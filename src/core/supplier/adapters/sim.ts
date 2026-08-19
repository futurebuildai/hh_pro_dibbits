import { dealerConfig } from '../../config/runtime';
import { termsDays as termsDaysFor } from '../../domain/account';
import { totalOnHand } from '../../domain/catalog';
import { CAPABILITY_VERBS, type Capability, type TeamRole, can } from '../../domain/team';
import type { EntityId } from '../../lib/ids';
import { type Result, err, ok } from '../../lib/result';
import { addHours } from '../../lib/time';
import { buildArSummary } from '../../selectors/ar';
import { searchProducts } from '../../selectors/order';
import type { SimClock } from '../../sim/clock';
import type { Sim } from '../../sim/index';
import {
  catalogStore,
  invoicesStore,
  ordersStore,
  quotesStore,
  salesOrdersStore,
  sessionStore,
  teamStore,
} from '../../stores/root';
import { listOf } from '../../stores/store';
import {
  type AccountSummary,
  type CatalogHit,
  type PortalRole,
  SUPPLIER_REFUSALS,
  type SupplierIdentity,
  type SupplierPort,
} from '../port';

/**
 * Today's simulator, behind the port.
 *
 * This adapter WRAPS `createSim` and the supplier-side stores; it does not
 * reimplement them and it changes nothing about how they behave. The reads
 * answer from the same stores the board already renders, the four writes
 * delegate to the same `Sim` methods the stage machine's effects already call,
 * and every synchronous answer is wrapped in a resolved promise. That is the
 * whole trick that lets one port span a local simulator and a network: the sim
 * loses nothing by being awaited.
 *
 * The simulator is a permanent, supported mode — it is how the demo runs, how
 * the guide is captured, how the e2e suite drives a production build, and how a
 * dealer evaluates the product before their ERP is connected. It never becomes
 * dead code, so it never rots.
 */
export type SimSupplier = SupplierPort & { readonly mode: 'sim' };

export interface SimSupplierOptions {
  sim: Sim;
  clock: SimClock;
}

const ALL_CAPABILITIES = Object.keys(CAPABILITY_VERBS) as Capability[];

/**
 * HH Pro's four roles collapsed onto CP-07's three, for the demo's benefit.
 *
 * Lossy in exactly the place the spec names: `pm` (orders, cannot pay) and `ap`
 * (pays, cannot order) both land on `buyer`, because CP-07's `buyer` holds
 * both `PayInvoices` and `CreateOrders` and cannot express either persona. The
 * loss is confined to the DISPLAY role — capabilities below still come from
 * the local grant table, so the demo's permission gate keeps working exactly
 * as it does today. Two portal roles (OR-2) would make the mapping exact.
 */
function portalRoleFor(role: TeamRole | 'estimator' | undefined): PortalRole {
  switch (role) {
    case 'owner':
      return 'account_admin';
    case 'field':
      return 'field_crew';
    default:
      return 'buyer';
  }
}

/**
 * The demo's session TTL, mirroring the ERP's 12h `jwtTTL` so a login screen
 * built against the sim behaves like one built against the real portal.
 */
const SIM_SESSION_HOURS = 12;

export function createSimSupplier(options: SimSupplierOptions): SimSupplier {
  const { sim, clock } = options;

  function identity(): Result<SupplierIdentity> {
    const session = sessionStore.get();
    if (!session.account || !session.user) return err(SUPPLIER_REFUSALS.sessionEnded);

    // Who is ACTING, which is the demo's login story: `team.activeId` is
    // per-window state and every permission check already reads it.
    const team = teamStore.get();
    const acting = team.activeId ? team.members.byId[team.activeId] : undefined;

    // With no team seeded, everything is allowed. The gate exists once people
    // exist — an embed of core without the team feature costs nothing, and the
    // pre-existing tests never had to change. Preserved here exactly.
    const capabilities = acting
      ? ALL_CAPABILITIES.filter((capability) => can(acting.role, capability))
      : [...ALL_CAPABILITIES];

    return ok({
      userId: acting?.id ?? session.user.id,
      accountId: session.account.id,
      name: acting?.name ?? session.user.name,
      email: acting?.email ?? session.user.email,
      role: portalRoleFor(acting?.role ?? session.user.role),
      capabilities,
    });
  }

  function session() {
    const who = identity();
    if (!who.ok) return err<{ identity: SupplierIdentity; expiresAt: string }>(who.error);
    return ok({
      identity: who.value,
      expiresAt: addHours(clock.nowIso(), SIM_SESSION_HOURS),
    });
  }

  function accountSummary(): Result<AccountSummary> {
    const account = sessionStore.get().account;
    if (!account) return err(SUPPLIER_REFUSALS.sessionEnded);

    // The same precedence `createSim` uses: the dealer's configured terms win,
    // the account's code is the fallback for a deployment that has never
    // opened the admin console. `??` and not `||`, because a dealer setting 0
    // means "due on receipt".
    const days = dealerConfig().supplier.termsDays ?? termsDaysFor(account.paymentTermsCode);

    return ok({
      accountId: account.id,
      name: account.name,
      accountNumber: account.accountNumber,
      type: account.type,
      termsDays: days,
      ...(account.creditLimit === undefined ? {} : { creditLimit: account.creditLimit }),
      // The simulator never stops an account. A hold is a dealer-side fact and
      // there is nothing in the sim that could produce one honestly.
      onHold: false,
    });
  }

  function catalogHit(productId: string): CatalogHit | null {
    const product = catalogStore.get().products.find((candidate) => candidate.id === productId);
    if (!product) return null;
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      uom: product.baseUom,
      // LIST price only, matching the ERP adapter. The account price comes
      // from the pricing resolve in Stage 2, and a port method that answers
      // differently depending on who implements it is the fork this design
      // exists to prevent — so the sim withholds what it could compute.
      listPrice: product.listPrice,
      onHand: totalOnHand(product),
      leadTimeDays: product.leadTimeDays,
      ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
    };
  }

  /** Wraps a sim verb: resolve the card first, refuse identically if it is gone. */
  function write(orderId: EntityId, run: (id: EntityId) => void): Promise<Result<void>> {
    const order = ordersStore.get().byId[orderId];
    if (!order) return Promise.resolve(err(SUPPLIER_REFUSALS.notFound));
    run(orderId);
    return Promise.resolve(ok(undefined));
  }

  return {
    mode: 'sim',

    // The simulator has no credential to check: there is no login in the demo,
    // and the PersonSwitcher is the login story. Any credentials establish the
    // seeded session, which is what a dealer evaluating the product expects.
    login: () => Promise.resolve(session()),
    refresh: () => Promise.resolve(session()),
    me: () => Promise.resolve(identity()),

    branding: () => {
      const branding = dealerConfig().branding;
      return Promise.resolve(
        ok({
          companyName: branding.companyName,
          brandColor: branding.brandColor,
          ...(branding.logoUrl ? { logoUrl: branding.logoUrl } : {}),
        }),
      );
    },

    searchCatalog: (input) => {
      const products = searchProducts(catalogStore.get().products, input.query, input.limit ?? 25);
      const hits: CatalogHit[] = [];
      for (const product of products) {
        const hit = catalogHit(product.id);
        if (hit) hits.push(hit);
      }
      return Promise.resolve(ok(hits));
    },

    accountSummary: () => Promise.resolve(accountSummary()),

    billingSummary: () => {
      const account = sessionStore.get().account;
      const ar = buildArSummary(invoicesStore.get(), clock.nowIso());
      const creditLimit = account?.creditLimit;
      return Promise.resolve(
        ok({
          balance: ar.outstanding,
          pastDue: ar.overdue,
          ...(creditLimit === undefined
            ? {}
            : {
                creditLimit,
                creditAvailable: Math.max(0, creditLimit - ar.outstanding),
              }),
          cardFeePercent: dealerConfig().supplier.cardFeePercent,
        }),
      );
    },

    listQuotes: () => Promise.resolve(ok(listOf(quotesStore.get()))),
    getQuote: (quoteId) => {
      const quote = quotesStore.get().byId[quoteId];
      return Promise.resolve(quote ? ok(quote) : err(SUPPLIER_REFUSALS.notFound));
    },

    listSalesOrders: () => Promise.resolve(ok(listOf(salesOrdersStore.get()))),
    getSalesOrder: (salesOrderId) => {
      const salesOrder = salesOrdersStore.get().byId[salesOrderId];
      return Promise.resolve(salesOrder ? ok(salesOrder) : err(SUPPLIER_REFUSALS.notFound));
    },

    listInvoices: () => Promise.resolve(ok(listOf(invoicesStore.get()))),
    getInvoice: (invoiceId) => {
      const invoice = invoicesStore.get().byId[invoiceId];
      return Promise.resolve(invoice ? ok(invoice) : err(SUPPLIER_REFUSALS.notFound));
    },

    // The four verbs, delegating to the same Sim the stage effects call today.
    submitToQuoteDesk: (orderId) => write(orderId, (id) => sim.submitToQuoteDesk(id)),
    withdrawFromQuoteDesk: (orderId) => write(orderId, (id) => sim.withdrawFromQuoteDesk(id)),
    createOrderWithSupplier: (orderId) =>
      write(orderId, (id) => {
        const order = ordersStore.get().byId[id];
        if (order) sim.createOrderWithSupplier(order);
      }),
    cancelWithSupplier: (orderId) => write(orderId, (id) => sim.cancelWithSupplier(id)),
  };
}
