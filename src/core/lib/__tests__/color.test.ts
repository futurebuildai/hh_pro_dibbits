import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, isLegibleFill, onColorFor, relativeLuminance } from '../color';

/** The two literals `onColorFor` chooses between, restated so the table can name them. */
const INK = 'oklch(21% 0.02 260)';
const PAPER = 'oklch(100% 0 0)';

describe('relativeLuminance', () => {
  it('anchors at black and white', () => {
    expect(relativeLuminance('#000')).toBeCloseTo(0, 10);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
  });

  it('parses every shape isValidColor admits', () => {
    // 3-digit hex expands by digit doubling: #f00 is #ff0000, not #0f0000.
    expect(relativeLuminance('#f00')).toBeCloseTo(relativeLuminance('#ff0000'), 12);
    expect(relativeLuminance('#14497B')).toBeCloseTo(0.063439, 5);
    // oklch(62.8% 0.2577 29.23) is pure red; the whole conversion chain is
    // wrong if this does not land on #ff0000's luminance.
    expect(relativeLuminance('oklch(62.8% 0.2577 29.23)')).toBeCloseTo(
      relativeLuminance('#ff0000'),
      3,
    );
    expect(relativeLuminance(PAPER)).toBeCloseTo(1, 10);
    // The ink is #131922 — far darker than "21%" reads as, because oklab
    // lightness is perceptual. This number is what sets the dead zone below.
    expect(relativeLuminance(INK)).toBeCloseTo(0.009256, 6);
  });

  it('is case- and whitespace-tolerant, and total on nonsense', () => {
    expect(relativeLuminance('  #FFC313  ')).toBeCloseTo(relativeLuminance('#ffc313'), 12);
    // Unparseable degrades to black, which makes onColorFor return white —
    // exactly what the product did before this module existed.
    expect(relativeLuminance('rebeccapurple')).toBe(0);
    expect(relativeLuminance('')).toBe(0);
  });
});

describe('contrastRatio', () => {
  it('is symmetric and bounded by the black/white extremes', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 6);
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 6);
    expect(contrastRatio('#FFC313', '#FFC313')).toBeCloseTo(1, 10);
  });
});

/**
 * The brand kit's colours, and the one from the recorded ERP fixture.
 *
 * Ratios are the values this module computes, asserted to 2dp so a change in
 * the conversion chain fails loudly rather than drifting.
 */
describe('onColorFor picks the ink that actually reads', () => {
  const cases: ReadonlyArray<{
    name: string;
    fill: string;
    on: string;
    ratio: number;
  }> = [
    // The kit claims 11.2:1 for ink on Gold; measured against this exact ink
    // literal it is 11.03:1 (the kit's figure is against pure black). Either
    // way it is the clear winner — white on gold is 1.61:1, which is why the
    // action fill needed its own on-colour at all.
    { name: 'Gable gold', fill: '#FFC313', on: INK, ratio: 11.03 },
    { name: 'Harbor', fill: '#14497B', on: PAPER, ratio: 9.26 },
    { name: 'Navy', fill: '#0B2338', on: PAPER, ratio: 16.01 },
    { name: 'Tide', fill: '#86BDF6', on: INK, ratio: 8.96 },
    { name: 'black', fill: '#000', on: PAPER, ratio: 21 },
    { name: 'white', fill: '#fff', on: INK, ratio: 17.72 },
  ];

  for (const { name, fill, on, ratio } of cases) {
    it(`prints ${on === INK ? 'ink' : 'paper'} on ${name}`, () => {
      expect(onColorFor(fill)).toBe(on);
      expect(contrastRatio(onColorFor(fill), fill)).toBeCloseTo(ratio, 2);
      expect(contrastRatio(onColorFor(fill), fill)).toBeGreaterThan(4.5);
      expect(isLegibleFill(fill)).toBe(true);
    });
  }

  /**
   * The regression pin for a live bug. `#E8A74E` is the brand colour in the
   * recorded ERP fixture, and today the app paints WHITE on it at 2.09:1 —
   * under half the AA bar, on a control someone is meant to press.
   */
  it('gives the recorded fixture colour #E8A74E a legible ink', () => {
    expect(contrastRatio(PAPER, '#E8A74E')).toBeCloseTo(2.09, 2); // the bug
    expect(onColorFor('#E8A74E')).toBe(INK);
    expect(contrastRatio(onColorFor('#E8A74E'), '#E8A74E')).toBeCloseTo(8.5, 1);
    expect(isLegibleFill('#E8A74E')).toBe(true);
  });

  it('never returns a var() reference', () => {
    for (const fill of ['#FFC313', '#0B2338', '#808080', 'oklch(60% 0.1 120)']) {
      expect(onColorFor(fill)).not.toContain('var(');
    }
  });
});

/**
 * The dead zone, measured rather than assumed.
 *
 * white clears 4.5:1 at fill-luminance <= 0.183333; ink clears it at >= 0.216652.
 * Between those NEITHER does, and the crossover at luminance 0.199437 reads
 * 4.21:1 both ways — a ratio that passes a large-object bar and fails a label
 * bar, which is precisely why it survives design review.
 */
describe('isLegibleFill refuses the dead zone', () => {
  const cases: ReadonlyArray<{ fill: string; legible: boolean; why: string }> = [
    { fill: '#767676', legible: true, why: 'lum 0.18116, just under the paper edge (4.54:1)' },
    { fill: '#787878', legible: false, why: 'lum 0.18782, inside: ink 4.01, paper 4.42' },
    { fill: '#808080', legible: false, why: 'plain mid-grey, still inside: ink 4.49, paper 3.95' },
    { fill: '#818181', legible: true, why: 'lum 0.21953, just over the ink edge (4.55:1)' },
  ];

  for (const { fill, legible, why } of cases) {
    it(`${legible ? 'admits' : 'refuses'} ${fill} — ${why}`, () => {
      expect(isLegibleFill(fill)).toBe(legible);
    });
  }

  it('is exactly "the best ink clears 4.5", not a lightness cutoff', () => {
    for (const fill of ['#767676', '#787878', '#808080', '#818181', '#FFC313', '#0B2338']) {
      expect(isLegibleFill(fill)).toBe(contrastRatio(onColorFor(fill), fill) >= 4.5);
    }
  });

  it('measures both dead-zone edges where the doc comment says they are', () => {
    // Paper stops clearing above lum 0.183333; ink starts clearing at 0.216652.
    expect(relativeLuminance('#767676')).toBeLessThan(0.183333);
    expect(relativeLuminance('#787878')).toBeGreaterThan(0.183333);
    expect(relativeLuminance('#808080')).toBeLessThan(0.216652);
    expect(relativeLuminance('#818181')).toBeGreaterThan(0.216652);
  });
});

/**
 * The trap this module is most likely to be "simplified" into.
 *
 * `ON_INK` is the platform --text VALUE inlined. Written as `var(--text)` it
 * would look tidier and would break `config.test.ts`'s assertion that the
 * emitted dealer CSS names no platform token — but only once brandingCss
 * consumes it, a repo away from the edit. Pin it at the source.
 */
describe('the module source', () => {
  it('contains no var() reference', () => {
    const source = readFileSync(fileURLToPath(new URL('../color.ts', import.meta.url)), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('var(--');
    expect(code).toContain("'oklch(21% 0.02 260)'");
    expect(code).toContain("'oklch(100% 0 0)'");
  });
});
