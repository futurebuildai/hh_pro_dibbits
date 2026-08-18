import { describe, expect, it } from 'vitest';
import { createErpSupplier } from '../adapters/erp';
import { SUPPLIER_WRITE_METHODS, type SupplierPort } from '../port';
import { BASE_URL, noWait, recorder, signedInRoutes } from './recorded';

/**
 * Stage 1 is READS ONLY, and this file is what makes that a property of the
 * built object rather than of the type declaration.
 *
 * A type says `writes: null`; a cast, a spread, or a helpfully-added convenience
 * method says otherwise at runtime. The rollout's whole promise — "flip the
 * flag back and the sim resumes, no data migration" — is only true while the
 * ERP adapter has written nothing.
 */

function build(): { supplier: SupplierPort; rec: ReturnType<typeof recorder> } {
  const rec = recorder(signedInRoutes());
  return {
    rec,
    supplier: createErpSupplier({ baseUrl: BASE_URL, fetch: rec.fetch, wait: noWait }),
  };
}

/** Every function-valued key reachable on the object, one level into each branch. */
function methodNames(port: SupplierPort): string[] {
  const names: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 3 || typeof value !== 'object' || value === null) return;
    for (const key of Object.keys(value)) {
      const member = (value as Record<string, unknown>)[key];
      if (typeof member === 'function') names.push(key);
      else visit(member, depth + 1);
    }
  };
  visit(port, 0);
  return names;
}

describe('the ERP adapter exposes no write', () => {
  it('has a null writes branch', () => {
    expect(build().supplier.writes).toBeNull();
  });

  /**
   * The deny-list in `port.ts` names every mutating capability in the spec's
   * endpoint map, not just today's four. A Stage 3 method landing early under
   * its eventual name is caught here.
   */
  it('carries no method named by the write deny-list, at any depth', () => {
    const found = methodNames(build().supplier);
    for (const forbidden of SUPPLIER_WRITE_METHODS) {
      expect(found, forbidden).not.toContain(forbidden);
    }
  });

  it('publishes exactly the Stage 1 read surface and nothing else', () => {
    expect(Object.keys(build().supplier.reads).sort()).toEqual([
      'billingSummary',
      'branding',
      'dashboard',
      'getInvoice',
      'getOrder',
      'getQuote',
      'listInvoices',
      'listOrders',
      'listQuotes',
      'me',
      'searchCatalog',
    ]);
  });

  /**
   * The strongest form of the claim: exercise every read and prove the wire
   * saw only GETs. A write method could be renamed past the deny-list; it
   * cannot reach the ERP without a verb.
   */
  it('issues only GETs across every read', async () => {
    const { supplier, rec } = build();
    await supplier.reads.me();
    await supplier.reads.branding();
    await supplier.reads.searchCatalog({ query: 'blu' });
    await supplier.reads.dashboard();
    await supplier.reads.billingSummary();
    await supplier.reads.listOrders();
    await supplier.reads.getOrder('ord_7741');
    await supplier.reads.listInvoices();
    await supplier.reads.getInvoice('inv_9142');
    await supplier.reads.listQuotes();
    await supplier.reads.getQuote('qt_3355');

    expect(rec.calls).toHaveLength(11);
    expect(rec.writes()).toEqual([]);
  });

  /**
   * Auth is the one place a POST is legitimate, and it is bounded to two
   * routes. Neither writes a supplier-side fact: one establishes a session, the
   * other renews it.
   */
  it('POSTs to exactly two auth routes and nowhere else', async () => {
    const { supplier, rec } = build();
    await supplier.auth?.login({ email: 'a@b.c', password: 'pw' });
    await supplier.auth?.refresh();

    const posted = rec.writes().map((call) => `${call.method} ${call.route}`);
    expect(new Set(posted)).toEqual(new Set(['POST /login', 'POST /token/refresh']));
  });

  /**
   * A read must never carry a body. A GET with a payload is the shape a write
   * takes when someone is trying not to look like one.
   */
  it('sends no body on any read', async () => {
    const { supplier, rec } = build();
    await supplier.reads.listOrders();
    await supplier.reads.getInvoice('inv_9142');
    for (const call of rec.calls) expect(call.body).toBeUndefined();
  });
});
