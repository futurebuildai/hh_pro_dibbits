import { type Result, err, ok } from '../../../lib/result';
import type { IsoDateTime } from '../../../lib/time';
import { SUPPLIER_REFUSALS } from '../../port';

/**
 * The fetch wrapper: base URL, Bearer, 401, retry/backoff, abort.
 *
 * Plain TypeScript with an INJECTED fetch. Nothing here reads an ambient
 * global — not `fetch`, not `sessionStorage`, not `location`. `src/core` is
 * framework-free and its test project runs in node, so a module that reaches
 * for a browser global passes review and then fails in a Lit build.
 *
 * Three behaviours are contractual rather than incidental, and each has a test:
 *
 * 1. **A 404 is not a 403.** The ERP resolves every id together with the
 *    caller's `customer_id` in the same query, so another tenant's order id
 *    answers 404 — that is the IDOR-safe design, and it means "not found" and
 *    "not allowed" are DIFFERENT ANSWERS carrying different sentences.
 *
 * 2. **A 401 ends the session, and never falls back to the simulator.** A
 *    portal that quietly starts serving fabricated prices when its ERP session
 *    lapses is the single worst failure this integration can have. The token is
 *    cleared, `onSessionLost` fires once, and the caller gets a refusal. Mode
 *    is configuration; it is never a fallback.
 *
 * 3. **Only GETs retry.** A 429 or a 5xx on a read is worth another attempt on
 *    a job-site LTE connection. An auth POST is not retried: `refresh` rotates
 *    the token server-side, so a retry can race its own success.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Where the bearer token lives.
 *
 * An interface rather than a concrete store, because custody is a HOST
 * decision: the browser shell mirrors it to `sessionStorage` — not
 * `localStorage`, and not one of the twelve persisted stores, because a bearer
 * token must never land in the `hh:corrupt-backup` forensic stash or ride a
 * cross-tab `storage` event. Core states the requirement and holds none of it.
 */
export interface TokenStore {
  get(): string | null;
  set(token: string, expiresAt: IsoDateTime): void;
  clear(): void;
  expiresAt(): IsoDateTime | null;
}

export function createMemoryTokenStore(): TokenStore {
  let token: string | null = null;
  let expires: IsoDateTime | null = null;
  return {
    get: () => token,
    set: (next, at) => {
      token = next;
      expires = at;
    },
    clear: () => {
      token = null;
      expires = null;
    },
    expiresAt: () => expires,
  };
}

/**
 * The only paths this client may POST to.
 *
 * Stage 1 is read-only, and "read-only" enforced by a comment is a convention.
 * An allowlist checked at the transport is a guarantee: a future adapter method
 * that tries to POST an order body is refused by its own client, whatever the
 * calling code believes it is doing.
 */
export const AUTH_PATHS = ['/login', '/token/refresh'] as const;

export const SESSION_ENDED = SUPPLIER_REFUSALS.sessionEnded;
export const NOT_FOUND = SUPPLIER_REFUSALS.notFound;
export const NOT_PERMITTED = SUPPLIER_REFUSALS.notPermitted;
export const UNREACHABLE = SUPPLIER_REFUSALS.unreachable;
export const CANCELLED = SUPPLIER_REFUSALS.cancelled;

export interface ErpClientOptions {
  /** Required in ERP mode. Trailing slashes are normalised away. */
  baseUrl: string;
  fetch: FetchLike;
  tokens?: TokenStore | undefined;
  /** Fired once when a 401 clears the session, so the shell can show login. */
  onSessionLost?: (() => void) | undefined;
  /** Retries for a GET, on 429/5xx/network only. Default 2. */
  retries?: number | undefined;
  /** Base backoff in ms; doubles per attempt. Default 250. */
  backoffMs?: number | undefined;
  /** Injected so a test does not wait out a real backoff. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined> | undefined;
  signal?: AbortSignal | undefined;
}

export interface ErpClient {
  get(path: string, options?: RequestOptions): Promise<Result<unknown>>;
  /** POST, restricted to `AUTH_PATHS`. */
  authPost(path: string, body: unknown, options?: RequestOptions): Promise<Result<unknown>>;
  tokens: TokenStore;
}

/** `/api/portal/v1` is the portal surface; the dealer configures the origin. */
const API_PREFIX = '/api/portal/v1';

function joinUrl(baseUrl: string, path: string, query: RequestOptions['query']): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const params: string[] = [];
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return `${base}${API_PREFIX}${suffix}${params.length > 0 ? `?${params.join('&')}` : ''}`;
}

function isAborted(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'AbortError'
  );
}

export function createErpClient(options: ErpClientOptions): ErpClient {
  const tokens = options.tokens ?? createMemoryTokenStore();
  const retries = options.retries ?? 2;
  const backoffMs = options.backoffMs ?? 250;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let sessionLostAnnounced = false;

  function endSession(): Result<unknown> {
    tokens.clear();
    if (!sessionLostAnnounced) {
      sessionLostAnnounced = true;
      options.onSessionLost?.();
    }
    return err(SESSION_ENDED);
  }

  async function send(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    request: RequestOptions | undefined,
  ): Promise<Result<unknown>> {
    const url = joinUrl(options.baseUrl, path, request?.query);
    const maxAttempts = method === 'GET' ? retries + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const headers: Record<string, string> = { Accept: 'application/json' };
      const token = tokens.get();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (method === 'POST') headers['Content-Type'] = 'application/json';

      let response: Response;
      try {
        response = await options.fetch(url, {
          method,
          headers,
          ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
          ...(request?.signal ? { signal: request.signal } : {}),
        });
      } catch (error) {
        // A hang-up is the caller's own doing and is never retried.
        if (isAborted(error, request?.signal)) return err(CANCELLED);
        if (attempt < maxAttempts - 1) {
          await sleep(backoffMs * 2 ** attempt);
          continue;
        }
        return err(UNREACHABLE);
      }

      if (response.status === 401) return endSession();
      // 403 and 404 are different answers and stay different sentences.
      if (response.status === 403) return err(NOT_PERMITTED);
      if (response.status === 404) return err(NOT_FOUND);

      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxAttempts - 1) {
          await sleep(backoffMs * 2 ** attempt);
          continue;
        }
        return err(UNREACHABLE);
      }

      if (!response.ok) return err(UNREACHABLE);

      try {
        return ok((await response.json()) as unknown);
      } catch {
        return err(UNREACHABLE);
      }
    }

    return err(UNREACHABLE);
  }

  return {
    tokens,
    get: (path, request) => send('GET', path, undefined, request),
    authPost: (path, body, request) => {
      if (!(AUTH_PATHS as readonly string[]).includes(path)) {
        // Not thrown: this is a caller bug, and a Result keeps the failure on
        // the same channel every other refusal in this codebase uses.
        return Promise.resolve(err(`${path} is not an auth route — this adapter only reads.`));
      }
      return send('POST', path, body, request);
    },
  };
}
