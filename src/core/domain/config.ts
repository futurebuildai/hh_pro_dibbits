import { isLegibleFill, onColorFor, relativeLuminance } from '../lib/color';
import { type Result, err, ok } from '../lib/result';

/**
 * Dealer configuration — the things a dealer's admin sets AFTER deployment,
 * rather than a developer setting them in code.
 *
 * The split that matters is public vs. secret. Everything in `DealerConfig` is
 * PUBLIC: it is injected into the page and readable by anyone using the app,
 * because it is branding, terms, and feature flags. The LLM credential is NOT
 * part of this type at all — it lives only in the server's private store and
 * has no representation here beyond `assistant.hasCredential`. That is
 * deliberate: a shape that cannot carry the secret cannot leak it.
 *
 * This module is framework-free and pure so the same validation runs in the
 * admin UI (immediate feedback) and on the server (the actual gate). The
 * server never trusts the client's validation — it re-runs this.
 */

export type FeatureKey = 'assistant' | 'customerQuotes' | 'payments' | 'willCall';

/**
 * The dealer's brand, as three ROLES rather than one colour.
 *
 * One `brandColor` was answering three different questions — what colour is
 * this dealer as TEXT, what does a pressable FILL look like, and what colour is
 * the SHELL around the content — and the answers genuinely differ. Painting
 * white on whatever the single colour happened to be is how the recorded ERP
 * gold (`#E8A74E`) shipped a control label at 2.09:1, less than half the AA bar.
 *
 * Flat, not nested `{light, dark}`: `parseConfig`'s doctrine is *a bad field
 * costs THAT field*, and a nested object invites "a bad object costs the group".
 *
 * Every field past `brandColor` is OPTIONAL, and that is load-bearing.
 * `mapBranding()` (`supplier/adapters/erp-map.ts`) builds a `DealerBranding`
 * from three ERP wire fields and knows nothing about these; its contract tests
 * assert the whole object with `toEqual({companyName, brandColor})`. A required
 * field here would break an ERP read that has nothing to do with branding roles.
 *
 * See `docs/brand-tokens.md` — the frozen token contract this shape serves.
 */
export interface DealerBranding {
  /** Shown in the shell and on order documents. */
  companyName: string;
  /** Identity, used as TEXT. OKLCH or hex. Becomes --brand at runtime. */
  brandColor: string;
  /** Identity in dark mode. Absent means "lift the light one" (see brandingCss). */
  brandColorDark?: string | undefined;
  /** The filled, pressable control. Absent means "use the identity colour". */
  actionColor?: string | undefined;
  /** The filled control in dark mode. Exists because gold must not invert. */
  actionColorDark?: string | undefined;
  /** The shell/frame ground. Absent means today's white chrome. */
  chromeColor?: string | undefined;
  /** The shell ground in dark mode. Absent reuses `chromeColor` unchanged. */
  chromeColorDark?: string | undefined;
  /** Optional; must be a same-origin path or a data: URI, never a remote URL. */
  logoUrl?: string | undefined;
  /** The mark for a dark ground. Same origin rules as `logoUrl`. */
  logoDarkUrl?: string | undefined;
}

export interface AssistantConfig {
  model: string;
  /** Ceiling per request, independently capped by the proxy. */
  maxTokens: number;
  /** 0 disables the cap. Counted server-side per calendar day. */
  dailyRequestCap: number;
  /**
   * Extra house rules appended to the system prompt. Deliberately additive —
   * it cannot replace the safety rules (never invent a quantity or a price),
   * because a dealer must not be able to configure those away.
   */
  houseRules: string;
  /** Reported by the server; never settable through config. */
  hasCredential?: boolean | undefined;
}

/**
 * The staged ERP rollout's flags (connection spec §7.3).
 *
 * One key per stage, added as its stage is funded — not the whole ladder up
 * front, because a flag that exists before the code it gates is a switch a
 * dealer can flip into nothing. Absent is off, which is the only state the
 * product has ever shipped in.
 */
export interface SupplierStages {
  /** Stage 1: auth, /me + capabilities, branding, catalog, orders/invoices/quotes reads. */
  erpReads: boolean;
}

export interface SupplierConfig {
  /** Net terms in days, used for invoice due dates. */
  termsDays: number;
  /** Percent, e.g. 2.9. Shown to the contractor before they choose a card. */
  cardFeePercent: number;
  /**
   * Which supplier is behind the port. `sim` is the default and a permanent,
   * supported mode — the demo, the guide capture, and the e2e suite all run on
   * it, which is what keeps it from rotting (§7.2).
   */
  mode: 'sim' | 'erp';
  /** The dealer's ERP root, e.g. `https://erp.dealer.example`. ERP mode only. */
  baseUrl?: string | undefined;
  stages: SupplierStages;
}

export interface DealerConfig {
  branding: DealerBranding;
  assistant: AssistantConfig;
  supplier: SupplierConfig;
  features: Record<FeatureKey, boolean>;
}

/** What ships when a dealer has configured nothing — today's hard-coded values. */
export const DEFAULT_CONFIG: DealerConfig = {
  branding: {
    companyName: 'Gable Landscape Supply',
    brandColor: '#14497B', // Harbor — identity, as text on a card
    brandColorDark: '#86BDF6', // Tide — the same identity, readable on a dark surface
    actionColor: '#FFC313', // Gold — the filled, pressable control
    actionColorDark: '#FFC313', // gold does NOT invert; see brandingCss rule 3
    chromeColor: '#0B2338', // Navy — the shell around the content
    chromeColorDark: '#0B2338', // measured: navy holds in dark, the divider carries the edge
    // logoUrl / logoDarkUrl are deliberately UNSET, and must stay that way.
    // `parseConfig` hardcodes '' as the logo fallback and never consults this
    // object, so a default here would be silently dropped by every parse — and
    // it would break `parseConfig({}) toEqual(DEFAULT_CONFIG)` on the way past.
    // The built-in DealerMark is the fallback; there is no default logo PATH.
  },
  assistant: {
    model: 'claude-opus-4-8',
    maxTokens: 8192,
    dailyRequestCap: 0,
    houseRules: '',
  },
  supplier: {
    termsDays: 30,
    cardFeePercent: 2.9,
    mode: 'sim',
    stages: { erpReads: false },
  },
  features: {
    assistant: true,
    customerQuotes: true,
    payments: true,
    willCall: true,
  },
};

/**
 * Models the proxy will forward. Kept in lockstep with the proxy's own
 * allowlist — a dealer choosing a model the proxy refuses would configure
 * their assistant into a 400.
 */
export const SELECTABLE_MODELS = ['claude-opus-4-8', 'claude-haiku-4-5'] as const;

export const MAX_TOKENS_LIMIT = 32_000;
export const MAX_HOUSE_RULES = 2_000;

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  assistant: 'AI assistant',
  customerQuotes: 'Customer quotes',
  payments: 'Online payments',
  willCall: 'Will-call pickup',
};

export const FEATURE_DESCRIPTIONS: Record<FeatureKey, string> = {
  assistant: 'The chat assistant that turns a material list into order lines.',
  customerQuotes: 'Contractor-branded proposals with a share link and signature.',
  payments: 'Paying invoices in the portal. Turn off if AR is handled elsewhere.',
  willCall: 'Pickup at the counter as an alternative to delivery.',
};

/**
 * A colour the dealer may set.
 *
 * Strict by necessity: these values are interpolated into a stylesheet, so an
 * unvalidated string is CSS injection — `red; } body { display: none } .x {`
 * would let a dealer admin rewrite the whole page, including the PLATFORM
 * token layer they are explicitly not allowed to touch. Only hex and a
 * conservative oklch() form are accepted; anything else is refused rather than
 * escaped, because refusing is easy to verify and escaping is not.
 */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const OKLCH = /^oklch\(\s*\d{1,3}(?:\.\d+)?%\s+\d(?:\.\d+)?\s+\d{1,3}(?:\.\d+)?\s*\)$/;

export function isValidColor(value: string): boolean {
  const trimmed = value.trim();
  return HEX.test(trimmed) || OKLCH.test(trimmed);
}

/**
 * A logo the dealer may set: a same-origin path or an inline data: image.
 * A remote URL is refused because it would beacon every contractor's visit to
 * a third party and give that party a way to swap the mark later.
 */
export function isValidLogo(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  return /^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed);
}

/**
 * An ERP root this app is willing to point a bearer token at.
 *
 * Absolute `http:`/`https:` only. A relative value would resolve against
 * whatever page happens to be open — so a dealer typo could aim the adapter,
 * and the contractor's token, at the app's own origin — and a non-http scheme
 * is not something to send a credential over at all. Refused rather than
 * repaired, on the same reasoning as the colour: refusing is easy to verify.
 */
export function isValidSupplierBaseUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function clampNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * One optional dealer colour, resolved. A bad value costs THAT field and
 * nothing else — the same rule `brandColor` has always followed, applied to the
 * five colours the role split added. `''` means "the dealer has not set this
 * role", which the emitter reads as "emit nothing for it".
 */
function resolveColor(value: unknown, fallback: string | undefined): string {
  const requested = typeof value === 'string' ? value.trim() : '';
  if (requested !== '' && isValidColor(requested)) return requested;
  return fallback ?? '';
}

/**
 * A FILL colour, which has a second bar to clear: something legible has to be
 * printed on it.
 *
 * `onColorFor` picks the better of white and the platform ink, but there is a
 * narrow band of mid-tones where NEITHER clears 4.5:1 — plain `#808080` is in
 * it. A fill in that band is a control whose own label fails an audit while
 * looking fine in a design review, so it is refused and the identity colour
 * stands in.
 *
 * This gate applies to the action fill ONLY. It deliberately does not gate
 * `brandColor`: `mapBranding()` never runs `parseConfig`, so gating there would
 * let an ERP-supplied colour through one door and be refused at the other, and
 * the recorded staging colour `#E8A74E` would be thrown out rather than simply
 * being given the correct ink.
 */
function resolveFill(value: unknown, fallback: string | undefined, brand: string): string {
  const resolved = resolveColor(value, fallback);
  if (resolved === '') return '';
  return isLegibleFill(resolved) ? resolved : brand;
}

/**
 * Validates and normalises an untrusted config payload.
 *
 * Returns the FULL config with defaults filled in, so a partial or hostile
 * payload can never leave the app with a missing field. Runs on the server
 * against whatever the admin UI sent, and again when reading the stored file,
 * because a file edited by hand is untrusted too.
 */
export function parseConfig(raw: unknown): Result<DealerConfig> {
  if (typeof raw !== 'object' || raw === null) return err('Configuration must be an object.');
  const input = raw as Record<string, unknown>;

  const branding = (input.branding ?? {}) as Record<string, unknown>;

  /**
   * Whether the payload spoke about branding AT ALL.
   *
   * This decides what a MISSING optional colour means, and the two answers are
   * genuinely different:
   *
   *   no `branding` block   -> nothing is configured, so ship the demo tenant
   *                            whole. `parseConfig({})` is the path the app
   *                            takes with no `.hhpro/config.json`, and it must
   *                            produce the full default brand or the shipped
   *                            demo loses its identity.
   *
   *   a `branding` block    -> this dealer HAS configured themselves, and a
   *                            role they left out is a role they do not want —
   *                            not an invitation to inherit the demo tenant's.
   *
   * Without the distinction, a dealer who sets only their own `brandColor`
   * inherits the demo tenant's gold fill, its navy chrome, and — worst — its
   * literal dark-mode identity colour, so THEIR brand silently becomes SOMEONE
   * ELSE'S the moment a contractor switches to dark mode. Left unset instead,
   * `brandingCss` derives the dark value from their own colour and omits the
   * roles they never asked for, which is the byte-identical behaviour every
   * pre-existing deployment already had.
   */
  const brandingConfigured = typeof input.branding === 'object' && input.branding !== null;
  const fallback = <T>(value: T): T | undefined => (brandingConfigured ? undefined : value);
  const assistant = (input.assistant ?? {}) as Record<string, unknown>;
  const supplier = (input.supplier ?? {}) as Record<string, unknown>;
  const features = (input.features ?? {}) as Record<string, unknown>;

  const companyName =
    typeof branding.companyName === 'string' && branding.companyName.trim()
      ? branding.companyName.trim().slice(0, 80)
      : DEFAULT_CONFIG.branding.companyName;

  // A bad value costs that value and nothing else. Rejecting the whole config
  // over one field meant a hand-edited colour silently reverted EVERY setting
  // to defaults — lifting the spend cap and re-enabling every feature flag.
  // Only a payload that is not an object is refused outright.
  const requested = typeof branding.brandColor === 'string' ? branding.brandColor.trim() : '';
  const brandColor = isValidColor(requested) ? requested : DEFAULT_CONFIG.branding.brandColor;

  const brandColorDark = resolveColor(
    branding.brandColorDark,
    fallback(DEFAULT_CONFIG.branding.brandColorDark),
  );
  const actionColor = resolveFill(
    branding.actionColor,
    fallback(DEFAULT_CONFIG.branding.actionColor),
    brandColor,
  );
  const actionColorDark = resolveFill(
    branding.actionColorDark,
    fallback(DEFAULT_CONFIG.branding.actionColorDark),
    brandColor,
  );
  const chromeColor = resolveColor(
    branding.chromeColor,
    fallback(DEFAULT_CONFIG.branding.chromeColor),
  );
  const chromeColorDark = resolveColor(
    branding.chromeColorDark,
    fallback(DEFAULT_CONFIG.branding.chromeColorDark),
  );

  const requestedLogo = typeof branding.logoUrl === 'string' ? branding.logoUrl.trim() : '';
  const logoUrl = isValidLogo(requestedLogo) ? requestedLogo : '';

  const requestedLogoDark =
    typeof branding.logoDarkUrl === 'string' ? branding.logoDarkUrl.trim() : '';
  const logoDarkUrl = isValidLogo(requestedLogoDark) ? requestedLogoDark : '';

  const model =
    typeof assistant.model === 'string' &&
    (SELECTABLE_MODELS as readonly string[]).includes(assistant.model)
      ? assistant.model
      : DEFAULT_CONFIG.assistant.model;

  // Rounded, not just clamped: the API rejects a fractional max_tokens, so a
  // decimal here would fail EVERY assistant request with a 400 the contractor
  // could do nothing about.
  const maxTokens = Math.round(
    Math.max(
      256,
      Math.min(
        MAX_TOKENS_LIMIT,
        clampNumber(assistant.maxTokens, DEFAULT_CONFIG.assistant.maxTokens),
      ),
    ),
  );

  const dailyRequestCap = Math.round(
    Math.max(0, Math.min(100_000, clampNumber(assistant.dailyRequestCap, 0))),
  );

  const houseRules =
    typeof assistant.houseRules === 'string' ? assistant.houseRules.slice(0, MAX_HOUSE_RULES) : '';

  const termsDays = Math.max(
    0,
    Math.min(365, Math.round(clampNumber(supplier.termsDays, DEFAULT_CONFIG.supplier.termsDays))),
  );

  const cardFeePercent = Math.max(
    0,
    Math.min(10, clampNumber(supplier.cardFeePercent, DEFAULT_CONFIG.supplier.cardFeePercent)),
  );

  // ERP mode is only real with a base URL this app is willing to send a bearer
  // token to. A `mode:"erp"` with a missing or hostile URL costs the MODE, not
  // the rest of the config — the same "a bad value costs that value" rule the
  // colour follows. The stage flags go down with it, so a half-configured
  // connection cannot leave `erpReads` on pointing at nothing.
  //
  // This is the config layer, and it is the ONLY place a supplier mode is ever
  // downgraded. At runtime the adapter never falls back: a 401 ends the session
  // and shows the login screen rather than quietly resuming the simulator, and
  // a portal that starts serving fabricated prices when its ERP session lapses
  // is the worst failure this integration can have.
  const requestedBaseUrl = typeof supplier.baseUrl === 'string' ? supplier.baseUrl.trim() : '';
  const baseUrl = isValidSupplierBaseUrl(requestedBaseUrl) ? requestedBaseUrl : '';
  const mode: SupplierConfig['mode'] = supplier.mode === 'erp' && baseUrl !== '' ? 'erp' : 'sim';

  const rawStages = (supplier.stages ?? {}) as Record<string, unknown>;
  const stages: SupplierStages = { ...DEFAULT_CONFIG.supplier.stages };
  if (mode === 'erp') {
    for (const key of Object.keys(DEFAULT_CONFIG.supplier.stages) as (keyof SupplierStages)[]) {
      if (typeof rawStages[key] === 'boolean') stages[key] = rawStages[key] as boolean;
    }
  }

  const resolvedFeatures = { ...DEFAULT_CONFIG.features };
  for (const key of Object.keys(DEFAULT_CONFIG.features) as FeatureKey[]) {
    if (typeof features[key] === 'boolean') resolvedFeatures[key] = features[key] as boolean;
  }

  return ok({
    branding: {
      companyName,
      brandColor,
      // Every optional field is spread conditionally, never emitted as an
      // explicit `undefined`: `exactOptionalPropertyTypes` is on, the config is
      // JSON-serialised to disk, and `parseConfig({})` has to deep-equal
      // DEFAULT_CONFIG — which carries no logo of either kind.
      ...(brandColorDark ? { brandColorDark } : {}),
      ...(actionColor ? { actionColor } : {}),
      ...(actionColorDark ? { actionColorDark } : {}),
      ...(chromeColor ? { chromeColor } : {}),
      ...(chromeColorDark ? { chromeColorDark } : {}),
      ...(logoUrl ? { logoUrl } : {}),
      ...(logoDarkUrl ? { logoDarkUrl } : {}),
    },
    assistant: { model, maxTokens, dailyRequestCap, houseRules },
    supplier: {
      termsDays,
      cardFeePercent,
      mode,
      ...(mode === 'erp' ? { baseUrl } : {}),
      stages,
    },
    features: resolvedFeatures,
  });
}

/** A colour the emitter is willing to interpolate, or undefined if it is not one. */
function safeColor(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return isValidColor(trimmed) ? trimmed : undefined;
}

/**
 * Every derived value is an opaque mix, never a transparency.
 *
 * `npm run contrast` paints a token to a canvas and reads the pixel back, so a
 * translucent value would measure against whatever happened to be behind it —
 * a number that is true for one screen and a fiction everywhere else.
 */
function mix(color: string, toward: 'black' | 'white', percent: number): string {
  return `color-mix(in oklch, ${color}, ${toward} ${percent}%)`;
}

/**
 * One role in the LIGHT block: the colour, its hover step, and the ink that
 * reads on it.
 *
 * `--brand-on` is computed here rather than being a dealer field, because a
 * settable on-colour is a settable way to write white-on-gold — the bug this
 * whole split exists to fix.
 */
function roleLight(prefix: string, value: string): string {
  return (
    `${prefix}:${value};` +
    `${prefix}-hover:${mix(value, 'black', 12)};` +
    `${prefix}-on:${onColorFor(value)};`
  );
}

/**
 * The same role in the DARK block.
 *
 * With no explicit dark value the historical formulas stand exactly — `white
 * 22%` for the colour, `white 38%` for the hover — so no existing dealer's dark
 * mode moves by a single byte of rendered colour. An EXPLICIT dark value is
 * already chosen for a dark surface and gets only a `white 16%` hover step; the
 * big lift was compensating for a light-chosen hue, and re-applying it to gold
 * washes it to pale yellow and loses the most recognisable colour in the kit.
 *
 * The ink is decided from a CONCRETE colour — the explicit dark value if there
 * is one, otherwise the light value the mix starts from. `onColorFor` cannot
 * evaluate a `color-mix()` (it reads as luminance 0 and would always answer
 * white), and lifting a colour toward white only ever moves it further into
 * ink's half of the range, so the light value's answer is never made wrong by
 * the lift.
 */
function roleDark(prefix: string, light: string, dark: string | undefined): string {
  const base = dark ?? mix(light, 'white', 22);
  const hover = dark ? mix(dark, 'white', 16) : mix(light, 'white', 38);
  return `${prefix}:${base};${prefix}-hover:${hover};${prefix}-on:${onColorFor(dark ?? light)};`;
}

/**
 * The six chrome tokens for one ground.
 *
 * Chrome borrows the OPPOSITE theme's accent: a navy sidebar sitting in a light
 * page needs the dark theme's dealer colour on its links, which is why there is
 * no separate "sidebar link" field to get out of step. The polarity is the same
 * luminance question `--brand-chrome-on` already answered, so it is one `if`
 * and not a second opinion.
 *
 * `--brand-chrome-line` is `white 30%`, not the smaller lift the other steps
 * take, and that is measured rather than tuned: at 16% the divider read 1.54:1
 * against navy — invisible. In dark mode the chrome ground and the page ground
 * are the same darkness by construction (no recognisably-navy value separates
 * them), so this line is the ENTIRE boundary between the shell and the page.
 */
function chromeBlock(ground: string, brand: string, brandDark: string | undefined): string {
  const on = onColorFor(ground);
  const groundIsDark = relativeLuminance(ground) < relativeLuminance(on);
  const accent = groundIsDark ? (brandDark ?? mix(brand, 'white', 22)) : brand;
  return (
    `--brand-chrome:${ground};` +
    `--brand-chrome-2:${mix(ground, 'white', 10)};` +
    `--brand-chrome-line:${mix(ground, 'white', 30)};` +
    `--brand-chrome-on:${on};` +
    `--brand-chrome-muted:color-mix(in oklch, ${on}, ${ground} 34%);` +
    `--brand-chrome-accent:${accent};`
  );
}

/**
 * The CSS the dealer's branding becomes. Only DEALER-layer tokens are emitted —
 * platform tokens (`--surface`, `--text`, the stage colours) are never
 * writable here, so "Order" looks the same on every dealer's deployment. The
 * `--brand` prefix IS the contract; `config.test.ts` parses every custom
 * property back out of this string and refuses one that does not carry it.
 *
 * It may never NAME a platform token either, only inline its VALUE — the ink
 * constants come back from `onColorFor` as literals for exactly that reason.
 * A `var(--text)` here would both fail that test on sight and be a lie at emit
 * time, since this block is injected BEFORE theme.css and the reference would
 * resolve to whichever polarity the viewer's theme ends up in.
 *
 * Nothing is emitted for a role the dealer did not set. No action colour and
 * theme.css's `--brand-fill: var(--brand)` stands; no chrome colour and the
 * shell stays white. That omission is what keeps a deployment that configured
 * only a brand colour byte-identical to what it renders today.
 *
 * Values are validated by parseConfig before reaching this, and re-checked
 * here so a hand-edited config file cannot inject a stylesheet either.
 */
export function brandingCss(config: DealerConfig): string {
  const branding = config.branding;
  const brand = safeColor(branding.brandColor) ?? DEFAULT_CONFIG.branding.brandColor;
  const brandDark = safeColor(branding.brandColorDark);
  const action = safeColor(branding.actionColor);
  const actionDark = safeColor(branding.actionColorDark);
  const chrome = safeColor(branding.chromeColor);
  const chromeDark = safeColor(branding.chromeColorDark);

  // The chrome ground does NOT take the dark-mode lift the other roles take.
  // It is a ground, not a hue chosen against white: lifting a navy shell in
  // dark mode makes it lighter than the page it frames. It also has to stay a
  // concrete colour, because `--brand-chrome-on` and `--brand-chrome-muted` are
  // computed FROM it and a `color-mix()` cannot be measured at emit time.
  const chromeGroundDark = chromeDark ?? chrome;

  // Specificity, not source order, decides this. The stylesheet is injected by
  // the bundler AFTER this tag in dev, so a plain `:root` here loses the
  // cascade and the dealer's colour silently never applies — which is exactly
  // what happened the first time. `:root:root` (0,2,0) beats theme.css's
  // `:root` (0,1,0); the dark rule beats `:root[data-theme="dark"]` (0,2,0)
  // the same way.
  return [
    ':root:root{',
    roleLight('--brand', brand),
    action ? roleLight('--brand-fill', action) : '',
    chrome ? chromeBlock(chrome, brand, brandDark) : '',
    '}',
    ':root:root[data-theme="dark"]{',
    roleDark('--brand', brand, brandDark),
    action ? roleDark('--brand-fill', action, actionDark) : '',
    chromeGroundDark ? chromeBlock(chromeGroundDark, brand, brandDark) : '',
    '}',
  ].join('');
}
