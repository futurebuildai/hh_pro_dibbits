import type { Uom } from '../domain/catalog';
import type { DealerBranding } from '../domain/config';
import type { Order } from '../domain/project';
import type { Invoice, Quote, SalesOrder } from '../domain/supplier';
import type { Capability } from '../domain/team';
import type { EntityId } from '../lib/ids';
import type { Cents } from '../lib/money';
import type { Result } from '../lib/result';
import type { IsoDateTime } from '../lib/time';

/**
 * The seam between HH Pro and whoever is playing the supplier.
 *
 * This interface was DISCOVERED, not designed. `sim/types.ts` already narrows
 * what a supplier is allowed to touch — five stores plus six mutators — and
 * `sim/index.ts` already publishes exactly four supplier-side writes. Those
 * four are `SupplierWrites` verbatim. The read half comes from the other
 * direction: the endpoint map in the connection spec (§2.2) says which facts a
 * real ERP can hand back, and Stage 1 (§7.3) says which of them ship first.
 * Nothing here is a guess about a future stage.
 *
 * Framework-free and transport-free by construction: `fetch` is injected, no
 * ambient globals are read, and the only DOM types named are the structural
 * ones a `fetch` implementation already satisfies (see `erp-client.ts`).
 */

export type SupplierMode = 'sim' | 'erp';

/** The ERP's list envelope (`httpx.Page[T]`), preserved rather than flattened. */
export interface SupplierPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PageInput {
  limit?: number;
  offset?: number;
  /** Passed through verbatim; the ERP 400s on a value outside its CHECK set. */
  status?: string;
}

/**
 * The supplier's own capability vocabulary, carried verbatim.
 *
 * HH Pro's six capabilities are COARSER than the ERP's nine in the two places
 * that matter (spec §1.3): `move-stage` spans SubmitRFQ *and* CreateOrders, and
 * `pay` spans PayInvoices *and* ManagePaymentMethods. Collapsing is lossy and
 * the loss is load-bearing later — the stage guard has to ask which stage it is
 * moving TO before it knows which ERP capability applies. So the collapse
 * happens for today's guards and the uncollapsed truth rides alongside it.
 */
export interface ErpCapabilities {
  manageUsers: boolean;
  viewBilling: boolean;
  payInvoices: boolean;
  managePaymentMethods: boolean;
  submitRfq: boolean;
  createOrders: boolean;
  viewOrdersDeliveries: boolean;
  editDeliveryInstructions: boolean;
  manageFiles: boolean;
}

export interface SupplierIdentity {
  userId: EntityId;
  accountId: EntityId;
  name: string;
  email: string;
  /**
   * The supplier's OWN role code (`account_admin`, `buyer_no_pay`, …), never
   * re-expressed as a HH Pro `TeamRole`. Shipping a role picker the server
   * cannot enforce is the post-M8 bug class the spec's R-4 exists to prevent.
   */
  role: string;
  status: string;
  /** What the guards may consult. Derived from the server, never from GRANTS. */
  capabilities: Record<Capability, boolean>;
  /** The uncollapsed server answer, for the guards that need the finer grain. */
  erpCapabilities: ErpCapabilities;
}

/**
 * A signed-in session, as everything above the port is allowed to see it.
 *
 * There is deliberately NO `token` field. Token custody is the adapter's, and
 * only the adapter's (spec §1.2): HH Pro persists twelve stores to
 * `localStorage` and stashes a corrupt-save backup, so a bearer token that can
 * be read above the port is a bearer token that eventually lands in a forensic
 * stash or rides a cross-tab `storage` event. A shape that cannot carry the
 * credential cannot leak it — the same argument `DealerConfig` already makes
 * about the LLM key.
 */
export interface SupplierSession {
  identity: SupplierIdentity;
  branding: DealerBranding;
  /**
   * When THIS token dies. `null` after a login, because the ERP's login
   * response does not carry it — only the refresh response does. See
   * NOTES-DIB480.md; this is a real gap in the Stage 1a contract, pinned by a
   * contract test so it cannot be quietly "fixed" client-side by decoding the
   * JWT (which is exactly what handing the instants over is meant to avoid).
   */
  expiresAt: IsoDateTime | null;
  /** The absolute ceiling — original login + 7 days. Never moves on refresh. */
  sessionExpiresAt: IsoDateTime | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface CatalogSearchInput {
  query: string;
  limit?: number;
}

/** `product.CatalogResult` — the compact picker hit, price-free by construction. */
export interface CatalogHit {
  productId: EntityId;
  sku: string;
  name: string;
  category: string;
  /**
   * `null` when the supplier priced in a unit this build does not model. The
   * house rule is "never render a confident wrong number" and a wrong UOM is
   * the most expensive wrong number in this vertical — a pallet read as an
   * each. Nothing is better than something here.
   */
  baseUom: Uom | null;
}

/** `GET /dashboard` — the account facts `domain/account.ts` invents today. */
export interface AccountSnapshot {
  accountId: EntityId;
  accountNumber: string;
  name: string;
  customerType: string;
  branchId: string | null;
  paymentTermsDays: number;
  creditLimit: Cents;
  onHold: boolean;
  openBalance: Cents;
  availableCredit: Cents;
}

/** `GET /billing/summary` — the numbers that explain a credit refusal (§4.2). */
export interface BillingSummary {
  openBalance: Cents;
  creditLimit: Cents;
  availableCredit: Cents;
  onHold: boolean;
  paymentTermsDays: number;
}

/**
 * Stage 1's read surface (§7.3): auth, self + capabilities, config/branding,
 * catalog search, dashboard/billing summary, and the orders/invoices/quotes
 * reads. Every one of these is a GET the ERP already serves.
 */
export interface SupplierReads {
  me(): Promise<Result<SupplierIdentity>>;
  branding(): Promise<Result<DealerBranding>>;
  searchCatalog(input: CatalogSearchInput): Promise<Result<CatalogHit[]>>;
  dashboard(): Promise<Result<AccountSnapshot>>;
  billingSummary(): Promise<Result<BillingSummary>>;
  listOrders(input?: PageInput): Promise<Result<SupplierPage<SalesOrder>>>;
  getOrder(id: EntityId): Promise<Result<SalesOrder>>;
  listInvoices(input?: PageInput): Promise<Result<SupplierPage<Invoice>>>;
  getInvoice(id: EntityId): Promise<Result<Invoice>>;
  listQuotes(input?: PageInput): Promise<Result<SupplierPage<Quote>>>;
  getQuote(id: EntityId): Promise<Result<Quote>>;
}

/**
 * The four supplier-side writes, lifted verbatim off `Sim` in `sim/index.ts`.
 *
 * Synchronous there, `Promise<Result<T>>` here — spec §2.1's one mechanical
 * change. `Result` survives the wrapping, which is what keeps the refusal
 * sentence contract intact for both the board drop and the AI's `tool_result`.
 */
export interface SupplierWrites {
  submitToQuoteDesk(orderId: EntityId): Promise<Result<void>>;
  withdrawFromQuoteDesk(orderId: EntityId): Promise<Result<void>>;
  createOrderWithSupplier(order: Order): Promise<Result<void>>;
  cancelWithSupplier(orderId: EntityId): Promise<Result<void>>;
}

export interface SupplierAuth {
  login(input: LoginInput): Promise<Result<SupplierSession>>;
  /** Sliding refresh (OR-3). Refuses rather than resurrecting a dead session. */
  refresh(): Promise<Result<SupplierSession>>;
  signOut(): void;
  session(): SupplierSession | null;
}

export interface SupplierPort {
  readonly mode: SupplierMode;
  readonly reads: SupplierReads;
  /**
   * `null` when there is no session to establish. The sim has no login at all
   * (§1.1) — its identity is the seeded demo account and the PersonSwitcher,
   * and inventing a `login()` that always succeeds would be a fake door.
   */
  readonly auth: SupplierAuth | null;
  /**
   * `null` when this implementation holds no supplier-side write path. Stage 1
   * is reads only (§7.3): writes stay sim everywhere, so `ErpSupplier.writes`
   * is null and the structural test below keeps it that way.
   */
  readonly writes: SupplierWrites | null;
}

/**
 * Every name a supplier-side WRITE can have, across the whole endpoint map.
 *
 * This is a deny-list for a structural test, not a roadmap. The first four are
 * today's sim writes; the rest are every mutating capability the spec's §2.2
 * endpoint map names for a later stage. A write method reaching `ErpSupplier`
 * this stage — under any of these names — is caught by
 * `supplier/__tests__/structure.test.ts` rather than by a contractor
 * discovering that a read-only board is not read-only.
 */
export const SUPPLIER_WRITE_METHODS = [
  // Stage 0 — what the sim publishes today.
  'submitToQuoteDesk',
  'withdrawFromQuoteDesk',
  'createOrderWithSupplier',
  'cancelWithSupplier',
  // Stage 2–3 — pricing and the quote desk.
  'quoteLines',
  'syncProjectLines',
  'acceptQuote',
  'rejectQuote',
  // Stage 4 — order writes.
  'convertQuote',
  'updateSiteInstructions',
  'requestDeliveryReschedule',
  'requestCancel',
  'confirmWillCallPickup',
  // Stage 5 — money.
  'payInvoices',
  'addPaymentMethod',
  'removePaymentMethod',
  'setDefaultPaymentMethod',
  // Team roster writes (OR-18).
  'inviteUser',
  'setUserRole',
  'setUserStatus',
] as const;

export type SupplierWriteMethod = (typeof SUPPLIER_WRITE_METHODS)[number];

/**
 * Where the adapter keeps its bearer token.
 *
 * Injected because `src/core` is DOM-free by default and the correct browser
 * home for this is `sessionStorage` — per-tab, not persisted, not cross-tab
 * synced (§1.2). Core ships the in-memory implementation; the shell supplies
 * the `sessionStorage`-backed one.
 */
export interface TokenStore {
  read(): string | null;
  write(token: string): void;
  clear(): void;
}

export function memoryTokenStore(): TokenStore {
  let token: string | null = null;
  return {
    read: () => token,
    write: (next) => {
      token = next;
    },
    clear: () => {
      token = null;
    },
  };
}

/**
 * Refusal sentences.
 *
 * They reach a contractor on a rejected action AND the model verbatim as a
 * `tool_result`, so they are written as sentences a person can act on rather
 * than as status codes. `SESSION_GONE` in particular is never softened into a
 * retry: a portal that quietly starts serving fabricated prices when its ERP
 * session lapses is the single worst failure this integration can have (§1.2).
 */
export const SUPPLIER_ERRORS = {
  sessionGone: 'Your session with the supplier has ended — sign in again.',
  badCredentials: "That email and password don't match an account with the supplier.",
  forbidden: "You don't have permission to see that on your supplier account.",
  notFound: "That isn't on your supplier account.",
  unavailable: "Couldn't reach the supplier just now — try again in a moment.",
  aborted: 'That request was cancelled.',
  malformed: 'The supplier sent something this app could not read.',
  notConfigured: 'The supplier connection is not configured.',
} as const;
