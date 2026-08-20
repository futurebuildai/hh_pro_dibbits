# NOTES — DIB-501: serve HH Pro from the Dibbits staging environment (integrated V1, reads only)

Branch `feature/staging-erp-connect`, off `master` at `cccbea6`. Ruling D-088
(staged rollout, `erpReads` first); builds directly on the DIB-480 seam
(NOTES-DIB480.md) and changes none of its shape. This is configuration +
completion of the shipped Stage-1b seam against the REAL staging ERP — not a
redesign.

Everything here was verified against `https://dibbits-staging.gablelbm.com`
on 2026-08-20, and against `hardscapeos_dibbits` `origin/master` at `88b17b1`
(2026-08-19) — DIB-479 (Stage 1a) has merged and is LIVE on staging.

---

## 1. Scope — what this branch does

1. **Env-driven supplier config** (`server/supplier-env.ts` + one line in
   `readConfig`): the supplier block can be armed from three environment
   variables. Sim remains the default when unset — provably, by identity.
2. **One real adapter drift fixed** (`erp-map.ts` `mapUom`): the ERP's UOM
   vocabulary translated instead of ignored. Found by the first live read;
   nothing else drifted (§4).
3. **Live-recorded fixtures + contract tests** (`fixtures-live/`,
   `erp-staging-recorded.test.ts`): NOTES-DIB480 park 10 lands — captures off
   the running staging server, driven through the real adapter in `npm test`.
4. **A live verification suite** (`erp-staging.live.ts`, own config, NOT part
   of `npm test`): the real `ErpSupplier` against the real server, 8/8.
5. **Deploy prep for the Railway service `hhpro-demo`** — env vars pre-set
   (skipDeploys), runbook in §8. **No deploy was triggered from this lane.**

Reads only. `ErpSupplier.writes` is `null`, `AUTH_PATHS` still bounds POSTs to
`/login` + `/token/refresh` at the transport, and the deny-list test still
walks the built object. No write path of any kind was added.

## 2. Config surface

```
HHPRO_SUPPLIER_MODE       'erp' | 'sim'
HHPRO_SUPPLIER_BASE_URL   https://dibbits-staging.gablelbm.com
HHPRO_SUPPLIER_ERP_READS  'true' | 'false'
```

- Overlay point: `readConfig()` (server-side) — the single read path used by
  `adminPlugin.transformIndexHtml` (which BAKES config into `dist/*.html` at
  build time), the dev server's `/api/config`, and `deploy/prod-entry.ts`.
  On the static-hosted Railway service, build time IS the config moment.
- **Unset ⇒ untouched, by reference.** The demo, guide, e2e and every sim
  deployment see a byte-identical config path. Pinned by test.
- **`parseConfig` stays the only validator.** A hostile/mistyped base URL
  costs the mode (downgraded to sim, stage flags forced off) exactly as from
  the config file. The overlay validates nothing itself.
- Only `'true'` arms `erpReads` (fail-closed, same posture as
  `HHPRO_ADMIN_ALLOW_REMOTE`); `'false'` explicitly DISARMS over a config
  file that turned it on — the operator's kill switch.
- Only the supplier block is reachable; branding/assistant/features cannot be
  set through env. Nothing in these variables is a secret — all three values
  are injected into the public HTML by design.
- Proven end to end: `HHPRO_SUPPLIER_MODE=erp HHPRO_SUPPLIER_BASE_URL=… \
  HHPRO_SUPPLIER_ERP_READS=true npm run build` → both `dist/index.html` and
  `dist/admin.html` carry
  `supplier: {mode:'erp', baseUrl:'https://dibbits-staging.gablelbm.com', stages:{erpReads:true}}`;
  the same build with nothing set carries `mode:'sim', erpReads:false`.

## 3. Auth findings — WORKING demo login, no blocker

- **Staging has a documented, working demo buyer credential.** ERP migration
  `0055_portal_demo_fixtures.sql` is SELF-CONTAINED (it exists precisely
  because staging runs migrations but never `cmd/seed`, so the 0046 UAT user
  is guarded out): customer `df…0001` "Dibbits Demo Contractor", portal user
  **`portal.demo@dibbits.example`**, role `account_admin`, status active,
  bcrypt hash re-asserted on every migrate. **The password is documented in
  that migration's header comment** — deliberately not repeated in this repo;
  it is the ERP repo's documented demo credential, not ours to copy around.
  (`0046`'s `uat.tester@quintehardscapes.example` does NOT exist on staging —
  its guard requires the seed-only Quinte customer.)
- **Verified live:** `POST /api/portal/v1/login` with that credential → 200
  `{token, user, config}`; all eleven Stage-1 reads then answer 200 with the
  bearer; `POST /token/refresh` → 200 with `expires_at` (12h sliding) and
  `session_expires_at` (login + 7d ceiling). Anonymous read → 401
  `{"error":"unauthorized"}`; made-up id → 404 `{"error":"not found"}`.
- **C-1 confirmed on the live wire:** the login response still carries NO
  `expires_at` — only refresh does. The adapter's `expiresAt: null` after
  login stands, as does the DIB-480 park asking for the one-field ERP fix.
- **`GET /me` carries the resolved capability map on staging** (the DIB-479
  extension) — the adapter's second-request-at-login design works unmodified.
- Transport wiring: unchanged from DIB-480 and correct against the live
  server — Bearer per request, 401 drops the session (never sim-fallback),
  the two auth routes are the only POSTs the client will emit.

## 4. Endpoint shape confirmation (drift audit)

Every Stage-1a wire struct re-read on ERP `origin/master@88b17b1` AND
exercised live. Matching, no adapter change needed: `LoginResponse`,
`RefreshResponse`, `MeResponse` (+`Capabilities`, now nine fields incl. the
OR-2 roles `buyer_no_pay`/`ap_finance` in the DB CHECK), `Config`,
`CatalogSearchResponse`/`CatalogResult`, `DashboardResponse`,
`BillingSummaryResponse`, `customer.Account`, `order.Order/Line/Detail`,
`billing.Invoice`, `quote.Quote/Detail`, `httpx.Page[T]`, error envelope.
Order/quote status CHECK sets match the mapper's tables (incl. `READY`'s
fulfillment-dependent read).

**One real drift, fixed:** the ERP prices in its own `uoms` table (migration
0002): `PC, EA, LYR, PLT, BOX, BAG, SF, M2, LF, KG, T, CYD`. The old `mapUom`
recognised only HH Pro's spellings, so live paver hits (`PC`) and sand
(`BAG`, `T`) all mapped to `baseUom: null`. New translation table maps exact
1:1 units only — `PC→EA, BAG→BG, BOX→BX, T→TON, CYD→CY` — and anything
needing a CONVERSION stays null (`M2` is not `SF`, `KG` is not `TON`, `LYR`
has no analogue). Pinned to the real staging SKUs in the recorded tests.

Live-wire facts now pinned by fixtures that the struct-derived set never
carried: `#`-prefixed document numbers (`#SO-TRT-43`, `#INV-30`, `#Q-4`),
`INVOICED`+`PICKUP` orders with Go zero `requested_date`, `PAID` invoices
with zero balance and order links, DRAFT/ACCEPTED quotes, nanosecond-precision
refresh instants.

## 5. Verification evidence

- **Transport proof (curl):** login 200; `/me`, `/config`, `/dashboard`,
  `/billing/summary`, `/catalog/search`, `/orders[?/{id}]`,
  `/invoices[?/{id}]`, `/quotes[?/{id}]` all 200 with real data; refresh 200
  with both instants; 401/404 shapes as above. Excerpts live on as
  `fixtures-live/*.json` (tokens redacted — the ONLY edit).
- **Adapter proof (the real code, live):**
  `HHPRO_LIVE_PASSWORD=… npx vitest run --config vitest.live.config.ts` →
  **8/8**, full output in `verification/DIB-501-live-run-2026-08-20.txt` —
  real catalog hits with translated UOMs, the account money facts agreeing
  across dashboard and billing summary, mapped orders/invoices/quotes, C-1,
  refresh instants, 404 posture. That file contains no credential and no
  token (checked mechanically).
- **Flag-ON browser boot:** env-armed production build served locally and
  driven in Chromium at 390px — `window.__HHPRO_CONFIG__.supplier` reads
  `mode:'erp', erpReads:true`, app renders, **zero console/page errors**.
  Screenshot: `verification/DIB-501-flag-on-boot-390px.png`. (The board still
  shows sim data — PARK 1 of DIB-480: nothing binds the reads to the UI until
  Stage 1c. The flip is deliberately inert to contractors; see §8.)
- Chromium in this environment cannot TLS through the egress proxy, so the
  browser was pointed only at localhost; all staging traffic went through
  curl/Node. (A TLS-terminating local proxy was not needed since nothing in
  the flag-on page calls the ERP yet — see PARK 1.)

## 6. Suite arithmetic — exactly additive

| | files | tests |
|---|---|---|
| Baseline (`master@cccbea6`, this env) | 31 | **451** |
| This branch (`npm test`) | 33 | **476** |
| Added | +2 | **+25** = 11 (`server/__tests__/supplier-env.test.ts`) + 14 (`erp-staging-recorded.test.ts`) |

No existing test file was edited; no existing fixture was touched (live
captures are a NEW sibling directory). The live suite (8 tests) runs under
`vitest.live.config.ts` only and is deliberately outside `npm test` — it
needs a server and a credential.

Gates on the final tree: `npm run typecheck` clean · `npm test` 476/476
(includes the architecture test, untouched and green) · `npm run build` clean
· `npm run check` clean, no reformatting. `npm run e2e`/`a11y` were NOT run
here: they require branded Chrome (`channel:'chrome'`), which this
environment lacks; the change is flag-off inert (proven by identity + tests)
and the flag-on boot was walked manually above. Worth a normal e2e pass on a
machine with Chrome before the gate if the supervisor wants belt and braces.

## 7. Mutation ledger

Each mutation introduced, watched fail, reverted; suite re-green after each.

| # | Mutation | Test(s) that died |
|---|---|---|
| 1 | `applySupplierEnv`: any non-empty `HHPRO_SUPPLIER_ERP_READS` arms the flag (`erpReads: true` unconditionally) | `supplier-env > only 'true' arms the flag …` AND `> …'false' disarms the flag over a file that turned it on` (2 failed) |
| 2 | `applySupplierEnv`: drop the no-env identity return (always rebuild the object) | `supplier-env > returns the input BY REFERENCE when no supplier variable is set` |
| 3 | `mapUom`: `PC → 'PLT'` (a piece read as a pallet — the expensive wrong number) | `live capture — the ERP UOM vocabulary > reads a PC paver as each…` AND `> reads tonnes, bags and pieces off the real sand search` (2 failed) |
| 4 | `readConfig`: unhook `applySupplierEnv` (env silently ignored) | `readConfig with the environment set > serves the env-armed supplier block through the real read path` |

Mutation 4 is the one worth reading: the pure-function tests all stay green
under it — only the integration test through the real read path catches an
overlay that exists but is never called, which is exactly the failure mode a
"wired everything, forgot one line" review would miss.

## 8. Gate-day runbook — the Railway flip (supervisor's gate)

**Current state, verified 2026-08-20:**
- Service `hhpro-demo` (id `227a09b8-376d-49f3-adaa-84aff550ceb4`), project
  `hhpro-staging` (`4ec19557-81ad-4fc4-a100-68742c78b98a`), environment
  `production` (`953831b3-e58f-47fd-adfb-17883cd1f376`), auto-deploys from
  `futurebuildai/hh_pro_dibbits` `master`.
- Build command: `npm install --no-audit --no-fund && npm run build`
  (already the npm-install pattern — `npm ci` breaks on Railway's cache
  mount; do not "fix" it back). Start: `npx -y serve@latest dist -s -l $PORT`
  (pure static). Domain: `hhpro-demo-production.up.railway.app`.
- **The three variables are ALREADY SET on the service** (this lane set them
  with `skipDeploys: true`; verified no deployment was created — latest is
  still 2026-08-19):
  - `HHPRO_SUPPLIER_MODE` = `erp`
  - `HHPRO_SUPPLIER_BASE_URL` = `https://dibbits-staging.gablelbm.com`
  - `HHPRO_SUPPLIER_ERP_READS` = `true`
  They are inert against current `master` (which has no overlay code), so the
  merge itself is the flip.

**The flip:**
1. Merge `feature/staging-erp-connect` → `master` (supervisor's gate).
   Railway auto-builds; the build reads the pre-set variables and bakes
   `mode:'erp' + erpReads:true` into the HTML.
2. Post-deploy check (no CLI needed):
   `curl -s https://hhpro-demo-production.up.railway.app/ | grep -o '"supplier":{[^}]*}[^}]*}'`
   → must show `"mode":"erp"`, the staging base URL, `"erpReads":true`.
3. Behavioural expectation: **visibly nothing changes.** Boot constructs the
   `ErpSupplier` (flag-on boot walked in §5); the board still renders sim
   data because Stage 1c (login screen + store hydration + read-only
   affordance) is not built — DIB-480 PARK 1. This flip proves the deployment
   path and arms the seam; it ships no contractor-visible ERP data yet.

**Rollback** (either, both non-secret):
- `variableCollectionUpsert` same ids with
  `variables: { HHPRO_SUPPLIER_ERP_READS: "false" }` and redeploy — mode
  stays configured, reads disarmed (the narrower switch, by design); or
- `variableDelete` all three and redeploy — full sim.

Raw GraphQL that was used (works with the workspace token where the Railway
CLI refuses it; endpoint `https://backboard.railway.app/graphql/v2`, header
`Authorization: Bearer <RAILWAY_TOKEN>` — token by NAME, from the secrets
vault):

```graphql
mutation {
  variableCollectionUpsert(input: {
    projectId: "4ec19557-81ad-4fc4-a100-68742c78b98a",
    environmentId: "953831b3-e58f-47fd-adfb-17883cd1f376",
    serviceId: "227a09b8-376d-49f3-adaa-84aff550ceb4",
    skipDeploys: true,
    variables: {
      HHPRO_SUPPLIER_MODE: "erp",
      HHPRO_SUPPLIER_BASE_URL: "https://dibbits-staging.gablelbm.com",
      HHPRO_SUPPLIER_ERP_READS: "true"
    }
  })
}
```

## 9. The finding that gates Stage 1c: the ERP serves no CORS

The staging ERP (Caddy → Go) has **no CORS middleware anywhere** (verified in
source and live: `OPTIONS /api/portal/v1/login` with an Origin +
`Access-Control-Request-*` headers → `405`, zero `Access-Control-*` response
headers). A browser on `hhpro-demo-production.up.railway.app` therefore
CANNOT call `dibbits-staging.gablelbm.com` — every authorized request
preflights (Authorization header) and dies there.

**This does not block THIS flip** — nothing browser-side calls the ERP until
Stage 1c binds the reads to the UI (PARK 1). It is the first hard dependency
of 1c, and it needs a ruling:

- **Recommended: ERP-side CORS for `/api/portal/v1/*` only**, explicit origin
  allowlist (the Railway domain + any future portal domain), allow headers
  `Authorization, Content-Type`, methods `GET, POST, PUT, DELETE`, no
  credentials mode needed (bearer, not cookies). Small, additive, and it
  keeps the portal API the single seam. Needs an ERP lane + deploy train —
  file the ticket when 1c is cut.
- Alternative: serve HH Pro same-origin behind the ERP's Caddy (a
  `handle /portal/*` vhost block or subdomain on gablelbm.com), or add a
  `/api/portal/*` reverse-proxy to HH Pro's own serving layer (requires
  changing the Railway start command off pure static — supervisor-gated).

The live suite in this repo (§5) is unaffected — Node has no CORS — which is
exactly why it exists as the verification arm.

## 10. Parks

1. **Stage 1c is the next ticket**: login screen, `sessionStorage`
   `TokenStore` (shell-side), store hydration from `reads.*`, the read-only
   board affordance — and the CORS ruling above before any of it can talk.
2. **C-1 still open ERP-side**: `LoginResponse` still lacks
   `expires_at`/`session_expires_at` on master (confirmed live). One field
   pair, computed exactly as `Refresh` does.
3. **e2e/a11y on a Chrome machine** before or at the gate if wanted (§6).
4. **`fixtures-live` will age**: staging accumulates data (a quote and two
   orders appeared between yesterday and today). The captures are pinned
   history, not a mirror — re-record at will with the §5 commands; the live
   suite asserts shapes, not counts, for exactly this reason.
5. **`.hhpro`-hosted deployments with an open admin console**: on a host
   where BOTH the env overlay and the admin console are live, a console save
   persists the env-overlaid supplier block into `config.json`. Documented at
   the overlay; harmless on every current deployment (Railway has no admin
   mounted, the droplet path is static too), but worth remembering if the
   admin console ever ships to a dealer host that also sets HHPRO_SUPPLIER_*.
6. **`package-lock.json` still says `lumbernow`** — pre-existing park, left
   alone again.
