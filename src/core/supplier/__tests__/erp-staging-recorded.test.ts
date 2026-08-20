import { describe, expect, it } from 'vitest';
import { createErpSupplier } from '../adapters/erp';
import { SUPPLIER_ERRORS } from '../port';
import liveBillingSummary from './fixtures-live/billing-summary.json';
import liveCatalogPaver from './fixtures-live/catalog-search-paver.json';
import liveCatalogSand from './fixtures-live/catalog-search-sand.json';
import liveConfig from './fixtures-live/config.json';
import liveDashboard from './fixtures-live/dashboard.json';
import liveError404 from './fixtures-live/error-404.json';
import liveInvoiceDetail from './fixtures-live/invoice-detail.json';
import liveInvoicesPage from './fixtures-live/invoices-page.json';
import liveLogin from './fixtures-live/login.json';
import liveMe from './fixtures-live/me.json';
import liveOrderDetail from './fixtures-live/order-detail.json';
import liveOrdersPage from './fixtures-live/orders-page.json';
import liveQuoteDetail from './fixtures-live/quote-detail.json';
import liveQuotesPage from './fixtures-live/quotes-page.json';
import liveRefresh from './fixtures-live/refresh.json';
import { BASE_URL, need, noWait, recorder } from './recorded';

/**
 * The Stage-1a contract, re-proven against fixtures CAPTURED OFF THE LIVE WIRE
 * (DIB-501; NOTES-DIB480 park 10).
 *
 * Every fixture in `fixtures-live/` is a verbatim response from
 * `https://dibbits-staging.gablelbm.com/api/portal/v1/*` recorded on
 * 2026-08-20 against the documented staging demo account (ERP migration 0055),
 * with exactly one edit: bearer tokens are replaced with a redaction marker,
 * because a signed staging JWT is a credential and has no business in a repo.
 *
 * The original suite ran on fixtures transcribed from the Go structs, which
 * bought field names but not proof the server behaves that way at runtime.
 * This file is the other half — and recording it immediately earned its keep:
 * the live catalog answered `base_uom` in the ERP's own vocabulary (`PC`,
 * `BAG`, `T`), which the struct-derived fixtures never exercised, and every
 * such hit mapped to `baseUom: null`. The UOM translation table in
 * `erp-map.ts` exists because of these captures, and the tests below pin it
 * to the exact SKUs staging serves.
 */

function build(extraRoutes: Record<string, { status?: number; body?: unknown }> = {}) {
  const rec = recorder({
    'POST /login': { body: liveLogin },
    'POST /token/refresh': { body: liveRefresh },
    'GET /me': { body: liveMe },
    'GET /config': { body: liveConfig },
    'GET /catalog/search': { body: liveCatalogPaver },
    'GET /dashboard': { body: liveDashboard },
    'GET /billing/summary': { body: liveBillingSummary },
    'GET /orders': { body: liveOrdersPage },
    'GET /orders/86b744fc-c0bf-4b07-a3c7-91b860d428f4': { body: liveOrderDetail },
    'GET /invoices': { body: liveInvoicesPage },
    'GET /invoices/0dd4ec29-9616-4754-9f5f-667da1722018': { body: liveInvoiceDetail },
    'GET /quotes': { body: liveQuotesPage },
    'GET /quotes/2cbb6e96-c88d-4a05-a2c9-d2709a15a718': { body: liveQuoteDetail },
    ...extraRoutes,
  });
  const supplier = createErpSupplier({ baseUrl: BASE_URL, fetch: rec.fetch, wait: noWait });
  return { rec, supplier };
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: string }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value as T;
}

describe('live capture — login and session', () => {
  it('signs in against the recorded staging login and reads the real identity', async () => {
    const { supplier } = build();
    const auth = need(supplier.auth);
    const session = unwrap(await auth.login({ email: 'x@example.com', password: 'pw' }));
    expect(session.identity.name).toBe('Dibbits Demo (Owner)');
    expect(session.identity.role).toBe('account_admin');
    expect(session.identity.accountId).toBe('df000000-0000-4000-9000-000000000001');
    // C-1, confirmed on the live wire: the login response carries no expiry.
    expect(session.expiresAt).toBeNull();
    expect(session.sessionExpiresAt).toBeNull();
  });

  it('hands back no token, even from a live payload that carried one', async () => {
    const { supplier } = build();
    const auth = need(supplier.auth);
    const session = unwrap(await auth.login({ email: 'x@example.com', password: 'pw' }));
    expect(JSON.stringify(session)).not.toMatch(/token/i);
  });

  it('adopts the refresh instants exactly as staging spelled them', async () => {
    const { supplier } = build();
    const auth = need(supplier.auth);
    unwrap(await auth.login({ email: 'x@example.com', password: 'pw' }));
    const session = unwrap(await auth.refresh());
    // Nanosecond-precision RFC3339 straight off the live wire — adopted
    // verbatim, never re-parsed into a second authority.
    expect(session.expiresAt).toBe('2026-08-21T06:16:53.760855658Z');
    expect(session.sessionExpiresAt).toBe('2026-08-27T18:16:34Z');
  });

  it('maps the staging account_admin to all nine ERP capabilities, collapsed honestly', async () => {
    const { supplier } = build();
    const identity = unwrap(await supplier.reads.me());
    expect(Object.values(identity.erpCapabilities).every(Boolean)).toBe(true);
    expect(identity.capabilities).toEqual({
      'edit-scope': true,
      'move-stage': true,
      'customer-quote': true,
      pay: true,
      'confirm-pickup': true,
      'manage-team': true,
    });
  });
});

describe('live capture — branding', () => {
  it("keeps Dibbits' real dealer name and colour, and drops the support fields", async () => {
    const { supplier } = build();
    const branding = unwrap(await supplier.reads.branding());
    expect(branding).toEqual({
      companyName: 'Dibbits Landscape Supply',
      brandColor: '#E8A74E',
    });
    expect(JSON.stringify(branding)).not.toMatch(/support/);
  });
});

describe('live capture — the ERP UOM vocabulary', () => {
  /**
   * The drift the live read surfaced: staging prices pieces as `PC`, sand as
   * `BAG` and `T` — the ERP's own `uoms` table (migration 0002) — and the
   * struct-derived fixtures never said so. Each assertion here is a real
   * staging SKU.
   */
  it('reads a PC paver as each, off the real paver search', async () => {
    const { supplier } = build();
    const hits = unwrap(await supplier.reads.searchCatalog({ query: 'paver' }));
    const oaks = need(hits.find((h) => h.sku === 'DBS-OAKS-VINTAGE'));
    expect(oaks.baseUom).toBe('EA');
    const sealer = need(hits.find((h) => h.sku === 'DBS-SIKA-SEALER'));
    expect(sealer.baseUom).toBe('EA');
  });

  it('reads tonnes, bags and pieces off the real sand search', async () => {
    const { supplier } = build({ 'GET /catalog/search': { body: liveCatalogSand } });
    const hits = unwrap(await supplier.reads.searchCatalog({ query: 'sand' }));
    expect(need(hits.find((h) => h.sku === 'DBS-AGG-SAND')).baseUom).toBe('TON'); // wire: T
    expect(need(hits.find((h) => h.sku === 'DBS-GATOR-SAND')).baseUom).toBe('BG'); // wire: BAG
    expect(need(hits.find((h) => h.sku === 'DBS-BANAS-COPING')).baseUom).toBe('EA'); // wire: PC
  });
});

describe('live capture — orders', () => {
  it('maps the INVOICED pickup order exactly as staging serves it', async () => {
    const { supplier } = build();
    const page = unwrap(await supplier.reads.listOrders({ limit: 3 }));
    const so = need(page.items.find((o) => o.number === '#SO-TRT-43'));
    expect(so.status).toBe('invoiced');
    expect(so.fulfillment).toBe('willcall'); // wire: PICKUP
    // Go zero time on the live wire means unset, so no promised date exists.
    expect('promisedDate' in so).toBe(false);
    // The tax-inclusive total is the one number a contractor is shown.
    expect(so.subtotal).toBe(101_700);
    expect(so.orderId).toBe(''); // no board card until erpPlan (Stage 3)
  });

  it('drops the live detail fields the domain type does not name', async () => {
    const { supplier } = build();
    const so = unwrap(await supplier.reads.getOrder('86b744fc-c0bf-4b07-a3c7-91b860d428f4'));
    const json = JSON.stringify(so);
    // The live detail carries lines[] (with qty_base, allocated_base …) and
    // delivery_instructions; none of it survives the whitelist mapper.
    expect(json).not.toMatch(/line_no|qty_base|allocated|delivery_instructions|tax_cents/);
    expect(so.tracking).toEqual([]);
  });
});

describe('live capture — invoices and quotes', () => {
  it('maps the PAID invoice with its sales-order link', async () => {
    const { supplier } = build();
    const page = unwrap(await supplier.reads.listInvoices({ limit: 3 }));
    const inv = need(page.items.find((i) => i.number === '#INV-30'));
    expect(inv.balance).toBe(0);
    expect(inv.subtotal).toBe(101_700);
    expect(inv.salesOrderId).toBe('ae58d658-427f-40a1-b10e-e7603cb2a7ba');
    expect(inv.origin).toBe('portal');
  });

  it('reads the real DRAFT quote as in-review and the ACCEPTED one as priced', async () => {
    const { supplier } = build();
    const page = unwrap(await supplier.reads.listQuotes({ limit: 3 }));
    const draft = need(page.items.find((q) => q.number === '#Q-4'));
    expect(draft.status).toBe('in-review');
    expect(draft.expiresAt).toBe('2026-09-18T00:00:00Z');
    const accepted = need(page.items.find((q) => q.number === 'Q-DEMO-CP03'));
    expect(accepted.status).toBe('priced');
  });

  it('keeps quote linePrices empty even though the live detail has priced lines', async () => {
    // `linePrices` is keyed by scopeItemId — an HH Pro id the ERP has never
    // seen until erpPlan syncs the board. Filling it would invent the join.
    const { supplier } = build();
    const quote = unwrap(await supplier.reads.getQuote('2cbb6e96-c88d-4a05-a2c9-d2709a15a718'));
    expect(quote.linePrices).toEqual([]);
    expect(JSON.stringify(quote)).not.toMatch(/Clear Stone|unit_price_cents/);
  });

  it("answers staging's real not-found body with the not-found sentence", async () => {
    const { supplier } = build({
      'GET /orders/00000000-0000-4000-9000-00000000dead': { status: 404, body: liveError404 },
    });
    const result = await supplier.reads.getOrder('00000000-0000-4000-9000-00000000dead');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(SUPPLIER_ERRORS.notFound);
  });
});

describe('live capture — transport discipline', () => {
  it('walked every live read with GETs only, Bearer on each, and both auth POSTs in bounds', async () => {
    const { rec, supplier } = build();
    const auth = need(supplier.auth);
    unwrap(await auth.login({ email: 'x@example.com', password: 'pw' }));
    unwrap(await auth.refresh());
    unwrap(await supplier.reads.branding());
    unwrap(await supplier.reads.searchCatalog({ query: 'paver' }));
    unwrap(await supplier.reads.dashboard());
    unwrap(await supplier.reads.billingSummary());
    unwrap(await supplier.reads.listOrders());
    unwrap(await supplier.reads.listInvoices());
    unwrap(await supplier.reads.listQuotes());
    const writes = rec.writes();
    expect(writes.map((w) => w.route).sort()).toEqual(['/login', '/token/refresh']);
    for (const call of rec.calls) {
      if (call.route === '/login') continue;
      expect(call.headers.Authorization, call.route).toMatch(/^Bearer /);
    }
  });
});
