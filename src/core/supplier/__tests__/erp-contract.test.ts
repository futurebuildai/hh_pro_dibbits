import { describe, expect, it } from 'vitest';
import { type ErpSupplier, createErpSupplier } from '../adapters/erp';
import { type FetchLike, createMemoryTokenStore } from '../adapters/erp/client';
import { SUPPLIER_REFUSALS } from '../port';
import {
  BILLING_SUMMARY_RESPONSE,
  CATALOG_SEARCH_RESPONSE,
  CONFIG_RESPONSE,
  DASHBOARD_COD,
  DASHBOARD_NET45,
  DASHBOARD_RESPONSE,
  INVOICES_RESPONSE,
  LOGIN_RESPONSE,
  ME_BUYER,
  ME_FIELD_CREW,
  ORDERS_RESPONSE,
  ORDER_READY_DELIVERY,
  ORDER_READY_WILLCALL,
  QUOTES_RESPONSE,
  QUOTE_UNKNOWN_STATUS,
} from './fixtures';

/**
 * The contract suite: one test per Stage 1 read, replayed against recorded
 * fixtures.
 *
 * Every assertion is a deep equality against the WHOLE mapped value, not a
 * spot check on one field. That is what makes this suite catch the failure it
 * exists for: a mapper that starts passing the wire object through — a
 * `{...raw}` spread, an added convenience field, a projection that drifted
 * server-side — fails immediately, because the mapped value gains a key the
 * expectation does not have. A test that only asserted `unitPrice` would sail
 * past the day `margin_bps` arrives on the same object.
 */

const BASE_URL = 'https://erp.dibbits.example';

/** Fields that end the dealer's commercial position if any of them ever ship. */
const FORBIDDEN = [
  'margin_bps',
  'floor_bps',
  'cost_cents',
  'blocked',
  'block_policy',
  'bypass_reason',
  'override_requested',
  'override_authority',
  'source',
  'detail',
];

interface Route {
  status?: number;
  body?: unknown;
}

interface Harness {
  supplier: ErpSupplier;
  calls: { url: string; method: string; headers: Record<string, string> }[];
}

function harness(routes: Record<string, Route>): Harness {
  const calls: Harness['calls'] = [];
  const fetch: FetchLike = (url, init) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace('/api/portal/v1', '');
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const route = routes[path];
    if (!route) return Promise.resolve(new Response('{}', { status: 404 }));
    return Promise.resolve(
      new Response(JSON.stringify(route.body ?? {}), {
        status: route.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return {
    supplier: createErpSupplier({ baseUrl: BASE_URL, fetch, tokens: createMemoryTokenStore() }),
    calls,
  };
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected ok, got refusal: ${result.error}`);
  return result.value;
}

describe('login', () => {
  it('maps the recorded login into an identity with server-resolved capabilities', async () => {
    const { supplier } = harness({ '/login': { body: LOGIN_RESPONSE } });

    const session = unwrap(await supplier.login({ email: 'dana@x', password: 'pw' }));

    expect(session).toEqual({
      expiresAt: '2026-08-19T18:00:00.000Z',
      identity: {
        userId: 'pu_8812',
        accountId: 'cus_4471',
        name: 'Dana Reyes',
        email: 'dana@summitgrade.example',
        role: 'account_admin',
        capabilities: [
          'edit-scope',
          'move-stage',
          'customer-quote',
          'pay',
          'confirm-pickup',
          'manage-team',
        ],
      },
    });
  });

  it('never lets the bearer token cross the port', async () => {
    const { supplier } = harness({ '/login': { body: LOGIN_RESPONSE } });

    const session = unwrap(await supplier.login({ email: 'dana@x', password: 'pw' }));

    // The credential belongs to the token store. A token reachable from a
    // domain value is a token in a persisted store one refactor later.
    expect(JSON.stringify(session)).not.toContain(LOGIN_RESPONSE.token);
  });

  it('sends the token it was given on every later read', async () => {
    const { supplier, calls } = harness({
      '/login': { body: LOGIN_RESPONSE },
      '/config': { body: CONFIG_RESPONSE },
    });

    await supplier.login({ email: 'dana@x', password: 'pw' });
    await supplier.branding();

    expect(calls[0]?.headers.Authorization).toBeUndefined();
    expect(calls[1]?.headers.Authorization).toBe(`Bearer ${LOGIN_RESPONSE.token}`);
  });
});

describe('refresh', () => {
  it('slides a live session forward against the refresh route', async () => {
    const rotated = {
      ...LOGIN_RESPONSE,
      token: 'rotated.token.value',
      expires_at: '2026-08-20T06:00:00.000Z',
    };
    const { supplier, calls } = harness({
      '/login': { body: LOGIN_RESPONSE },
      '/token/refresh': { body: rotated },
      '/config': { body: CONFIG_RESPONSE },
    });

    await supplier.login({ email: 'dana@x', password: 'pw' });
    const session = unwrap(await supplier.refresh());
    await supplier.branding();

    expect(session.expiresAt).toBe('2026-08-20T06:00:00.000Z');
    expect(calls[1]?.method).toBe('POST');
    expect(calls[2]?.headers.Authorization).toBe('Bearer rotated.token.value');
  });

  it('refuses without reaching the network when there is no session to slide', async () => {
    const { supplier, calls } = harness({ '/token/refresh': { body: LOGIN_RESPONSE } });

    const result = await supplier.refresh();

    expect(result).toEqual({ ok: false, error: SUPPLIER_REFUSALS.sessionEnded });
    expect(calls).toHaveLength(0);
  });
});

describe('me + capabilities', () => {
  it('derives a field crew member from the server map, not a local role table', async () => {
    const { supplier } = harness({ '/me': { body: ME_FIELD_CREW } });

    const identity = unwrap(await supplier.me());

    expect(identity).toEqual({
      userId: 'pu_9903',
      accountId: 'cus_4471',
      name: 'Marcus Webb',
      email: 'marcus@summitgrade.example',
      role: 'field_crew',
      // No scope editing, no stage moves, no paying, no team. The contractor's
      // own sell side is theirs regardless of what the dealer's ERP thinks.
      capabilities: ['customer-quote', 'confirm-pickup'],
    });
  });

  it('gives a buyer everything except managing users', async () => {
    const { supplier } = harness({ '/me': { body: ME_BUYER } });

    expect(unwrap(await supplier.me()).capabilities).toEqual([
      'edit-scope',
      'move-stage',
      'customer-quote',
      'pay',
      'confirm-pickup',
    ]);
  });

  it('reads an unrecognised role as the least privileged of the three', async () => {
    const { supplier } = harness({
      '/me': { body: { ...ME_BUYER, role: 'branch_manager' } },
    });

    const identity = unwrap(await supplier.me());

    expect(identity.role).toBe('field_crew');
    // ...while capabilities still come from the server, so the person can do
    // everything the ERP says they can.
    expect(identity.capabilities).toContain('pay');
  });
});

describe('config / branding', () => {
  it('maps the dealer config onto the branding HH Pro already renders', async () => {
    const { supplier } = harness({ '/config': { body: CONFIG_RESPONSE } });

    expect(unwrap(await supplier.branding())).toEqual({
      companyName: 'Dibbits Landscape Supply',
      brandColor: 'oklch(52% 0.19 255)',
      logoUrl: '/images/dealer/dibbits.svg',
      supportEmail: 'orders@dibbits.example',
      supportPhone: '605-555-0142',
    });
  });
});

describe('catalog search', () => {
  it('maps hits price-free, and drops every field the drifted row carried', async () => {
    const { supplier } = harness({ '/catalog/search': { body: CATALOG_SEARCH_RESPONSE } });

    const hits = unwrap(await supplier.searchCatalog({ query: 'paver' }));

    expect(hits).toEqual([
      {
        productId: 'prd_2201',
        sku: 'TB-BLU-60',
        name: 'Blu 60 Smooth Paver',
        uom: 'SF',
        listPrice: 689,
        onHand: 4200,
        leadTimeDays: 0,
        imageUrl: '/images/products/tb-blu-60.svg',
      },
      {
        productId: 'prd_3310',
        sku: 'AGG-BASE-A',
        name: "Granular 'A' Base",
        uom: 'TON',
        listPrice: 3613,
        onHand: 180,
        leadTimeDays: 2,
      },
    ]);
  });

  it('leaks no margin machinery even when the projection drifts', async () => {
    const { supplier } = harness({ '/catalog/search': { body: CATALOG_SEARCH_RESPONSE } });

    const serialized = JSON.stringify(unwrap(await supplier.searchCatalog({ query: 'base' })));

    for (const field of FORBIDDEN) expect(serialized).not.toContain(field);
    // The recorded response really does carry them — otherwise this proves
    // nothing about the mapper.
    expect(JSON.stringify(CATALOG_SEARCH_RESPONSE)).toContain('margin_bps');
  });

  it('passes the query and a bounded limit to the route', async () => {
    const { supplier, calls } = harness({ '/catalog/search': { body: { results: [] } } });

    await supplier.searchCatalog({ query: 'blu 60', limit: 5 });

    expect(calls[0]?.url).toBe(
      'https://erp.dibbits.example/api/portal/v1/catalog/search?q=blu%2060&limit=5',
    );
  });
});

describe('dashboard / billing', () => {
  it('maps the account facts and drops the dealer-only segmentation', async () => {
    const { supplier } = harness({ '/dashboard': { body: DASHBOARD_RESPONSE } });

    expect(unwrap(await supplier.accountSummary())).toEqual({
      accountId: 'cus_4471',
      name: 'Summit Grade Hardscapes',
      accountNumber: 'SG-10442',
      type: 'charge',
      termsDays: 30,
      creditLimit: 2_000_000,
      onHold: false,
    });
  });

  it('carries Net-45 through intact, and reports a hold', async () => {
    const { supplier } = harness({ '/dashboard': { body: DASHBOARD_NET45 } });

    const account = unwrap(await supplier.accountSummary());

    // The failure this guards: squeezing 45 into HH Pro's NET30 code would put
    // a due date fifteen days early on a real invoice.
    expect(account.termsDays).toBe(45);
    expect(account.onHold).toBe(true);
  });

  it('reads due-on-receipt as a cash account with no credit line', async () => {
    const { supplier } = harness({ '/dashboard': { body: DASHBOARD_COD } });

    const account = unwrap(await supplier.accountSummary());

    expect(account.type).toBe('cash');
    expect(account.termsDays).toBe(0);
    expect(account.creditLimit).toBeUndefined();
  });

  it('takes the card fee from the server, where the charge is decided', async () => {
    const { supplier } = harness({ '/billing/summary': { body: BILLING_SUMMARY_RESPONSE } });

    expect(unwrap(await supplier.billingSummary())).toEqual({
      balance: 1_420_000,
      pastDue: 318_500,
      creditLimit: 2_000_000,
      creditAvailable: 580_000,
      cardFeePercent: 2.9,
    });
  });

  it('refuses a summary it cannot read rather than rendering a zero balance', async () => {
    const { supplier } = harness({
      '/billing/summary': { body: { past_due_cents: 0 } },
    });

    // A missing balance is not a settled account.
    expect(await supplier.billingSummary()).toEqual({
      ok: false,
      error: SUPPLIER_REFUSALS.malformed,
    });
  });
});

describe('quotes read', () => {
  it('maps a priced quote, its desk note and its line prices', async () => {
    const { supplier } = harness({ '/quotes': { body: QUOTES_RESPONSE } });

    expect(unwrap(await supplier.listQuotes())).toEqual([
      {
        id: 'q_7001',
        orderId: 'ord_1188',
        number: 'Q-1043',
        status: 'priced',
        submittedAt: '2026-08-14T13:20:00.000Z',
        pricedAt: '2026-08-14T18:05:00.000Z',
        expiresAt: '2026-08-28T18:05:00.000Z',
        deskNote: 'Held the Blu 60 at the spring price. Coping is a 3-week order.',
        linePrices: [
          { scopeItemId: 'li_5501', unitPrice: 645, leadTimeDays: 0 },
          { scopeItemId: 'li_5502', unitPrice: 12_400, leadTimeDays: 21 },
        ],
      },
    ]);
  });

  it('reads a status this build has never seen as in-review, never as priced', async () => {
    const { supplier } = harness({ '/quotes/q_7002': { body: QUOTE_UNKNOWN_STATUS } });

    // "priced" would tell a contractor the desk stood behind a number it may
    // never have produced, and would unblock an order on it.
    expect(unwrap(await supplier.getQuote('q_7002')).status).toBe('in-review');
  });

  it('refuses a quote line with no price rather than quoting it at zero', async () => {
    const { supplier } = harness({
      '/quotes/q_7003': {
        body: {
          ...QUOTE_UNKNOWN_STATUS,
          id: 'q_7003',
          lines: [{ line_id: 'li_1', lead_time_days: 3 }],
        },
      },
    });

    expect(await supplier.getQuote('q_7003')).toEqual({
      ok: false,
      error: SUPPLIER_REFUSALS.malformed,
    });
  });
});

describe('orders read', () => {
  it('maps a sales order with an empty timeline rather than a fabricated one', async () => {
    const { supplier } = harness({ '/orders': { body: ORDERS_RESPONSE } });

    expect(unwrap(await supplier.listSalesOrders())).toEqual([
      {
        id: 'so_9100',
        orderId: 'ord_1188',
        number: 'SO-5211',
        status: 'picking',
        fulfillment: 'delivery',
        submittedAt: '2026-08-15T14:02:00.000Z',
        promisedDate: '2026-08-22T00:00:00.000Z',
        subtotal: 894_300,
        // The contractor-safe timeline is a redacted projection that does not
        // exist yet. Synthesising events from a status would put times on the
        // screen that no truck ever kept.
        tracking: [],
      },
    ]);
  });

  it('splits READY on the fulfillment method', async () => {
    const { supplier } = harness({
      '/orders/so_9101': { body: ORDER_READY_WILLCALL },
      '/orders/so_9102': { body: ORDER_READY_DELIVERY },
    });

    expect(unwrap(await supplier.getSalesOrder('so_9101')).status).toBe('ready-willcall');
    // Ready for delivery is not ready for the contractor — nothing has left.
    expect(unwrap(await supplier.getSalesOrder('so_9102')).status).toBe('picking');
  });

  it('reads an unknown status as the earliest state, not the furthest', async () => {
    const { supplier } = harness({
      '/orders/so_9199': { body: { ...ORDER_READY_DELIVERY, id: 'so_9199', status: 'STAGED' } },
    });

    // A default of "delivered" would switch off the pull-back guard that stops
    // a contractor cancelling goods already on site.
    expect(unwrap(await supplier.getSalesOrder('so_9199')).status).toBe('submitted');
  });
});

describe('invoices read', () => {
  it('maps portal and counter invoices, keeping the origin distinction', async () => {
    const { supplier } = harness({ '/invoices': { body: INVOICES_RESPONSE } });

    expect(unwrap(await supplier.listInvoices())).toEqual([
      {
        id: 'inv_3301',
        number: 'INV-9042',
        accountId: 'cus_4471',
        orderId: 'ord_1188',
        salesOrderId: 'so_9100',
        origin: 'portal',
        issuedAt: '2026-08-16T00:00:00.000Z',
        dueAt: '2026-09-15T00:00:00.000Z',
        subtotal: 894_300,
        balance: 894_300,
        description: 'Wilson Custom Home — paver field',
      },
      {
        id: 'inv_3302',
        number: 'INV-9051',
        accountId: 'cus_4471',
        origin: 'counter',
        issuedAt: '2026-08-17T00:00:00.000Z',
        dueAt: '2026-09-16T00:00:00.000Z',
        subtotal: 12_600,
        balance: 0,
        description: 'Counter sale — polymeric sand',
      },
    ]);
  });

  it('reads one invoice by id', async () => {
    const { supplier, calls } = harness({
      '/invoices/inv_3301': { body: INVOICES_RESPONSE.invoices[0] },
    });

    expect(unwrap(await supplier.getInvoice('inv_3301')).number).toBe('INV-9042');
    expect(calls[0]?.url).toBe('https://erp.dibbits.example/api/portal/v1/invoices/inv_3301');
  });
});

describe('another tenant is a 404, and a 404 is not a 403', () => {
  it('renders a cross-tenant id as not-found, never as a permission problem', async () => {
    const { supplier } = harness({ '/orders/so_someone_else': { status: 404 } });

    const result = await supplier.getSalesOrder('so_someone_else');

    expect(result).toEqual({ ok: false, error: SUPPLIER_REFUSALS.notFound });
  });

  it('renders a real capability refusal generically, without naming anyone', async () => {
    const { supplier } = harness({ '/billing/summary': { status: 403 } });

    const result = await supplier.billingSummary();

    expect(result).toEqual({ ok: false, error: SUPPLIER_REFUSALS.notPermitted });
    // The named-person variant is built from the roster, which a field crew
    // member cannot read. Do not fabricate names client-side.
    expect(SUPPLIER_REFUSALS.notPermitted).not.toContain('Dana');
  });

  it('keeps the two sentences distinct', () => {
    expect(SUPPLIER_REFUSALS.notFound).not.toBe(SUPPLIER_REFUSALS.notPermitted);
  });
});
