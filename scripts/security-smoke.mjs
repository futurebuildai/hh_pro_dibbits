/**
 * Security smoke test against a REAL dev server.
 *
 * Every assertion here corresponds to a vulnerability that was actually
 * present and verified during review, not a hypothetical:
 *
 *  - `.lumbernow/secrets.json` was served over HTTP with no auth, handing out
 *    the dealer's Anthropic key to anyone who guessed the path.
 *  - The API middleware registered ahead of Vite's DNS-rebinding defence, so a
 *    forged Host header reached the key-spending proxy and the admin API.
 *
 * These cannot be unit-tested: both are properties of how middleware composes
 * inside a running Vite server.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5417;
const BASE = `http://127.0.0.1:${PORT}`;
const CANARY = 'sk-ant-api03-CANARYcanaryCANARYcanary123';

/**
 * Raw request, because Node's fetch silently DROPS a forged `Host` header —
 * it is a forbidden header name in undici. A rebinding test written with
 * fetch quietly asserts nothing and passes, which is worse than no test.
 */
function rawGet(path, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method: headers.method ?? 'GET', headers },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', () => resolve({ status: 0, body: '' }));
    if (headers.body) req.write(headers.body);
    req.end();
  });
}

const failures = [];
function check(name, ok, detail) {
  process.stdout.write(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}\n`);
  if (!ok) failures.push(name);
}

async function main() {
  // A canary secret, so "is the key reachable" is answered by content, not by
  // a status code that might be a coincidence.
  const dataDir = join(ROOT, '.lumbernow');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'secrets.json'), JSON.stringify({ anthropicKey: CANARY }));

  const server = spawn('npx', ['vite'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT) },
  });

  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(BASE)).ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    // --- The credential must not be fetchable, by any path -------------------
    for (const path of [
      '/.lumbernow/secrets.json',
      `/@fs${ROOT}/.lumbernow/secrets.json`,
      '/.lumbernow/../.lumbernow/secrets.json',
    ]) {
      const { body } = await rawGet(path);
      check(`credential not served at ${path.slice(0, 44)}`, !body.includes(CANARY), 'KEY LEAKED');
    }

    // Content, not status: the SPA fallback legitimately answers 200 with
    // index.html for unknown paths, so a status check here asserts nothing.
    const git = await rawGet('/.git/config');
    check(
      'git internals not served',
      !/repositoryformatversion|\[core\]/.test(git.body),
      'git config reachable',
    );

    // --- DNS rebinding: a forged Host must not reach the API ----------------
    for (const path of ['/api/anthropic/health', '/api/config', '/api/admin/state']) {
      const { status } = await rawGet(path, { Host: 'evil.com' });
      check(`forged Host blocked on ${path}`, status === 403, `got ${status}`);
    }

    const spend = await rawGet('/api/anthropic/v1/messages', {
      method: 'POST',
      Host: 'evil.com',
      Origin: 'http://evil.com',
      'content-type': 'application/json',
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 8, messages: [] }),
    });
    check('forged Host cannot spend the key', spend.status === 403, `got ${spend.status}`);

    // --- And legitimate local traffic still works ---------------------------
    //
    // Asserted on CONTENT, not status. These three checked `status === 200`
    // and stayed green through a total outage of every API route: the SPA
    // fallback had swallowed them and was answering 200 with index.html. A
    // status code cannot tell "mounted" apart from "fell through".
    const LOCAL = [
      { path: '/', expect: (body) => body.includes('__LUMBERNOW_CONFIG__') },
      { path: '/api/anthropic/health', expect: (body) => JSON.parse(body).ok === true },
      {
        path: '/api/config',
        expect: (body) => typeof JSON.parse(body).branding.companyName === 'string',
      },
    ];
    for (const { path, expect: matches } of LOCAL) {
      // `*​/*` is what a browser's fetch() sends, and it is the case the HTML
      // fallback hijacks.
      const { status, body } = await rawGet(path, { Accept: '*/*' });
      let ok = status === 200;
      try {
        ok = ok && matches(body);
      } catch {
        ok = false;
      }
      check(`localhost still served: ${path}`, ok, `got ${status} ${body.slice(0, 40)}`);
    }
  } finally {
    server.kill();
    rmSync(join(ROOT, '.lumbernow', 'secrets.json'), { force: true });
  }

  process.stdout.write(`\n${failures.length} security check(s) failed\n`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
