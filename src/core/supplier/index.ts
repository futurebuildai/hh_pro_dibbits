import type { SupplierConfig } from '../domain/config';
import type { SimClock } from '../sim/clock';
import type { Sim } from '../sim/index';
import { type ErpSupplier, createErpSupplier } from './adapters/erp';
import type { FetchLike, TokenStore } from './adapters/erp/client';
import { type SimSupplier, createSimSupplier } from './adapters/sim';
import type { Supplier } from './port';

/**
 * The switch — and it is a switch, never a fork.
 *
 * One decision, taken once, at boot. Above this line there are no mode checks:
 * any `if (mode === 'sim')` in `actions/`, `selectors/`, `domain/` or `ui/` is
 * the fork starting, and the only legitimate mode checks in the whole app are
 * the Demo Director's visibility, the clock-speed controls, and the seeded
 * scenario boot path.
 *
 * Stage 1 rolls out behind `erpReads`. The flag being off must be
 * indistinguishable from this module not existing, which is what
 * `__tests__/zero-delta.test.ts` proves: flag off, the simulator answers, and
 * every one of the suite's pre-existing tests passes unchanged.
 */

export interface CreateSupplierOptions {
  config: SupplierConfig;
  /** Today's simulator. Always built: Stage 1 leaves every write with it. */
  sim: Sim;
  clock: SimClock;
  /** Injected, never ambient. Required when the ERP adapter is selected. */
  fetch?: FetchLike | undefined;
  tokens?: TokenStore | undefined;
  onSessionLost?: (() => void) | undefined;
}

export function createSupplier(options: CreateSupplierOptions): Supplier {
  const { config } = options;

  if (config.mode === 'erp' && config.erpReads) {
    if (!config.baseUrl) {
      // Unreachable through `parseConfig`, which refuses to resolve `mode` to
      // 'erp' without a usable base URL. Kept as a guard because a config
      // object can also be built by hand in a test or a host.
      throw new Error('supplier.mode is "erp" but no baseUrl was configured');
    }
    if (!options.fetch) {
      // Loud on purpose. The alternative — quietly running the simulator on a
      // deployment that believes it is connected — is the failure this whole
      // design is arranged to prevent: a contractor cannot be shown fabricated
      // supplier facts and told they are real.
      throw new Error('supplier.mode is "erp" but no fetch was injected');
    }
    return createErpSupplier({
      baseUrl: config.baseUrl,
      fetch: options.fetch,
      tokens: options.tokens,
      onSessionLost: options.onSessionLost,
    });
  }

  return createSimSupplier({ sim: options.sim, clock: options.clock });
}

export type { ErpSupplier, SimSupplier };
export {
  PORTAL_ROLE_LABELS,
  SUPPLIER_READ_METHODS,
  SUPPLIER_REFUSALS,
  SUPPLIER_WRITE_METHODS,
  isWriteCapable,
} from './port';
export type {
  AccountSummary,
  BillingSummary,
  CatalogHit,
  CatalogSearchInput,
  LoginInput,
  PortalRole,
  Supplier,
  SupplierBranding,
  SupplierIdentity,
  SupplierMode,
  SupplierPort,
  SupplierReadOnlyPort,
  SupplierReads,
  SupplierSession,
  SupplierWrites,
} from './port';
export { createMemoryTokenStore } from './adapters/erp/client';
export type { FetchLike, TokenStore } from './adapters/erp/client';
