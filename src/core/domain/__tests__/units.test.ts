import { describe, expect, it } from 'vitest';
import type { Uom } from '../catalog';
import { formatQty, perUnit, qtyStep, soldBy, unitShort } from '../units';

const ALL_UOMS: readonly Uom[] = ['EA', 'SF', 'LF', 'TON', 'CY', 'PLT', 'BG', 'BX', 'RL', 'BD'];

describe('the units products are actually sold in', () => {
  it('has copy for every unit in the domain', () => {
    // A missing entry does not throw — it renders "$42.50/undefined" on a
    // product page. Enumerating the union is the only way to catch a unit
    // added to `Uom` and forgotten here.
    for (const uom of ALL_UOMS) {
      expect(unitShort(uom), uom).toBeTruthy();
      expect(perUnit(uom), uom).toBe(`/${unitShort(uom)}`);
      expect(soldBy(uom), uom).toMatch(/^Sold/);
      expect(formatQty(2, uom), uom).not.toContain('undefined');
    }
  });

  it('prices by area, weight and volume the way the yard quotes them', () => {
    expect(perUnit('SF')).toBe('/sq ft');
    expect(perUnit('TON')).toBe('/tonne');
    expect(perUnit('CY')).toBe('/cu yd');
    expect(perUnit('LF')).toBe('/lin ft');
    expect(perUnit('BG')).toBe('/bag');
  });

  it('agrees with itself on singular and plural', () => {
    expect(formatQty(1, 'TON')).toBe('1 tonne');
    expect(formatQty(34, 'TON')).toBe('34 tonnes');
    expect(formatQty(1, 'BX')).toBe('1 box');
    expect(formatQty(3, 'BX')).toBe('3 boxes');
    // Area and length do not pluralise — nobody says "640 square feets", and
    // "sq ft" is what is written on the ticket.
    expect(formatQty(640, 'SF')).toBe('640 sq ft');
    expect(formatQty(1, 'SF')).toBe('1 sq ft');
  });

  it('steps by ten where the job is measured, by one where it is counted', () => {
    // A patio is hundreds of square feet; a fire pit kit is one kit. One step
    // size would be wrong for one of them.
    expect(qtyStep('SF')).toBe(10);
    expect(qtyStep('LF')).toBe(10);
    expect(qtyStep('EA')).toBe(1);
    expect(qtyStep('TON')).toBe(1);
  });
});
