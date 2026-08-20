import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, parseConfig } from '../../src/core/domain/config';
import { usesErpReads } from '../../src/core/supplier/index';
import { readConfig } from '../admin-store';
import { applySupplierEnv, hasSupplierEnv } from '../supplier-env';

/**
 * The env-driven supplier overlay (DIB-501).
 *
 * The property under test is the deployment story: on a static host (the
 * Railway staging service) the ONLY lever is environment variables at build
 * time, and this overlay is how they reach the supplier seam. The tests run
 * the overlay's output through the real `parseConfig` and the real
 * `usesErpReads`, because the overlay's contract is precisely that it is NOT
 * a validator — the existing gates must still decide.
 */

const STAGING_ENV = {
  HHPRO_SUPPLIER_MODE: 'erp',
  HHPRO_SUPPLIER_BASE_URL: 'https://dibbits-staging.gablelbm.com',
  HHPRO_SUPPLIER_ERP_READS: 'true',
};

function parsed(raw: unknown) {
  const result = parseConfig(raw);
  if (!result.ok) throw new Error(`parseConfig refused: ${result.error}`);
  return result.value;
}

describe('applySupplierEnv', () => {
  it('returns the input BY REFERENCE when no supplier variable is set', () => {
    // Identity, not just equality: the no-env path must be provably untouched,
    // because it is every deployment that existed before this module did.
    const raw = { branding: { companyName: 'Someone Else' } };
    expect(applySupplierEnv(raw, {})).toBe(raw);
    expect(applySupplierEnv(raw, { HHPRO_SUPPLIER_MODE: '  ' })).toBe(raw);
    expect(hasSupplierEnv({})).toBe(false);
  });

  it('with nothing set, sim stays the default the config has always had', () => {
    const config = parsed(applySupplierEnv({}, {}));
    expect(config.supplier.mode).toBe('sim');
    expect(config.supplier.stages.erpReads).toBe(false);
    expect(usesErpReads(config.supplier)).toBe(false);
  });

  it('the staging triple arms the ERP read adapter end to end', () => {
    const config = parsed(applySupplierEnv({}, STAGING_ENV));
    expect(config.supplier.mode).toBe('erp');
    expect(config.supplier.baseUrl).toBe('https://dibbits-staging.gablelbm.com');
    expect(config.supplier.stages.erpReads).toBe(true);
    expect(usesErpReads(config.supplier)).toBe(true);
  });

  it('erpReads alone, with no mode and no base URL, arms nothing', () => {
    // The stage flag is the NARROWER switch (spec §7.2): a flag pointed at
    // nothing must not produce an adapter, however it was set.
    const config = parsed(applySupplierEnv({}, { HHPRO_SUPPLIER_ERP_READS: 'true' }));
    expect(config.supplier.mode).toBe('sim');
    expect(config.supplier.stages.erpReads).toBe(false);
    expect(usesErpReads(config.supplier)).toBe(false);
  });

  it('a hostile base URL costs the mode, exactly as it would from the file', () => {
    const config = parsed(
      applySupplierEnv(
        {},
        { ...STAGING_ENV, HHPRO_SUPPLIER_BASE_URL: 'javascript:alert(1)' /* not http(s) */ },
      ),
    );
    expect(config.supplier.mode).toBe('sim');
    expect(config.supplier.baseUrl).toBeUndefined();
    expect(usesErpReads(config.supplier)).toBe(false);
  });

  it("HHPRO_SUPPLIER_ERP_READS='false' disarms the flag over a file that turned it on", () => {
    const file = {
      supplier: {
        mode: 'erp',
        baseUrl: 'https://dibbits-staging.gablelbm.com',
        stages: { erpReads: true },
      },
    };
    const config = parsed(applySupplierEnv(file, { HHPRO_SUPPLIER_ERP_READS: 'false' }));
    expect(config.supplier.mode).toBe('erp');
    expect(config.supplier.stages.erpReads).toBe(false);
    expect(usesErpReads(config.supplier)).toBe(false);
  });

  it("only 'true' arms the flag — 'TRUE ', '1', 'yes' all fail closed to off", () => {
    for (const spelling of ['1', 'yes', 'on', 'True ']) {
      const config = parsed(
        applySupplierEnv({}, { ...STAGING_ENV, HHPRO_SUPPLIER_ERP_READS: spelling }),
      );
      // 'True ' trims+lowercases to 'true' and arms; the rest must not.
      expect(config.supplier.stages.erpReads).toBe(spelling.trim().toLowerCase() === 'true');
    }
  });

  it('an unknown mode spelling leaves the stored mode standing', () => {
    const file = { supplier: { mode: 'sim' } };
    const overlaid = applySupplierEnv(file, {
      HHPRO_SUPPLIER_MODE: 'both',
      HHPRO_SUPPLIER_BASE_URL: 'https://dibbits-staging.gablelbm.com',
    }) as { supplier: { mode?: string } };
    expect(overlaid.supplier.mode).toBe('sim');
  });

  it('reaches ONLY the supplier block — branding, assistant and features pass through', () => {
    const file = {
      branding: { companyName: 'Copps Buildall', brandColor: '#123456' },
      assistant: { dailyRequestCap: 40 },
      features: { payments: false },
    };
    const config = parsed(applySupplierEnv(file, STAGING_ENV));
    expect(config.branding.companyName).toBe('Copps Buildall');
    expect(config.branding.brandColor).toBe('#123456');
    expect(config.assistant.dailyRequestCap).toBe(40);
    expect(config.features.payments).toBe(false);
    // And the overlay carries nothing the env did not say.
    expect(config.supplier.termsDays).toBe(DEFAULT_CONFIG.supplier.termsDays);
  });
});

describe('readConfig with the environment set', () => {
  const NAMES = [
    'HHPRO_SUPPLIER_MODE',
    'HHPRO_SUPPLIER_BASE_URL',
    'HHPRO_SUPPLIER_ERP_READS',
  ] as const;
  const saved = new Map<string, string | undefined>();

  afterEach(() => {
    for (const name of NAMES) {
      const value = saved.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    saved.clear();
  });

  function setEnv(values: Partial<Record<(typeof NAMES)[number], string>>): void {
    for (const name of NAMES) {
      saved.set(name, process.env[name]);
      const next = values[name];
      if (next === undefined) delete process.env[name];
      else process.env[name] = next;
    }
  }

  it('serves the env-armed supplier block through the real read path', () => {
    // This is the exact path the Railway build takes: transformIndexHtml ->
    // readConfig -> (overlay + parseConfig) -> baked into dist/*.html.
    setEnv(STAGING_ENV);
    const config = readConfig();
    expect(config.supplier.mode).toBe('erp');
    expect(config.supplier.baseUrl).toBe('https://dibbits-staging.gablelbm.com');
    expect(config.supplier.stages.erpReads).toBe(true);
    expect(usesErpReads(config.supplier)).toBe(true);
  });

  it('with the variables absent, readConfig still answers sim', () => {
    setEnv({});
    const config = readConfig();
    expect(config.supplier.mode).toBe('sim');
    expect(usesErpReads(config.supplier)).toBe(false);
  });
});
