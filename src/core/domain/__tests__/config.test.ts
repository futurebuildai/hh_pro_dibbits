import { describe, expect, it } from 'vitest';
import type { DealerBranding } from '../config';
import {
  DEFAULT_CONFIG,
  MAX_TOKENS_LIMIT,
  brandingCss,
  isValidColor,
  isValidLogo,
  parseConfig,
} from '../config';

/** The ink `onColorFor` prints on a light fill — the platform --text VALUE, inlined. */
const INK = 'oklch(21% 0.02 260)';

/** Every colour role a dealer may set. A seventh cannot be added without a hostile case. */
const COLOUR_FIELDS = [
  'brandColor',
  'brandColorDark',
  'actionColor',
  'actionColorDark',
  'chromeColor',
  'chromeColorDark',
] as const satisfies readonly (keyof DealerBranding)[];

/** Every colour role except the required identity one. */
const OPTIONAL_COLOUR_FIELDS = COLOUR_FIELDS.filter((field) => field !== 'brandColor');

const ATTACK = 'red; } body { display:none } .x {';

/**
 * Dealer config validation.
 *
 * The security-relevant assertions are the colour and logo ones: those values
 * are interpolated into a stylesheet and an <img src>, so an unvalidated string
 * is CSS injection or a third-party beacon. Everything else is about a partial
 * or hostile payload never leaving the app in a broken state.
 */

describe('colour validation', () => {
  it('accepts the forms the admin UI produces', () => {
    for (const good of ['#1E40AF', '#abc', 'oklch(52% 0.19 255)', 'oklch(52.5% 0.1 20)']) {
      expect(isValidColor(good), good).toBe(true);
    }
  });

  /** Each of these would rewrite the page, including the platform token layer. */
  it('refuses anything that could break out of the declaration', () => {
    for (const attack of [
      'red; } body { display: none } .x {',
      'oklch(52% 0.19 255); } :root { --surface: black',
      'url(https://evil.example/beacon.png)',
      'var(--surface)',
      'expression(alert(1))',
      '#12345',
      'rgb(1,2,3)',
      '',
    ]) {
      expect(isValidColor(attack), attack).toBe(false);
    }
  });

  /**
   * Table-driven over EVERY colour role, deliberately. One settable colour grew
   * into six, and a per-field check is the only shape in which adding a seventh
   * without a hostile case is impossible — `COLOUR_FIELDS` is typed against
   * `DealerBranding`, so the list and the type cannot drift apart quietly.
   */
  it.each(COLOUR_FIELDS)('never emits an unvalidated %s into the stylesheet', (field) => {
    // A hand-edited config file is untrusted too, so brandingCss re-checks.
    const css = brandingCss({
      ...DEFAULT_CONFIG,
      branding: { ...DEFAULT_CONFIG.branding, [field]: ATTACK },
    });
    expect(css).not.toContain('display:none');
    expect(css).not.toContain('body {');
    // The identity colour always renders something; a hostile one falls back.
    expect(css).toContain('--brand:');
  });

  it.each(COLOUR_FIELDS)('drops a hostile %s at the parse boundary', (field) => {
    const result = parseConfig({ branding: { [field]: ATTACK } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.branding[field] ?? '').not.toContain('display:none');
    expect(JSON.stringify(result.value)).not.toContain('display:none');
  });

  /**
   * What a rejected OPTIONAL colour falls back to — a different question from
   * whether the hostile string survived.
   *
   * `brandColor` is required and falls back to the default. The five optional
   * roles fall back to NOTHING once the payload has supplied a `branding`
   * block: the role is unset, and `brandingCss` then omits or derives it.
   *
   * Inheriting `DEFAULT_CONFIG`'s value would be worse than it sounds, because
   * `DEFAULT_CONFIG` is the DEMO TENANT. A dealer who typos their action
   * colour would silently be handed the demo dealer's gold; one who sets no
   * dark identity would have their brand become the demo dealer's blue the
   * moment a contractor switched to dark mode. A dealer's mistake must cost
   * them that role, never hand them someone else's brand.
   */
  it.each(OPTIONAL_COLOUR_FIELDS)(
    'leaves %s unset rather than inheriting the demo tenant',
    (field) => {
      const result = parseConfig({ branding: { brandColor: '#123456', [field]: ATTACK } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.branding[field]).toBeUndefined();
      expect(result.value.branding.brandColor).toBe('#123456');
    },
  );

  it('a dealer who configures only an identity colour gets no other tenant', () => {
    const result = parseConfig({
      branding: { companyName: 'Copps Buildall', brandColor: '#123456' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const css = brandingCss(result.value);

    expect(css).toContain('--brand:#123456');
    expect(css).not.toContain('--brand-fill');
    expect(css).not.toContain('--brand-chrome');
    for (const demoTenantValue of ['#FFC313', '#0B2338', '#86BDF6', '#14497B']) {
      expect(css).not.toContain(demoTenantValue);
    }
  });

  it('falls back to the default identity colour when the dealer\u2019s is hostile', () => {
    const css = brandingCss({
      ...DEFAULT_CONFIG,
      branding: { ...DEFAULT_CONFIG.branding, brandColor: ATTACK },
    });
    expect(css).toContain(DEFAULT_CONFIG.branding.brandColor);
  });

  /**
   * The bundler injects theme.css AFTER the branding tag in dev, so a plain
   * `:root` selector loses the cascade and the dealer's colour never applies.
   * It has to win on specificity instead of on order.
   */
  it('outranks the stylesheet it has to override', () => {
    const css = brandingCss(DEFAULT_CONFIG);
    expect(css).toContain(':root:root{');
    expect(css).toContain(':root:root[data-theme="dark"]');
    expect(css).not.toMatch(/(^|})\s*:root\{/);
  });

  /**
   * The `--brand` prefix IS the contract (`docs/brand-tokens.md`).
   *
   * This used to be four "must not contain" assertions — `--surface`, `--text`,
   * `--stage-`, `--danger` — the platform layer a dealer may never write. Those
   * four are now CONSEQUENCES of the allowlist rather than the whole check: a
   * denylist has to be extended every time the platform gains a token, and the
   * one it is missing is the one that gets written. The allowlist also catches
   * the subtler failure, which is naming a platform token inside a VALUE:
   * `var(--text)` would resolve against whichever theme the viewer ends up in,
   * the exact opposite polarity of the ink that was chosen.
   *
   * The match is over every `--…` sequence in the string, not just the ones in
   * property position, so a reference in a value cannot slip past.
   */
  it('only ever writes dealer-layer tokens', () => {
    const css = brandingCss(DEFAULT_CONFIG);
    const tokens = css.match(/--[a-zA-Z0-9-]+/g) ?? [];

    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(token, `${token} is not a dealer-layer token`).toMatch(/^--brand(-|$)/);
    }
    expect(css).toContain('--brand:');
    // The originals, kept explicit so the intent survives the generalisation.
    for (const platformToken of ['--surface', '--text', '--stage-', '--danger']) {
      expect(css).not.toContain(platformToken);
    }
  });
});

/**
 * The three roles one `brandColor` used to conflate: identity as TEXT, the
 * pressable FILL, and the SHELL ground. See `docs/brand-tokens.md`.
 */
describe('the brand roles', () => {
  /**
   * Rule 1 of the emitter, and the reason the whole change is safe to ship:
   * a dealer who set only a brand colour renders exactly what they render
   * today. theme.css's `--brand-fill: var(--brand)` stands, and the shell
   * stays white, because nothing was written over them.
   */
  it('emits nothing for a role the dealer did not set', () => {
    const css = brandingCss({
      ...DEFAULT_CONFIG,
      branding: { companyName: 'Cascade Supply', brandColor: '#1E40AF' },
    });

    expect(css).not.toContain('--brand-fill');
    expect(css).not.toContain('--brand-chrome');
    expect(css).toContain('--brand:#1E40AF;');
  });

  /**
   * The live bug this split exists to fix. `#E8A74E` is the colour the recorded
   * staging ERP actually serves, and white on it is 2.09:1 — less than half the
   * AA bar, on a control's own label. The ink is a calculation, not a default.
   */
  it('prints ink on a mid-gold identity, not white', () => {
    const css = brandingCss({
      ...DEFAULT_CONFIG,
      branding: { companyName: 'Cascade Supply', brandColor: '#E8A74E' },
    });

    expect(css).toContain(`--brand-on:${INK};`);
    expect(css).not.toContain('--brand-on:oklch(100% 0 0)');
  });

  /** Gold does not invert: an explicit dark value is emitted as-is. */
  it('keeps an explicit dark action colour instead of washing it toward white', () => {
    const css = brandingCss(DEFAULT_CONFIG);
    const dark = css.slice(css.indexOf(':root:root[data-theme="dark"]'));

    expect(dark).toContain(`--brand-fill:${DEFAULT_CONFIG.branding.actionColorDark};`);
    expect(dark).toContain(`--brand-fill-on:${INK};`);
  });

  /**
   * A dark chrome island in a light page uses the DARK theme's dealer colour on
   * its links — which is why there is no separate "sidebar link" field to fall
   * out of step with the identity.
   */
  it('borrows the opposite theme\u2019s accent for the chrome', () => {
    const onDarkChrome = brandingCss(DEFAULT_CONFIG);
    expect(onDarkChrome).toContain(
      `--brand-chrome-accent:${DEFAULT_CONFIG.branding.brandColorDark};`,
    );

    const onLightChrome = brandingCss({
      ...DEFAULT_CONFIG,
      branding: { ...DEFAULT_CONFIG.branding, chromeColor: '#FFFFFF', chromeColorDark: '#FFFFFF' },
    });
    expect(onLightChrome).toContain(`--brand-chrome-accent:${DEFAULT_CONFIG.branding.brandColor};`);
    expect(onLightChrome).toContain(`--brand-chrome-on:${INK};`);
  });

  /**
   * A fill in the dead zone (`#808080` is in it) has no legible ink at all, so
   * the identity colour stands in rather than shipping a label that fails an
   * audit while looking fine in a review. The gate is on the FILL only —
   * `mapBranding()` never runs parseConfig, so gating the identity colour would
   * let an ERP colour through one door and be refused at the other.
   */
  it('refuses an action fill nothing legible can be printed on', () => {
    const result = parseConfig({
      branding: { brandColor: '#14497B', actionColor: '#808080' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.branding.actionColor).toBe('#14497B');
  });

  it('does not apply that gate to the identity colour', () => {
    const result = parseConfig({ branding: { brandColor: '#808080' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.branding.brandColor).toBe('#808080');
  });
});

describe('logo validation', () => {
  it('accepts a same-origin path or an inline image', () => {
    expect(isValidLogo('/images/brands/gable.png')).toBe(true);
    expect(isValidLogo('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isValidLogo('')).toBe(true);
  });

  /** A remote logo beacons every contractor visit and can be swapped later. */
  it('refuses a remote URL or a protocol-relative one', () => {
    for (const bad of [
      'https://evil.example/logo.png',
      '//evil.example/logo.png',
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
    ]) {
      expect(isValidLogo(bad), bad).toBe(false);
    }
  });
});

describe('parsing an untrusted payload', () => {
  /**
   * Deep equality, not a spot check. Every optional branding field is spread
   * conditionally (`...(x ? {x} : {})`) rather than written as an explicit
   * `undefined`, and the two logo fields have NO default at all — parseConfig
   * hardcodes `''` as their fallback and never reads DEFAULT_CONFIG, so a
   * default logo would be silently dropped by every parse and would fail here.
   */
  it('fills every field from defaults when given nothing', () => {
    const result = parseConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(DEFAULT_CONFIG);
    expect(result.value.branding.logoUrl).toBeUndefined();
    expect(result.value.branding.logoDarkUrl).toBeUndefined();
  });

  it('refuses a non-object', () => {
    expect(parseConfig(null).ok).toBe(false);
    expect(parseConfig('nope').ok).toBe(false);
  });

  /**
   * A bad field costs that field, not the whole config. Rejecting outright
   * meant one hand-edited colour silently reverted EVERY setting to defaults —
   * lifting the dealer's spend cap and re-enabling every feature flag. The
   * security property is unchanged: the hostile string never survives.
   */
  it('drops a hostile colour without discarding the rest of the config', () => {
    const result = parseConfig({
      branding: { companyName: 'Cascade Supply', brandColor: 'red; } body { display:none } .x {' },
      assistant: { dailyRequestCap: 500 },
      features: { payments: false },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.branding.brandColor).toBe(DEFAULT_CONFIG.branding.brandColor);
    expect(JSON.stringify(result.value)).not.toContain('display:none');
    // Everything else survived — this is the part that used to be lost.
    expect(result.value.branding.companyName).toBe('Cascade Supply');
    expect(result.value.assistant.dailyRequestCap).toBe(500);
    expect(result.value.features.payments).toBe(false);
  });

  it('drops a remote logo without discarding the rest', () => {
    const result = parseConfig({
      branding: { companyName: 'Cascade Supply', logoUrl: 'https://evil.example/logo.png' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.branding.logoUrl).toBeUndefined();
    expect(result.value.branding.companyName).toBe('Cascade Supply');
  });

  it('rounds values the API requires to be whole numbers', () => {
    const result = parseConfig({ assistant: { maxTokens: 8192.7, dailyRequestCap: 10.4 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A fractional max_tokens fails every request upstream with a 400 the
    // contractor can do nothing about.
    expect(Number.isInteger(result.value.assistant.maxTokens)).toBe(true);
    expect(Number.isInteger(result.value.assistant.dailyRequestCap)).toBe(true);
  });

  it('clamps numbers into ranges that cannot break the proxy or the ledger', () => {
    const result = parseConfig({
      assistant: { maxTokens: 5_000_000, dailyRequestCap: -20 },
      supplier: { termsDays: 9999, cardFeePercent: 400 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assistant.maxTokens).toBe(MAX_TOKENS_LIMIT);
    expect(result.value.assistant.dailyRequestCap).toBe(0);
    expect(result.value.supplier.termsDays).toBe(365);
    expect(result.value.supplier.cardFeePercent).toBe(10);
  });

  it('ignores a model the proxy would refuse', () => {
    const result = parseConfig({ assistant: { model: 'gpt-4' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assistant.model).toBe(DEFAULT_CONFIG.assistant.model);
  });

  it('keeps feature flags boolean and complete', () => {
    const result = parseConfig({ features: { assistant: false, nonsense: true } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.features.assistant).toBe(false);
    expect(result.value.features.payments).toBe(true);
    expect('nonsense' in result.value.features).toBe(false);
  });

  /**
   * The config type has no field for a credential, so a payload trying to
   * smuggle one through cannot land it anywhere.
   */
  it('drops anything resembling a secret', () => {
    const result = parseConfig({
      apiKey: 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaa',
      assistant: { hasCredential: true, apiKey: 'sk-ant-api03-bbbbbbbbbbbbbbbbbbbbbbb' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain('sk-ant');
    expect(result.value.assistant.hasCredential).toBeUndefined();
  });

  it('caps house rules so the system prompt cannot be flooded', () => {
    const result = parseConfig({ assistant: { houseRules: 'x'.repeat(50_000) } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assistant.houseRules.length).toBeLessThanOrEqual(2_000);
  });
});
