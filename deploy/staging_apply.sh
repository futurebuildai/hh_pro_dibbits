#!/usr/bin/env bash
# staging_apply.sh — add the HH Pro staging vhost to the EXISTING dibbits-staging
# droplet (tor1, 178.128.237.81), additively and reversibly. Decision D-085.
#
# Mirrors the idiom of hardscapeos_dibbits/scripts/staging_apply.sh: a prebuilt
# artifact bundle is scp'd to /tmp, this script is piped over SSH with `bash -s`,
# and it does sanity → backup → install → verify → loud rollback instructions.
#
# It differs in one way that matters, and the difference is the entire point of
# this file: THIS DROPLET IS NOT OURS ALONE. dibbits-staging lives here, serving
# a real UAT audience off a Postgres nobody wants restored from a backup today.
# So the co-tenant's health is a GATE, not a footnote — it is asserted BEFORE
# anything is touched and again AFTER every change, and any degradation triggers
# an immediate automatic rollback rather than a message asking a human to do it.
#
# What it will never do:
#   - open, rewrite or reformat the dibbits-staging vhost
#   - `systemctl restart caddy` (that drops every listener on the box, including
#     the co-tenant's). Only `reload`, which swaps config in place.
#   - touch /opt/hardscapeos, the hardscapeos unit, or its database
#   - provision anything. No new droplet, no new volume, no new DNS record.
#
# Layout it creates (all additive, all under paths nothing else uses):
#   /opt/hhpro/releases/<sha>/     — one directory per build, immutable
#   /opt/hhpro/current             — symlink, flipped atomically
#   /etc/caddy/conf.d/hhpro-staging.caddy
#   one `import conf.d/*.caddy` line in /etc/caddy/Caddyfile (backed up first)
#
# Idempotent: re-running with the same SHA re-links and re-verifies without
# re-unpacking. Re-running with a new SHA is a deploy. Versioned by commit SHA
# throughout, and the live SHA is readable at /healthz — the only reliable way
# to tell a finished deploy from a cached page.
#
# Usage (from a runner or laptop that can reach the droplet):
#   scp hhpro-artifacts.tar.gz root@178.128.237.81:/tmp/
#   ssh root@178.128.237.81 'bash -s' < deploy/staging_apply.sh
#
# Escape hatches (all default to the safe behaviour):
#   HHPRO_SKIP_DNS_CHECK=1   proceed although the hostname does not resolve here
#   HHPRO_DRY_RUN=1          run every check, make no change
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/hhpro}
TARBALL=${TARBALL:-/tmp/hhpro-artifacts.tar.gz}
SITE=${SITE:-hhpro-staging.gablelbm.com}
CADDY_MAIN=${CADDY_MAIN:-/etc/caddy/Caddyfile}
CADDY_CONFD=${CADDY_CONFD:-/etc/caddy/conf.d}
VHOST_NAME=hhpro-staging.caddy
VHOST="$CADDY_CONFD/$VHOST_NAME"
# The co-tenant. Both probes are checked: the loopback one proves the service
# itself is alive, the public one proves its vhost still routes. A change to
# Caddy can break the second while the first stays green, and that is precisely
# the failure this deployment could plausibly cause.
DIBBITS_LOCAL=${DIBBITS_LOCAL:-http://127.0.0.1:8080/healthz}
DIBBITS_PUBLIC=${DIBBITS_PUBLIC:-https://dibbits-staging.gablelbm.com/healthz}
STAMP=$(date +%Y%m%d-%H%M%S)
BK="$APP_DIR/backup-$STAMP"
DRY=${HHPRO_DRY_RUN:-0}

say() { printf '\n── %s ──\n' "$*"; }
die() { printf '\nFATAL: %s\n' "$*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
# co-tenant probe
# ─────────────────────────────────────────────────────────────────────────────
dibbits_ok() {
  local where=$1 local_body public_code
  if ! local_body=$(curl -fsS -m 10 "$DIBBITS_LOCAL" 2>&1); then
    printf 'dibbits-staging LOCAL healthz FAILED (%s): %s\n' "$where" "$local_body" >&2
    return 1
  fi
  public_code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 --retry 2 --retry-delay 2 "$DIBBITS_PUBLIC" || echo 000)
  if [ "$public_code" != "200" ]; then
    printf 'dibbits-staging PUBLIC healthz returned %s (%s)\n' "$public_code" "$where" >&2
    return 1
  fi
  printf 'dibbits-staging OK (%s): local=%s public=200\n' "$where" "$local_body"
  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# rollback — removes only what this script added, then re-proves the co-tenant
# ─────────────────────────────────────────────────────────────────────────────
ADDED_IMPORT=0
INSTALLED_VHOST=0
rollback() {
  say "ROLLING BACK"
  [ "$INSTALLED_VHOST" = "1" ] && rm -f "$VHOST" && echo "removed $VHOST"
  if [ "$ADDED_IMPORT" = "1" ] && [ -f "$BK/Caddyfile" ]; then
    cp -f "$BK/Caddyfile" "$CADDY_MAIN"
    echo "restored $CADDY_MAIN from $BK/Caddyfile"
  fi
  systemctl reload caddy || systemctl status caddy --no-pager || true
  sleep 3
  if dibbits_ok "after-rollback"; then
    echo "rollback complete — dibbits-staging healthy, HH Pro not deployed."
  else
    cat >&2 <<EOF

!! ROLLBACK DID NOT RESTORE THE CO-TENANT. Escalate now. Manual recovery:
     rm -f $VHOST
     cp -f $BK/Caddyfile $CADDY_MAIN
     caddy validate --config $CADDY_MAIN --adapter caddyfile
     systemctl reload caddy
     curl -fsS $DIBBITS_LOCAL
   Caddy's own view:  journalctl -u caddy -n 80 --no-pager
EOF
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
say "sanity"
[ "$(id -u)" = "0" ] || die "must run as root (writes /etc/caddy and /opt)"
command -v caddy >/dev/null || die "caddy not on PATH — wrong host?"
systemctl is-active --quiet caddy || die "caddy is not running — refusing to touch its config"
[ -f "$CADDY_MAIN" ] || die "missing $CADDY_MAIN"
# The co-tenant's marker. If this is absent we are on the wrong droplet, and
# every path below would be creating a deployment somewhere nobody expects.
[ -d /opt/hardscapeos ] || die "no /opt/hardscapeos — this is not the dibbits-staging droplet"
[ -f "$TARBALL" ] || die "no artifact bundle at $TARBALL"

say "unpack + identify build"
STAGE=$(mktemp -d /tmp/hhpro-apply.XXXXXX)
trap 'rm -rf "$STAGE"' EXIT
tar -C "$STAGE" -xzf "$TARBALL"
[ -f "$STAGE/dist/index.html" ] || die "bundle incomplete: no dist/index.html"
[ -f "$STAGE/deploy/$VHOST_NAME" ] || die "bundle incomplete: no deploy/$VHOST_NAME"
[ -f "$STAGE/VERSION" ] || die "bundle incomplete: no VERSION (commit sha)"
SHA=$(tr -d ' \n\r' < "$STAGE/VERSION")
[ -n "$SHA" ] || die "VERSION is empty"
echo "build $SHA"
RELEASE="$APP_DIR/releases/$SHA"

# ─────────────────────────────────────────────────────────────────────────────
say "PRE-FLIGHT — the co-tenant must be healthy BEFORE we touch anything"
# Deploying onto an already-sick host makes this change the prime suspect for a
# fault it did not cause, and buries the real one.
dibbits_ok "before" || die "dibbits-staging is not healthy BEFORE any change. Nothing was touched. Fix that first."

say "PRE-FLIGHT — DNS"
# Caddy starts an ACME order the moment this vhost loads. If the name does not
# resolve to this droplet the order fails and retries on a backoff, which is
# noise at best. Worse, it means the deploy cannot actually be verified. So DNS
# comes FIRST — see RUNBOOK.md §2.
if RESOLVED=$(getent hosts "$SITE" 2>/dev/null | awk '{print $1}' | head -1) && [ -n "$RESOLVED" ]; then
  echo "$SITE resolves to $RESOLVED"
  MYIPS=$(hostname -I 2>/dev/null || true)
  case " $MYIPS " in
    *" $RESOLVED "*) echo "→ matches an address on this host" ;;
    *) echo "→ NOTE: does not match this host's addresses ($MYIPS). Expected if the record is proxied through Cloudflare (orange cloud); in that case ACME HTTP-01 cannot complete and the record must be DNS-only (grey cloud) — see RUNBOOK.md §2." ;;
  esac
else
  if [ "${HHPRO_SKIP_DNS_CHECK:-0}" = "1" ]; then
    echo "$SITE does not resolve — continuing because HHPRO_SKIP_DNS_CHECK=1. Caddy will retry ACME until the record exists."
  else
    die "$SITE does not resolve. Create the DNS record first (RUNBOOK.md §2), or set HHPRO_SKIP_DNS_CHECK=1 to stage the vhost anyway. Nothing was touched."
  fi
fi

if [ "$DRY" = "1" ]; then
  say "HHPRO_DRY_RUN=1 — all pre-flight checks passed, no change made"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
say "backup"
mkdir -p "$BK" "$APP_DIR/releases" "$CADDY_CONFD"
cp -f "$CADDY_MAIN" "$BK/Caddyfile"
[ -f "$VHOST" ] && cp -f "$VHOST" "$BK/$VHOST_NAME"
echo "backup at $BK"

say "install release $SHA"
# Unpack beside the target and rename: a half-written release directory is never
# reachable through the symlink, so an interrupted deploy leaves the live site on
# the previous build rather than on a partial one.
rm -rf "$RELEASE.tmp"
cp -r "$STAGE/dist" "$RELEASE.tmp"
[ -f "$STAGE/server.mjs" ] && cp -f "$STAGE/server.mjs" "$RELEASE.tmp/server.mjs"
rm -rf "$RELEASE"
mv "$RELEASE.tmp" "$RELEASE"
# ln -sfn onto a temp name then mv is the atomic form; `ln -sfn` straight at an
# existing symlink-to-directory would nest the link INSIDE the old target.
ln -sfn "$RELEASE" "$APP_DIR/current.new"
mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
echo "$APP_DIR/current → $RELEASE"

# Keep the deploy sources on the box, outside the release tree so pruning cannot
# take them. RUNBOOK.md §7 (switching the assistant on) needs the unit file, and
# an operator at 2am should not have to go find the repo to get it.
mkdir -p "$APP_DIR/deploy"
cp -f "$STAGE/deploy/"* "$APP_DIR/deploy/"
echo "deploy sources at $APP_DIR/deploy"

say "install vhost"
# The live SHA is stamped into /healthz so the deployed build is observable.
sed "s/__COMMIT__/$SHA/g" "$STAGE/deploy/$VHOST_NAME" > "$VHOST"
INSTALLED_VHOST=1
mkdir -p /var/log/caddy
echo "wrote $VHOST"

# One line, appended, only if absent. This is the sole edit to the shared
# Caddyfile in the whole procedure, and $BK/Caddyfile is the way back.
if grep -qE '^[[:space:]]*import[[:space:]]+.*conf\.d' "$CADDY_MAIN"; then
  echo "import of conf.d already present — main Caddyfile untouched"
else
  printf '\n# HH Pro staging (D-085) — additive vhosts live in conf.d/\nimport %s/*.caddy\n' "$CADDY_CONFD" >> "$CADDY_MAIN"
  ADDED_IMPORT=1
  echo "appended 'import $CADDY_CONFD/*.caddy' to $CADDY_MAIN"
fi

say "validate config BEFORE asking Caddy to load it"
# A reload with a bad config is refused by Caddy and the old config keeps
# serving — but validating first turns a scary "reload failed" into a clean
# abort with the co-tenant never involved.
if ! caddy validate --config "$CADDY_MAIN" --adapter caddyfile 2>&1; then
  echo "config INVALID — reverting before any reload" >&2
  rollback
  die "caddy validate failed; nothing was reloaded and the co-tenant was never at risk"
fi

say "reload caddy (never restart — restart drops the co-tenant's listeners too)"
if ! systemctl reload caddy; then
  echo "reload FAILED" >&2
  journalctl -u caddy -n 40 --no-pager || true
  rollback
  die "caddy reload failed"
fi
sleep 3

# ─────────────────────────────────────────────────────────────────────────────
say "POST-CHECK — the co-tenant must STILL be healthy"
if ! dibbits_ok "after"; then
  echo "CO-TENANT DEGRADED AFTER THE CHANGE — rolling back immediately." >&2
  rollback
  die "dibbits-staging degraded; HH Pro deployment reverted"
fi

say "POST-CHECK — HH Pro is serving"
HHPRO_OK=1
if ! curl -fsS -m 30 --retry 4 --retry-delay 5 "https://$SITE/healthz"; then
  HHPRO_OK=0
  echo ""
  echo "HH Pro /healthz did not answer over HTTPS yet." >&2
  echo "Most likely cause: the ACME certificate is still being issued (first deploy takes ~30s), or DNS is proxied rather than DNS-only." >&2
  journalctl -u caddy -n 30 --no-pager | grep -i -E "$SITE|acme|certificate|error" || true
fi
echo ""

# A failure to serve HH Pro is NOT grounds for an automatic rollback: the
# co-tenant is proven healthy above, and the usual cause is a certificate that
# simply has not been issued yet. Ripping the vhost out would guarantee it never
# is. Report loudly, leave it in place, let the operator decide.
if [ "$HHPRO_OK" = "0" ]; then
  cat <<EOF

── HH Pro is NOT yet serving, but dibbits-staging is VERIFIED HEALTHY ──
The vhost is installed and left in place so ACME can finish. Re-check with:
  curl -fsS https://$SITE/healthz
  journalctl -u caddy -f | grep -i acme
If you want it gone entirely:
  rm -f $VHOST && cp -f $BK/Caddyfile $CADDY_MAIN && systemctl reload caddy
EOF
  exit 1
fi

say "prune old releases (keep 5)"
# shellcheck disable=SC2012
ls -1dt "$APP_DIR"/releases/*/ 2>/dev/null | tail -n +6 | while read -r old; do
  case "$old" in "$RELEASE"/|"$RELEASE") continue ;; esac
  rm -rf "$old" && echo "pruned $old"
done

say "HH Pro staging apply complete — $SHA"
cat <<EOF
live:      https://$SITE/          (SIM/DEMO, static)
health:    https://$SITE/healthz   (reports commit $SHA)
co-tenant: dibbits-staging verified healthy BEFORE and AFTER this change

roll back this deployment (leaves dibbits-staging untouched):
  rm -f $VHOST
  cp -f $BK/Caddyfile $CADDY_MAIN
  caddy validate --config $CADDY_MAIN --adapter caddyfile && systemctl reload caddy
  curl -fsS $DIBBITS_LOCAL

roll back to the previous HH Pro build instead:
  ln -sfn $APP_DIR/releases/<older-sha> $APP_DIR/current.new && mv -Tf $APP_DIR/current.new $APP_DIR/current
EOF
