import { describe, expect, it, vi } from 'vitest';
import {
  AUTH_PATHS,
  type FetchLike,
  createErpClient,
  createMemoryTokenStore,
} from '../adapters/erp/client';
import { SUPPLIER_REFUSALS } from '../port';

/**
 * The transport's own contract: what a status code MEANS to a contractor.
 *
 * These are the behaviours a mapper test cannot reach, and each of them is a
 * decision the spec forced: a lapsed session must not degrade into simulated
 * data, another tenant's id must answer "not found" rather than "not allowed",
 * and a flaky job-site connection must be retried without a write being
 * replayed.
 */

const BASE_URL = 'https://erp.dibbits.example/';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Replays a queue of responses, one per attempt; the last one repeats. */
function queued(responses: [Response | Error, ...(Response | Error)[]]): {
  fetch: FetchLike;
  count: () => number;
} {
  let index = 0;
  return {
    count: () => index,
    fetch: () => {
      const next = responses[Math.min(index, responses.length - 1)] ?? responses[0];
      index += 1;
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

const noSleep = () => Promise.resolve();

describe('addressing', () => {
  it('builds the portal path from the dealer origin, trailing slash and all', async () => {
    const seen: string[] = [];
    const client = createErpClient({
      baseUrl: BASE_URL,
      fetch: (url) => {
        seen.push(url);
        return Promise.resolve(json({}));
      },
    });

    await client.get('/quotes', { query: { since: 'abc', limit: 10, skip: undefined } });

    expect(seen[0]).toBe('https://erp.dibbits.example/api/portal/v1/quotes?since=abc&limit=10');
  });
});

describe('401 ends the session', () => {
  it('clears the token, announces once, and refuses — it never falls back', async () => {
    const tokens = createMemoryTokenStore();
    tokens.set('live.token', '2026-08-19T18:00:00.000Z');
    const onSessionLost = vi.fn();
    const client = createErpClient({
      baseUrl: BASE_URL,
      fetch: () => Promise.resolve(json({ error: 'unauthorized' }, 401)),
      tokens,
      onSessionLost,
      sleep: noSleep,
    });

    const first = await client.get('/me');
    const second = await client.get('/invoices');

    expect(first).toEqual({ ok: false, error: SUPPLIER_REFUSALS.sessionEnded });
    expect(second).toEqual({ ok: false, error: SUPPLIER_REFUSALS.sessionEnded });
    expect(tokens.get()).toBeNull();
    // Once, not once per in-flight request — the shell shows one login screen.
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('but a 401 on the login route is a wrong password, not a lapsed session', async () => {
    const onSessionLost = vi.fn();
    const client = createErpClient({
      baseUrl: BASE_URL,
      fetch: () => Promise.resolve(json({ error: 'invalid_credentials' }, 401)),
      onSessionLost,
      sleep: noSleep,
    });

    const result = await client.authPost('/login', { email: 'a@b.c', password: 'wrong' });

    expect(result).toEqual({ ok: false, error: SUPPLIER_REFUSALS.badCredentials });
    // Telling someone who mistyped their password that they have been signed
    // out — and bouncing them to the screen they are already on — is worse
    // than useless.
    expect(onSessionLost).not.toHaveBeenCalled();
  });

  it('is not retried: a revoked session does not become more valid on attempt three', async () => {
    const replay = queued([json({}, 401), json({ ok: true })]);
    const client = createErpClient({ baseUrl: BASE_URL, fetch: replay.fetch, sleep: noSleep });

    await client.get('/me');

    expect(replay.count()).toBe(1);
  });
});

describe('403 and 404 stay different answers', () => {
  it('renders 404 as not-found', async () => {
    const client = createErpClient({
      baseUrl: BASE_URL,
      fetch: () => Promise.resolve(json({}, 404)),
    });

    expect(await client.get('/orders/other_tenant')).toEqual({
      ok: false,
      error: SUPPLIER_REFUSALS.notFound,
    });
  });

  it('renders 403 as a permission refusal', async () => {
    const client = createErpClient({
      baseUrl: BASE_URL,
      fetch: () => Promise.resolve(json({}, 403)),
    });

    expect(await client.get('/users')).toEqual({
      ok: false,
      error: SUPPLIER_REFUSALS.notPermitted,
    });
  });
});

describe('retry', () => {
  it('retries a read through a 503 and returns the eventual answer', async () => {
    const replay = queued([json({}, 503), json({}, 503), json({ dealer_name: 'Dibbits' })]);
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const client = createErpClient({ baseUrl: BASE_URL, fetch: replay.fetch, sleep });

    const result = await client.get('/config');

    expect(result).toEqual({ ok: true, value: { dealer_name: 'Dibbits' } });
    expect(replay.count()).toBe(3);
    // Backoff doubles rather than hammering a struggling server.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 500]);
  });

  it('retries a network failure, then gives up with a connection sentence', async () => {
    const replay = queued([new Error('ECONNRESET')]);
    const client = createErpClient({ baseUrl: BASE_URL, fetch: replay.fetch, sleep: noSleep });

    expect(await client.get('/orders')).toEqual({
      ok: false,
      error: SUPPLIER_REFUSALS.unreachable,
    });
    expect(replay.count()).toBe(3);
  });

  it('never retries an auth POST — a refresh rotates the token server-side', async () => {
    const replay = queued([json({}, 500)]);
    const client = createErpClient({ baseUrl: BASE_URL, fetch: replay.fetch, sleep: noSleep });

    await client.authPost('/token/refresh', {});

    expect(replay.count()).toBe(1);
  });

  it('treats a 429 as worth waiting for', async () => {
    const replay = queued([json({}, 429), json({ ok: true })]);
    const client = createErpClient({ baseUrl: BASE_URL, fetch: replay.fetch, sleep: noSleep });

    expect(await client.get('/catalog/search')).toEqual({ ok: true, value: { ok: true } });
  });
});

describe('abort', () => {
  it('reports a hang-up as cancelled and does not retry it', async () => {
    const controller = new AbortController();
    let attempts = 0;
    const client = createErpClient({
      baseUrl: BASE_URL,
      fetch: () => {
        attempts += 1;
        controller.abort();
        const error = new Error('aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      },
      sleep: noSleep,
    });

    const result = await client.get('/orders', { signal: controller.signal });

    expect(result).toEqual({ ok: false, error: SUPPLIER_REFUSALS.cancelled });
    expect(attempts).toBe(1);
  });
});

describe('the transport is read-only by construction', () => {
  it('refuses a POST to anything that is not an auth route', async () => {
    let called = false;
    const client = createErpClient({
      baseUrl: BASE_URL,
      fetch: () => {
        called = true;
        return Promise.resolve(json({}));
      },
    });

    const result = await client.authPost('/orders/so_1/cancel-request', { reason: 'weather' });

    expect(result.ok).toBe(false);
    // Refused before a byte left: the guarantee is at the transport, not in a
    // comment above the caller.
    expect(called).toBe(false);
  });

  it('allows exactly the two auth routes and no others', () => {
    expect([...AUTH_PATHS]).toEqual(['/login', '/token/refresh']);
  });
});

describe('a body it cannot parse is a refusal', () => {
  it('does not hand a half-read response to the mapper', async () => {
    const client = createErpClient({
      baseUrl: BASE_URL,
      fetch: () => Promise.resolve(new Response('<!doctype html>', { status: 200 })),
    });

    // The SPA fallback answers 200 with HTML. "200 means mounted" was never
    // true in this codebase, and it is not true here either.
    expect(await client.get('/me')).toEqual({
      ok: false,
      error: SUPPLIER_REFUSALS.unreachable,
    });
  });
});
