#!/usr/bin/env bash
# build_bundle.sh — produce the artifact bundle staging_apply.sh consumes.
#
# Runs on a machine with the toolchain (a CI runner or a laptop), NOT on the
# droplet. The droplet stays an artifact host with no Node toolchain and no repo
# clone, exactly as dibbits-staging already is — that is the property that keeps
# a deploy from being able to break the box in a new way.
#
# Output: ./hhpro-artifacts.tar.gz containing
#   dist/                      the built SPA (dealer config already baked in)
#   deploy/hhpro-staging.caddy the vhost, with __COMMIT__ still unsubstituted
#   VERSION                    the commit sha, the version of record
#   server.mjs                 the OPTIONAL Node entry (shipped, not started)
#
# Usage: bash deploy/build_bundle.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT="$ROOT/hhpro-artifacts.tar.gz"

SHA=$(git rev-parse --short HEAD)
if ! git diff --quiet || ! git diff --cached --quiet; then
  # The SHA is the deployment's identity: it names the release directory and is
  # what /healthz reports. A dirty tree would ship bytes that no commit
  # describes under a SHA that claims otherwise, and the next person to check
  # what is live would be misled.
  echo "working tree is dirty — commit or stash first, so the deployed SHA means something" >&2
  exit 1
fi

echo "── build $SHA ──"
npm ci
npm run build
test -f dist/index.html || { echo "build produced no dist/index.html" >&2; exit 1; }
# The no-flash guarantee is a build-time property in static mode, so it is
# asserted at build time rather than discovered on the droplet.
grep -q '__HHPRO_CONFIG__' dist/index.html \
  || { echo "dist/index.html has no injected dealer config — adminPlugin.transformIndexHtml did not run; static serving would show unbranded defaults" >&2; exit 1; }

echo "── bundle the optional node entry ──"
# Cleaned first: a leftover .bundle-tmp/dist from an interrupted run would make
# `cp -r dist $STAGE/dist` nest the new build inside the old one, and the bundle
# would ship a stale index.html at the path Caddy actually serves.
rm -rf "$ROOT/.bundle-tmp"
# Bundled with esbuild (already present via Vite) so the droplet needs neither a
# TypeScript toolchain nor node_modules. `--packages=external` would require
# them; everything this entry imports is either our own source or node: builtins.
./node_modules/.bin/esbuild deploy/prod-entry.ts \
  --bundle --platform=node --format=esm --target=node20 \
  --outfile="$ROOT/.bundle-tmp/server.mjs"

echo "── assemble ──"
STAGE="$ROOT/.bundle-tmp"
mkdir -p "$STAGE/deploy"
cp -r dist "$STAGE/dist"
cp deploy/hhpro-staging.caddy "$STAGE/deploy/"
cp deploy/hhpro-staging.service "$STAGE/deploy/"
printf '%s\n' "$SHA" > "$STAGE/VERSION"

tar -C "$STAGE" -czf "$OUT" dist deploy VERSION server.mjs
rm -rf "$STAGE"

echo "── done ──"
echo "bundle: $OUT ($(du -h "$OUT" | cut -f1)) @ $SHA"
echo "next:   scp $OUT root@178.128.237.81:/tmp/hhpro-artifacts.tar.gz"
echo "        ssh root@178.128.237.81 'bash -s' < deploy/staging_apply.sh"
