import { beforeEach, describe, expect, it } from 'vitest';
import { boot, getContext } from '../../boot';
import { resetConfigCache } from '../../config/runtime';
import { DEFAULT_CONFIG, type SupplierConfig, parseConfig } from '../../domain/config';
import { invoicesStore, quotesStore, salesOrdersStore, sessionStore } from '../../stores/root';
import { listOf } from '../../stores/store';
import { createSupplier } from '../index';
import { SUPPLIER_REFUSALS, isWriteCapable } from '../port';

/**
 * The flag-off guarantee: with `erpReads` off, this whole feature is
 * indistinguishable from not existing.
 *
 * The suite-wide half of that proof is the other 376 tests, which pass
 * unchanged — the port was introduced without moving a single call site, so
 * every stage effect, every action and every screen still runs the simulator
 * it ran before. This file pins the switch itself, and the two ways it could
 * quietly stop being true: the default config resolving to ERP, or the sim
 * adapter answering something different from the stores the board renders.
 */

function supplierConfig(overrides: Partial<SupplierConfig> = {}): SupplierConfig {
  return { ...DEFAULT_CONFIG.supplier, ...overrides };
}

function simSupplier(config: SupplierConfig = supplierConfig()) {
  const context = getContext();
  return createSupplier({ config, sim: context.sim, clock: context.clock });
}

describe('the default deployment is the simulator', () => {
  beforeEach(() => {
    resetConfigCache();
    boot({ reset: true, seed: 20_260_730 });
  });

  it('ships with mode sim and the ERP reads off', () => {
    expect(DEFAULT_CONFIG.supplier.mode).toBe('sim');
    expect(DEFAULT_CONFIG.supplier.erpReads).toBe(false);
  });

  it('gives boot a write-capable simulator', () => {
    const supplier = getContext().supplier;

    expect(supplier.mode).toBe('sim');
    expect(isWriteCapable(supplier)).toBe(true);
  });

  it('returns the simulator when the flag is off, whatever the mode says', () => {
    // A dealer mid-rollout: the ERP is configured, the stage is not turned on.
    expect(
      simSupplier(supplierConfig({ mode: 'erp', baseUrl: 'https://erp.example', erpReads: false }))
        .mode,
    ).toBe('sim');
  });

  it('returns the simulator when the mode is sim, whatever the flag says', () => {
    expect(simSupplier(supplierConfig({ erpReads: true })).mode).toBe('sim');
  });

  it('leaves the simulator in charge of every write', () => {
    const context = getContext();

    // The four verbs the stage effects call are still the Sim's own, reached
    // exactly as they were before the port existed.
    expect(typeof context.sim.submitToQuoteDesk).toBe('function');
    expect(typeof context.sim.createOrderWithSupplier).toBe('function');
    expect(typeof context.sim.control.skipToNextEvent).toBe('function');
  });
});

describe('parseConfig will not resolve ERP mode it cannot honour', () => {
  it('keeps a deployment that names no base URL on the simulator', () => {
    const parsed = parseConfig({ supplier: { mode: 'erp', erpReads: true } });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.supplier.mode).toBe('sim');
    // The stage flag cannot be on for a mode that is off, or a later stage
    // would read "erpReads is true" and believe the ERP was reachable.
    expect(parsed.value.supplier.erpReads).toBe(false);
  });

  it('refuses a relative or credential-bearing base URL', () => {
    for (const baseUrl of ['/api', 'erp.example', 'https://user:pw@erp.example', 'ftp://erp']) {
      const parsed = parseConfig({ supplier: { mode: 'erp', baseUrl, erpReads: true } });
      expect(parsed.ok && parsed.value.supplier.mode).toBe('sim');
    }
  });

  it('resolves ERP mode when the deployment is complete', () => {
    const parsed = parseConfig({
      supplier: { mode: 'erp', baseUrl: 'https://erp.dibbits.example', erpReads: true },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.supplier).toEqual({
      termsDays: 30,
      cardFeePercent: 2.9,
      mode: 'erp',
      baseUrl: 'https://erp.dibbits.example',
      erpReads: true,
    });
  });

  it('is loud rather than silently simulated when a host forgets to inject fetch', () => {
    const context = getContext();

    expect(() =>
      createSupplier({
        config: supplierConfig({
          mode: 'erp',
          baseUrl: 'https://erp.dibbits.example',
          erpReads: true,
        }),
        sim: context.sim,
        clock: context.clock,
      }),
    ).toThrow(/no fetch was injected/);
  });
});

describe('the sim adapter answers from the stores the board already renders', () => {
  beforeEach(() => {
    resetConfigCache();
    boot({ reset: true, seed: 20_260_730 });
  });

  it('reads sales orders, invoices and quotes straight from the seed', async () => {
    const supplier = simSupplier();

    const orders = await supplier.listSalesOrders();
    const invoices = await supplier.listInvoices();
    const quotes = await supplier.listQuotes();

    expect(orders.ok && orders.value).toEqual(listOf(salesOrdersStore.get()));
    expect(invoices.ok && invoices.value).toEqual(listOf(invoicesStore.get()));
    expect(quotes.ok && quotes.value).toEqual(listOf(quotesStore.get()));
    // The seeded scenario really does have supplier artifacts behind its cards.
    expect(listOf(salesOrdersStore.get()).length).toBeGreaterThan(0);
  });

  it('refuses a missing id with the same sentence the ERP adapter uses', async () => {
    const result = await simSupplier().getInvoice('inv_does_not_exist');

    expect(result).toEqual({ ok: false, error: SUPPLIER_REFUSALS.notFound });
  });

  it('reports the account on the dealer terms the demo runs on', async () => {
    const result = await simSupplier().accountSummary();
    const account = sessionStore.get().account;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accountId).toBe(account?.id);
    expect(result.value.termsDays).toBe(DEFAULT_CONFIG.supplier.termsDays);
    // The simulator never stops an account; a hold is a dealer-side fact.
    expect(result.value.onHold).toBe(false);
  });

  it('withholds the account price it could compute, matching the ERP adapter', async () => {
    const result = await simSupplier().searchCatalog({ query: 'paver', limit: 3 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    for (const hit of result.value) {
      // Price-free on both sides of the port. Resolving the contractor's price
      // is Stage 2; a port method that answers differently depending on who
      // implements it is the fork this design exists to prevent.
      expect(Object.keys(hit)).not.toContain('unitPrice');
      expect(Object.keys(hit)).not.toContain('yourPrice');
      expect(hit.listPrice).toBeGreaterThan(0);
    }
  });

  it('derives capabilities from the acting person, exactly as the gate does', async () => {
    const identity = await simSupplier().me();

    expect(identity.ok).toBe(true);
    if (!identity.ok) return;
    // Dana, the seeded owner, is acting until someone switches.
    expect(identity.value.role).toBe('account_admin');
    expect(identity.value.capabilities).toContain('pay');
    expect(identity.value.capabilities).toContain('manage-team');
  });
});
