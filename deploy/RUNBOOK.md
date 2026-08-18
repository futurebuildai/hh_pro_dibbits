# HH Pro staging — deployment runbook

**Target:** `https://hhpro-staging.gablelbm.com`
**Host:** the EXISTING DigitalOcean staging droplet — tor1, `178.128.237.81` — beside `dibbits-staging`
**Decision:** D-085 (2026-08-18, commander-ruled: existing droplet, not Railway, not a new droplet)
**Mode:** SIM/DEMO. No ERP connection. No database. No new cloud resources.

Everything here is additive and reversible. The whole deployment is one directory
under `/opt/hhpro`, one file in `/etc/caddy/conf.d/`, and one `import` line. Removing
those three things returns the droplet to exactly its current state.

> **The rule that governs this document.** `dibbits-staging` shares this droplet and
> serves a live UAT audience. Its `/healthz` must return `200` before and after every
> step. `deploy/staging_apply.sh` enforces that automatically and rolls back on its own
> if it degrades. When you deviate from the script, you inherit that obligation.

---

## Why this was parked, and what is ready

Prepared and verified in a container that **cannot reach the droplet**:

| | Status |
|---|---|
| Build (`npm run build`) | ✅ verified — 1853 modules, `dist/` complete |
| Static serving model | ✅ verified end-to-end against the real `dist/` |
| `deploy/prod-entry.ts` (optional Node entry) | ✅ bundles + runs; routes and path-traversal tested |
| Caddy vhost | ✅ `caddy validate` clean, and every route exercised against a real Caddy |
| systemd unit, apply script, bundle build | ✅ written, syntax-checked, bundle built end-to-end |
| **DNS record** | ⛔ **PARKED** — see §2. No Cloudflare credential available. |
| **Apply to droplet** | ⛔ **PARKED** — no `ssh` binary in the prep container and TCP/22 is blocked. |

Two people-shaped things are needed: a DNS record (§2), and someone with droplet
access to run §4 — or the GitHub Actions path in §4b, which needs no human at a
terminal at all.

---

## 0. What production serving actually needs (read once)

**Pure static. There is no server to run.** This is not a shortcut; it is the correct
answer for this app in demo mode, and it was verified rather than assumed:

1. **Dealer config and brand CSS are compiled into the HTML at build time.**
   `adminPlugin.transformIndexHtml` runs for `vite build`, not just for dev. The built
   `dist/index.html` already contains `window.__HHPRO_CONFIG__` and
   `<style id="ln-dealer-brand">`. The no-flash branding guarantee survives static
   hosting intact. `deploy/build_bundle.sh` asserts this on every build so it cannot
   silently regress.
2. **`/api/config` is never fetched by the client.** It reads the injected global. The
   endpoint exists for the embeddable future only.
3. **The only runtime call the app makes is `GET /api/anthropic/health`**, once at boot,
   to decide whether to render the assistant. The Caddy vhost answers it with a literal
   `{"ok":true,"hasKey":false}`.
4. **State is `localStorage`.** SIM mode needs no database and no backend.

### The AI assistant is deliberately demo-stubbed

The assistant needs an Anthropic key. **Staging gets none, on purpose.** The key is the
*dealer's* credential and is billed to them; putting one on a droplet shared with
`dibbits-staging`, behind a public demo URL, means a leaked link becomes a metered relay
on somebody's real account. The rate limiter and daily cap in `server/claude-proxy.ts`
bound that damage — they do not make it acceptable.

So the health probe answers `hasKey:false` and the app renders its own honest
"no key configured" state. **This is a real UI state the product ships, not an error.**
Running the Node entry would not change this: with no key it returns the same 503. That
is the whole argument for static — the Node process would add a long-running service
next to the co-tenant and buy the demo nothing.

§7 switches the assistant on the day a dealer key exists.

### The admin console is closed on staging

`authorize()` in `server/admin-api.ts` gates remote callers with `isLoopback(req)`, which
reads `req.socket.remoteAddress`. **Behind a reverse proxy that value is always
`127.0.0.1`** — Caddy is the TCP peer, not the visitor. The loopback defence does not
survive this deployment shape, and the admin API would be standing on `HHPRO_ADMIN_TOKEN`
alone. Nothing in the demo needs it, so the vhost 404s `/admin*` at the edge and
`prod-entry.ts` refuses to mount `/api/admin` without an explicit opt-in.

---

## 1. Preconditions

- [ ] SSH access to `root@178.128.237.81` (the `STAGING_SSH_KEY` used by
      `hardscapeos_dibbits/.github/workflows/deploy-staging.yml` is the same key), **or**
      use §4b and never touch a terminal.
- [ ] Ability to add a DNS record for `gablelbm.com` (Cloudflare — see §2).
- [ ] A machine with Node 20+ and this repo checked out, to build the bundle.
- [ ] `dibbits-staging` currently healthy:
      ```
      curl -fsS https://dibbits-staging.gablelbm.com/healthz
      ```
      Expected: `{"status":"ok","db":"up",...}`. **If this is not 200, stop.**

---

## 2. DNS — do this FIRST (currently PARKED)

Caddy starts an ACME certificate order the moment the vhost loads. If the name does not
resolve, the order fails and retries on a backoff, and the deploy cannot be verified.
**DNS before vhost, always.**

### Where DNS lives

`gablelbm.com` is **not** managed by DigitalOcean. Verified from the prep container:

```
GET https://api.digitalocean.com/v2/domains  →  200 {"domains":[],"meta":{"total":0}}
```

The DO API is reachable and the token works — the account simply manages no domains.
Resolution shows **Cloudflare**:

```
gablelbm.com              → 104.21.38.107, 172.67.222.1     (Cloudflare edge)
dibbits-staging.gablelbm.com → 178.128.237.81               (the droplet, DNS-only)
hhpro-staging.gablelbm.com   → NXDOMAIN                     (does not exist yet)
```

No Cloudflare credential is present in the secret store, so this step could not be
automated. **It is a manual action.**

### The record to create

| Field | Value |
|---|---|
| Type | `A` |
| Name | `hhpro-staging` |
| Content | `178.128.237.81` |
| Proxy status | **DNS only (grey cloud)** |
| TTL | Auto |

> **The grey cloud is not optional.** `dibbits-staging` is DNS-only, which is why it
> resolves straight to the droplet and why Caddy holds its own certificate for it
> (`via: 1.1 Caddy`, `alt-svc: h3`). If `hhpro-staging` is created **proxied (orange
> cloud)**, Cloudflare terminates TLS, ACME HTTP-01 cannot reach Caddy, and the site
> will not come up. Match the sibling record exactly.

### Confirm before continuing

```
getent hosts hhpro-staging.gablelbm.com     # must print 178.128.237.81
```

---

## 3. Build the bundle

On a machine with the toolchain — **not** on the droplet. The droplet stays a pure
artifact host with no Node toolchain and no repo clone, exactly as it is today.

```
git checkout feature/staging-deploy      # or master, once this is merged
git pull
bash deploy/build_bundle.sh
```

Produces `./hhpro-artifacts.tar.gz` containing `dist/`, `deploy/hhpro-staging.caddy`,
`deploy/hhpro-staging.service`, `VERSION` (the commit SHA), and `server.mjs`.

The script **refuses to build from a dirty tree** — the SHA names the release directory
and is what `/healthz` reports, so it has to mean something.

---

## 4. Ship and apply (manual path)

```
scp hhpro-artifacts.tar.gz root@178.128.237.81:/tmp/hhpro-artifacts.tar.gz
ssh root@178.128.237.81 'bash -s' < deploy/staging_apply.sh
```

**Rehearse first** — this runs every safety check and changes nothing:

```
ssh root@178.128.237.81 'HHPRO_DRY_RUN=1 bash -s' < deploy/staging_apply.sh
```

The script, in order:

1. Refuses to run unless it is root, Caddy is active, and `/opt/hardscapeos` exists
   (the co-tenant marker — proof it is the right droplet).
2. **Pre-flight: `dibbits-staging` healthz, loopback `:8080` AND public.** Not healthy
   → abort, nothing touched.
3. **Pre-flight: DNS resolves.** Not resolving → abort (override with
   `HHPRO_SKIP_DNS_CHECK=1`).
4. Backs up `/etc/caddy/Caddyfile` to `/opt/hhpro/backup-<timestamp>/`.
5. Unpacks to `/opt/hhpro/releases/<sha>` and flips `/opt/hhpro/current` atomically.
6. Writes `/etc/caddy/conf.d/hhpro-staging.caddy` with the SHA stamped into `/healthz`.
7. Appends `import /etc/caddy/conf.d/*.caddy` to the main Caddyfile **only if absent**.
8. `caddy validate` → invalid means roll back before any reload.
9. **`systemctl reload caddy`** — never `restart`, which would drop the co-tenant's
   listeners too.
10. **Post-check: `dibbits-staging` healthz again.** Degraded → **automatic immediate
    rollback**, then re-verifies the co-tenant.
11. Post-check: `https://hhpro-staging.gablelbm.com/healthz`.
12. Prunes to the last 5 releases and prints both rollback commands.

Re-running with the same SHA is a no-op re-verify. Re-running with a new SHA is a deploy.

> If step 11 fails but step 10 passed, the script **leaves the vhost in place and exits
> 1**. That is deliberate: the usual cause is a certificate still being issued, and
> tearing the vhost out would guarantee it never is. The co-tenant is proven healthy;
> re-check with `curl -fsS https://hhpro-staging.gablelbm.com/healthz`.

---

## 4b. Ship and apply (GitHub Actions path — no terminal needed)

A ready workflow does §3 and §4 on a runner, which is useful precisely because the
runner *can* reach the droplet. It is **`workflow_dispatch` only** — it will never fire
on a push, because auto-deploying to a shared droplet on every merge is not what D-085
authorised.

**It ships at `deploy/github-workflow-deploy-hhpro-staging.yml` and is inert there.**
Activate it:

```
mkdir -p .github/workflows
git mv deploy/github-workflow-deploy-hhpro-staging.yml \
       .github/workflows/deploy-hhpro-staging.yml
git commit -m "Enable the HH Pro staging deploy workflow" && git push
```

> That move needs a token with `workflow` scope, or a commit through the GitHub web UI.
> The PAT available when this was prepared has no `workflow` scope, and GitHub rejects
> any push that touches `.github/workflows/` without it — which is why the file is
> parked one directory over rather than already live.

One-time setup, in **this** repo's Settings → Secrets → Actions:

| Secret | Value |
|---|---|
| `STAGING_SSH_KEY` | the same deploy key `hardscapeos_dibbits` uses |
| `STAGING_HOST` | `178.128.237.81` |
| `STAGING_USER` | `root` |

Then: Actions → *deploy-hhpro-staging* → Run workflow. Leave **dry run** ticked the first
time; it runs every check and changes nothing.

---

## 5. Verify

```
# HH Pro is live, and reports which build
curl -fsS https://hhpro-staging.gablelbm.com/healthz
# → {"status":"ok","service":"hhpro-staging","mode":"sim","commit":"<sha>","serving":"static"}

# client routes boot the SPA rather than 404
for p in / /catalog /pay /more /orders/DEMO-1; do
  echo "$p $(curl -s -o /dev/null -w '%{http_code}' https://hhpro-staging.gablelbm.com$p)"
done

# assistant is honestly demo-stubbed
curl -fsS https://hhpro-staging.gablelbm.com/api/anthropic/health   # → {"ok":true,"hasKey":false}

# admin surface is closed
curl -s -o /dev/null -w '%{http_code}\n' https://hhpro-staging.gablelbm.com/admin        # → 404
curl -s -o /dev/null -w '%{http_code}\n' https://hhpro-staging.gablelbm.com/api/admin/state # → 404

# THE CO-TENANT — the check that actually matters
curl -fsS https://dibbits-staging.gablelbm.com/healthz   # → {"status":"ok","db":"up",...}
```

In a browser: the app should paint **Dibbits Landscape Supply** branding with no flash of
default blue, and the assistant should render its "no key" state.

---

## 6. Rollback

**Remove HH Pro entirely** (leaves `dibbits-staging` untouched):

```
rm -f /etc/caddy/conf.d/hhpro-staging.caddy
cp -f /opt/hhpro/backup-<timestamp>/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy
curl -fsS http://127.0.0.1:8080/healthz          # co-tenant still green
```

**Roll back to the previous HH Pro build only:**

```
ln -sfn /opt/hhpro/releases/<older-sha> /opt/hhpro/current.new
mv -Tf /opt/hhpro/current.new /opt/hhpro/current
# no Caddy action needed — the symlink is resolved per request
```

**If `dibbits-staging` is degraded and you are not sure why:** remove the vhost and
reload (first block above). That is the complete extent of this deployment's reach into
shared state — one file plus one `import` line.

---

## 7. Optional — switch the assistant on (Node mode)

Only when a dealer Anthropic key exists and someone owns the bill.

1. Create the service user and its data directory. **`/var/lib/hhpro` is the working
   directory, and that is load-bearing:** `server/admin-store.ts` resolves its data dir
   as `join(process.cwd(), '.hhpro')` with no environment override. Pointing the CWD at
   the release directory would put the dealer's stored key somewhere the next deploy
   deletes.
   ```
   useradd --system --home /var/lib/hhpro --shell /usr/sbin/nologin hhpro
   mkdir -p /var/lib/hhpro && chown hhpro:hhpro /var/lib/hhpro
   ```
2. Write `/etc/hhpro/staging.env` (mode `0640`, owner `root:hhpro`):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   HHPRO_COMMIT=<sha>
   ```
3. Install and start the unit:
   ```
   cp /opt/hhpro/deploy/hhpro-staging.service /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now hhpro-staging
   curl -fsS http://127.0.0.1:8091/healthz
   ```
4. In `/etc/caddy/conf.d/hhpro-staging.caddy`, replace the `handle /api/anthropic/health`
   and `handle /api/*` blocks with:
   ```
   handle /api/* {
       reverse_proxy 127.0.0.1:8091
   }
   ```
5. `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy`
6. **Re-check the co-tenant**: `curl -fsS https://dibbits-staging.gablelbm.com/healthz`

To also open the admin console, add `HHPRO_ADMIN_TOKEN` and
`HHPRO_ADMIN_ALLOW_REMOTE=true` to the env file and drop the `handle /admin*` 404 block —
**but read the reverse-proxy loopback warning in §0 first.** Consider pairing it with
§8.

---

## 8. Optional — password-gate the demo

Not enabled, because it is a product decision. The vhost carries a ready-to-paste
`basic_auth` block; generate the hash with `caddy hash-password --plaintext '<password>'`.

---

## Risks

1. **Shared droplet, shared Caddy.** The one piece of genuinely shared state this touches
   is `/etc/caddy/Caddyfile` (a single appended `import` line) and the Caddy process
   (reloaded, never restarted). Mitigations: backup before edit, `caddy validate` before
   reload, co-tenant healthz gate before *and* after, automatic rollback on degradation.
   **Residual risk: a Caddy reload is not perfectly free** — it re-provisions the server
   in place. It does not drop established connections, and dibbits-staging's own deploys
   already exercise this box, but it is non-zero.
2. **Public, unauthenticated demo URL** showing a named dealer's branding and product
   catalogue. `X-Robots-Tag: noindex, nofollow, noarchive` is set, which stops honest
   crawlers and nothing else. If the catalogue or pricing is commercially sensitive,
   enable §8 before sharing the link. **This needs a decision, not a default.**
3. **The reverse proxy defeats `isLoopback()`** in `server/admin-api.ts` — see §0. Handled
   here by closing `/admin*` at the edge, but the underlying weakness is in application
   code and will resurface for any future proxied deployment. Worth a ticket: the check
   should read a trusted forwarded-for header, or be replaced by something that is not a
   lie behind a proxy.
4. **No ERP.** SIM/DEMO only. Everything is `localStorage`, so state is per-browser: two
   testers do not see each other's data, and clearing site data resets the demo. Say so
   when handing the link over.
5. **The assistant is visibly disabled.** If a stakeholder expects a working AI demo, §7
   is the answer and it needs a key and a budget owner. Do not surprise them live.
6. **DNS proxy-status is the most likely failure.** An orange-cloud record silently
   breaks ACME. §2 covers it; check it first if the site does not come up.
7. **The bundle is ~15 MB because `vite.config.ts` sets `sourcemap: true`.** That is a
   deliberate app-level choice and useful on staging — a tester's console error is
   readable — but it means the deployed release directory ships full sourcemaps publicly.
   If the source of this app is considered sensitive, that is a decision to revisit in
   the app config, not here.

---

## Appendix — verified in preparation, 2026-08-18

- `dibbits-staging` healthz **before** any work:
  `200 {"status":"ok","db":"up","google_sso":false,"bistrack":"unconfigured"}`
  Headers confirm Caddy with its own TLS: `via: 1.1 Caddy`, `alt-svc: h3=":443"`.
- **Nothing on the droplet was modified.** No SSH client exists in the prep container and
  TCP/22 is blocked from it, so no change was possible; none was attempted.
- `npm run build` succeeds; `dist/index.html` carries the injected dealer config.
- Static serving proven against the real `dist/`: `/`, `/catalog`, `/pay`, `/more`,
  `/orders/:id` → `200 text/html`; `/admin` → the admin bundle; assets and favicon → 200.
- `deploy/prod-entry.ts` bundles with esbuild and runs: `/healthz`, `/api/anthropic/health`,
  `/api/config` → 200 JSON; unknown `/api/*` → 404 JSON (never the SPA); path-traversal
  attempts (`/../../../etc/passwd`, percent-encoded, and `/assets/../../server/...`) leak
  nothing; `POST /api/anthropic/v1/messages` with no key → the built-in 503 message.
- `deploy/build_bundle.sh` ran end-to-end: 15 MB bundle at `d712da0`, containing exactly
  the four things `staging_apply.sh` asserts on.
- **The vhost was validated and then actually executed.** `caddy validate` (v2.8.4) on the
  installed form — SHA substituted, pulled in through the same `import conf.d/*.caddy`
  line the apply script adds — returns *Valid configuration*. Caddy was then run against
  the real `dist/`, and every route was exercised:

  | Request | Result |
  |---|---|
  | `/healthz` | `200 {"status":"ok",...,"commit":"d712da0","serving":"static"}` |
  | `/api/anthropic/health` | `200 {"ok":true,"hasKey":false}` |
  | `/api/config`, `/api/admin/state` | `404` **JSON** — not the SPA |
  | `/admin`, `/admin.html` | `404` |
  | `/catalog`, `/pay`, `/orders/DEMO-1` | `200 text/html`, carrying `__HHPRO_CONFIG__` and `ln-dealer-brand` |
  | `/` headers | `Cache-Control: no-cache`, `X-Robots-Tag: noindex, nofollow, noarchive`, `X-Content-Type-Options: nosniff`, no `Server` |
  | `/assets/main-*.js` | `Cache-Control: public, max-age=31536000, immutable` |
  | gzip | negotiated (1269 → 695 bytes) |
  | traversal, raw and percent-encoded | nothing leaked |

  So the routing contract in §5 is not a prediction — it is a transcript. What remains
  unverified on the droplet is only what cannot be simulated: ACME issuance and the
  interaction with the live Caddy instance.
