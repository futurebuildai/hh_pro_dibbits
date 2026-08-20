/**
 * Environment-driven supplier configuration (DIB-501).
 *
 * The Railway staging service (`hhpro-demo`) builds with `npm run build` and
 * serves `dist/` as static files — there is no admin console and no `.hhpro/`
 * directory on that host. The only lever an operator has is environment
 * variables, which are present at BUILD time when `adminPlugin.
 * transformIndexHtml` bakes the dealer config into `dist/*.html`. This module
 * is that lever: it overlays the SUPPLIER block of the stored config from
 * three env vars, so pointing a deployment at a real ERP is a service-variable
 * change plus a redeploy, never a code change.
 *
 *   HHPRO_SUPPLIER_MODE       'erp' | 'sim'
 *   HHPRO_SUPPLIER_BASE_URL   e.g. https://dibbits-staging.gablelbm.com
 *   HHPRO_SUPPLIER_ERP_READS  'true' | 'false'   (spec §7.3 Stage 1 flag)
 *
 * Four properties, each load-bearing:
 *
 * 1. **Unset means untouched.** With none of the three variables set this
 *    function returns its input BY REFERENCE, so every deployment that has
 *    never heard of these variables — the demo, the guide capture, the e2e
 *    suite, every dealer evaluating in sim mode — is byte-identical to before
 *    this module existed. Sim stays the default the way it always has: by the
 *    config simply not saying otherwise.
 * 2. **This is an overlay, not a validator.** The merged raw object still goes
 *    through `parseConfig`, which is the single gate: a hostile or mistyped
 *    base URL costs the MODE (downgraded to sim, stage flags off) exactly as
 *    it would coming from the config file, and `usesErpReads` still requires
 *    both `mode:'erp'` and `stages.erpReads` before an adapter is built.
 *    Re-implementing validation here would be a second authority.
 * 3. **Only the supplier block is reachable.** Branding, the assistant, and
 *    feature flags cannot be set through this path — the overlay copies three
 *    named values and nothing else, so a compromised build environment cannot
 *    repaint the shell or lift the spend cap through it.
 * 4. **Nothing here is a secret.** The mode, the base URL and the stage flag
 *    are all injected into the public HTML by design (DealerConfig is the
 *    PUBLIC store). The bearer credential this connection ultimately uses is a
 *    contractor's own login at runtime; no token, key or password has any
 *    representation in these variables.
 */

export interface SupplierEnvSource {
  HHPRO_SUPPLIER_MODE?: string | undefined;
  HHPRO_SUPPLIER_BASE_URL?: string | undefined;
  HHPRO_SUPPLIER_ERP_READS?: string | undefined;
}

/** Is any supplier variable present (non-empty) in this environment? */
export function hasSupplierEnv(env: SupplierEnvSource): boolean {
  return Boolean(
    (env.HHPRO_SUPPLIER_MODE ?? '').trim() ||
      (env.HHPRO_SUPPLIER_BASE_URL ?? '').trim() ||
      (env.HHPRO_SUPPLIER_ERP_READS ?? '').trim(),
  );
}

/**
 * Overlays the supplier block of a RAW (pre-parse) config object with the
 * environment's answer. Returns the input unchanged when the environment says
 * nothing. The result is untrusted by construction and must go through
 * `parseConfig` — see property 2 above.
 */
export function applySupplierEnv(raw: unknown, env: SupplierEnvSource): unknown {
  if (!hasSupplierEnv(env)) return raw;

  const base = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const supplier =
    typeof base.supplier === 'object' && base.supplier !== null
      ? (base.supplier as Record<string, unknown>)
      : {};
  const stages =
    typeof supplier.stages === 'object' && supplier.stages !== null
      ? (supplier.stages as Record<string, unknown>)
      : {};

  const mode = (env.HHPRO_SUPPLIER_MODE ?? '').trim().toLowerCase();
  const baseUrl = (env.HHPRO_SUPPLIER_BASE_URL ?? '').trim();
  const erpReads = (env.HHPRO_SUPPLIER_ERP_READS ?? '').trim().toLowerCase();

  return {
    ...base,
    supplier: {
      ...supplier,
      // Only the two known modes pass through; any other spelling leaves the
      // stored value standing rather than inventing a third state for
      // parseConfig to guess at.
      ...(mode === 'erp' || mode === 'sim' ? { mode } : {}),
      ...(baseUrl !== '' ? { baseUrl } : {}),
      stages: {
        ...stages,
        // 'true' is the only spelling that arms a stage flag — the same
        // fail-closed posture HHPRO_ADMIN_ALLOW_REMOTE already takes. 'false'
        // (or anything else non-empty) explicitly disarms, so an operator can
        // hold the flag off over a config file that turned it on.
        ...(erpReads !== '' ? { erpReads: erpReads === 'true' } : {}),
      },
    },
  };
}
