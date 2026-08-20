import type { Uom } from '../../domain/catalog';
import {
  DEFAULT_CONFIG,
  type DealerBranding,
  isValidColor,
  isValidLogo,
} from '../../domain/config';
import type {
  Invoice,
  Quote,
  QuoteStatus,
  SalesOrder,
  SalesOrderStatus,
} from '../../domain/supplier';
import type { Capability } from '../../domain/team';
import type { Cents } from '../../lib/money';
import type {
  AccountSnapshot,
  BillingSummary,
  CatalogHit,
  ErpCapabilities,
  SupplierIdentity,
  SupplierPage,
} from '../port';
import type {
  WireAccount,
  WireBillingSummary,
  WireCapabilities,
  WireCatalogResult,
  WireConfig,
  WireDashboard,
  WireInvoice,
  WireMe,
  WireOrder,
  WireOrderDetail,
  WirePage,
  WireQuote,
} from './erp-wire';

/**
 * Wire shapes -> domain types. The ONLY place cents, UOM and status translate
 * (spec §7.1), and the only place that decides what an unrecognised value costs.
 *
 * Two rules run through every function here:
 *
 * 1. **Whitelist, never pass-through.** Every object is BUILT, field by named
 *    field. A projection that spreads the wire object leaks the next field the
 *    ERP adds — which for the pricing surface is the dealer's margin (R-2) and
 *    is unrecoverable. Building explicitly means an unknown field cannot
 *    survive the boundary even by accident.
 * 2. **An unrecognised enum degrades to the most neutral member**, never to the
 *    strongest claim (R-11). A status HH Pro has never heard of renders as
 *    "the supplier has it", not as "delivered".
 */

/** Fields that must never cross the counter, at any stage (spec §2.4 / R-2). */
export const FORBIDDEN_WIRE_FIELDS = [
  'margin_bps',
  'floor_bps',
  'cost_cents',
  'blocked',
  'block_policy',
  'bypass_reason',
  'override_requested',
  'override_authority',
  'source',
  'detail',
  'actor_id',
  'actor_name',
] as const;

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function cents(value: unknown): Cents {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
}

function bool(value: unknown): boolean {
  return value === true;
}

/**
 * An ISO instant, or the empty string when the ERP sent something unusable.
 *
 * Go's `time.Time` zero value serializes as `0001-01-01T00:00:00Z`, which is a
 * VALID date and would render as the year 1 on a delivery card. It is the
 * ERP's "unset", so it is treated as unset here rather than shown.
 */
export const GO_ZERO_TIME = '0001-01-01T00:00:00Z';
const GO_ZERO_DATE = GO_ZERO_TIME.slice(0, 10);

function iso(value: unknown): string {
  const raw = str(value);
  if (raw === '' || raw.startsWith(GO_ZERO_DATE)) return '';
  return Number.isNaN(Date.parse(raw)) ? '' : raw;
}

/**
 * The ERP speaks its own UOM vocabulary (`uoms` table, migration 0002):
 * `PC, EA, LYR, PLT, BOX, BAG, SF, M2, LF, KG, T, CYD`. HH Pro's `Uom` union
 * spells several of the same physical units differently, and the first live
 * read against dibbits-staging surfaced the drift: every `PC` paver and `BAG`
 * of sand came back `baseUom: null` because the old table only recognised
 * HH Pro's own spellings.
 *
 * The rule for an entry here is EXACT 1:1 sameness of the physical unit —
 * a bag is a bag, a tonne is a tonne, a piece is a count of one exactly as
 * "each" is. Anything that would need a CONVERSION is refused, not converted:
 * `M2` is not `SF` (×10.764), `KG` is not `TON` (×1000), and a `LYR` (layer)
 * has no HH Pro unit at all. Those stay `null` under the house rule that a
 * wrong unit is the most expensive wrong number in this vertical.
 *
 * HH Pro's own codes stay accepted as identities so recorded fixtures and any
 * future ERP that adopts the same spellings keep working.
 */
const UOM_FROM_WIRE: Record<string, Uom> = {
  // Identities — codes both vocabularies share, plus HH Pro's own spellings.
  EA: 'EA',
  SF: 'SF',
  LF: 'LF',
  TON: 'TON',
  CY: 'CY',
  PLT: 'PLT',
  BG: 'BG',
  BX: 'BX',
  RL: 'RL',
  BD: 'BD',
  // ERP spellings of the same physical unit (uoms table, migration 0002).
  PC: 'EA', // "Piece" — count of one, exactly what EA renders as ("each")
  BAG: 'BG',
  BOX: 'BX',
  T: 'TON', // both are the metric tonne
  CYD: 'CY', // both are the cubic yard
};

export function mapUom(value: unknown): Uom | null {
  return UOM_FROM_WIRE[str(value).toUpperCase()] ?? null;
}

export function mapErpCapabilities(wire: WireCapabilities | undefined): ErpCapabilities {
  const c = wire ?? {};
  return {
    manageUsers: bool(c.manage_users),
    viewBilling: bool(c.view_billing),
    payInvoices: bool(c.pay_invoices),
    managePaymentMethods: bool(c.manage_payment_methods),
    submitRfq: bool(c.submit_rfq),
    createOrders: bool(c.create_orders),
    viewOrdersDeliveries: bool(c.view_orders_deliveries),
    editDeliveryInstructions: bool(c.edit_delivery_instructions),
    manageFiles: bool(c.manage_files),
  };
}

/**
 * ERP capabilities -> HH Pro capabilities (spec §1.3's table).
 *
 * Where one HH Pro capability spans two ERP ones the collapse is a CONJUNCTION,
 * because the failure modes are not symmetric: a refusal the server would have
 * allowed costs a phone call, and a button the server refuses costs trust — it
 * is the "permission gate silently switched off" class the post-M8 review
 * already fought once (R-4). The uncollapsed set rides along on
 * `SupplierIdentity.erpCapabilities` for the destination-aware stage guard.
 *
 * `customer-quote` is the one capability the server has no opinion about: the
 * contractor's homeowner proposals are HH Pro-local in v1 and carry the
 * CONTRACTOR's branding (§4.5 / OR-11). Deriving it from the ERP would mean
 * deriving it as `false` and deleting a working local feature for every signed
 * -in contractor, so it is true by construction and pinned by a test.
 */
export function mapCapabilities(erp: ErpCapabilities): Record<Capability, boolean> {
  return {
    'edit-scope': erp.submitRfq,
    'move-stage': erp.submitRfq && erp.createOrders,
    'customer-quote': true,
    pay: erp.payInvoices && erp.managePaymentMethods,
    'confirm-pickup': erp.viewOrdersDeliveries,
    'manage-team': erp.manageUsers,
  };
}

export function mapIdentity(wire: WireMe | undefined): SupplierIdentity {
  const me = wire ?? {};
  const erpCapabilities = mapErpCapabilities(me.capabilities);
  return {
    userId: str(me.id),
    accountId: str(me.customer_id),
    name: str(me.name),
    email: str(me.email),
    role: str(me.role),
    status: str(me.status),
    capabilities: mapCapabilities(erpCapabilities),
    erpCapabilities,
  };
}

/**
 * `GET /config` -> `DealerBranding`.
 *
 * Re-validated through the SAME guards the injected config runs through, for
 * the same reason: these values are interpolated into a stylesheet, so an
 * unvalidated colour is CSS injection — and an ERP is not a more trustworthy
 * source of a stylesheet fragment than a hand-edited config file. A remote
 * `logo_url` is dropped, not rendered: `isValidLogo` refuses remote URLs
 * because they beacon every contractor's visit to a third party.
 *
 * `support_email` / `support_phone` have no home in `DealerBranding` and are
 * DROPPED rather than growing an ERP-shaped variant of a domain type (§7.2
 * rule 4). They come back when a surface needs them.
 */
export function mapBranding(wire: WireConfig | undefined): DealerBranding {
  const config = wire ?? {};
  const name = str(config.dealer_name).trim().slice(0, 80);
  const color = str(config.primary_color).trim();
  const logo = str(config.logo_url).trim();
  return {
    companyName: name === '' ? DEFAULT_CONFIG.branding.companyName : name,
    brandColor: isValidColor(color) ? color : DEFAULT_CONFIG.branding.brandColor,
    ...(logo !== '' && isValidLogo(logo) ? { logoUrl: logo } : {}),
  };
}

export function mapCatalogHit(wire: WireCatalogResult): CatalogHit {
  return {
    productId: str(wire.product_id),
    sku: str(wire.sku),
    name: str(wire.name),
    category: str(wire.category),
    baseUom: mapUom(wire.base_uom),
  };
}

export function mapAccount(wire: WireDashboard | undefined): AccountSnapshot {
  const dash = wire ?? {};
  const account: WireAccount = dash.account ?? {};
  const branch = str(account.branch_id);
  return {
    accountId: str(account.customer_id),
    accountNumber: str(account.account_no),
    name: str(account.name),
    customerType: str(account.customer_type),
    branchId: branch === '' ? null : branch,
    paymentTermsDays:
      typeof account.payment_terms_days === 'number' ? account.payment_terms_days : 0,
    creditLimit: cents(account.credit_limit_cents),
    onHold: bool(account.on_hold),
    openBalance: cents(dash.open_balance_cents),
    availableCredit: cents(dash.available_credit_cents),
  };
}

export function mapBillingSummary(wire: WireBillingSummary | undefined): BillingSummary {
  const summary = wire ?? {};
  return {
    openBalance: cents(summary.open_balance_cents),
    creditLimit: cents(summary.credit_limit_cents),
    availableCredit: cents(summary.available_credit_cents),
    onHold: bool(summary.on_hold),
    paymentTermsDays:
      typeof summary.payment_terms_days === 'number' ? summary.payment_terms_days : 0,
  };
}

/**
 * There is no board card behind an ERP order in Stage 1.
 *
 * `Order` (the board card) only gains an ERP identity at Stage 3, when
 * `erpPlan` syncs procurement projects. Until then a read-only ERP order
 * belongs to no card, and the honest value is the ERP's own sentinel for an
 * unset id: the empty string. It is falsy, so every existing board selector's
 * `so.orderId === order.id` is false and nothing on the board can adopt an
 * order it does not own.
 */
const NO_BOARD_CARD = '';

const ORDER_STATUS: Record<string, SalesOrderStatus> = {
  DRAFT: 'submitted',
  CONFIRMED: 'confirmed',
  PICKING: 'picking',
  PARTIALLY_FULFILLED: 'out-for-delivery',
  FULFILLED: 'delivered',
  INVOICED: 'invoiced',
  CLOSED: 'invoiced',
  CANCELLED: 'cancelled',
};

export function mapFulfillment(value: unknown): SalesOrder['fulfillment'] {
  // PICKUP and WILL_CALL are the same act to a contractor: come and get it.
  return str(value).toUpperCase() === 'DELIVERY' ? 'delivery' : 'willcall';
}

export function mapOrderStatus(
  value: unknown,
  fulfillment: SalesOrder['fulfillment'],
): SalesOrderStatus {
  const raw = str(value).toUpperCase();
  // READY is the one status whose meaning depends on how the order leaves the
  // yard. For a will-call it is "come and get it"; for a delivery it means
  // picked and staged, which HH Pro already calls "being picked". Rendering
  // "Ready for pickup" on a delivery would send a contractor to the counter.
  if (raw === 'READY') return fulfillment === 'willcall' ? 'ready-willcall' : 'picking';
  return ORDER_STATUS[raw] ?? 'submitted';
}

/**
 * `order.Detail` -> `SalesOrder`.
 *
 * `subtotal` is mapped from `total_cents`, NOT `subtotal_cents`. HH Pro has no
 * tax model at all — `SalesOrder.subtotal` is the single number a contractor is
 * shown for an order — so mapping the ERP's pre-tax subtotal would understate
 * every order by the tax and turn "never render a confident wrong number" into
 * rendering a confidently wrong one.
 *
 * `tracking` is empty: `GET /orders/{id}/timeline` is an unbuilt route in the
 * gap ledger, and inventing a timeline from the status would be fabricating
 * supplier facts. An empty array is the existing "no events yet" shape.
 */
export function mapSalesOrder(wire: WireOrderDetail | WireOrder | undefined): SalesOrder {
  const order = wire ?? {};
  const fulfillment = mapFulfillment(order.fulfillment);
  const requested = iso(order.requested_date);
  return {
    id: str(order.id),
    orderId: NO_BOARD_CARD,
    number: str(order.order_no),
    status: mapOrderStatus(order.status, fulfillment),
    fulfillment,
    submittedAt: iso(order.created_at),
    ...(requested === '' ? {} : { promisedDate: requested }),
    subtotal: cents(order.total_cents),
    tracking: [],
  };
}

/**
 * `billing.Invoice` -> `Invoice`.
 *
 * `origin` is derived from whether the ERP linked an order: an invoice with no
 * order is a counter sale, which is exactly what the domain's own comment says
 * the absent `orderId` means. `description` is empty because the ERP invoice
 * header carries none — the lines do, and lists omit them. An empty string
 * renders as nothing rather than as a guess.
 */
export function mapInvoice(wire: WireInvoice | undefined): Invoice {
  const invoice = wire ?? {};
  const erpOrderId = str(invoice.order_id);
  return {
    id: str(invoice.id),
    number: str(invoice.invoice_no),
    accountId: str(invoice.customer_id),
    // The ERP order id IS the id `mapSalesOrder` puts on `SalesOrder.id`, so
    // this links invoice -> sales order within the ERP-read set. It is NOT the
    // board card id, which is why `orderId` stays absent.
    ...(erpOrderId === '' ? {} : { salesOrderId: erpOrderId }),
    origin: erpOrderId === '' ? 'counter' : 'portal',
    issuedAt: iso(invoice.issue_date),
    dueAt: iso(invoice.due_date),
    subtotal: cents(invoice.total_cents),
    balance: cents(invoice.balance_cents),
    description: '',
  };
}

const QUOTE_STATUS: Record<string, QuoteStatus> = {
  DRAFT: 'in-review',
  SENT: 'priced',
  ACCEPTED: 'priced',
  CONVERTED: 'priced',
  EXPIRED: 'expired',
  LOST: 'withdrawn',
};

/**
 * `quote.Detail` -> `Quote`.
 *
 * `linePrices` is empty and `deskNote` absent: both need the §2.2 extension to
 * `GET /quotes/{id}` (`desk_note`, per-line `lead_time_days`, and the project
 * link), and neither exists yet. More to the point, `linePrices` is keyed by
 * `scopeItemId` — an HH Pro id the ERP has never seen until `erpPlan` syncs the
 * plan board at Stage 3. Filling it would require inventing the join.
 */
export function mapQuote(wire: WireQuote | undefined): Quote {
  const quote = wire ?? {};
  const validUntil = iso(quote.valid_until);
  return {
    id: str(quote.id),
    orderId: NO_BOARD_CARD,
    number: str(quote.quote_no),
    status: QUOTE_STATUS[str(quote.status).toUpperCase()] ?? 'in-review',
    submittedAt: iso(quote.created_at),
    ...(validUntil === '' ? {} : { expiresAt: validUntil }),
    linePrices: [],
  };
}

/** `httpx.Page[T]` -> `SupplierPage<T>`, one mapper applied to every item. */
export function mapPage<W, T>(wire: WirePage<W> | undefined, item: (raw: W) => T): SupplierPage<T> {
  const page = wire ?? {};
  const items = Array.isArray(page.items) ? page.items : [];
  return {
    items: items.map(item),
    total: typeof page.total === 'number' ? page.total : items.length,
    limit: typeof page.limit === 'number' ? page.limit : items.length,
    offset: typeof page.offset === 'number' ? page.offset : 0,
  };
}
