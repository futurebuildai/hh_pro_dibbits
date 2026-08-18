import type { FetchLike, HttpInit, HttpResponse } from '../adapters/erp-client';
import billingSummary from './fixtures/billing-summary.json';
import catalogSearch from './fixtures/catalog-search.json';
import config from './fixtures/config.json';
import dashboard from './fixtures/dashboard.json';
import error401 from './fixtures/error-401.json';
import error403 from './fixtures/error-403.json';
import error404 from './fixtures/error-404.json';
import invoiceDetail from './fixtures/invoice-detail.json';
import invoicesPage from './fixtures/invoices-page.json';
import login from './fixtures/login.json';
import meAccountAdmin from './fixtures/me-account-admin.json';
import meBuyerNoPay from './fixtures/me-buyer-no-pay.json';
import meFieldCrew from './fixtures/me-field-crew.json';
import orderDetail from './fixtures/order-detail.json';
import ordersPage from './fixtures/orders-page.json';
import quoteDetail from './fixtures/quote-detail.json';
import quotesPage from './fixtures/quotes-page.json';
import refreshDemoted from './fixtures/refresh-demoted.json';
import refresh from './fixtures/refresh.json';

/**
 * Recorded-fixture mode.
 *
 * DIB-479 (the ERP half of Stage 1) exists as code on
 * `feedback/dib-479-portal-stage1a` and has not merged to a reachable server,
 * so every response below is shaped from the Go struct that will serialize it
 * rather than captured off the wire. Each fixture names its source struct in
 * `fixtures/` and the field names are transcribed, not guessed — see
 * NOTES-DIB480.md for the provenance table and what that does and does not buy.
 *
 * The transport RECORDS every request. That is half the point: a contract test
 * that only checks the parsed body would pass an adapter that POSTed to a read
 * route, and the whole promise of Stage 1 is that it cannot.
 */

export const FIXTURES = {
  login,
  refresh,
  refreshDemoted,
  meAccountAdmin,
  meBuyerNoPay,
  meFieldCrew,
  config,
  catalogSearch,
  dashboard,
  billingSummary,
  ordersPage,
  orderDetail,
  invoicesPage,
  invoiceDetail,
  quotesPage,
  quoteDetail,
  error401,
  error403,
  error404,
};

export interface RecordedCall {
  method: string;
  url: string;
  /** Path below `/api/portal/v1`, query stripped — the route key. */
  route: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface StubResponse {
  status?: number;
  body?: unknown;
}

/** `METHOD /route` -> the response, or a queue of responses consumed in order. */
export type RouteTable = Record<string, StubResponse | StubResponse[]>;

export interface Recorder {
  fetch: FetchLike;
  calls: RecordedCall[];
  /** Every non-GET request seen. The structural test asserts on this. */
  writes(): RecordedCall[];
}

function respond(stub: StubResponse): HttpResponse {
  const status = stub.status ?? 200;
  const text = stub.body === undefined ? '' : JSON.stringify(stub.body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(text),
  };
}

export function recorder(routes: RouteTable): Recorder {
  const calls: RecordedCall[] = [];
  const queues = new Map<string, StubResponse[]>();
  for (const [key, value] of Object.entries(routes)) {
    queues.set(key, Array.isArray(value) ? [...value] : [value]);
  }

  const fetchLike: FetchLike = (url: string, init: HttpInit) => {
    const parsed = new URL(url);
    const route = parsed.pathname.replace('/api/portal/v1', '');
    const query: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    calls.push({
      method: init.method,
      url,
      route,
      query,
      headers: { ...init.headers },
      body: init.body,
    });

    const key = `${init.method} ${route}`;
    const queue = queues.get(key);
    if (!queue || queue.length === 0) {
      return Promise.resolve(respond({ status: 404, body: FIXTURES.error404 }));
    }
    // The last entry repeats, so a route can be called twice without the test
    // having to say how many times the adapter happens to call it today.
    const next = queue.length > 1 ? (queue.shift() as StubResponse) : (queue[0] as StubResponse);
    return Promise.resolve(respond(next));
  };

  return {
    fetch: fetchLike,
    calls,
    writes: () => calls.filter((call) => call.method !== 'GET'),
  };
}

/** The routes a signed-in Stage 1 session answers, all happy-path. */
export function signedInRoutes(): RouteTable {
  return {
    'POST /login': { body: FIXTURES.login },
    'POST /token/refresh': { body: FIXTURES.refresh },
    'GET /me': { body: FIXTURES.meAccountAdmin },
    'GET /config': { body: FIXTURES.config },
    'GET /catalog/search': { body: FIXTURES.catalogSearch },
    'GET /dashboard': { body: FIXTURES.dashboard },
    'GET /billing/summary': { body: FIXTURES.billingSummary },
    'GET /orders': { body: FIXTURES.ordersPage },
    'GET /orders/ord_7741': { body: FIXTURES.orderDetail },
    'GET /invoices': { body: FIXTURES.invoicesPage },
    'GET /invoices/inv_9142': { body: FIXTURES.invoiceDetail },
    'GET /quotes': { body: FIXTURES.quotesPage },
    'GET /quotes/qt_3355': { body: FIXTURES.quoteDetail },
  };
}

export const BASE_URL = 'https://erp.dibbits.example';

/** Retry/backoff without the wait, so a 500-then-200 test runs in microseconds. */
export const noWait = (): Promise<void> => Promise.resolve();

/**
 * `x!` for tests, without the `!`.
 *
 * Biome forbids non-null assertions repo-wide, and rightly — but a test that
 * indexes a recorded call list has to narrow somehow. Throwing here fails the
 * test at the line that was wrong, which a `!` followed by a property access
 * would report several frames later as "cannot read property of undefined".
 */
export function need<T>(value: T | null | undefined, what = 'a value'): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}, got ${value}`);
  return value;
}
