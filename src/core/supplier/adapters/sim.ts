import { dealerConfig } from '../../config/runtime';
import { termsDays } from '../../domain/account';
import type { DealerBranding } from '../../domain/config';
import type { Order } from '../../domain/project';
import type { Invoice, Quote, SalesOrder } from '../../domain/supplier';
import { type Capability, can } from '../../domain/team';
import type { EntityId } from '../../lib/ids';
import { type Result, err, ok } from '../../lib/result';
import { buildArSummary } from '../../selectors/ar';
import { searchProducts } from '../../selectors/order';
import type { Sim } from '../../sim/index';
import {
  catalogStore,
  invoicesStore,
  quotesStore,
  salesOrdersStore,
  sessionStore,
  teamStore,
} from '../../stores/root';
import { type Collection, listOf } from '../../stores/store';
import {
  type AccountSnapshot,
  type BillingSummary,
  type CatalogHit,
  type CatalogSearchInput,
  type PageInput,
  SUPPLIER_ERRORS,
  type SupplierIdentity,
  type SupplierPage,
  type SupplierPort,
  type SupplierReads,
  type SupplierWrites,
} from '../port';

/**
 * `SimSupplier` — today's behaviour, behind the port.
 *
 * This adapter adds NOTHING. Its four writes are the four methods `Sim` already
 * publishes, called on the SAME `Sim` instance `boot` already built, wrapped in
 * a resolved promise so the signature matches the network implementation
 * (spec §2.1). Its reads are the store snapshots the selectors already read.
 * That is the whole point: with `erpReads` off, every byte of behaviour on the
 * far side of this object is the behaviour master shipped, which is what
 * `__tests__/zero-delta.test.ts` exists to prove.
 *
 * It deliberately does NOT own a `Sim` of its own. Constructing a second
 * simulator would mean a second scheduler over one persisted queue — the exact
 * double-firing bug the cross-tab leader lease was added to fix.
 */

/** The sim has no clock of its own here; timestamps come from the injected one. */
export interface SimSupplierOptions {
  sim: Sim;
  /** `clock.nowIso` — never the wall clock, so a 600x demo ages its AR too. */
  nowIso: () => string;
}

function pageOf<T>(rows: readonly T[], input: PageInput | undefined): SupplierPage<T> {
  const offset = Math.max(0, input?.offset ?? 0);
  const limit = Math.max(0, input?.limit ?? rows.length);
  return {
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset,
  };
}

function findIn<T extends { id: EntityId }>(collection: Collection<T>, id: EntityId): Result<T> {
  const found = collection.byId[id];
  // The same refusal the ERP gives for a cross-tenant id, for the same reason:
  // "not yours" and "not there" must be one answer (§2.4).
  return found ? ok(found) : err(SUPPLIER_ERRORS.notFound);
}

export function createSimSupplier(options: SimSupplierOptions): SupplierPort {
  const { sim, nowIso } = options;

  const reads: SupplierReads = {
    async me(): Promise<Result<SupplierIdentity>> {
      const { account, user } = sessionStore.get();
      if (!account || !user) return err(SUPPLIER_ERRORS.notConfigured);

      // In sim mode the acting person IS the PersonSwitcher's selection — the
      // simulator's whole login story (§1.1) — and capabilities come from the
      // local GRANTS table because there is no server to ask. That is the one
      // place the two implementations legitimately differ, and it is why the
      // ERP identity carries the server's answer instead.
      const team = teamStore.get();
      const acting = team.activeId ? team.members.byId[team.activeId] : undefined;
      const role = acting?.role ?? 'field';
      const capabilities = Object.fromEntries(
        (
          [
            'edit-scope',
            'move-stage',
            'customer-quote',
            'pay',
            'confirm-pickup',
            'manage-team',
          ] as const
        ).map((capability) => [capability, can(role, capability)]),
      ) as Record<Capability, boolean>;

      return ok({
        userId: acting?.id ?? user.id,
        accountId: account.id,
        name: acting?.name ?? user.name,
        email: acting?.email ?? user.email,
        role,
        status: 'active',
        capabilities,
        // The sim has no ERP capability vocabulary. Reporting HH Pro's answer
        // in the ERP's field names would be a fabrication with a straight face.
        erpCapabilities: {
          manageUsers: capabilities['manage-team'],
          viewBilling: true,
          payInvoices: capabilities.pay,
          managePaymentMethods: capabilities.pay,
          submitRfq: capabilities['edit-scope'],
          createOrders: capabilities['move-stage'],
          viewOrdersDeliveries: true,
          editDeliveryInstructions: capabilities['edit-scope'],
          manageFiles: true,
        },
      });
    },

    async branding(): Promise<Result<DealerBranding>> {
      return ok(dealerConfig().branding);
    },

    async searchCatalog(input: CatalogSearchInput): Promise<Result<CatalogHit[]>> {
      const catalog = catalogStore.get();
      const categories = new Map(
        catalog.categories.map((category) => [category.id, category.name]),
      );
      const found = searchProducts(catalog.products, input.query, input.limit ?? 25);
      return ok(
        found.map((product) => ({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          category: categories.get(product.categoryId) ?? '',
          baseUom: product.baseUom,
        })),
      );
    },

    async dashboard(): Promise<Result<AccountSnapshot>> {
      const { account } = sessionStore.get();
      if (!account) return err(SUPPLIER_ERRORS.notConfigured);
      const summary = buildArSummary(invoicesStore.get(), nowIso());
      const creditLimit = account.creditLimit ?? 0;
      return ok({
        accountId: account.id,
        accountNumber: account.accountNumber,
        name: account.name,
        customerType: account.type,
        branchId: null,
        paymentTermsDays: dealerConfig().supplier.termsDays ?? termsDays(account.paymentTermsCode),
        creditLimit,
        onHold: false,
        openBalance: summary.outstanding,
        availableCredit: Math.max(0, creditLimit - summary.outstanding),
      });
    },

    async billingSummary(): Promise<Result<BillingSummary>> {
      const { account } = sessionStore.get();
      if (!account) return err(SUPPLIER_ERRORS.notConfigured);
      const summary = buildArSummary(invoicesStore.get(), nowIso());
      const creditLimit = account.creditLimit ?? 0;
      return ok({
        openBalance: summary.outstanding,
        creditLimit,
        availableCredit: Math.max(0, creditLimit - summary.outstanding),
        onHold: false,
        paymentTermsDays: dealerConfig().supplier.termsDays ?? termsDays(account.paymentTermsCode),
      });
    },

    async listOrders(input?: PageInput): Promise<Result<SupplierPage<SalesOrder>>> {
      return ok(pageOf(listOf(salesOrdersStore.get()), input));
    },
    async getOrder(id: EntityId): Promise<Result<SalesOrder>> {
      return findIn(salesOrdersStore.get(), id);
    },

    async listInvoices(input?: PageInput): Promise<Result<SupplierPage<Invoice>>> {
      return ok(pageOf(listOf(invoicesStore.get()), input));
    },
    async getInvoice(id: EntityId): Promise<Result<Invoice>> {
      return findIn(invoicesStore.get(), id);
    },

    async listQuotes(input?: PageInput): Promise<Result<SupplierPage<Quote>>> {
      return ok(pageOf(listOf(quotesStore.get()), input));
    },
    async getQuote(id: EntityId): Promise<Result<Quote>> {
      return findIn(quotesStore.get(), id);
    },
  };

  /**
   * Straight delegation. Each of these is `void` on `Sim` and returns
   * `ok(undefined)` here — the sim refuses by doing nothing (an order with no
   * quote, a cancel with no sales order), and inventing a refusal SENTENCE at
   * this seam would put words in the guard's mouth. The guards live in
   * `actions/`, which is where the sentences already are.
   */
  const writes: SupplierWrites = {
    async submitToQuoteDesk(orderId: EntityId): Promise<Result<void>> {
      sim.submitToQuoteDesk(orderId);
      return ok(undefined);
    },
    async withdrawFromQuoteDesk(orderId: EntityId): Promise<Result<void>> {
      sim.withdrawFromQuoteDesk(orderId);
      return ok(undefined);
    },
    async createOrderWithSupplier(order: Order): Promise<Result<void>> {
      sim.createOrderWithSupplier(order);
      return ok(undefined);
    },
    async cancelWithSupplier(orderId: EntityId): Promise<Result<void>> {
      sim.cancelWithSupplier(orderId);
      return ok(undefined);
    },
  };

  return {
    mode: 'sim',
    reads,
    // No login exists in sim mode, and a `login()` that always succeeds is a
    // fake door on a screen a contractor would trust (§1.1).
    auth: null,
    writes,
  };
}
