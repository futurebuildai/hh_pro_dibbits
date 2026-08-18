import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../domain/config';
import { createErpSupplier } from '../adapters/erp';
import { FORBIDDEN_WIRE_FIELDS } from '../adapters/erp-map';
import type { SupplierPort } from '../port';
import { SUPPLIER_ERRORS } from '../port';
import {
  BASE_URL,
  FIXTURES,
  type RouteTable,
  need,
  noWait,
  recorder,
  signedInRoutes,
} from './recorded';

/**
 * Contract tests for every Stage 1 read.
 *
 * Each one asserts three separate things, because each catches a different
 * class of mistake:
 *   1. the REQUEST — verb, route, query, and the Bearer header;
 *   2. the RESPONSE mapping — the domain object the fixture becomes;
 *   3. what did NOT survive — no wire field the contract does not name.
 *
 * The third is the one that would otherwise rot. An adapter that spreads the
 * wire object passes (1) and (2) forever and leaks the next field the ERP adds.
 */

function build(routes: RouteTable = signedInRoutes()) {
  const rec = recorder(routes);
  const supplier: SupplierPort = createErpSupplier({
    baseUrl: BASE_URL,
    fetch: rec.fetch,
    wait: noWait,
  });
  return { rec, supplier };
}

async function signedIn(routes: RouteTable = signedInRoutes()) {
  const built = build(routes);
  const result = await built.supplier.auth?.login({
    email: 'ryan@coppslandscaping.example',
    password: 'correct horse',
  });
  expect(result?.ok).toBe(true);
  return built;
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
}

describe('auth', () => {
  it('logs in against POST /login and never sends a token with the credentials', async () => {
    const { rec, supplier } = build();
    const session = unwrap(
      await need(supplier.auth).login({ email: 'ryan@coppslandscaping.example', password: 'pw' }),
    );

    const call = need(rec.calls[0]);
    expect(call.method).toBe('POST');
    expect(call.url).toBe(`${BASE_URL}/api/portal/v1/login`);
    expect(call.headers.Authorization).toBeUndefined();
    expect(JSON.parse(call.body ?? '{}')).toEqual({
      email: 'ryan@coppslandscaping.example',
      password: 'pw',
    });

    expect(session.identity.userId).toBe('pu_ryan');
    expect(session.identity.accountId).toBe('cus_copps');
    expect(session.identity.role).toBe('account_admin');
    expect(session.branding.companyName).toBe('Dibbits Landscape Supply');
  });

  /**
   * The bearer token is the adapter's and nobody else's. A `token` reachable
   * from the session is a token that eventually lands in one of the twelve
   * stores HH Pro persists to localStorage.
   */
  it('hands back no token, at any depth of the session object', async () => {
    const { supplier } = build();
    const session = unwrap(await need(supplier.auth).login({ email: 'a@b.c', password: 'pw' }));
    expect(JSON.stringify(session)).not.toContain(FIXTURES.login.token);
    expect(JSON.stringify(session)).not.toContain('token');
  });

  it('resolves capabilities from GET /me, not from a local table', async () => {
    const { rec, supplier } = build();
    await need(supplier.auth).login({ email: 'a@b.c', password: 'pw' });

    const me = need(rec.calls[1]);
    expect(me.method).toBe('GET');
    expect(me.route).toBe('/me');
    expect(me.headers.Authorization).toBe(`Bearer ${FIXTURES.login.token}`);
  });

  /**
   * The ERP ships `expires_at` / `session_expires_at` on REFRESH only; the
   * login response has neither. Reporting null is the honest answer and it is
   * pinned here so nobody "fixes" it by decoding the JWT client-side — the
   * whole reason DIB-479 hands the instants over is so a client never parses a
   * token. Filed as a one-field ERP extension in NOTES-DIB480.md.
   */
  it('reports null expiry after login, because the login response carries none', async () => {
    const { supplier } = build();
    const session = unwrap(await need(supplier.auth).login({ email: 'a@b.c', password: 'pw' }));
    expect(session.expiresAt).toBeNull();
    expect(session.sessionExpiresAt).toBeNull();
  });

  it('refreshes against POST /token/refresh and carries both instants forward', async () => {
    const { rec, supplier } = await signedIn();
    const session = unwrap(await need(supplier.auth).refresh());

    const call = need(rec.calls.find((c) => c.route === '/token/refresh'));
    expect(call.method).toBe('POST');
    expect(call.headers.Authorization).toBe(`Bearer ${FIXTURES.login.token}`);
    expect(session.expiresAt).toBe('2026-08-19T02:14:00Z');
    expect(session.sessionExpiresAt).toBe('2026-08-24T18:02:41Z');
  });

  it('does not re-read /me on a refresh that returns the same role', async () => {
    const { rec, supplier } = await signedIn();
    const before = rec.calls.filter((c) => c.route === '/me').length;
    await need(supplier.auth).refresh();
    expect(rec.calls.filter((c) => c.route === '/me').length).toBe(before);
  });

  /**
   * The ERP mints the refreshed token from the FRESHLY LOADED user, so someone
   * demoted five minutes ago refreshes into their new role. Holding the old
   * capability map would leave the app enabling buttons the server now refuses.
   */
  it('re-resolves capabilities when a refresh comes back with a different role', async () => {
    const routes = signedInRoutes();
    routes['POST /token/refresh'] = { body: FIXTURES.refreshDemoted };
    routes['GET /me'] = [{ body: FIXTURES.meAccountAdmin }, { body: FIXTURES.meFieldCrew }];
    const { supplier } = await signedIn(routes);

    const session = unwrap(await need(supplier.auth).refresh());
    expect(session.identity.role).toBe('field_crew');
    expect(session.identity.capabilities['move-stage']).toBe(false);
    expect(session.identity.capabilities['manage-team']).toBe(false);
  });

  it('refuses to refresh with no session rather than calling the ERP', async () => {
    const { rec, supplier } = build();
    const result = await need(supplier.auth).refresh();
    expect(result).toEqual({ ok: false, error: SUPPLIER_ERRORS.sessionGone });
    expect(rec.calls).toEqual([]);
  });

  /**
   * A token whose permissions could not be read is not a usable session. Keeping
   * it would leave the app authenticated and unauthorized — the state in which a
   * client starts inventing its own answer.
   */
  it('drops the token when /me fails after a good login', async () => {
    const routes = signedInRoutes();
    routes['GET /me'] = { status: 500 };
    const { rec, supplier } = build(routes);

    const result = await need(supplier.auth).login({ email: 'a@b.c', password: 'pw' });
    expect(result.ok).toBe(false);
    expect(need(supplier.auth).session()).toBeNull();

    await supplier.reads.dashboard();
    const dashboardCall = need(rec.calls.find((c) => c.route === '/dashboard'));
    expect(dashboardCall.headers.Authorization).toBeUndefined();
  });

  /**
   * A rejected sign-in and a lapsed session are both 401s and they are not the
   * same event. Telling someone who mistyped their password that their session
   * has ended sends them looking for a problem that is not there — and firing
   * the shell's signed-out hook on a login screen nobody was signed in to is
   * how a login form starts flickering.
   */
  it('tells a bad password apart from a dead session', async () => {
    const routes = signedInRoutes();
    routes['POST /login'] = { status: 401, body: FIXTURES.error401 };
    let lost = 0;
    const rec = recorder(routes);
    const supplier = createErpSupplier({
      baseUrl: BASE_URL,
      fetch: rec.fetch,
      wait: noWait,
      onSessionLost: () => {
        lost += 1;
      },
    });

    const result = await need(supplier.auth).login({ email: 'a@b.c', password: 'wrong' });
    expect(result).toEqual({ ok: false, error: SUPPLIER_ERRORS.badCredentials });
    expect(result).not.toEqual({ ok: false, error: SUPPLIER_ERRORS.sessionGone });
    expect(lost).toBe(0);
  });

  /**
   * A refresh that comes back without a token must not advance the session's
   * expiry: the held token is still the live one, and a client scheduling off
   * an instant that belongs to a token it never adopted refreshes too late.
   */
  it('does not advance the expiry on a refresh it had to refuse', async () => {
    const routes = signedInRoutes();
    routes['POST /token/refresh'] = { body: { ...FIXTURES.refresh, token: '' } };
    const { supplier } = await signedIn(routes);

    const before = need(supplier.auth).session();
    expect(before?.expiresAt).toBeNull();

    const result = await need(supplier.auth).refresh();
    expect(result).toEqual({ ok: false, error: SUPPLIER_ERRORS.malformed });
    expect(need(supplier.auth).session()?.expiresAt).toBeNull();
  });

  it('signs out by forgetting the token, so the next read is anonymous', async () => {
    const { rec, supplier } = await signedIn();
    need(supplier.auth).signOut();
    expect(need(supplier.auth).session()).toBeNull();

    await supplier.reads.branding();
    const call = need(rec.calls.find((c) => c.route === '/config'));
    expect(call.headers.Authorization).toBeUndefined();
  });
});

describe('capabilities', () => {
  it('maps an account_admin onto every HH Pro capability', async () => {
    const { supplier } = build();
    const identity = unwrap(await supplier.reads.me());
    expect(identity.capabilities).toEqual({
      'edit-scope': true,
      'move-stage': true,
      'customer-quote': true,
      pay: true,
      'confirm-pickup': true,
      'manage-team': true,
    });
  });

  it('gives a field_crew only what the ERP gave them', async () => {
    const routes = signedInRoutes();
    routes['GET /me'] = { body: FIXTURES.meFieldCrew };
    const { supplier } = build(routes);
    const identity = unwrap(await supplier.reads.me());
    expect(identity.capabilities).toEqual({
      'edit-scope': false,
      'move-stage': false,
      'customer-quote': true,
      pay: false,
      'confirm-pickup': true,
      'manage-team': false,
    });
  });

  /**
   * `buyer_no_pay` is the DIB-479 role that makes HH Pro's `pm` persona
   * enforceable (OR-2). It holds SubmitRFQ and CreateOrders but neither pay
   * capability — so `move-stage` is on and `pay` is off, which is precisely the
   * distinction HH Pro's own role table has always made and the ERP could not.
   */
  it('represents the pm persona through buyer_no_pay', async () => {
    const routes = signedInRoutes();
    routes['GET /me'] = { body: FIXTURES.meBuyerNoPay };
    const { supplier } = build(routes);
    const identity = unwrap(await supplier.reads.me());
    expect(identity.capabilities['move-stage']).toBe(true);
    expect(identity.capabilities.pay).toBe(false);
    expect(identity.erpCapabilities.submitRfq).toBe(true);
    expect(identity.erpCapabilities.payInvoices).toBe(false);
  });

  /**
   * The contractor's homeowner proposals have no ERP analogue (§4.5). Deriving
   * this from the server means deriving it as false and deleting a working
   * local feature for every signed-in contractor.
   */
  it('never lets the server switch off customer quotes', async () => {
    const routes = signedInRoutes();
    routes['GET /me'] = { body: FIXTURES.meFieldCrew };
    const { supplier } = build(routes);
    const identity = unwrap(await supplier.reads.me());
    expect(identity.capabilities['customer-quote']).toBe(true);
  });
});

describe('config / branding', () => {
  it('reads GET /config and drops the fields DealerBranding has no home for', async () => {
    const { rec, supplier } = build();
    const branding = unwrap(await supplier.reads.branding());

    expect(need(rec.calls[0]).method).toBe('GET');
    expect(need(rec.calls[0]).route).toBe('/config');
    expect(branding).toEqual({
      companyName: 'Dibbits Landscape Supply',
      brandColor: '#E8A74E',
    });
    expect(JSON.stringify(branding)).not.toContain('support_email');
  });

  /**
   * These values are interpolated into a stylesheet. An ERP is not a more
   * trustworthy source of a stylesheet fragment than a hand-edited config file,
   * and the whole PLATFORM token layer is downstream of getting this wrong.
   */
  it('refuses a colour the config validator would refuse', async () => {
    const routes = signedInRoutes();
    routes['GET /config'] = {
      body: { ...FIXTURES.config, primary_color: 'red; } :root { --surface: black } .x {' },
    };
    const { supplier } = build(routes);
    const branding = unwrap(await supplier.reads.branding());
    expect(branding.brandColor).toBe(DEFAULT_CONFIG.branding.brandColor);
  });

  it('drops a remote logo URL rather than beaconing every visit to it', async () => {
    const routes = signedInRoutes();
    routes['GET /config'] = { body: { ...FIXTURES.config, logo_url: 'https://cdn.evil/l.png' } };
    const { supplier } = build(routes);
    expect(unwrap(await supplier.reads.branding()).logoUrl).toBeUndefined();
  });
});

describe('catalog search', () => {
  it('sends q + limit and maps the compact hits', async () => {
    const { rec, supplier } = build();
    const hits = unwrap(await supplier.reads.searchCatalog({ query: 'blu 60', limit: 12 }));

    const call = need(rec.calls[0]);
    expect(call.method).toBe('GET');
    expect(call.route).toBe('/catalog/search');
    expect(call.query).toEqual({ q: 'blu 60', limit: '12' });

    expect(hits[0]).toEqual({
      productId: 'prd_blu60_champagne',
      sku: 'TB-BLU60-CHM',
      name: 'Blu 60 Smooth Paver — Champagne',
      category: 'Pavers',
      baseUom: 'SF',
    });
  });

  /**
   * A unit this build does not model becomes null, not a guess. A pallet read
   * as an each is the most expensive wrong number in this vertical.
   */
  it('renders an unmodelled UOM as null rather than defaulting it', async () => {
    const { supplier } = build();
    const hits = unwrap(await supplier.reads.searchCatalog({ query: 'crate' }));
    expect(need(hits[3]).baseUom).toBeNull();
  });

  it('carries no price field at all — the catalog route is price-free', async () => {
    const { supplier } = build();
    const hits = unwrap(await supplier.reads.searchCatalog({ query: 'blu' }));
    expect(JSON.stringify(hits)).not.toMatch(/price/i);
  });
});

describe('dashboard and billing summary', () => {
  it('maps the account facts domain/account.ts invents today', async () => {
    const { rec, supplier } = build();
    const snapshot = unwrap(await supplier.reads.dashboard());

    expect(need(rec.calls[0]).route).toBe('/dashboard');
    expect(snapshot).toEqual({
      accountId: 'cus_copps',
      accountNumber: 'C-10428',
      name: 'Copps Landscaping Ltd.',
      customerType: 'CONTRACTOR',
      branchId: 'br_kitchener',
      paymentTermsDays: 30,
      creditLimit: 2_000_000,
      onHold: false,
      openBalance: 1_420_000,
      availableCredit: 580_000,
    });
  });

  it('maps the numbers that explain a credit refusal', async () => {
    const { rec, supplier } = build();
    const summary = unwrap(await supplier.reads.billingSummary());
    expect(need(rec.calls[0]).route).toBe('/billing/summary');
    expect(summary).toEqual({
      openBalance: 1_420_000,
      creditLimit: 2_000_000,
      availableCredit: 580_000,
      onHold: false,
      paymentTermsDays: 30,
    });
  });
});

describe('orders read', () => {
  it('maps the page envelope and every order in it', async () => {
    const { rec, supplier } = build();
    const page = unwrap(await supplier.reads.listOrders({ limit: 25, offset: 0 }));

    expect(need(rec.calls[0]).route).toBe('/orders');
    expect(need(rec.calls[0]).query).toEqual({ limit: '25', offset: '0' });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(3);
  });

  /**
   * READY means "come and get it" on a will-call and "picked and staged" on a
   * delivery. Rendering "Ready for pickup" on a delivery sends a contractor to
   * the counter for something that is coming to them on a truck.
   */
  it('reads READY differently for a will-call and a delivery', async () => {
    const { supplier } = build();
    const page = unwrap(await supplier.reads.listOrders());
    expect(need(page.items[0]).status).toBe('ready-willcall');
    expect(need(page.items[0]).fulfillment).toBe('willcall');
    expect(need(page.items[1]).status).toBe('picking');
    expect(need(page.items[1]).fulfillment).toBe('delivery');
  });

  /** R-11: an unrecognised status renders neutrally, never as a stronger claim. */
  it('degrades a status it has never seen to the neutral one', async () => {
    const { supplier } = build();
    const page = unwrap(await supplier.reads.listOrders());
    expect(need(page.items[2]).status).toBe('submitted');
  });

  it('treats Go’s zero time as unset rather than the year 1', async () => {
    const { supplier } = build();
    const page = unwrap(await supplier.reads.listOrders());
    expect(need(page.items[2]).promisedDate).toBeUndefined();
  });

  /**
   * HH Pro has no tax model — `SalesOrder.subtotal` is the single number a
   * contractor sees for an order. Mapping the ERP's pre-tax subtotal would
   * understate every order by the tax.
   */
  it('shows the tax-inclusive total, because subtotal is the only number shown', async () => {
    const { supplier } = build();
    const order = unwrap(await supplier.reads.getOrder('ord_7741'));
    expect(order.subtotal).toBe(472_340);
    expect(order.subtotal).not.toBe(418_000);
  });

  /**
   * The board link arrives at Stage 3 with `erpPlan`. Until then an ERP order
   * belongs to no card, and the empty string is falsy so no board selector's
   * `so.orderId === order.id` can adopt it.
   */
  it('leaves the board-card link empty, and empty is falsy', async () => {
    const { supplier } = build();
    const order = unwrap(await supplier.reads.getOrder('ord_7741'));
    expect(order.orderId).toBe('');
    expect(order.tracking).toEqual([]);
  });

  it('carries no line, instruction, or wire field the domain type does not name', async () => {
    const { supplier } = build();
    const order = unwrap(await supplier.reads.getOrder('ord_7741'));
    expect(Object.keys(order).sort()).toEqual([
      'fulfillment',
      'id',
      'number',
      'orderId',
      'promisedDate',
      'status',
      'submittedAt',
      'subtotal',
      'tracking',
    ]);
  });
});

describe('invoices read', () => {
  it('maps an order-linked invoice as portal and a stray one as counter', async () => {
    const { rec, supplier } = build();
    const page = unwrap(await supplier.reads.listInvoices());

    expect(need(rec.calls[0]).route).toBe('/invoices');
    expect(need(page.items[0]).origin).toBe('portal');
    expect(need(page.items[0]).salesOrderId).toBe('ord_7690');
    expect(need(page.items[1]).origin).toBe('counter');
    expect(need(page.items[1]).salesOrderId).toBeUndefined();
  });

  it('maps the balance and the tax-inclusive total', async () => {
    const { supplier } = build();
    const invoice = unwrap(await supplier.reads.getInvoice('inv_9142'));
    expect(invoice.number).toBe('INV-9142');
    expect(invoice.subtotal).toBe(101_700);
    expect(invoice.balance).toBe(51_700);
    expect(invoice.dueAt).toBe('2026-08-30T00:00:00Z');
  });
});

describe('quotes read', () => {
  it('maps the ERP quote vocabulary onto HH Pro statuses', async () => {
    const { rec, supplier } = build();
    const page = unwrap(await supplier.reads.listQuotes());

    expect(need(rec.calls[0]).route).toBe('/quotes');
    expect(need(page.items[0]).status).toBe('priced');
    expect(need(page.items[1]).status).toBe('priced');
    expect(need(page.items[2]).status).toBe('in-review');
  });

  /**
   * `linePrices` is keyed by `scopeItemId` — an HH Pro id the ERP has never
   * seen until `erpPlan` syncs the plan board. Filling it means inventing a join.
   */
  it('leaves the priced lines empty rather than inventing the join', async () => {
    const { supplier } = build();
    const quote = unwrap(await supplier.reads.getQuote('qt_3355'));
    expect(quote.linePrices).toEqual([]);
    expect(quote.deskNote).toBeUndefined();
    expect(quote.expiresAt).toBe('2026-09-01T00:00:00Z');
  });
});

describe('refusals', () => {
  /**
   * Every ERP route resolves its id together with the caller's customer_id, so
   * someone else's order and no such order are the same answer by construction
   * (§2.4). The adapter must not try to tell them apart either.
   */
  it('answers a cross-tenant id with not-found, exactly as it answers a missing one', async () => {
    const routes = signedInRoutes();
    routes['GET /orders/ord_someone_else'] = { status: 404, body: FIXTURES.error404 };
    const { supplier } = await signedIn(routes);

    const crossTenant = await supplier.reads.getOrder('ord_someone_else');
    const missing = await supplier.reads.getOrder('ord_nope');
    expect(crossTenant).toEqual({ ok: false, error: SUPPLIER_ERRORS.notFound });
    expect(crossTenant).toEqual(missing);
  });

  it('keeps 403 distinct from 404 — a capability refusal is not a missing row', async () => {
    const routes = signedInRoutes();
    routes['GET /invoices'] = { status: 403, body: FIXTURES.error403 };
    const { supplier } = await signedIn(routes);
    expect(await supplier.reads.listInvoices()).toEqual({
      ok: false,
      error: SUPPLIER_ERRORS.forbidden,
    });
  });

  /**
   * Mode is config, never a fallback. A 401 ends the session and says so; it
   * does not quietly resume the simulator behind a screen the contractor
   * believes is their real account.
   */
  it('drops the session on a 401 and never falls back to the sim', async () => {
    const routes = signedInRoutes();
    routes['GET /dashboard'] = { status: 401, body: FIXTURES.error401 };
    let lost = 0;
    const rec = recorder(routes);
    const supplier = createErpSupplier({
      baseUrl: BASE_URL,
      fetch: rec.fetch,
      wait: noWait,
      onSessionLost: () => {
        lost += 1;
      },
    });
    await need(supplier.auth).login({ email: 'a@b.c', password: 'pw' });

    const result = await supplier.reads.dashboard();
    expect(result).toEqual({ ok: false, error: SUPPLIER_ERRORS.sessionGone });
    expect(lost).toBe(1);
    expect(need(supplier.auth).session()).toBeNull();
    expect(supplier.mode).toBe('erp');
  });

  it('retries a 500 and gives up with a sentence a contractor can act on', async () => {
    const routes = signedInRoutes();
    routes['GET /quotes'] = { status: 500 };
    const { rec, supplier } = build(routes);
    expect(await supplier.reads.listQuotes()).toEqual({
      ok: false,
      error: SUPPLIER_ERRORS.unavailable,
    });
    expect(rec.calls.filter((c) => c.route === '/quotes')).toHaveLength(3);
  });

  it('recovers when the retry succeeds', async () => {
    const routes = signedInRoutes();
    routes['GET /quotes'] = [{ status: 500 }, { body: FIXTURES.quotesPage }];
    const { supplier } = build(routes);
    expect(unwrap(await supplier.reads.listQuotes()).total).toBe(3);
  });

  it('refuses a body it cannot read instead of half-mapping it', async () => {
    const rec = recorder({});
    const supplier = createErpSupplier({
      baseUrl: BASE_URL,
      fetch: () =>
        Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('<!doctype html>') }),
      wait: noWait,
    });
    void rec;
    expect(await supplier.reads.billingSummary()).toEqual({
      ok: false,
      error: SUPPLIER_ERRORS.malformed,
    });
  });
});

/**
 * R-2, applied one stage early.
 *
 * Stage 1 has no pricing route, so nothing here should carry a margin today —
 * which is exactly why the test belongs here. It poisons every fixture with the
 * confidential field set and asserts the mapped output is still clean, so the
 * property is proven of the MAPPER rather than of the fixtures.
 */
describe('nothing confidential crosses the counter', () => {
  const poison = Object.fromEntries(FORBIDDEN_WIRE_FIELDS.map((field) => [field, 4242]));

  function poisoned(body: unknown): unknown {
    if (Array.isArray(body)) return body.map(poisoned);
    if (typeof body === 'object' && body !== null) {
      const out: Record<string, unknown> = { ...poison };
      for (const [key, value] of Object.entries(body)) out[key] = poisoned(value);
      return out;
    }
    return body;
  }

  it('recorded fixtures are margin-free to begin with', () => {
    const all = JSON.stringify(FIXTURES);
    for (const field of FORBIDDEN_WIRE_FIELDS) {
      // `detail` and `source` are generic words; assert on the JSON key form.
      expect(all).not.toContain(`"${field}"`);
    }
  });

  it('drops every confidential field even when the ERP sends one', async () => {
    const routes: RouteTable = {};
    for (const [key, value] of Object.entries(signedInRoutes())) {
      const stub = Array.isArray(value) ? need(value[0]) : value;
      routes[key] = { body: poisoned(stub.body) };
    }
    const { supplier } = build(routes);

    const outputs = [
      unwrap(await supplier.reads.me()),
      unwrap(await supplier.reads.branding()),
      unwrap(await supplier.reads.searchCatalog({ query: 'blu' })),
      unwrap(await supplier.reads.dashboard()),
      unwrap(await supplier.reads.billingSummary()),
      unwrap(await supplier.reads.listOrders()),
      unwrap(await supplier.reads.getOrder('ord_7741')),
      unwrap(await supplier.reads.listInvoices()),
      unwrap(await supplier.reads.getInvoice('inv_9142')),
      unwrap(await supplier.reads.listQuotes()),
      unwrap(await supplier.reads.getQuote('qt_3355')),
    ];

    const serialized = JSON.stringify(outputs);
    for (const field of FORBIDDEN_WIRE_FIELDS) {
      expect(serialized, field).not.toContain(field);
    }
    expect(serialized).not.toContain('4242');
  });
});
