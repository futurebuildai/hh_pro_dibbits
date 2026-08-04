import { describe, expect, it } from 'vitest';
import {
  applyPercent,
  formatCents,
  formatCentsCompact,
  multiplyCents,
  sumCents,
  toCents,
} from '../money';

describe('money', () => {
  it('converts dollars to integer cents without float drift', () => {
    expect(toCents(5.97)).toBe(597);
    expect(toCents(32.49)).toBe(3249);
    // The classic float trap: 1.005 * 100 === 100.49999999999999, which would
    // round DOWN to 100. Half-cents must round up.
    expect(toCents(1.005)).toBe(101);
    expect(toCents(8.615)).toBe(862);
    // Tiny magnitudes fall back to the multiply path without producing NaN.
    expect(toCents(1e-7)).toBe(0);
  });

  it('keeps line extension exact across repeated addition', () => {
    const unit = toCents(0.1);
    const lines = Array.from({ length: 10 }, () => unit);
    expect(sumCents(lines)).toBe(toCents(1.0));
  });

  it('multiplies by fractional quantities', () => {
    expect(multiplyCents(1000, 2.5)).toBe(2500);
    expect(multiplyCents(597, 13)).toBe(7761);
  });

  it('applies markup percentages', () => {
    expect(applyPercent(10000, 22)).toBe(2200);
    expect(applyPercent(7761, 15)).toBe(1164);
  });

  it('formats for display', () => {
    expect(formatCents(7761)).toBe('$77.61');
    expect(formatCentsCompact(1250000)).toBe('$12.5k');
    expect(formatCentsCompact(1200000)).toBe('$12k');
    expect(formatCentsCompact(7761)).toBe('$77.61');
  });
});
