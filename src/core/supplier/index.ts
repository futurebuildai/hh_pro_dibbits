import type { SupplierConfig } from '../domain/config';
import type { Sim } from '../sim/index';
import { createErpSupplier } from './adapters/erp';
import { type FetchLike, platformFetch } from './adapters/erp-client';
import { createSimSupplier } from './adapters/sim';
import type { SupplierPort, TokenStore } from './port';

/**
 * The switch (spec §7.1). One line in `boot`, two implementations, no fork.
 *
 * The sim is the DEFAULT and stays a permanent, supported mode — it is how the
 * demo runs, how `npm run guide` captures the user guide against a prod build,
 * how the e2e suite drives the product, and how a dealer evaluates HH Pro
 * before their ERP is connected. It never becomes dead code, so it never rots.
 *
 * There is deliberately no `if (mode === 'sim')` anywhere above this function.
 * A conditional in `actions/`, `selectors/`, `domain/` or `ui/` is the fork
 * starting, and the fork is what this whole shape exists to prevent.
 */

export interface CreateSupplierDeps {
  /**
   * The `Sim` `boot` already built. Required in sim mode and NOT constructed
   * here: a second simulator means a second scheduler over one persisted queue,
   * which is the double-firing bug the cross-tab leader lease was added to fix.
   */
  sim?: Sim | undefined;
  /** `clock.nowIso`, so sim-mode AR ages on sim time rather than the wall clock. */
  nowIso?: (() => string) | undefined;
  /** Injected transport. Defaults to the platform `fetch` in ERP mode only. */
  fetch?: FetchLike | undefined;
  tokens?: TokenStore | undefined;
  wait?: ((ms: number) => Promise<void>) | undefined;
  onSessionLost?: (() => void) | undefined;
}

/**
 * Is the ERP read adapter switched on for this deployment?
 *
 * Two conditions, both required, and the flag is the narrower of the two: a
 * dealer can point `mode:'erp'` at a base URL and still ship every stage off
 * while the connection is being proven. `erpReads` absent means false, which is
 * what makes "the flag is not in the config" and "the flag is off" the same
 * state — the only state master has ever run in.
 */
export function usesErpReads(config: SupplierConfig): boolean {
  return config.mode === 'erp' && config.stages.erpReads === true;
}

export function createSupplier(
  config: SupplierConfig,
  deps: CreateSupplierDeps = {},
): SupplierPort {
  if (usesErpReads(config)) {
    // `parseConfig` has already refused a `mode:'erp'` with an unusable base
    // URL, so reaching here without one is a programming error rather than a
    // dealer's typo — and it must be loud, because the alternative is quietly
    // running the simulator while a contractor believes they are looking at
    // their real account.
    const baseUrl = config.baseUrl;
    if (!baseUrl) {
      throw new Error('supplier.mode is "erp" but no baseUrl survived config validation');
    }
    const send = deps.fetch ?? platformFetch();
    if (!send) {
      throw new Error('supplier.mode is "erp" but this runtime has no fetch');
    }
    return createErpSupplier({
      baseUrl,
      fetch: send,
      tokens: deps.tokens,
      wait: deps.wait,
      onSessionLost: deps.onSessionLost,
    });
  }

  if (!deps.sim) {
    throw new Error('createSupplier needs the Sim that boot built');
  }
  return createSimSupplier({
    sim: deps.sim,
    nowIso: deps.nowIso ?? (() => new Date().toISOString()),
  });
}

export type {
  AccountSnapshot,
  BillingSummary,
  CatalogHit,
  CatalogSearchInput,
  ErpCapabilities,
  LoginInput,
  PageInput,
  SupplierAuth,
  SupplierIdentity,
  SupplierMode,
  SupplierPage,
  SupplierPort,
  SupplierReads,
  SupplierSession,
  SupplierWrites,
  TokenStore,
} from './port';
export { SUPPLIER_ERRORS, SUPPLIER_WRITE_METHODS, memoryTokenStore } from './port';
