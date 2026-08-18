import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, getContext } from '../../boot';
import { resetConfigCache } from '../../config/runtime';
import { DEFAULT_CONFIG, type DealerConfig, parseConfig } from '../../domain/config';
import type { FetchLike } from '../adapters/erp-client';
import { createSupplier, usesErpReads } from '../index';

/**
 * Flag-off zero delta — the DIB-476 discipline.
 *
 * The claim this file defends is narrow and total: with `erpReads` absent, HH
 * Pro behaves EXACTLY as master did. The 376-test suite passing unchanged is
 * the behavioural half of that proof; this file is the structural half, because
 * a suite passing unchanged cannot tell you that a network client was merely
 * never *called* rather than never *built*.
 */

beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
});

beforeEach(() => {
  resetConfigCache();
});

afterEach(() => {
  resetConfigCache();
});

/** A transport that fails the test if the flag-off path so much as builds it. */
function forbiddenFetch(): { fetch: FetchLike; calls: number } {
  const state = { calls: 0, fetch: null as unknown as FetchLike };
  state.fetch = (url: string) => {
    state.calls += 1;
    throw new Error(`flag-off build reached the network: ${url}`);
  };
  return state;
}

function withErpReads(overrides: Partial<DealerConfig['supplier']> = {}): DealerConfig {
  const parsed = parseConfig({
    supplier: {
      mode: 'erp',
      baseUrl: 'https://erp.dibbits.example',
      stages: { erpReads: true },
      ...overrides,
    },
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

describe('the flag is off unless a dealer turns it on', () => {
  it('defaults to sim with no supplier block at all', () => {
    const parsed = parseConfig({});
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.supplier.mode).toBe('sim');
    expect(parsed.value.supplier.stages.erpReads).toBe(false);
    expect(usesErpReads(parsed.value.supplier)).toBe(false);
  });

  it('ships DEFAULT_CONFIG in the state master has always run in', () => {
    expect(DEFAULT_CONFIG.supplier.mode).toBe('sim');
    expect(DEFAULT_CONFIG.supplier.stages.erpReads).toBe(false);
    expect(DEFAULT_CONFIG.supplier.baseUrl).toBeUndefined();
  });

  /**
   * A dealer who sets the flag but not a usable base URL gets the simulator,
   * and the flag goes down with the mode — a half-configured connection must
   * not leave `erpReads` on pointing at nothing.
   */
  it('costs the mode AND the stage flags when the base URL is unusable', () => {
    for (const baseUrl of ['', 'not-a-url', '/api', 'ftp://erp.example', 'javascript:alert(1)']) {
      const parsed = parseConfig({
        supplier: { mode: 'erp', baseUrl, stages: { erpReads: true } },
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value.supplier.mode, baseUrl).toBe('sim');
      expect(parsed.value.supplier.stages.erpReads, baseUrl).toBe(false);
    }
  });

  it('keeps every other setting when the supplier mode is refused', () => {
    const parsed = parseConfig({
      branding: { companyName: 'Copps Supply' },
      supplier: { mode: 'erp', baseUrl: 'nonsense', termsDays: 15, cardFeePercent: 1.5 },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.branding.companyName).toBe('Copps Supply');
    expect(parsed.value.supplier.termsDays).toBe(15);
    expect(parsed.value.supplier.cardFeePercent).toBe(1.5);
  });
});

describe('with the flag off, createSupplier builds the sim and nothing else', () => {
  it('returns the sim arm and never touches the transport', () => {
    boot({ reset: true, seed: 20_260_730 });
    const sim = getContext().sim;
    const transport = forbiddenFetch();

    const port = createSupplier(DEFAULT_CONFIG.supplier, { sim, fetch: transport.fetch });

    expect(port.mode).toBe('sim');
    expect(transport.calls).toBe(0);
  });

  /**
   * The sim has no session to establish, so there is no login door to knock on
   * — and it keeps its four writes, because flag-off means the simulator runs
   * exactly as it always has.
   */
  it('has no auth and keeps all four sim writes', () => {
    boot({ reset: true, seed: 20_260_730 });
    const port = createSupplier(DEFAULT_CONFIG.supplier, { sim: getContext().sim });
    expect(port.auth).toBeNull();
    expect(Object.keys(port.writes ?? {}).sort()).toEqual([
      'cancelWithSupplier',
      'createOrderWithSupplier',
      'submitToQuoteDesk',
      'withdrawFromQuoteDesk',
    ]);
  });

  /**
   * The no-push assertion on the wiring. `boot` builds ONE simulator and the
   * port wraps that instance — it does not construct a second one, which would
   * put a second scheduler on the same persisted queue.
   */
  it('wraps the Sim boot already built, rather than constructing another', async () => {
    boot({ reset: true, seed: 20_260_730 });
    const context = getContext();
    expect(context.supplier.mode).toBe('sim');

    const seen: string[] = [];
    const spy = {
      ...context.sim,
      submitToQuoteDesk: (id: string) => {
        seen.push(id);
      },
    };
    const port = createSupplier(DEFAULT_CONFIG.supplier, { sim: spy });
    await port.writes?.submitToQuoteDesk('ord_probe');
    expect(seen).toEqual(['ord_probe']);
  });

  it('boots with a sim-mode supplier on the context and leaves clock/pricing/sim alone', () => {
    const context = boot({ reset: true, seed: 20_260_730 });
    expect(context.supplier.mode).toBe('sim');
    expect(Object.keys(context).sort()).toEqual(['clock', 'pricing', 'seed', 'sim', 'supplier']);
    expect(context.sim.scheduler).toBeDefined();
    expect(context.pricing).toBeDefined();
  });
});

describe('with the flag on, nothing about the simulator changes', () => {
  /**
   * Stage 1 moves reads, not writes. `erpReads` on must still leave a working
   * simulator behind every write path — the rollback story ("flip the flag, the
   * sim resumes, no data migration") is only true while that holds.
   */
  it('still boots a Sim, and the ERP port still has no writes', () => {
    const config = withErpReads();
    resetConfigCache(config);
    const context = boot({ reset: true, seed: 20_260_730 });

    expect(context.supplier.mode).toBe('erp');
    expect(context.supplier.writes).toBeNull();
    expect(context.sim.control.speed()).toBeGreaterThan(0);
    expect(typeof context.sim.submitToQuoteDesk).toBe('function');
  });

  it('refuses to build an ERP adapter with no fetch rather than serving the sim in disguise', () => {
    const config = withErpReads();
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = undefined;
    try {
      expect(() => createSupplier(config.supplier, {})).toThrow(/no fetch/);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});
