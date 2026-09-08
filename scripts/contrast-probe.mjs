import { chromium } from 'playwright';

/**
 * Contrast, measured through a real browser's own colour pipeline.
 *
 * Not via getComputedStyle().color — Chromium now echoes `oklch(...)` back
 * unchanged, so parsing it as rgb() silently reads lightness as red. Painting
 * to a canvas and reading the pixel is the only answer that cannot lie.
 *
 * The subject is the committed PAIRS table below, not an argv string. A gate
 * whose subject arrives by hand grades nothing on the run nobody typed into —
 * `npm run contrast` passes no argument. An argument still works for ad-hoc
 * probing (`node scripts/contrast-probe.mjs 'fg|bg|label;...'`) and overrides
 * the table, but it can never be the only thing this check ever measured.
 */

// ── The palette under test ────────────────────────────────────────────────
const SURFACE_L = '#FFFFFF';
const SURFACE2_L = 'oklch(98% 0.003 250)';
const SURFACE_D = 'oklch(17% 0.012 265)';
const INK = 'oklch(21% 0.02 260)';
const PAPER = 'oklch(100% 0 0)';
const NAVY = '#0B2338';
const GOLD = '#FFC313';
const HARBOR = '#14497B';
const TIDE = '#86BDF6';

// Derived dealer values, verbatim from docs/brand-tokens.md's brandingCss output.
// Every one is opaque: a transparent mix would read as a composite against
// whatever the canvas last held.
const GOLD_HOVER_L = 'color-mix(in oklch, #FFC313, black 12%)';
const GOLD_HOVER_D = 'color-mix(in oklch, #FFC313, white 16%)';
const BRAND_TINT_L = 'color-mix(in oklch, #14497B, white 90%)';
const OWNER_TINT = 'color-mix(in oklch, #14497B, white 86%)';
const TIDE_TINT_D = 'color-mix(in oklch, #86BDF6, black 78%)';
const CHROME_2 = 'color-mix(in oklch, #0B2338, white 10%)';
const CHROME_MUTED = 'color-mix(in oklch, oklch(100% 0 0), #0B2338 34%)';
const CHROME_LINE = 'color-mix(in oklch, #0B2338, white 30%)';
const SURFACE2_D = 'oklch(21% 0.014 265)';

/**
 * The bar lives in the row, never inferred from the group heading: 4.5 for
 * anything read as text, 3 for a boundary judged as a UI shape (a focus ring,
 * a raised fill). Getting that wrong in either direction is how a gate starts
 * lying quietly.
 *
 * `informational: true` reports the ratio without gating on it. It is for pairs
 * where no WCAG bar actually applies but the number still tells you something —
 * a sidebar ground against a page ground is decorative grouping, not a component
 * that must be identified. Use it sparingly and always with a note saying why,
 * because "informational" is also exactly how a real failure gets excused away.
 */
const PAIRS = [
  // ── Light theme, text ───────────────────────────────────────────────────
  { group: 'light / text', fg: INK, bg: GOLD, label: 'ink on gold (primary btn, Pay)', min: 4.5 },
  { group: 'light / text', fg: INK, bg: GOLD_HOVER_L, label: 'ink on gold hover', min: 4.5 },
  { group: 'light / text', fg: HARBOR, bg: SURFACE_L, label: 'harbor on card', min: 4.5 },
  { group: 'light / text', fg: HARBOR, bg: BRAND_TINT_L, label: 'harbor on brand-tint', min: 4.5 },
  { group: 'light / text', fg: PAPER, bg: NAVY, label: 'paper on navy (wordmark)', min: 4.5 },
  {
    group: 'light / text',
    fg: CHROME_MUTED,
    bg: NAVY,
    label: 'chrome-muted on navy',
    min: 4.5,
    note: 'inactive nav labels — the riskiest new pair',
  },
  {
    group: 'light / text',
    fg: CHROME_MUTED,
    bg: CHROME_2,
    label: 'chrome-muted on chrome-2',
    min: 4.5,
  },
  { group: 'light / text', fg: TIDE, bg: NAVY, label: 'tide on navy (active nav)', min: 4.5 },
  {
    group: 'light / text',
    fg: TIDE,
    bg: CHROME_2,
    label: 'tide on chrome-2 (active nav)',
    min: 4.5,
  },
  { group: 'light / text', fg: PAPER, bg: CHROME_2, label: 'paper on chrome-2', min: 4.5 },
  { group: 'light / text', fg: INK, bg: OWNER_TINT, label: 'ink on owner-avatar tint', min: 4.5 },

  // ── Dark theme ──────────────────────────────────────────────────────────
  {
    group: 'dark',
    fg: TIDE,
    bg: SURFACE_D,
    label: 'tide on dark surface',
    min: 4.5,
    note: "kit's 9.6 is against Ink #0B1725; our dark surface is lighter",
  },
  { group: 'dark', fg: TIDE, bg: TIDE_TINT_D, label: 'tide on dark brand-tint', min: 4.5 },
  { group: 'dark', fg: INK, bg: TIDE, label: 'ink on tide', min: 4.5 },
  { group: 'dark', fg: INK, bg: GOLD_HOVER_D, label: 'ink on dark gold hover', min: 4.5 },
  {
    group: 'dark',
    fg: NAVY,
    bg: SURFACE_D,
    label: 'navy chrome vs dark page',
    min: 3,
    informational: true,
    note: 'no navy value fixes this: #12314D=1.33, #163A5C=1.52, deep-earth #071827=1.01 — the dark page IS this dark. The boundary is the line below, not the fill.',
  },
  {
    group: 'dark',
    fg: CHROME_LINE,
    bg: SURFACE2_D,
    label: 'chrome-line vs dark page',
    min: 1.5,
    note: 'in dark mode this line is the ONLY thing separating chrome from page',
  },

  // ── Non-text: fills and rings judged as UI boundaries ───────────────────
  { group: 'non-text', fg: GOLD, bg: NAVY, label: 'gold FAB on tab bar', min: 3 },
  {
    group: 'non-text',
    fg: GOLD,
    bg: SURFACE2_L,
    label: 'gold FAB on page (no ring)',
    min: 3,
    informational: true,
    note: 'why the ring exists: the translucent tab bar lets surface-2 through and gold has no edge against it',
  },
  {
    group: 'non-text',
    fg: NAVY,
    bg: GOLD,
    label: 'FAB chrome ring vs gold (inner)',
    min: 3,
  },
  {
    group: 'non-text',
    fg: NAVY,
    bg: SURFACE2_L,
    label: 'FAB chrome ring vs page (outer)',
    min: 3,
  },
  { group: 'non-text', fg: CHROME_LINE, bg: NAVY, label: 'chrome-line vs navy chrome', min: 1.5 },
  { group: 'non-text', fg: NAVY, bg: SURFACE_L, label: 'navy focus ring on card', min: 3 },

  // ── Regression: the platform text ramp must not have moved ──────────────
  {
    group: 'regression',
    fg: 'oklch(21% 0.02 260)',
    bg: SURFACE_L,
    label: '--text on surface (want 17.6)',
    min: 4.5,
  },
  {
    group: 'regression',
    fg: 'oklch(45% 0.02 260)',
    bg: SURFACE_L,
    label: '--text-muted on surface (want 7.4)',
    min: 4.5,
  },
  {
    group: 'regression',
    fg: 'oklch(52% 0.015 260)',
    bg: SURFACE_L,
    label: '--text-subtle on surface (want 5.5)',
    min: 4.5,
  },
];

// An argv string overrides the table, for ad-hoc probing only.
const argv = process.argv[2];
const pairs = argv
  ? argv
      .split(';')
      .filter(Boolean)
      .map((s) => {
        const [fg, bg, label, min] = s.split('|');
        return { group: 'argv', fg, bg, label: label ?? `${fg} on ${bg}`, min: Number(min) || 4.5 };
      })
  : PAIRS;

const b = await chromium.launch();
const p = await b.newPage();
await p.setContent('<canvas id="c" width="1" height="1"></canvas>');

let measured;
try {
  measured = await p.evaluate((rows) => {
    const ctx = document.getElementById('c').getContext('2d', { willReadFrequently: true });

    /**
     * Canvas silently KEEPS the previous fillStyle when handed a colour it
     * cannot parse — so an unsupported color-mix() would report the previous
     * pair's ratio as though it were this one. Two different sentinels catch
     * that without false-positiving on a legitimately repeated colour: if the
     * canvas accepted the string, both reads serialise to the same value; if
     * it rejected it, each read is still its own sentinel and they differ.
     */
    const SENTINEL_A = '#010203';
    const SENTINEL_B = '#fefdfc';
    const accepted = (c) => {
      ctx.fillStyle = SENTINEL_A;
      ctx.fillStyle = c;
      const a = ctx.fillStyle;
      ctx.fillStyle = SENTINEL_B;
      ctx.fillStyle = c;
      return a === ctx.fillStyle;
    };

    const px = (c) => {
      if (!accepted(c)) throw new Error(`canvas refused colour: ${JSON.stringify(c)}`);
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };

    const lum = (rgb) =>
      rgb
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);

    return rows.map((row) => {
      const [hi, lo] = [lum(px(row.fg)), lum(px(row.bg))].sort((m, n) => n - m);
      return { ...row, ratio: (hi + 0.05) / (lo + 0.05) };
    });
  }, pairs);
} finally {
  await b.close();
}

// ── Report ────────────────────────────────────────────────────────────────
const width = Math.max(...measured.map((r) => r.label.length));
let group = null;
let failed = 0;

for (const r of measured) {
  if (r.group !== group) {
    group = r.group;
    console.log(`\n${group}`);
  }
  const pass = r.ratio >= r.min;
  if (!pass && !r.informational) failed += 1;
  const verdict = r.informational ? 'note' : pass ? 'PASS' : 'FAIL';
  const bar = r.informational ? '   ' : `min ${String(r.min).padEnd(3)}`;
  console.log(
    `  ${r.label.padEnd(width)}  ${r.ratio.toFixed(2).padStart(6)}:1  ${bar}  ${verdict}`,
  );
  if (r.note) console.log(`  ${' '.repeat(width)}  ${r.note}`);
}

const gated = measured.filter((r) => !r.informational).length;
console.log(
  `\n${gated - failed}/${gated} gated pairs pass their bar${failed ? ` — ${failed} FAILING` : ''}` +
    ` (${measured.length - gated} informational)`,
);
if (failed) process.exit(1);
