import { beforeAll, describe, expect, it } from 'vitest';
import { createErpSupplier } from '../adapters/erp';
import { platformFetch } from '../adapters/erp-client';
import type { SupplierPort } from '../port';
import { need } from './recorded';

/**
 * LIVE verification (DIB-501): the real `ErpSupplier`, over the platform
 * `fetch`, against the real staging ERP. Not part of `npm test` — see
 * `vitest.live.config.ts` for why and for how to run it.
 *
 * What this proves that the recorded suites cannot: DNS, TLS, Caddy, the Go
 * router, the real bcrypt row from migration 0055, and the adapter's own
 * client (URL building, Bearer handling, retry) all agree at the same moment.
 * What it deliberately does NOT do: assert on volatile data values. Staging
 * accumulates orders and quotes; these tests assert SHAPES and invariants,
 * and print the mapped values so a run doubles as captured evidence.
 *
 * The credential is env-only. The demo account is documented in the ERP
 * repo's migration 0055_portal_demo_fixtures.sql; no password exists in this
 * repository, in any form.
 */

const BASE_URL = process.env.HHPRO_LIVE_BASE_URL ?? 'https://dibbits-staging.gablelbm.com';
const EMAIL = process.env.HHPRO_LIVE_EMAIL ?? 'portal.demo@dibbits.example';
const PASSWORD = process.env.HHPRO_LIVE_PASSWORD;

function unwrap<T>(result: { ok: boolean; value?: T; error?: string }, what: string): T {
  if (!result.ok) throw new Error(`${what} refused: ${result.error}`);
  return result.value as T;
}

let supplier: SupplierPort;

beforeAll(async () => {
  if (!PASSWORD) {
    throw new Error(
      'HHPRO_LIVE_PASSWORD is not set. The staging demo credential is documented in ' +
        'hardscapeos_dibbits backend/migrations/0055_portal_demo_fixtures.sql — export it, ' +
        'never commit it.',
    );
  }
  const send = platformFetch();
  if (!send) throw new Error('this runtime has no fetch');
  supplier = createErpSupplier({ baseUrl: BASE_URL, fetch: send });
  const session = unwrap(
    await need(supplier.auth).login({ email: EMAIL, password: PASSWORD }),
    'login',
  );
  console.log(`[live] signed in: ${session.identity.name} (${session.identity.role})`);
});

describe(`live staging reads — ${BASE_URL}`, () => {
  it('login carried no expiry (C-1) and the session carries no token', () => {
    const session = need(need(supplier.auth).session());
    expect(session.expiresAt).toBeNull();
    expect(JSON.stringify(session)).not.toMatch(/token/i);
  });

  it('GET /me answers the resolved capability map, not a role string to guess from', async () => {
    const identity = unwrap(await supplier.reads.me(), '/me');
    console.log('[live] capabilities:', JSON.stringify(identity.erpCapabilities));
    expect(identity.accountId).not.toBe('');
    expect(typeof identity.erpCapabilities.submitRfq).toBe('boolean');
    expect(identity.capabilities['customer-quote']).toBe(true);
  });

  it('GET /config maps to validated dealer branding', async () => {
    const branding = unwrap(await supplier.reads.branding(), '/config');
    console.log('[live] branding:', JSON.stringify(branding));
    expect(branding.companyName).not.toBe('');
    expect(branding.brandColor).toMatch(/^#|^oklch/);
  });

  it('catalog search returns real hits with translated UOMs, price-free', async () => {
    const hits = unwrap(await supplier.reads.searchCatalog({ query: 'paver', limit: 5 }), 'search');
    console.log('[live] paver hits:', JSON.stringify(hits, null, 1));
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.sku).not.toBe('');
      // The whole point of DIB-501's UOM fix: a real hit must not come back
      // unit-less when the ERP said PC/BAG/T.
      expect(hit.baseUom).not.toBeNull();
    }
    expect(JSON.stringify(hits)).not.toMatch(/price|cents/i);
  });

  it('dashboard and billing summary agree on the account money facts', async () => {
    const account = unwrap(await supplier.reads.dashboard(), '/dashboard');
    const summary = unwrap(await supplier.reads.billingSummary(), '/billing/summary');
    console.log('[live] account:', JSON.stringify(account));
    console.log('[live] billing:', JSON.stringify(summary));
    expect(account.openBalance).toBe(summary.openBalance);
    expect(account.creditLimit).toBe(summary.creditLimit);
    expect(account.availableCredit).toBe(summary.availableCredit);
  });

  it('orders, invoices and quotes read as pages of mapped domain objects', async () => {
    const orders = unwrap(await supplier.reads.listOrders({ limit: 5 }), '/orders');
    const invoices = unwrap(await supplier.reads.listInvoices({ limit: 5 }), '/invoices');
    const quotes = unwrap(await supplier.reads.listQuotes({ limit: 5 }), '/quotes');
    console.log(`[live] orders total=${orders.total}:`, JSON.stringify(orders.items.slice(0, 2)));
    console.log(
      `[live] invoices total=${invoices.total}:`,
      JSON.stringify(invoices.items.slice(0, 2)),
    );
    console.log(`[live] quotes total=${quotes.total}:`, JSON.stringify(quotes.items.slice(0, 2)));
    expect(orders.total).toBeGreaterThan(0);
    for (const so of orders.items) {
      expect(so.orderId).toBe(''); // no board card until erpPlan
      expect(so.subtotal).toBeGreaterThanOrEqual(0);
    }
    const first = need(orders.items[0]);
    const detail = unwrap(await supplier.reads.getOrder(first.id), '/orders/{id}');
    expect(detail.id).toBe(first.id);
    expect(JSON.stringify(detail)).not.toMatch(/tax_cents|actor|margin|cost_cents/);
  });

  it('a made-up id answers not-found, cross-tenant-safe by construction', async () => {
    const result = await supplier.reads.getOrder('00000000-0000-4000-9000-00000000dead');
    expect(result.ok).toBe(false);
  });

  it('refresh slides the window and hands over both instants', async () => {
    const session = unwrap(await need(supplier.auth).refresh(), 'refresh');
    console.log(
      `[live] refresh: expiresAt=${session.expiresAt} sessionExpiresAt=${session.sessionExpiresAt}`,
    );
    expect(session.expiresAt).not.toBeNull();
    expect(session.sessionExpiresAt).not.toBeNull();
  });
});
