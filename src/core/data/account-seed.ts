import type { Account, User } from '../domain/account';
import type { PaymentMethod } from '../domain/payment';
import type { Address } from '../domain/project';
import { toCents } from '../lib/money';
import type { PricingRule, PricingTier } from '../sim/pricing';
import { categoryId } from './catalog-seed';

/**
 * The demo contractor and the commercial terms the supplier has them on.
 *
 * The pricing rules below are deliberately varied rather than one flat
 * discount. A contractor scanning their scope should be able to see that the
 * relationship is worth something specific: better-than-baseline on the
 * category they buy most, a locked price their rep negotiated, and volume
 * breaks on the commodity items they buy by the hundred. A single uniform
 * discount would price everything correctly and communicate nothing.
 *
 * None of this is visible to the contractor as rules — only as their price.
 */

export const ACCOUNT_ID = 'acct_summit';
export const USER_ID = 'usr_demo';
export const TIER_PRO_ID = 'tier_pro';

const YARD_ADDRESS: Address = {
  id: 'addr_shop',
  label: 'Yard',
  line1: '84 Bellevue Dr',
  city: 'Belleville',
  state: 'ON',
  zip: 'K8N 4Z5',
};

export const DEMO_ADDRESSES: Address[] = [YARD_ADDRESS];

export const PRICING_TIERS: PricingTier[] = [
  { id: 'tier_standard', name: 'Standard', percentOffList: 0 },
  { id: 'tier_preferred', name: 'Preferred', percentOffList: 6 },
  // The demo account. A real pro account, not a walk-in.
  { id: TIER_PRO_ID, name: 'Pro', percentOffList: 12 },
];

/** Category ids from the Dibbits catalog, named for readability. */
const CAT_HARDSCAPE = categoryId(1);
const CAT_PAVERS = categoryId(11);
const CAT_AGGREGATES = categoryId(3);

export const PRICING_RULES: PricingRule[] = [
  // Their bread and butter. Cascades to pavers, walls, steps and porcelain,
  // which is why the rule is written against the parent and not each child.
  {
    kind: 'category',
    accountId: ACCOUNT_ID,
    categoryId: CAT_HARDSCAPE,
    percentOffList: 18,
  },
  // Bulk moves on margin, not on list. Everyone on Pro gets it.
  {
    kind: 'category',
    tierId: TIER_PRO_ID,
    categoryId: CAT_AGGREGATES,
    percentOffList: 15,
  },
  // A negotiated, locked price on the paver they lay most. Immune to list
  // changes — the thing a contractor calls their rep about.
  {
    kind: 'contract',
    accountId: ACCOUNT_ID,
    sku: 'PVR-OAK-YORK60',
    unitPrice: toCents(6.35),
  },
  // Volume breaks across pavers, in SQUARE FEET. Relative, not absolute, and
  // the reason is sharper here than it was in lumber: this category spans a
  // $4.62/sf economy paver and a $17.67/sf wood-grain slab. One absolute break
  // price across both would be nonsense on nearly all of it.
  //
  // The thresholds are a real patio and a real driveway, not round numbers:
  // 600 sf is a decent back yard, 1,500 sf is a driveway plus walkways.
  {
    kind: 'volume',
    categoryId: CAT_PAVERS,
    breaks: [
      { minQty: 600, extraPercentOff: 6 },
      { minQty: 1500, extraPercentOff: 11 },
    ],
  },
  // Bulk base by the tonne. A full triaxle is about 20 tonnes, so the first
  // break is "you are ordering a truck, not a scoop".
  {
    kind: 'volume',
    sku: 'AGG-HPB-BULK',
    breaks: [
      { minQty: 20, unitPrice: toCents(38.5) },
      { minQty: 60, unitPrice: toCents(35.0) },
    ],
  },
];

export const DEMO_ACCOUNT: Account = {
  id: ACCOUNT_ID,
  name: 'Quinte Landscape & Design',
  accountNumber: 'ACCT-1042',
  type: 'charge',
  paymentTermsCode: 'NET30',
  pricingTierId: TIER_PRO_ID,
  creditLimit: toCents(75_000),
  addresses: DEMO_ADDRESSES,
  branding: {
    companyName: 'Quinte Landscape & Design',
    contactName: 'Dana Reyes',
    phone: '(613) 555-0142',
    email: 'dana@quintelandscape.ca',
    licenseNumber: 'Landscape Ontario #2291',
  },
};

export const DEMO_USER: User = {
  id: USER_ID,
  accountId: ACCOUNT_ID,
  name: 'Dana Reyes',
  email: 'dana@quintelandscape.ca',
  role: 'owner',
  initials: 'DR',
};

/**
 * Saved methods. The "•••• 0002" card always fails in the simulator — a demo
 * that only ever shows the happy path teaches nothing about what a decline
 * looks like.
 */
export const SEED_PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'pm_ach',
    accountId: ACCOUNT_ID,
    kind: 'ach',
    label: 'Business checking ••4471',
    isDefault: true,
  },
  {
    id: 'pm_visa',
    accountId: ACCOUNT_ID,
    kind: 'card',
    label: 'Visa •••• 4242',
    isDefault: false,
    expiry: '09/29',
  },
  {
    id: 'pm_bad',
    accountId: ACCOUNT_ID,
    kind: 'card',
    label: 'Visa •••• 0002',
    isDefault: false,
    expiry: '01/28',
  },
];
