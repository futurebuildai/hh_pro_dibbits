import type { Uom } from '../../../domain/catalog';
import type {
  Invoice,
  Quote,
  QuoteStatus,
  SalesOrder,
  SalesOrderStatus,
} from '../../../domain/supplier';
import type { Capability } from '../../../domain/team';
import type { Cents } from '../../../lib/money';
import { type Result, err, ok } from '../../../lib/result';
import type {
  AccountSummary,
  BillingSummary,
  CatalogHit,
  PortalRole,
  SupplierBranding,
  SupplierIdentity,
  SupplierSession,
} from '../../port';
import { SUPPLIER_REFUSALS } from '../../port';

/**
 * ERP wire shapes -> domain types. The ONLY place a translation happens.
 *
 * Everything about the ERP's vocabulary stops here: snake_case, `*_cents`
 * integers, uppercase status enums, CP-07's nine capabilities. Downstream —
 * `domain/`, `selectors/`, `actions/`, `ui/` — sees the same types the
 * simulator produces and cannot tell which supplier answered.
 *
 * Three rules this file exists to enforce:
 *
 * 1. **WHITELIST, never pass-through.** Each mapper builds a fresh object out
 *    of named fields. A response that grows `margin_bps`, `floor_bps`,
 *    `cost_cents`, `blocked` or `bypass_reason` next deploy therefore cannot
 *    reach a contractor's screen: there is nowhere for it to land. A
 *    `{...raw}` spread anywhere in this file would publish the dealer's floor
 *    the first time the projection drifts, which is R-2.
 *
 * 2. **A field we cannot read is a REFUSAL, not a zero.** `balance_cents`
 *    missing must not become `0` — that renders an unpaid invoice as settled.
 *    Every mapper returns `Result`, and a malformed payload produces a
 *    contractor-readable sentence instead of a confident wrong number.
 *
 * 3. **An unknown enum degrades to the SAFEST neighbour, never the most
 *    advanced one.** A status this build has never seen must not resolve to
 *    `priced` (a price nobody stood behind) or `delivered` (which switches off
 *    the pull-back guard). Unknown quote statuses read as `in-review`; unknown
 *    order statuses read as `submitted`. Both are true of anything the route
 *    returned, which is the property a default needs.
 */

const MALFORMED = SUPPLIER_REFUSALS.malformed;

type Raw = Record<string, unknown>;

function asObject(raw: unknown): Raw | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Raw) : null;
}

function str(raw: Raw, key: string): string | null {
  const value = raw[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optStr(raw: Raw, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Cents are integers on the wire. A float or a NaN is a malformed payload. */
function cents(raw: Raw, key: string): Cents | null {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function optCents(raw: Raw, key: string): Cents | undefined {
  const value = cents(raw, key);
  return value === null ? undefined : value;
}

function num(raw: Raw, key: string): number | null {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(raw: Raw, key: string): boolean {
  return raw[key] === true;
}

/**
 * CP-07 capability -> HH Pro capability.
 *
 * The mapping is the spec's table (§1.3) and every row is a decision:
 *
 * - `edit-scope` <- `submit_rfq`. Project and line writes sit behind it.
 * - `move-stage` <- `submit_rfq` OR `create_orders`. One HH Pro capability
 *   spans two ERP ones (Plan->Quote is `submit_rfq`, Quote->Order is
 *   `create_orders`). Stage 1 reads cannot express a destination-sensitive
 *   grant, so the union is used and the finer split is parked for the stage
 *   that actually writes — the server is the enforcement point either way, so
 *   the failure mode is a refused request, not an unauthorised one.
 * - `pay` <- `pay_invoices` alone. HH Pro conflates paying with managing
 *   payment methods; the ERP splits them. Granting on the method half would
 *   show a Pay button to someone the server will refuse.
 * - `confirm-pickup` <- `view_orders_deliveries`.
 * - `manage-team` <- `manage_users`.
 * - `customer-quote` is granted unconditionally: contractor-branded homeowner
 *   proposals have NO ERP analogue and stay HH Pro-local (§4.5). Gating the
 *   contractor's own sell side on a dealer's flag would be the wrong system
 *   owning the wrong document.
 */
export function mapCapabilities(raw: unknown): Capability[] {
  const caps = asObject(raw) ?? {};
  const submitRfq = bool(caps, 'submit_rfq');
  const createOrders = bool(caps, 'create_orders');

  const out: Capability[] = [];
  if (submitRfq) out.push('edit-scope');
  if (submitRfq || createOrders) out.push('move-stage');
  out.push('customer-quote');
  if (bool(caps, 'pay_invoices')) out.push('pay');
  if (bool(caps, 'view_orders_deliveries')) out.push('confirm-pickup');
  if (bool(caps, 'manage_users')) out.push('manage-team');
  return out;
}

const PORTAL_ROLES: Record<string, PortalRole> = {
  account_admin: 'account_admin',
  buyer: 'buyer',
  field_crew: 'field_crew',
};

export function mapIdentity(raw: unknown): Result<SupplierIdentity> {
  const user = asObject(raw);
  if (!user) return err(MALFORMED);

  const userId = str(user, 'id');
  const accountId = str(user, 'customer_id');
  const name = str(user, 'name');
  const email = str(user, 'email');
  const roleCode = str(user, 'role');
  if (!userId || !accountId || !name || !email || !roleCode) return err(MALFORMED);

  // An unrecognised role is not guessed at. It reads as the least privileged
  // of the three, and capabilities — which the server resolved — decide what
  // the person may actually do.
  const role = PORTAL_ROLES[roleCode] ?? 'field_crew';

  return ok({
    userId,
    accountId,
    name,
    email,
    role,
    capabilities: mapCapabilities(user.capabilities),
  });
}

export function mapSession(raw: unknown): Result<{ token: string; session: SupplierSession }> {
  const body = asObject(raw);
  if (!body) return err(MALFORMED);

  const token = str(body, 'token');
  const expiresAt = str(body, 'expires_at');
  if (!token || !expiresAt) return err(MALFORMED);

  const identity = mapIdentity(body.user);
  if (!identity.ok) return identity;

  // The token is returned to the CLIENT, which puts it in the token store. It
  // is deliberately not part of `SupplierSession`, so it cannot travel into a
  // domain value and from there into a persisted store.
  return ok({ token, session: { identity: identity.value, expiresAt } });
}

export function mapBranding(raw: unknown): Result<SupplierBranding> {
  const config = asObject(raw);
  if (!config) return err(MALFORMED);

  const companyName = str(config, 'dealer_name');
  const brandColor = str(config, 'primary_color');
  if (!companyName || !brandColor) return err(MALFORMED);

  const logoUrl = optStr(config, 'logo_url');
  const supportEmail = optStr(config, 'support_email');
  const supportPhone = optStr(config, 'support_phone');

  return ok({
    companyName,
    brandColor,
    ...(logoUrl ? { logoUrl } : {}),
    ...(supportEmail ? { supportEmail } : {}),
    ...(supportPhone ? { supportPhone } : {}),
  });
}

const UOMS: readonly Uom[] = ['EA', 'SF', 'LF', 'TON', 'CY', 'PLT', 'BG', 'BX', 'RL', 'BD'];

export function mapCatalogHit(raw: unknown): Result<CatalogHit> {
  const hit = asObject(raw);
  if (!hit) return err(MALFORMED);

  const productId = str(hit, 'id');
  const sku = str(hit, 'sku');
  const name = str(hit, 'name');
  const uomCode = str(hit, 'uom');
  const listPrice = cents(hit, 'list_price_cents');
  const onHand = num(hit, 'on_hand');
  const leadTimeDays = num(hit, 'lead_time_days');
  if (!productId || !sku || !name || !uomCode) return err(MALFORMED);
  if (listPrice === null || onHand === null || leadTimeDays === null) return err(MALFORMED);
  if (!(UOMS as readonly string[]).includes(uomCode)) return err(MALFORMED);

  const imageUrl = optStr(hit, 'image_url');

  return ok({
    productId,
    sku,
    name,
    uom: uomCode as Uom,
    listPrice,
    onHand,
    leadTimeDays,
    ...(imageUrl ? { imageUrl } : {}),
  });
}

export function mapCatalogHits(raw: unknown): Result<CatalogHit[]> {
  const body = asObject(raw);
  const rows = Array.isArray(raw) ? raw : Array.isArray(body?.results) ? body.results : null;
  if (!rows) return err(MALFORMED);

  const out: CatalogHit[] = [];
  for (const row of rows) {
    const mapped = mapCatalogHit(row);
    if (!mapped.ok) return mapped;
    out.push(mapped.value);
  }
  return ok(out);
}

/**
 * `GET /dashboard` -> the commercial relationship.
 *
 * `customer_type` is the dealer's own segmentation ("contractor", "retail")
 * and has no home in HH Pro's `Account`, so it is dropped. Cash-vs-charge is
 * derived from the terms instead, which is what the distinction MEANS: a COD
 * account settles at the counter and never accrues a balance, so zero terms is
 * a cash account. If the ERP ever ships an explicit flag, this line is the one
 * place it lands.
 */
export function mapAccountSummary(raw: unknown): Result<AccountSummary> {
  const body = asObject(raw);
  if (!body) return err(MALFORMED);
  const account = asObject(body.account) ?? body;

  const accountId = str(account, 'id');
  const name = str(account, 'name');
  const accountNumber = str(account, 'account_number');
  const termsDays = num(account, 'payment_terms_days');
  if (!accountId || !name || !accountNumber || termsDays === null) return err(MALFORMED);

  const creditLimit = optCents(account, 'credit_limit_cents');

  return ok({
    accountId,
    name,
    accountNumber,
    type: termsDays > 0 ? 'charge' : 'cash',
    termsDays,
    ...(creditLimit === undefined ? {} : { creditLimit }),
    onHold: bool(account, 'on_hold'),
  });
}

export function mapBillingSummary(raw: unknown): Result<BillingSummary> {
  const body = asObject(raw);
  if (!body) return err(MALFORMED);

  const balance = cents(body, 'balance_cents');
  const pastDue = cents(body, 'past_due_cents');
  if (balance === null || pastDue === null) return err(MALFORMED);

  const creditLimit = optCents(body, 'credit_limit_cents');
  const creditAvailable = optCents(body, 'credit_available_cents');
  const cardFeePercent = num(body, 'card_fee_percent');

  return ok({
    balance,
    pastDue,
    ...(creditLimit === undefined ? {} : { creditLimit }),
    ...(creditAvailable === undefined ? {} : { creditAvailable }),
    ...(cardFeePercent === null ? {} : { cardFeePercent }),
  });
}

/**
 * ERP quote status -> `QuoteStatus`.
 *
 * Whitelisted, and the default is deliberate. `priced` would tell a contractor
 * the desk stood behind a number it may never have produced; `expired` would
 * re-block an order for no reason. `in-review` says "the desk has it", which
 * is true of every quote this route can return.
 */
const QUOTE_STATUS: Record<string, QuoteStatus> = {
  DRAFT: 'submitted',
  SUBMITTED: 'submitted',
  SENT: 'priced',
  PRICED: 'priced',
  IN_REVIEW: 'in-review',
  REVIEWING: 'in-review',
  ACCEPTED: 'priced',
  EXPIRED: 'expired',
  REJECTED: 'withdrawn',
  WITHDRAWN: 'withdrawn',
  CANCELLED: 'withdrawn',
};

export function mapQuoteStatus(code: string): QuoteStatus {
  return QUOTE_STATUS[code.toUpperCase()] ?? 'in-review';
}

export function mapQuote(raw: unknown): Result<Quote> {
  const body = asObject(raw);
  if (!body) return err(MALFORMED);

  const id = str(body, 'id');
  // The board card an ERP quote belongs to. `procurement_projects.quote_id` is
  // the link the spec adds; until a quote carries one it has no card to attach
  // to and is not renderable, so this is required rather than defaulted.
  const orderId = str(body, 'project_id');
  const number = str(body, 'quote_no');
  const status = str(body, 'status');
  const submittedAt = str(body, 'submitted_at');
  if (!id || !orderId || !number || !status || !submittedAt) return err(MALFORMED);

  const pricedAt = optStr(body, 'priced_at');
  const expiresAt = optStr(body, 'valid_until');
  const deskNote = optStr(body, 'desk_note');

  const linePrices: Quote['linePrices'] = [];
  const lines = Array.isArray(body.lines) ? body.lines : [];
  for (const line of lines) {
    const row = asObject(line);
    if (!row) return err(MALFORMED);
    const scopeItemId = str(row, 'line_id');
    const unitPrice = cents(row, 'unit_price_cents');
    const leadTimeDays = num(row, 'lead_time_days');
    // A quote line with no price is not a zero-priced line. Refuse the quote
    // rather than render a free pallet of pavers.
    if (!scopeItemId || unitPrice === null || leadTimeDays === null) return err(MALFORMED);
    linePrices.push({ scopeItemId, unitPrice, leadTimeDays });
  }

  return ok({
    id,
    orderId,
    number,
    status: mapQuoteStatus(status),
    submittedAt,
    ...(pricedAt ? { pricedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(deskNote ? { deskNote } : {}),
    linePrices,
  });
}

/**
 * ERP order status -> `SalesOrderStatus`.
 *
 * `READY` splits on fulfillment: a will-call order that is ready is
 * `ready-willcall` (it parks at the counter), a delivery that is ready is
 * still `picking` from the contractor's point of view — nothing has left the
 * yard. Unknown codes read as `submitted`, the earliest state, because a
 * default of `delivered` would switch off the pull-back guard that stops a
 * contractor cancelling goods already on site.
 */
const ORDER_STATUS: Record<string, SalesOrderStatus> = {
  DRAFT: 'submitted',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  PICKING: 'picking',
  OUT_FOR_DELIVERY: 'out-for-delivery',
  IN_TRANSIT: 'out-for-delivery',
  DELIVERED: 'delivered',
  COMPLETED: 'delivered',
  INVOICED: 'invoiced',
  CANCELLED: 'cancelled',
  VOID: 'cancelled',
};

export function mapOrderStatus(
  code: string,
  fulfillment: 'delivery' | 'willcall',
): SalesOrderStatus {
  const upper = code.toUpperCase();
  if (upper === 'READY') return fulfillment === 'willcall' ? 'ready-willcall' : 'picking';
  return ORDER_STATUS[upper] ?? 'submitted';
}

export function mapSalesOrder(raw: unknown): Result<SalesOrder> {
  const body = asObject(raw);
  if (!body) return err(MALFORMED);

  const id = str(body, 'id');
  const orderId = str(body, 'project_id');
  const number = str(body, 'order_no');
  const status = str(body, 'status');
  const submittedAt = str(body, 'created_at');
  const subtotal = cents(body, 'subtotal_cents');
  if (!id || !orderId || !number || !status || !submittedAt || subtotal === null) {
    return err(MALFORMED);
  }

  const fulfillment = str(body, 'fulfillment') === 'willcall' ? 'willcall' : 'delivery';
  const promisedDate = optStr(body, 'promised_date');
  const deliveredAt = optStr(body, 'delivered_at');

  return ok({
    id,
    orderId,
    number,
    status: mapOrderStatus(status, fulfillment),
    fulfillment,
    submittedAt,
    ...(promisedDate ? { promisedDate } : {}),
    ...(deliveredAt ? { deliveredAt } : {}),
    subtotal,
    /**
     * Empty, not fabricated. The contractor-safe timeline is
     * `GET /orders/{id}/timeline`, a redacted projection that does not exist
     * yet (Stage 4, OR-8). Synthesising tracking events from a status would
     * put times on the screen that no truck ever kept.
     */
    tracking: [],
  });
}

export function mapInvoice(raw: unknown): Result<Invoice> {
  const body = asObject(raw);
  if (!body) return err(MALFORMED);

  const id = str(body, 'id');
  const number = str(body, 'invoice_no');
  const accountId = str(body, 'customer_id');
  const issuedAt = str(body, 'issued_at');
  const dueAt = str(body, 'due_at');
  const description = str(body, 'description');
  const subtotal = cents(body, 'subtotal_cents');
  const balance = cents(body, 'balance_cents');
  if (!id || !number || !accountId || !issuedAt || !dueAt || !description) return err(MALFORMED);
  if (subtotal === null || balance === null) return err(MALFORMED);

  const orderId = optStr(body, 'project_id');
  const salesOrderId = optStr(body, 'order_id');

  return ok({
    id,
    number,
    accountId,
    ...(orderId ? { orderId } : {}),
    ...(salesOrderId ? { salesOrderId } : {}),
    // Anything that did not come through the portal is a counter sale. The
    // distinction drives AR copy, so a strict check beats a permissive one.
    origin: str(body, 'origin') === 'portal' ? 'portal' : 'counter',
    issuedAt,
    dueAt,
    subtotal,
    balance,
    description,
  });
}

/** `{items: [...]}` or a bare array — both are shapes Go handlers return. */
export function mapList<T>(
  raw: unknown,
  key: string,
  one: (row: unknown) => Result<T>,
): Result<T[]> {
  const body = asObject(raw);
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(body?.[key])
      ? (body[key] as unknown[])
      : null;
  if (!rows) return err(MALFORMED);

  const out: T[] = [];
  for (const row of rows) {
    const mapped = one(row);
    if (!mapped.ok) return mapped;
    out.push(mapped.value);
  }
  return ok(out);
}

export const MALFORMED_RESPONSE = MALFORMED;
