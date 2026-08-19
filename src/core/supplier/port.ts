import type { Uom } from '../domain/catalog';
import type { Invoice, Quote, SalesOrder } from '../domain/supplier';
import type { Capability } from '../domain/team';
import type { EntityId } from '../lib/ids';
import type { Cents } from '../lib/money';
import type { Result } from '../lib/result';
import type { IsoDateTime } from '../lib/time';

/**
 * ONE port, two implementations — the seam a real ERP connects through.
 *
 * This interface was not designed from the ERP's route list. It was DISCOVERED
 * from what `sim/types.ts` already narrows a supplier down to: five stores and
 * six mutators, of which exactly three stores hold supplier-side facts
 * (`quotes`, `salesOrders`, `invoices`), plus the four verbs `sim/index.ts`
 * already exposes as `Sim` — submit to the quote desk, withdraw from it, place
 * an order, cancel one. The simulator was built as a seam rather than a stub
 * ("when a real ERP connects, everything in this file is replaced by an API
 * call that returns the same PriceQuote"), so the port is the shape it already
 * has. Anything else would be an invention one of the two implementations then
 * has to fake.
 *
 * The split below is the load-bearing part:
 *
 * - `SupplierReads` is everything answerable with a GET against a real ERP.
 * - `SupplierWrites` is the four verbs. Stage 1 (`erpReads`) ships reads only,
 *   so `ErpSupplier` implements `SupplierReads` and nothing else —
 *   structurally, not by convention. A method that does not exist cannot be
 *   called by accident, and `supplier/__tests__/structure.test.ts` fails if one
 *   appears.
 *
 * Every method returns `Promise<Result<T>>`. `Result` is preserved rather than
 * thrown because the refusal sentence is contractor-facing copy that also
 * reaches the AI verbatim as a `tool_result` (`lib/result.ts`); a rejected
 * promise loses that symmetry. The promise is what makes a network legal here —
 * the sim answers synchronously and wraps in a resolved promise.
 *
 * One set of domain types. `Quote`, `SalesOrder` and `Invoice` are already the
 * boundary and do not gain ERP variants: if an ERP field has no home, either
 * the domain type earns it or `adapters/erp/map.ts` drops it.
 */

export type SupplierMode = 'sim' | 'erp';

/**
 * The refusal vocabulary, shared by every implementation.
 *
 * These sentences belong to the PORT rather than to the HTTP client, because
 * an identical failure must read identically whichever supplier answered — the
 * contractor asking for an order that is not there gets the same words in the
 * demo and in production, and so does the assistant, verbatim.
 *
 * `notFound` and `notPermitted` are deliberately separate. The ERP resolves
 * every id together with the caller's `customer_id` in the same query, so
 * another tenant's id answers 404 rather than 403; collapsing the two would
 * either confirm to a prober that a guessed id exists, or send a contractor to
 * ask an admin for something that was simply deleted.
 */
export const SUPPLIER_REFUSALS = {
  sessionEnded: 'Your session with the supplier has ended. Sign in again to continue.',
  /**
   * A 401 on the LOGIN route is a wrong password, not a lapsed session.
   *
   * The ERP answers both with the same status, and folding them together tells
   * someone who has just mistyped their password that they have been signed
   * out — of a session they never had. It also fires `onSessionLost`, so the
   * shell "returns" to a login screen the contractor is already looking at.
   * Generic on purpose: it names neither which half was wrong nor whether the
   * email exists, matching the ERP's own constant-time miss path.
   */
  badCredentials: "That email and password don't match an account with the supplier.",
  notFound: "We couldn't find that with the supplier — it may have been removed.",
  notPermitted: "You don't have permission to do that — ask an account admin at your company.",
  unreachable: "We couldn't reach the supplier. Check your connection and try again.",
  cancelled: 'Cancelled.',
  malformed: 'The supplier sent something we could not read. Try again in a moment.',
} as const;

/**
 * CP-07's three portal roles, carried verbatim.
 *
 * Deliberately NOT squeezed into HH Pro's four `TeamRole`s. HH Pro's model is
 * finer in one place that matters — `pm` orders-but-cannot-pay and `ap`
 * pays-but-cannot-order are not representable in CP-07 — and rendering a role
 * the server cannot enforce is the "permission gate silently switched off" bug
 * class this codebase already fought once. In ERP mode HH Pro shows the ERP's
 * three roles honestly and derives what a person may DO from `capabilities`,
 * never from a local role table.
 */
export type PortalRole = 'account_admin' | 'buyer' | 'field_crew';

export const PORTAL_ROLE_LABELS: Record<PortalRole, string> = {
  account_admin: 'Owner',
  buyer: 'Buyer',
  field_crew: 'Field crew',
};

/**
 * Who the caller is, and what they may do — as resolved by the SERVER.
 *
 * `capabilities` is the authority, not `role`. The ERP re-loads the user on
 * every request and derives capabilities from the CURRENT role and status, so
 * a demoted user loses access on the next request rather than at token expiry.
 * That property only survives if HH Pro reads the server's map instead of
 * running its own `GRANTS` table, which is the reason this field exists.
 *
 * There is deliberately no `token` field. The bearer token lives in the
 * client's token store and never crosses the port — nothing in `domain/`,
 * `selectors/` or `ui/` has any business holding a credential, and a token in
 * a domain value is a token in a persisted store one refactor later.
 */
export interface SupplierIdentity {
  userId: EntityId;
  accountId: EntityId;
  name: string;
  email: string;
  role: PortalRole;
  capabilities: Capability[];
}

/** What `login`/`refresh` establish: an identity, plus how long it is good for. */
export interface SupplierSession {
  identity: SupplierIdentity;
  /** When the current token stops being accepted. */
  expiresAt: IsoDateTime;
}

/** The dealer's identity as the server states it (`GET /config`). */
export interface SupplierBranding {
  companyName: string;
  brandColor: string;
  logoUrl?: string | undefined;
  supportEmail?: string | undefined;
  supportPhone?: string | undefined;
}

/**
 * The commercial relationship, in the units the ERP actually keeps it in.
 *
 * `termsDays` is a NUMBER, not HH Pro's `'COD' | 'NET15' | 'NET30'` code. The
 * ERP stores `payment_terms_days`, and a dealer running Net-45 is ordinary;
 * the code union cannot express one, and squeezing 45 into `NET30` would put a
 * wrong due date on a real invoice. The domain already converts code -> days
 * (`domain/account.ts`), so days is the honest superset and the code stays a
 * seed concern.
 */
export interface AccountSummary {
  accountId: EntityId;
  name: string;
  accountNumber: string;
  type: 'cash' | 'charge';
  termsDays: number;
  creditLimit?: Cents | undefined;
  /**
   * The account is stopped at the dealer. It earns a home here because a
   * credit hold is the most common real refusal a charge-account contractor
   * hits, and it has to be renderable as a first-class sentence rather than as
   * a generic error.
   */
  onHold: boolean;
}

/** `GET /billing/summary` — the numbers that explain a refusal. */
export interface BillingSummary {
  balance: Cents;
  pastDue: Cents;
  creditLimit?: Cents | undefined;
  creditAvailable?: Cents | undefined;
  /**
   * Percent, e.g. 2.9. Optional because a dealer may not charge one.
   *
   * Read from the SERVER rather than from local config: HH Pro's payment sheet
   * guarantees that the fee shown before a card is chosen is the fee charged,
   * and a locally-configured number cannot guarantee anything about what the
   * gateway will bill.
   */
  cardFeePercent?: number | undefined;
}

/**
 * One catalog hit. PRICE-FREE by construction.
 *
 * `listPrice` is public and crosses the counter; the contractor's ACCOUNT
 * price does not appear here in either implementation, because resolving one
 * is `POST /pricing/quote` — Stage 2, behind `erpPricing`. A port method whose
 * output differs by adapter is the fork this design exists to prevent, so the
 * simulator withholds the account price it could trivially compute.
 *
 * Nothing about how a price was computed is representable here at all: no
 * margin, no floor, no rule ids, no cost. Dealer margin is the one thing that
 * can never leak, and the cheapest way to guarantee that is a type with
 * nowhere to put it.
 */
export interface CatalogHit {
  productId: EntityId;
  sku: string;
  name: string;
  uom: Uom;
  listPrice: Cents;
  onHand: number;
  leadTimeDays: number;
  imageUrl?: string | undefined;
}

export interface CatalogSearchInput {
  query: string;
  limit?: number | undefined;
}

export interface LoginInput {
  email: string;
  password: string;
}

/**
 * Everything a real ERP answers with a GET, plus the two auth POSTs — which
 * write nothing on the contractor's behalf, they establish who is asking.
 *
 * Stage 1 of the rollout is exactly this list: login + refresh, `/me` and
 * capabilities, config/branding, catalog search, dashboard/billing, orders
 * read, invoices read, quotes read.
 */
export interface SupplierReads {
  /** Exchange credentials for a session. */
  login(input: LoginInput): Promise<Result<SupplierSession>>;
  /**
   * Slide the session forward. Re-runs the server's status and role check, so
   * a deactivated user cannot refresh their way back in.
   */
  refresh(): Promise<Result<SupplierSession>>;
  /** Re-resolve the caller. The capability map is the authorization source. */
  me(): Promise<Result<SupplierIdentity>>;
  branding(): Promise<Result<SupplierBranding>>;
  searchCatalog(input: CatalogSearchInput): Promise<Result<CatalogHit[]>>;
  accountSummary(): Promise<Result<AccountSummary>>;
  billingSummary(): Promise<Result<BillingSummary>>;
  listQuotes(): Promise<Result<Quote[]>>;
  getQuote(quoteId: EntityId): Promise<Result<Quote>>;
  listSalesOrders(): Promise<Result<SalesOrder[]>>;
  getSalesOrder(salesOrderId: EntityId): Promise<Result<SalesOrder>>;
  listInvoices(): Promise<Result<Invoice[]>>;
  getInvoice(invoiceId: EntityId): Promise<Result<Invoice>>;
}

/**
 * The four verbs a contractor asks the supplier to perform.
 *
 * Lifted verbatim from `sim/index.ts`'s `Sim` — these are the supplier-side
 * writes the stage machine's effects already drive. They stay sim-only until
 * Stages 3-5 (`erpPlan`, `erpOrders`, `erpPayments`); `ErpSupplier` does not
 * implement this interface and must not acquire a member of it by accident.
 */
export interface SupplierWrites {
  submitToQuoteDesk(orderId: EntityId): Promise<Result<void>>;
  withdrawFromQuoteDesk(orderId: EntityId): Promise<Result<void>>;
  createOrderWithSupplier(orderId: EntityId): Promise<Result<void>>;
  cancelWithSupplier(orderId: EntityId): Promise<Result<void>>;
}

export interface SupplierPort extends SupplierReads, SupplierWrites {
  readonly mode: SupplierMode;
}

/** A read-only supplier: the reads, and structurally nothing else. */
export interface SupplierReadOnlyPort extends SupplierReads {
  readonly mode: SupplierMode;
}

export type Supplier = SupplierPort | SupplierReadOnlyPort;

/**
 * The method names, as data, so a test can iterate them.
 *
 * `structure.test.ts` asserts every WRITE name is absent from `ErpSupplier`
 * and every READ name is present on both implementations. Written down once
 * here rather than duplicated in the test: adding a method to the interface
 * without adding it to this list is caught by the compiler (`satisfies`), and
 * adding it here without implementing it is caught by the test.
 */
export const SUPPLIER_READ_METHODS = [
  'login',
  'refresh',
  'me',
  'branding',
  'searchCatalog',
  'accountSummary',
  'billingSummary',
  'listQuotes',
  'getQuote',
  'listSalesOrders',
  'getSalesOrder',
  'listInvoices',
  'getInvoice',
] as const satisfies readonly (keyof SupplierReads)[];

export const SUPPLIER_WRITE_METHODS = [
  'submitToQuoteDesk',
  'withdrawFromQuoteDesk',
  'createOrderWithSupplier',
  'cancelWithSupplier',
] as const satisfies readonly (keyof SupplierWrites)[];

/** Narrows to the write-capable port — true for the sim, false for Stage 1 ERP. */
export function isWriteCapable(supplier: Supplier): supplier is SupplierPort {
  return SUPPLIER_WRITE_METHODS.every(
    (method) => typeof (supplier as unknown as Record<string, unknown>)[method] === 'function',
  );
}
