/**
 * Production HTTP entry for HH Pro.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE ENABLING IT ON hhpro-staging.gablelbm.com.
 *
 * The staging deployment (D-085) does NOT run this process. It serves
 * `dist/` as pure static files from Caddy, because in SIM/DEMO mode this
 * server adds nothing a demo can see:
 *
 *   - Dealer config + brand CSS are baked into `dist/*.html` at BUILD time by
 *     `adminPlugin.transformIndexHtml`, which Vite runs for `vite build` as
 *     well as for dev. Verified on the built artifact: `dist/index.html`
 *     carries `window.__HHPRO_CONFIG__` and `<style id="ln-dealer-brand">`.
 *     So the no-flash branding guarantee survives static hosting intact.
 *   - `/api/config` is never fetched by the client — it reads the injected
 *     global. It exists for the embeddable future only.
 *   - The assistant needs an Anthropic key. Staging has none and must not be
 *     given one (see below), so this process would answer `/v1/messages` with
 *     the same 503 the client already renders when the health probe says
 *     `hasKey:false`. Same demo, one fewer long-running process next to
 *     dibbits-staging.
 *
 * This file exists as the UPGRADE PATH: the day a dealer key is provisioned,
 * `deploy/hhpro-staging.service` is enabled and the Caddy vhost's `handle
 * /api/*` block is swapped for a `reverse_proxy` to this listener. Until then
 * it ships disabled and unstarted, and `deploy/RUNBOOK.md` §7 is the switch.
 *
 * ── Why staging gets no Anthropic key ────────────────────────────────────────
 * The key is the DEALER's credential and it is billed to them. Putting one on
 * a shared staging droplet that also hosts dibbits-staging means a leaked
 * demo URL becomes a metered relay on somebody's real account. The rate
 * limiter and daily cap in server/claude-proxy.ts bound the damage; they do
 * not make it acceptable. Demo-stub the assistant instead — the app already
 * renders an honest "no key" state, which is a truthful thing to show.
 *
 * ── Why the admin console is refused unless explicitly opened ────────────────
 * `authorize()` in server/admin-api.ts gates non-loopback callers with
 * `isLoopback(req)`, which reads `req.socket.remoteAddress`. BEHIND A REVERSE
 * PROXY THAT VALUE IS ALWAYS 127.0.0.1 — Caddy is the TCP peer, not the
 * visitor. The loopback defence is therefore fully defeated by the very
 * deployment shape this file is written for, and the admin API would be left
 * standing on `HHPRO_ADMIN_TOKEN` alone. That is a deliberate decision, not a
 * default: this entry refuses to mount /api/admin unless the operator sets
 * HHPRO_ADMIN_ALLOW_REMOTE=true, and the Caddy vhost 404s /admin* at the edge
 * regardless.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { createAdminHandler } from '../server/admin-api';
import { readStoredKey } from '../server/admin-store';
import { readConfig } from '../server/admin-store';
import { createMessagesHandler } from '../server/claude-proxy';

const DIST = resolve(process.env.HHPRO_DIST ?? './dist');
const PORT = Number(process.env.PORT ?? 8091);
/** Loopback by default — Caddy fronts this, it is never the public listener. */
const HOST = process.env.HHPRO_BIND ?? '127.0.0.1';
const COMMIT = process.env.HHPRO_COMMIT ?? 'unknown';
const API_KEY = process.env.ANTHROPIC_API_KEY || undefined;
const ADMIN_TOKEN = process.env.HHPRO_ADMIN_TOKEN || undefined;
const ADMIN_ALLOW_REMOTE = process.env.HHPRO_ADMIN_ALLOW_REMOTE === 'true';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * Resolve a URL path to a file inside DIST, or null.
 *
 * The `startsWith(DIST + sep)` check is the whole point: without it
 * `/../../etc/passwd` (or an encoded form of it, which `new URL` decodes for
 * us) escapes the document root. `resolve` normalises `..` BEFORE the check,
 * so the comparison is on the real target rather than on the request text.
 */
function safePath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath);
  if (decoded.includes('\0')) return null;
  const target = resolve(join(DIST, decoded));
  if (target !== DIST && !target.startsWith(DIST + sep)) return null;
  return target;
}

async function serveFile(res: ServerResponse, file: string, immutable: boolean): Promise<boolean> {
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    res.statusCode = 200;
    res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
    res.setHeader('content-length', String(info.size));
    // Hashed asset filenames change on every build, so they can be cached
    // hard. HTML must not be: it carries the injected dealer config, and a
    // cached copy would pin a stale brand colour past the next deploy.
    res.setHeader(
      'cache-control',
      immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    await new Promise<void>((ok, fail) => {
      const stream = createReadStream(file);
      stream.on('error', fail);
      stream.on('end', () => ok());
      stream.pipe(res);
    });
    return true;
  } catch {
    return false;
  }
}

const messages = createMessagesHandler(API_KEY);
const admin =
  ADMIN_TOKEN && ADMIN_ALLOW_REMOTE
    ? createAdminHandler({ token: ADMIN_TOKEN, allowRemote: true })
    : null;

if (ADMIN_TOKEN && !ADMIN_ALLOW_REMOTE) {
  console.warn(
    '[hhpro] HHPRO_ADMIN_TOKEN is set but HHPRO_ADMIN_ALLOW_REMOTE is not "true" — /api/admin is NOT mounted. ' +
      'Behind a reverse proxy the loopback check in admin-api.ts cannot distinguish a visitor from Caddy, ' +
      'so opening it must be a deliberate act. See deploy/RUNBOOK.md §7.',
  );
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    // ── operational ──────────────────────────────────────────────────────────
    if (path === '/healthz') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'hhpro-staging',
        mode: 'sim',
        commit: COMMIT,
        assistant: API_KEY || readStoredKey() ? 'enabled' : 'demo-stub',
      });
      return;
    }

    // ── api ──────────────────────────────────────────────────────────────────
    if (path === '/api/anthropic/health') {
      // Unauthenticated by design: a boolean, never the key.
      sendJson(res, 200, { ok: true, hasKey: Boolean(API_KEY || readStoredKey()) });
      return;
    }
    if (path === '/api/anthropic/v1/messages') {
      await messages(req, res);
      return;
    }
    if (path === '/api/config') {
      sendJson(res, 200, readConfig());
      return;
    }
    if (path.startsWith('/api/admin')) {
      if (!admin) {
        sendJson(res, 404, { error: { message: 'Not found.' } });
        return;
      }
      await admin(req, res, req.url ?? '');
      return;
    }
    // Any other /api/* is ours and unimplemented — answer JSON, never the SPA.
    // The SPA fallback swallowing an API path is the exact bug documented at
    // length in server/dev-middleware.ts; do not let it recur here.
    if (path.startsWith('/api/')) {
      sendJson(res, 404, { error: { message: 'Not found.' } });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: { message: 'GET only' } });
      return;
    }

    // ── static ───────────────────────────────────────────────────────────────
    const file = safePath(path);
    if (!file) {
      sendJson(res, 400, { error: { message: 'Bad path.' } });
      return;
    }
    if (path !== '/' && (await serveFile(res, file, path.startsWith('/assets/')))) return;

    // The admin console is a SECOND entry point, not a client route, so it is
    // matched explicitly before the SPA fallback would hand back index.html.
    if (path === '/admin' || path === '/admin/') {
      if (await serveFile(res, join(DIST, 'admin.html'), false)) return;
    }

    // ── SPA fallback ─────────────────────────────────────────────────────────
    if (await serveFile(res, join(DIST, 'index.html'), false)) return;

    sendJson(res, 404, { error: { message: 'Not found.' } });
  })().catch((error) => {
    console.error('[hhpro] unhandled request error', error);
    if (!res.headersSent) sendJson(res, 500, { error: { message: 'Internal error.' } });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(
    `[hhpro] serving ${DIST} on http://${HOST}:${PORT} · commit ${COMMIT} · ` +
      `assistant ${API_KEY || readStoredKey() ? 'enabled' : 'demo-stub'} · ` +
      `admin ${admin ? 'MOUNTED (remote allowed)' : 'not mounted'}`,
  );
});

// systemd sends SIGTERM on stop/restart. Closing the listener lets in-flight
// SSE streams finish instead of being cut mid-token.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
