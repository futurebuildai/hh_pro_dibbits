# Dealer brand tokens — the frozen contract

This file is the single source of truth for token **names**, the `DealerBranding`
**shape**, and the exact `brandingCss` **output**. It exists because this change is
implemented across several parallel work units, and two of them independently inventing
`--brand-fill-on` vs `--brand-on-fill` is unrecoverable. Read it verbatim; do not
improvise a name.

## The three roles

One `brandColor` conflated three questions. They are now three tokens.

| Role | The question | Gable light | Gable dark | Token |
| --- | --- | --- | --- | --- |
| identity | what colour is this dealer *as text on a card*? | Harbor `#14497B` | Tide `#86BDF6` | `--brand` |
| action | what does a filled, pressable control look like? | Gold `#FFC313` | Gold `#FFC313` | `--brand-fill` |
| chrome | what colour is the frame around the content? | Navy `#0B2338` | Navy `#0B2338` | `--brand-chrome` |

`--brand` keeps its existing meaning, so every current `text-brand` site is untouched and
no existing dealer's deployment changes colour. Only `bg-brand` moves to `bg-brand-fill`.

## The full token list

Dealer layer, all `--brand`-prefixed. **The prefix is the contract**: `brandingCss` may
emit nothing else, and `config.test.ts` asserts every emitted property matches
`/^--brand-/` (plus the bare `--brand`).

| Token | Meaning | theme.css default |
| --- | --- | --- |
| `--brand` | identity, used as text | `oklch(52% 0.19 255)` |
| `--brand-hover` | identity hover | `oklch(46% 0.19 255)` |
| `--brand-on` | ink on a `--brand` fill | derived; `oklch(100% 0 0)` |
| `--brand-tint` | pale wash of identity | `color-mix(in oklch, var(--brand), white 90%)` |
| `--brand-fill` | the action fill | `var(--brand)` |
| `--brand-fill-hover` | action fill hover | `var(--brand-hover)` |
| `--brand-fill-on` | ink on the action fill | `var(--brand-on)` |
| `--brand-chrome` | shell ground | `var(--surface)` |
| `--brand-chrome-2` | raised/active within chrome | `var(--surface-3)` |
| `--brand-chrome-line` | chrome divider | `var(--border)` |
| `--brand-chrome-on` | primary text on chrome | `var(--text)` |
| `--brand-chrome-muted` | secondary text on chrome | `var(--text-muted)` |
| `--brand-chrome-accent` | active/link accent on chrome | `var(--brand)` |

**Why the defaults are platform `var()`s:** it means `PortalLayout` uses chrome tokens
unconditionally with no `if`, and a dealer who sets no chrome colour sees today's white
shell. It also means the dark block needs **only `--brand-tint` repeated** — the rest
resolve at computed-value time against the dark block's own `--surface`/`--text`.

### Names that are forbidden, and why

`config.test.ts` asserts the emitted CSS contains none of `--surface`, `--text`,
`--stage-`, `--danger` — the platform layer a dealer may never write.

- **`--brand-text` is banned** — contains the substring `--text`, fails on sight. The
  identity-as-text role therefore has no token of its own; it *is* `--brand`.
- `brandingCss` may never *name* a platform token, only inline its **value**. In
  particular the on-ink constant must be the literal `oklch(21% 0.02 260)`, never
  `var(--text)`.
- `--brand-chrome-line`, not `-border`: `border-brand-chrome-border` is an unreadable
  utility name.

### Identity constants — a separate layer, not dealer-writable

`--logo-fill`, `--logo-stroke`, `--logo-accent`, `--logo-bars` live in
`src/ui/styles/identity.css`. They are **not** part of the dealer contract and
`brandingCss` never emits them. They exist so the mark can flip light/dark in pure CSS:
`data-theme` is set by an attribute on `<html>` that React never observes, so a
JS-selected variant cannot react to it.

## `DealerBranding`

```ts
export interface DealerBranding {
  companyName: string;
  brandColor: string;                   // identity, as text
  brandColorDark?: string | undefined;
  actionColor?: string | undefined;     // the filled control
  actionColorDark?: string | undefined;
  chromeColor?: string | undefined;     // the shell
  chromeColorDark?: string | undefined;
  logoUrl?: string | undefined;         // dealer override; NO default
  logoDarkUrl?: string | undefined;
}
```

Flat, not nested `{light, dark}` — `parseConfig`'s doctrine is *a bad field costs THAT
field*, and a nested object invites "a bad object costs the group".

Every new field is **optional**. That is what keeps `mapBranding()`
(`supplier/adapters/erp-map.ts:213`) and its `toEqual({companyName, brandColor})`
assertions compiling and passing untouched — it builds a `DealerBranding` from three wire
fields and knows nothing about these.

Emit each optional field with the `...(x ? {x} : {})` spread already used for `logoUrl`,
or `parseConfig({}) toEqual(DEFAULT_CONFIG)` (`config.test.ts:96`) breaks.

**`DEFAULT_CONFIG.branding.logoUrl` and `logoDarkUrl` stay UNSET.** `parseConfig:215-216`
hardcodes `''` as the logo fallback and never consults `DEFAULT_CONFIG`, so a default
there is silently dropped by every parse *and* fails the `toEqual` above. The built-in
`DealerMark` is the fallback, not a default path.

### `DEFAULT_CONFIG.branding`

```ts
{
  companyName: 'Gable Landscape Supply',
  brandColor: '#14497B',        // Harbor
  brandColorDark: '#86BDF6',    // Tide
  actionColor: '#FFC313',       // Gold
  actionColorDark: '#FFC313',   // gold does NOT invert — see below
  chromeColor: '#0B2338',       // Navy
  chromeColorDark: '#0B2338',   // pending Wave 3 measurement
}
```

All six are hex and pass the existing `isValidColor` unchanged. **No validator needs
modifying.**

## `brandingCss` output for Gable

Emitted as one line; broken here for reading. `--brand-tint` is deliberately **not**
emitted — it stays derived in `theme.css` from `var(--brand)`.

```
:root:root{
--brand:#14497B;
--brand-hover:color-mix(in oklch, #14497B, black 12%);
--brand-on:oklch(100% 0 0);
--brand-fill:#FFC313;
--brand-fill-hover:color-mix(in oklch, #FFC313, black 12%);
--brand-fill-on:oklch(21% 0.02 260);
--brand-chrome:#0B2338;
--brand-chrome-2:color-mix(in oklch, #0B2338, white 10%);
--brand-chrome-line:color-mix(in oklch, #0B2338, white 30%);
--brand-chrome-on:oklch(100% 0 0);
--brand-chrome-muted:color-mix(in oklch, oklch(100% 0 0), #0B2338 34%);
--brand-chrome-accent:#86BDF6;
}
:root:root[data-theme="dark"]{
--brand:#86BDF6;
--brand-hover:color-mix(in oklch, #86BDF6, white 16%);
--brand-on:oklch(21% 0.02 260);
--brand-fill:#FFC313;
--brand-fill-hover:color-mix(in oklch, #FFC313, white 16%);
--brand-fill-on:oklch(21% 0.02 260);
--brand-chrome:#0B2338;
--brand-chrome-2:color-mix(in oklch, #0B2338, white 10%);
--brand-chrome-line:color-mix(in oklch, #0B2338, white 30%);
--brand-chrome-on:oklch(100% 0 0);
--brand-chrome-muted:color-mix(in oklch, oklch(100% 0 0), #0B2338 34%);
--brand-chrome-accent:#86BDF6;
}
```

### Measured and settled (Wave 3)

These were provisional; `npm run contrast` has now decided them.

- **`--brand-chrome-muted` at `34%` holds.** 7.01:1 on navy, 5.44:1 on chrome-2, 7.45:1
  on the kit's deep-earth. Chrome-2 is the tighter ground and it still clears. Keep.
- **`--brand-chrome-line` moves from `white 16%` to `white 30%`.** At 16% it measured
  **1.54:1** against navy — a divider nobody can see. 30% gives 2.40:1 on navy and 2.32:1
  against the dark page, visible on both sides. One value serves both themes because the
  chrome is navy in both.
- **`chromeColorDark` stays `#0B2338`. Do not chase separation from the dark page.**
  Navy measures 1.11:1 against our dark `--surface-2`, and *no recognisably-navy value
  fixes it*: lifting to `#12314D` gives 1.33, `#163A5C` gives 1.52; darkening to the
  kit's own deep-earth `#071827` gives **1.01** — because our dark page is already at
  deep-earth luminance. Chrome and page are the same darkness in dark mode by
  construction, so the boundary is carried by `--brand-chrome-line`, not by the fill.
  That is also why the "navy chrome vs dark page" probe row is **informational** and not
  a 3:1 gate: WCAG 1.4.11 governs components that must be *identified*, and a sidebar
  ground against a page ground is decorative grouping — the nav items inside it are the
  components, and they measure 7–9:1.
- **The raised assistant FAB gets a `--brand-chrome` ring.** Gold over the page measures
  **1.52:1** where the translucent tab bar lets `--surface-2` through, so the button has
  no perceivable edge there. A navy ring gives **9.96:1** against the gold (inner edge)
  and **15.16:1** against the light page (outer edge). This is a real fix, not a tuning.

### Rules the emitter follows

1. **Nothing is emitted for a role the dealer did not set.** No `actionColor` → the three
   `--brand-fill-*` lines are omitted and `theme.css`'s `--brand-fill: var(--brand)`
   stands. No `chromeColor` → all six chrome lines omitted and the shell stays white.
   This is what keeps every existing deployment byte-identical.
2. **Derived dark keeps today's formulas.** When no explicit dark value is given, use
   exactly today's `white 22%` / `white 38%` off the light value, so no existing dealer's
   dark mode moves. An *explicit* dark value gets a smaller `white 16%` lift, because the
   big lift was compensating for a light-chosen colour.
3. **Gold does not invert.** `color-mix(gold, white 22%)` washes to pale yellow and loses
   the kit's most recognisable colour. This is the whole reason `actionColorDark` exists.
4. **Chrome borrows the opposite theme's accent.** Polarity from
   `relativeLuminance(chromeColor)` — which the emitter computed anyway for
   `--brand-chrome-on`, so it is one `if`. A dark chrome island in a light page uses the
   dark theme's dealer values, which is why Tide needs no separate "sidebar link" field.
5. **Every derived value is opaque**, never `transparent` — the contrast probe paints to
   a canvas, and a transparent mix reads as a composite against whatever it held.
6. **`:root:root` specificity is load-bearing** and unchanged. The bundler injects
   `theme.css` *after* this tag, so a plain `:root` silently loses the cascade.

## `onColorFor` — how `--brand-on` is decided

Derived in TypeScript at emit time (`src/core/lib/color.ts`). Not a dealer field, because
a settable on-colour is a settable way to make white-on-gold — the bug being fixed.

```ts
const ON_PAPER = 'oklch(100% 0 0)';
const ON_INK   = 'oklch(21% 0.02 260)';   // the platform --text VALUE, inlined
```

Best-of-two by contrast ratio. Boundary-safe: at the crossover the candidates are equal,
so conversion imprecision costs nothing exactly where a threshold would be most fragile.

**The dead zone — MEASURED, not estimated.** `ON_INK` has luminance **0.009256**, not
the ~0.033 first assumed: oklab lightness is perceptual, so `oklch(21% 0.02 260)` is a
much darker ink than "21%" reads as (it resolves to `#131922`). The real boundaries:

| | first estimate | measured |
| --- | --- | --- |
| paper clears 4.5:1 below fill-luminance | ≈0.18 | **0.183333** |
| ink clears 4.5:1 above fill-luminance | ≈0.32 | **0.216652** |
| worst case at the crossover | ≈3.5:1 | **4.209:1** (at L 0.199437) |

So the zone is `0.183333 < L < 0.216652` — roughly `#777777`–`#808080` in 8-bit greys.
**Plain mid-grey `#808080` is inside it** (ink 4.49:1, paper 3.95:1), which is the case
worth remembering. The crossover is still the trap — it passes a 3:1 large-object bar and
fails a 4.5:1 label bar — just at a higher ratio than assumed.

`isLegibleFill()` refuses that range and applies **only to `actionColor`/
`actionColorDark`**, falling back to `brandColor`.

Verified contrast for the Gable values (`src/core/lib/__tests__/color.test.ts`):

| Fill | `onColorFor` | Ratio | The bug it replaces |
| --- | --- | --- | --- |
| `#FFC313` gold | ink | **11.03:1** | white on gold = **1.61:1** |
| `#E8A74E` (recorded ERP fixture) | ink | **8.50:1** | white on it = **2.09:1**, shipping today |
| `#14497B` Harbor | paper | 9.26:1 | — |
| `#0B2338` Navy | paper | 16.01:1 | — |
| `#86BDF6` Tide | ink | 8.96:1 | — |

The kit's claimed 11.2:1 for ink-on-gold is against pure black, not our ink; 11.03 is the
real number. Note also that `npm run contrast` quantises `oklch()` to 8-bit before
measuring, so it reports gold-on-ink as 10.98:1 against this module's 11.03:1 — a 0.4%
disagreement from quantisation, immaterial at these margins but worth not chasing.

It does **not** gate `brandColor`. `mapBranding()` never runs `parseConfig`, so gating
there would let an ERP colour pass one door and fail the other — and the recorded fixture
colour `#E8A74E` would be rejected outright rather than simply getting a correct ink.

---

## Incidental finding: the old favicon never rendered

`public/favicon.svg` as it stood before this change was **not well-formed XML** and no
browser could decode it. Its comment contained `var(--brand)`, and a double hyphen is
illegal inside an XML comment. Verified two ways:

```
python3 -c "ET.parse(...)"   → not well-formed (invalid token): line 5, column 48
chromium new Image()         → ORIGINAL: FAILED TO DECODE / NEW: LOADED 64x64
```

So the product has been showing the browser's default tab icon since the fork, and the
comment explaining the fixed blue was the thing that broke it.

Why no gate caught it: `npm run e2e` fails on a 404, and CLAUDE.md records that this is
"how a missing favicon surfaced" — but a malformed file is not a missing one. It returns
200 with the right content-type and fails silently in the decoder. **A 200 is not proof a
static asset is usable**, which is the same lesson as "the SPA fallback answers 200" from
the dev-server outage, one layer further down.

The replacement carries the same reasoning in prose without ever writing the token name
literally, and every vendored SVG is now checked to parse.
