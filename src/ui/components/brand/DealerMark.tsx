import type { CSSProperties } from 'react';

/**
 * The product's own mark, inline.
 *
 * Hand-authored from `public/brand/mark.svg` so it can be painted by the
 * document's cascade: a disc, a gold diamond at the peak, two roofline bars,
 * on a 64-unit grid.
 *
 * WHY THE COLOURS ARE CSS VARS AND NOT PROPS
 * ------------------------------------------
 * The mark flips between a filled disc on light and an outline on dark. The
 * switch is driven by `data-theme`, an attribute stamped on `<html>` — and
 * React does not observe attributes on a node outside its tree. A component
 * that chose its variant in JavaScript would have nothing to re-render on: it
 * would read the attribute once at mount and then be wrong for the rest of the
 * session, or wrong from the moment someone flips the theme. Even subscribing
 * (a MutationObserver, say) lands the correct colours a frame late, as a
 * visible flash of the wrong mark. Custom properties resolve against the
 * element's own cascade, so `src/ui/styles/identity.css` does the whole switch
 * with no JS, no subscription and no flash.
 *
 * Every literal below is a fallback for the case where identity.css did not
 * load (a bare test renderer, an embed that pulled the component and not the
 * stylesheet). It is the light treatment, because a navy disc on an unknown
 * ground still reads as a logo; `transparent` would render nothing at all.
 *
 * CLEAR SPACE — the caller's job, not this component's.
 * This renders no padding and no margin: a component that silently pads breaks
 * every flex row it lands in, and layout belongs to whoever placed it. The
 * brand's clear space is the diamond's height, `15 x sqrt(2)` of 64 units,
 * about 21.2/64 — call it 33% of the rendered size. At the 28px default that
 * is roughly 10px of gap on every side, and the caller owns it.
 */

/** The brand's stated minimum on screen. Below this the roofline bars merge. */
const MIN_SIZE = 24;
const DEFAULT_SIZE = 28;

export interface DealerMarkProps {
  /** Rendered edge length in px. Clamped up to 24; defaults to 28. */
  size?: number | undefined;
  /**
   * `auto` (default) takes its four colours from the identity layer, so it
   * follows the theme. `mono` collapses all four onto `currentColor`, for
   * places that must inherit the ink of whatever they sit in — note that this
   * makes the mark a single-colour silhouette, so the roofline stops reading;
   * prefer `auto` wherever the mark has room to be itself.
   *
   * `reverse` is for a mark sitting on the DEALER'S CHROME rather than on the
   * page. It has to exist separately from `auto` because `auto` switches on
   * `data-theme` — the PAGE's light/dark — while the chrome is the dealer's
   * own colour and is dark in BOTH themes for a dealer like this one. Left on
   * `auto`, a navy disc lands on a navy sidebar and the mark disappears; that
   * is not hypothetical, it is what shipped in the first build of this shell.
   */
  tone?: 'auto' | 'mono' | 'reverse' | undefined;
  /**
   * An accessible name, and ONLY when the mark stands alone. Omit it whenever
   * a visible company name sits beside the mark: a mark plus its own name
   * announced twice is a duplicate label that axe will not catch and a screen
   * reader user will.
   */
  label?: string | undefined;
}

/** `mono` wins because a custom property resolves on the element that sets it. */
/**
 * One-colour: the OUTLINE treatment, matching the brand kit's own
 * "one-color · black / white" panels.
 *
 * The disc must drop out. Painting all four shapes `currentColor` is the
 * literal reading of "mono" and it produces a featureless solid circle — the
 * diamond and the roofline bars vanish into the disc they sit on, so the mark
 * loses the two features that make it the mark. The ring carries the edge
 * instead, exactly as it does in dark mode.
 */
/**
 * On chrome: the disc drops out and the chrome's own ink draws the mark, which
 * is exactly the "stacked · reverse" lockup in the brand kit. The diamond
 * stays gold — it is the one element that survives every treatment.
 */
const REVERSE_STYLE: CSSProperties = {
  '--logo-fill': 'transparent',
  '--logo-stroke': 'var(--brand-chrome-on)',
  '--logo-accent': '#ffc313',
  '--logo-bars': 'var(--brand-chrome-on)',
} as CSSProperties;

const MONO_STYLE: CSSProperties = {
  '--logo-fill': 'transparent',
  '--logo-stroke': 'currentColor',
  '--logo-accent': 'currentColor',
  '--logo-bars': 'currentColor',
} as CSSProperties;

export function DealerMark({ size, tone = 'auto', label }: DealerMarkProps) {
  const px = Math.max(MIN_SIZE, size ?? DEFAULT_SIZE);
  const style = tone === 'mono' ? MONO_STYLE : tone === 'reverse' ? REVERSE_STYLE : undefined;

  const shapes = (
    <>
      {/* The disc. Solid on light; drops out on dark, where the ring draws the
          edge instead so the mark is not a navy hole in a navy page. */}
      <circle cx="32" cy="32" r="32" fill="var(--logo-fill, #0b2338)" />
      {/* The ring. Inset to r=30 so a 4-unit stroke lands inside the viewBox
          rather than being clipped in half by it. Transparent on light. */}
      <circle
        cx="32"
        cy="32"
        r="30"
        fill="none"
        stroke="var(--logo-stroke, transparent)"
        strokeWidth="4"
      />
      {/* The gable diamond at the peak. */}
      <rect
        x="24.5"
        y="10"
        width="15"
        height="15"
        fill="var(--logo-accent, #ffc313)"
        transform="rotate(45 32 17.5)"
      />
      {/* The two roofline courses. */}
      <rect x="16.5" y="31" width="31" height="5" fill="var(--logo-bars, #f5f7fa)" />
      <rect x="21" y="39" width="22" height="5" fill="var(--logo-bars, #f5f7fa)" />
    </>
  );

  // Two roots, one body. Exactly one of these accessible shapes, never both: a
  // mark that stands alone is named, and a mark that sits beside its own name
  // is removed from the tree entirely. Written out rather than spread so the
  // attributes are literal — the linter's a11y rule can see them, and so can
  // the next reader.
  return label ? (
    <svg
      viewBox="0 0 64 64"
      width={px}
      height={px}
      // A flex row will happily squeeze an svg narrower than its own
      // viewBox — measured at 20.9x24 in the sidebar before this, an oval
      // badge. width/height attributes do not stop it; `shrink-0` does.
      className="shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      role="img"
      aria-label={label}
    >
      {shapes}
    </svg>
  ) : (
    <svg
      viewBox="0 0 64 64"
      width={px}
      height={px}
      className="shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      aria-hidden={true}
      focusable={false}
    >
      {shapes}
    </svg>
  );
}
