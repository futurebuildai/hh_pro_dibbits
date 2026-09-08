/**
 * Contrast maths, in core, framework-free.
 *
 * This exists because one dealer-settable `brandColor` was being painted white
 * text on regardless of what it was, and the recorded ERP fixture ships a
 * mid-gold (`#E8A74E`) that renders white at 2.09:1 — less than half the AA
 * bar, on a pressable control. The ink on a fill is not a design preference;
 * it is a calculation, and it belongs next to the emitter that writes the
 * stylesheet rather than in a designer's head.
 *
 * The luminance formula here is byte-for-byte the one `scripts/contrast-probe.mjs`
 * uses (lines 21-25). That is deliberate and load-bearing: `npm run contrast`
 * is the gate that decides whether a palette ships, and a gate that computes a
 * different number from the code it grades is worse than no gate. If one moves,
 * the other moves with it.
 */

/**
 * White. The historical default ink, and still correct on any dark fill.
 */
const ON_PAPER = 'oklch(100% 0 0)';

/**
 * The platform `--text` VALUE, inlined as a literal.
 *
 * NEVER write this as `var(--text)`, however tempting the deduplication looks.
 * `onColorFor` output is interpolated into a stylesheet by `brandingCss`, and
 * `src/core/domain/__tests__/config.test.ts` asserts the emitted CSS contains
 * none of `--surface`, `--text`, `--stage-`, `--danger` — the platform layer a
 * dealer may never write. `var(--text)` contains `--text` and fails on sight.
 * It would also be a lie at emit time: the dealer's token block is injected
 * BEFORE theme.css, so the reference would resolve against whatever `--text`
 * ends up meaning in the viewer's theme, which is the opposite polarity in dark
 * mode. The whole point of picking an ink is that it does not move.
 */
const ON_INK = 'oklch(21% 0.02 260)';

/** The WCAG AA bar for normal-size text, which is the bar a control label must clear. */
const AA_NORMAL = 4.5;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const OKLCH = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/i;

/** sRGB transfer function, inverted: an 0-1 channel to its linear-light value. */
function toLinear(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * Parse a validated colour string to linear-light sRGB.
 *
 * Input is expected to have passed `isValidColor` (`domain/config.ts`), so the
 * shapes are 3-digit hex, 6-digit hex, or `oklch(L% C H)`. Anything else
 * returns null and the callers below treat it as black — see `relativeLuminance`.
 *
 * The gamut is deliberately NOT clamped. A wide-gamut oklch triple can produce
 * a negative or >1 channel, which is not paintable, but we are computing a
 * luminance and not a swatch: clamping would quietly move the number away from
 * the colour the author actually wrote. The canvas probe clamps because a
 * canvas must; this does not have to, and the disagreement it costs is under
 * half a percent of ratio (gold reads 11.03:1 here, 10.98:1 through the probe's
 * 8-bit quantisation of the same ink).
 */
function toLinearRgb(color: string): [number, number, number] | null {
  const value = color.trim();

  if (HEX.test(value)) {
    // The exact path, and the one that matters most: every dealer default and
    // everything the admin console stores is hex.
    const digits = value.slice(1);
    const full =
      digits.length === 3
        ? `${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`
        : digits;
    return [0, 2, 4].map((i) => toLinear(Number.parseInt(full.slice(i, i + 2), 16) / 255)) as [
      number,
      number,
      number,
    ];
  }

  const oklch = OKLCH.exec(value);
  if (!oklch) return null;

  const lightness = Number(oklch[1]) / 100;
  const chroma = Number(oklch[2]);
  const hue = (Number(oklch[3]) * Math.PI) / 180;
  if (!Number.isFinite(lightness) || !Number.isFinite(chroma) || !Number.isFinite(hue)) return null;

  // oklch -> oklab: the hue/chroma polar form is just cartesian a/b.
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);

  // oklab -> LMS' -> LMS -> linear sRGB. Björn Ottosson's published matrices;
  // spot-checked against oklch(62.8% 0.2577 29.23), which round-trips to
  // exactly #ff0000.
  const lp = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mp = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sp = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lp ** 3;
  const m = mp ** 3;
  const s = sp ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * WCAG relative luminance, 0 (black) to 1 (white).
 *
 * Total by design, in the house style: an unparseable string reads as 0 rather
 * than throwing. Zero is the safe answer — it makes `onColorFor` return white,
 * which is exactly what the product did before this module existed, so a
 * malformed colour degrades to today's behaviour instead of taking a page down.
 * Callers that need to know a colour is bad use `isValidColor`, which is that
 * question's actual owner.
 */
export function relativeLuminance(color: string): number {
  const rgb = toLinearRgb(color);
  if (!rgb) return 0;
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** WCAG contrast ratio between two colours. Symmetric: order never matters. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The ink to print on `fill`: whichever of white or the platform ink reads better.
 *
 * Best-of-two, not a threshold. At the crossover the two candidates are equal by
 * definition, so conversion imprecision costs nothing exactly where a hardcoded
 * lightness cutoff would be most fragile — a colour a hair either side of the
 * line gets an answer that is a hair better, never one that is wrong.
 *
 * The returned string is a CSS colour value and is interpolated straight into
 * the dealer token block. See `ON_INK` for why it is a literal.
 */
export function onColorFor(fill: string): string {
  return contrastRatio(ON_INK, fill) >= contrastRatio(ON_PAPER, fill) ? ON_INK : ON_PAPER;
}

/**
 * Does the best available ink actually clear 4.5:1 on this fill?
 *
 * There is a real dead zone, and it is narrower and darker than a first guess
 * suggests. Measured with the formula above:
 *
 *   ON_INK  `oklch(21% 0.02 260)` has luminance 0.009256 (it is #131922, a much
 *           darker ink than "21%" reads as — oklab lightness is perceptual, and
 *           0.21 there is nowhere near 21% of the light).
 *   white   clears 4.5:1 on any fill of luminance <= 0.183333
 *   ink     clears 4.5:1 on any fill of luminance >= 0.216652
 *
 * Between 0.183333 and 0.216652 NEITHER does. The crossover sits at luminance
 * 0.199437 where both read 4.21:1 — comfortably past the 3:1 bar a large
 * graphical object gets, and short of the 4.5:1 a control's own label needs.
 * That is the trap: such a fill looks fine in a design review and fails an
 * audit. In 8-bit greys the zone is roughly #777777 through #808080 — plain
 * mid-grey `#808080` is inside it, at 4.49:1 for ink and 3.95:1 for white.
 *
 * Per `docs/brand-tokens.md` this gates `actionColor`/`actionColorDark` only,
 * where the answer is "fall back to `brandColor`". It deliberately does NOT
 * gate `brandColor`: `mapBranding()` never runs `parseConfig`, so gating there
 * would let an ERP-supplied colour through one door and be refused at the
 * other, and the recorded fixture's `#E8A74E` would be thrown out rather than
 * simply being given the correct ink.
 */
export function isLegibleFill(fill: string): boolean {
  return contrastRatio(onColorFor(fill), fill) >= AA_NORMAL;
}
