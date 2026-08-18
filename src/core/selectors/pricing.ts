import { getContext } from '../boot';
import { DEMO_ACCOUNT } from '../data/account-seed';
import type { PriceQuote, Product } from '../domain/catalog';
import type { PricingInput } from '../sim/pricing';
import { sessionStore } from '../stores/root';

/**
 * The ONE place the running app asks "what does THIS contractor pay for this?"
 *
 * The pricing engine lives in `sim/` because tiers, contract SKUs and volume
 * breaks are the supplier's machinery. What was missing was the binding —
 * engine plus *which account* — and everything that needed a price built its
 * own: `actions/scope.ts` froze the demo account into a module constant, and
 * `OrderPage` hand-wrote `{ accountId: project.accountId, tierId: 'tier_pro' }`
 * at the call site. Two bindings is one too many. The order page's hardcoded
 * tier was already a bug waiting for a second pricing tier to exist: a
 * Preferred-tier contractor would have seen Pro prices on their own order, and
 * a different number the moment the same line was re-priced by an action.
 *
 * So: catalog browsing, the product page, the add-to-plan sheet, the order
 * page and the assistant's `search_catalog` all quote through here. A price
 * shown on one screen cannot disagree with the price charged on another,
 * because there is only one function that can answer the question.
 *
 * When a real ERP replaces `sim/pricing.ts`, this is still the seam: the
 * account resolution stays, the engine behind it changes.
 */

/** Who is buying — the session's account, falling back to the demo account. */
export function accountPricing(): PricingInput {
  const account = sessionStore.get().account ?? DEMO_ACCOUNT;
  return { accountId: account.id, tierId: account.pricingTierId };
}

/** A resolved quote for the acting account. Quantity matters: breaks move price. */
export function quoteForAccount(product: Product, qty: number): PriceQuote {
  return getContext().pricing.quote(product, qty, accountPricing());
}

/**
 * The injectable form. Selectors take pricing as a parameter so they stay pure
 * and testable against a hand-built engine; the app passes this.
 */
export type QuoteFor = (product: Product, qty: number) => PriceQuote;

export const accountQuoteFor: QuoteFor = quoteForAccount;
