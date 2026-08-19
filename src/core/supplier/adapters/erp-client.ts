import { type Result, err, ok } from '../../lib/result';
import { SUPPLIER_ERRORS, type TokenStore } from '../port';

/**
 * The HTTP seam. Base URL, Bearer, 401, retry/backoff, abort — and nothing
 * about the domain, which lives in `erp-map.ts`.
 *
 * `fetch` is injected (spec §0). The types below are the STRUCTURAL subset of
 * the platform `fetch` that this client actually uses, declared here rather
 * than imported from `lib.dom`, so a test can hand over a recorded transport
 * without constructing a `Response` and `src/core` keeps its "no ambient
 * globals" property.
 */

export interface HttpInit {
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: HttpInit) => Promise<HttpResponse>;

/**
 * The platform `fetch`, or null when there isn't one.
 *
 * Resolved LAZILY and only on the ERP arm of `createSupplier`, which is what
 * keeps the flag-off build from touching a network global at all. Read off
 * `globalThis` rather than called as a bare `fetch(...)` so nothing in
 * `src/core` closes over an ambient binding at module load.
 */
export function platformFetch(): FetchLike | null {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  return typeof candidate === 'function' ? (candidate as FetchLike) : null;
}

export interface ErpRequest {
  method: 'GET' | 'POST';
  /** Path below the portal root, e.g. `/orders/{id}`. */
  path: string;
  query?: Record<string, string | number | undefined> | undefined;
  body?: unknown;
  /** Send no Authorization header at all (login only). */
  anonymous?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface ErpClientOptions {
  baseUrl: string;
  fetch: FetchLike;
  tokens: TokenStore;
  /** Injected so retry/backoff is instant and deterministic under test. */
  wait?: ((ms: number) => Promise<void>) | undefined;
  /** Called when the ERP says 401. The adapter drops the whole session here. */
  onUnauthorized?: (() => void) | undefined;
}

export interface ErpClient {
  send<T>(request: ErpRequest): Promise<Result<T>>;
  /** After a successful login/refresh. Never read back out through the port. */
  setToken(token: string): void;
  clearToken(): void;
  hasToken(): boolean;
}

export const PORTAL_ROOT = '/api/portal/v1';

/** Two retries, on the transport failures that are plausibly transient. */
const MAX_RETRIES = 2;
const BACKOFF_MS = [200, 600] as const;

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Joins the dealer's base URL with the portal root and a path.
 *
 * A trailing slash on the configured base is the classic double-slash bug, and
 * `//orders` against some gateways is a different route than `/orders`.
 */
export function erpUrl(baseUrl: string, path: string, query?: ErpRequest['query']): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return `${base}${PORTAL_ROOT}${suffix}${qs ? `?${qs}` : ''}`;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export function createErpClient(options: ErpClientOptions): ErpClient {
  const { baseUrl, fetch: send, tokens } = options;
  const wait = options.wait ?? defaultWait;

  async function attempt<T>(request: ErpRequest): Promise<Result<T> | 'retry'> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = tokens.read();
    if (!request.anonymous && token) headers.Authorization = `Bearer ${token}`;
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: HttpResponse;
    try {
      response = await send(erpUrl(baseUrl, request.path, request.query), {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (error) {
      // An abort is a decision, not a failure — retrying it would defeat the
      // caller that made it.
      if (isAbortError(error)) return err<T>(SUPPLIER_ERRORS.aborted);
      return 'retry';
    }

    if (response.status === 401) {
      // A 401 on an ANONYMOUS request is a rejected sign-in, not a lapsed
      // session, and the two must not share a sentence: telling someone who
      // mistyped their password that their session has ended sends them to
      // look for a problem that is not there. It also must not fire
      // `onUnauthorized`, which is the shell's "you have been signed out" hook
      // — there was nothing to sign out of.
      if (request.anonymous) return err<T>(SUPPLIER_ERRORS.badCredentials);
      // Otherwise the session is gone. Drop the token here rather than letting
      // the next call re-present a credential the server has already refused,
      // and never fall back to sim — mode is config, never a fallback (§1.2).
      tokens.clear();
      options.onUnauthorized?.();
      return err<T>(SUPPLIER_ERRORS.sessionGone);
    }
    if (response.status === 403) return err<T>(SUPPLIER_ERRORS.forbidden);
    // 404 is also how the ERP answers a cross-tenant id — every route resolves
    // its id together with the caller's customer_id, so "someone else's order"
    // and "no such order" are indistinguishable by construction (§2.4). The
    // adapter must not try to tell them apart either.
    if (response.status === 404) return err<T>(SUPPLIER_ERRORS.notFound);
    if (response.status >= 500) return 'retry';
    if (!response.ok) return err<T>(SUPPLIER_ERRORS.unavailable);

    let raw: string;
    try {
      raw = await response.text();
    } catch {
      return err<T>(SUPPLIER_ERRORS.malformed);
    }
    if (raw === '') return ok(undefined as T);
    try {
      return ok(JSON.parse(raw) as T);
    } catch {
      return err<T>(SUPPLIER_ERRORS.malformed);
    }
  }

  return {
    async send<T>(request: ErpRequest): Promise<Result<T>> {
      for (let tries = 0; ; tries += 1) {
        const outcome = await attempt<T>(request);
        if (outcome !== 'retry') return outcome;
        if (tries >= MAX_RETRIES) return err<T>(SUPPLIER_ERRORS.unavailable);
        await wait(BACKOFF_MS[Math.min(tries, BACKOFF_MS.length - 1)] ?? 600);
      }
    },
    setToken: (token) => tokens.write(token),
    clearToken: () => tokens.clear(),
    hasToken: () => tokens.read() !== null,
  };
}
