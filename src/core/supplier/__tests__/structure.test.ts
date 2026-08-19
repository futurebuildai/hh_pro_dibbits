import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createErpSupplier } from '../adapters/erp';
import { AUTH_PATHS, createErpClient } from '../adapters/erp-client';
import {
  SUPPLIER_ERRORS,
  SUPPLIER_WRITE_METHODS,
  type SupplierPort,
  memoryTokenStore,
} from '../port';
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

/**
 * The same claim one layer down, and made by CONSTRUCTION rather than by
 * exercise.
 *
 * The suite above proves the adapter as built issues only GETs. It can only
 * see the methods that exist today: a Stage 4 `updateSiteInstructions` added
 * next quarter would POST to `/orders/{id}/delivery-instructions` and the test
 * would never call it. The transport's own allowlist is what stops that one,
 * on the day it is written, without anybody having to remember to extend a
 * test.
 */
describe('the transport refuses a POST outside the two auth routes', () => {
  function client(onCall: () => void) {
    return createErpClient({
      baseUrl: BASE_URL,
      tokens: memoryTokenStore(),
      wait: noWait,
      fetch: () => {
        onCall();
        throw new Error('the transport must not be reached for a refused POST');
      },
    });
  }

  it('names exactly two paths', () => {
    expect([...AUTH_PATHS]).toEqual(['/login', '/token/refresh']);
  });

  it.each(['/orders', '/orders/ord_7741/delivery-instructions', '/invoices/pay', '/quotes'])(
    'refuses POST %s without touching the network',
    async (path) => {
      let calls = 0;
      const result = await client(() => {
        calls += 1;
      }).send({ method: 'POST', path });

      // The refusal must cost nothing. A green suite cannot tell you a request
      // was never sent rather than merely never mattered; a fetch that throws
      // on any call can.
      expect(calls).toBe(0);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(SUPPLIER_ERRORS.readOnly);
    },
  );

  it('still lets the two auth routes through', async () => {
    const rec = recorder(signedInRoutes());
    const sender = createErpClient({
      baseUrl: BASE_URL,
      fetch: rec.fetch,
      tokens: memoryTokenStore(),
      wait: noWait,
    });
    for (const path of AUTH_PATHS) {
      const result = await sender.send({ method: 'POST', path, body: {}, anonymous: true });
      expect(result.ok).toBe(true);
    }
    expect(rec.writes().map((call) => call.route)).toEqual([...AUTH_PATHS]);
  });
});

/**
 * The mapper is a WHITELIST, and this keeps it one under future edits rather
 * than under review.
 *
 * `erp-contract.test.ts` already proves the property behaviourally, and proves
 * it well: it poisons every fixture with the full confidential set
 * (`margin_bps`, `floor_bps`, `cost_cents`, `bypass_reason`, …) and asserts the
 * mapped output is still clean. That arm is stronger than this one wherever it
 * reaches — but it can only reach the mapper functions a fixture exercises,
 * and it catches a leak on the day someone runs the suite rather than on the
 * day the line is typed.
 *
 * This is the cheap structural half, from the second implementation (b483035):
 * forbid the SYNTAX that would end the whitelist. One `{...raw}` in `erp-map.ts`
 * publishes the dealer's floor the first time the server-side projection
 * drifts, and every review that reads it as harmless is right until it isn't.
 *
 * DELIBERATE DEVIATION from the rebuild's version, which matched a name list
 * (`raw|body|row|hit|user|config|account|line`). This branch's mapper names its
 * wire parameters `wire`, so that list would have matched nothing and passed
 * VACUOUSLY — a green test asserting a property nobody had checked. Matching
 * the shape instead of the names has no such failure mode: a spread of any
 * identifier fails, and the conditional-key idiom `...(cond ? {k: v} : {})`,
 * which builds an object literal rather than copying one, is what remains
 * legal.
 *
 * Scoped to `erp-map.ts`, which is the only translation point. `erp.ts` spreads
 * an already-MAPPED `SupplierSession` to attach expiries — a domain value built
 * from named fields, which is the thing this rule exists to guarantee, not a
 * hole in it.
 */
describe('the mapper never spreads a wire object', () => {
  /** Comments stripped: the file's own prose discusses `{...raw}` by name. */
  const source = readFileSync(join(__dirname, '..', 'adapters', 'erp-map.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('builds every domain value from named fields', () => {
    // `...(` is the conditional-key idiom and stays legal; `...anything` else
    // is copying a value wholesale, which is the only way a field nobody
    // named reaches a contractor's screen.
    const spreads = source.match(/\.\.\.\s*[A-Za-z_$][\w$]*/g) ?? [];
    expect(spreads).toEqual([]);
  });

  it('does not copy one in through the side door either', () => {
    // `Object.assign(domain, wire)` is the same leak with different syntax,
    // and it is the one a reviewer who has internalised "no spreads" reads
    // straight past.
    expect(source).not.toContain('Object.assign');
  });
});
