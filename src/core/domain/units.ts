import type { Uom } from './catalog';

/**
 * How the yard actually sells things, in words a contractor uses.
 *
 * This exists because hardscape is not bought in pieces. A paver field is
 * quoted per square foot, the base under it per tonne, the edging per linear
 * foot, and the jointing sand per bag — and "$42.50 EA" for a tonne of base is
 * both wrong and unreadable. The unit is part of the price, not a code beside
 * it, so every surface that prints a price prints it through here.
 *
 * Kept in `domain/` rather than the UI because the catalog, an order line, a
 * customer quote and (later) an embedded web component must all say "per
 * tonne" the same way. A second table of unit names is a second set of words
 * that can disagree with itself.
 */

interface UnitCopy {
  /** Follows a price: "$42.50 /tonne". */
  short: string;
  singular: string;
  plural: string;
  /** One line on a product page: how this thing is sold. */
  sold: string;
}

const UNITS: Record<Uom, UnitCopy> = {
  EA: { short: 'ea', singular: 'each', plural: 'each', sold: 'Sold individually' },
  SF: {
    short: 'sq ft',
    singular: 'sq ft',
    plural: 'sq ft',
    sold: 'Sold by the square foot — order the coverage, not the piece count',
  },
  LF: {
    short: 'lin ft',
    singular: 'lin ft',
    plural: 'lin ft',
    sold: 'Sold by the linear foot',
  },
  TON: {
    short: 'tonne',
    singular: 'tonne',
    plural: 'tonnes',
    sold: 'Sold by weight, in bulk — a triaxle load is roughly 20 tonnes',
  },
  CY: {
    short: 'cu yd',
    singular: 'cubic yard',
    plural: 'cubic yards',
    sold: 'Sold by volume, in bulk',
  },
  PLT: { short: 'pallet', singular: 'pallet', plural: 'pallets', sold: 'Sold by the pallet' },
  BG: { short: 'bag', singular: 'bag', plural: 'bags', sold: 'Sold by the bag' },
  BX: { short: 'box', singular: 'box', plural: 'boxes', sold: 'Sold by the box' },
  RL: { short: 'roll', singular: 'roll', plural: 'rolls', sold: 'Sold by the roll' },
  BD: { short: 'bundle', singular: 'bundle', plural: 'bundles', sold: 'Sold by the bundle' },
};

export function unitShort(uom: Uom): string {
  return UNITS[uom].short;
}

/** The suffix on a unit price: `$8.13/sq ft`. */
export function perUnit(uom: Uom): string {
  return `/${UNITS[uom].short}`;
}

/** "640 sq ft", "1 tonne", "34 tonnes", "18 ea". */
export function formatQty(qty: number, uom: Uom): string {
  const unit = UNITS[uom];
  return `${qty} ${qty === 1 ? unit.singular : unit.plural}`;
}

export function soldBy(uom: Uom): string {
  return UNITS[uom].sold;
}

/**
 * How much one tap of the quantity stepper moves.
 *
 * A patio is measured in hundreds of square feet and a fire pit kit is bought
 * one at a time, so a single step size is wrong for one of them. Stepping area
 * and length by ten keeps the control usable with gloves on without pretending
 * to know how big the job is — the field is still typed for the real number.
 */
export function qtyStep(uom: Uom): number {
  return uom === 'SF' || uom === 'LF' ? 10 : 1;
}
