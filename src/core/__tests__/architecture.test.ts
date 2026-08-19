import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the load-bearing constraint of this codebase: src/core must stay
 * framework-free so a future Lit migration only rewrites src/ui. A lint rule
 * can be disabled inline; this test can't be, which is why it exists.
 */

const CORE_DIR = join(__dirname, '..');

const BANNED_IMPORTS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react-router',
  'use-sync-external-store',
  'lit',
];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Matches the module specifier of static imports and re-exports. */
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    if (match[1]) specifiers.push(match[1]);
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

describe('src/core stays framework-free', () => {
  const files = collectTsFiles(CORE_DIR);

  it('finds core source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports no UI framework', () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        const bare = specifier
          .split('/')
          .slice(0, specifier.startsWith('@') ? 2 : 1)
          .join('/');
        if (BANNED_IMPORTS.includes(specifier) || BANNED_IMPORTS.includes(bare)) {
          violations.push(`${relative(CORE_DIR, file)} imports "${specifier}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('never reaches into src/ui', () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith('@ui') || specifier.includes('../ui/')) {
          violations.push(`${relative(CORE_DIR, file)} imports "${specifier}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

/**
 * The supplier seam (connection spec §7.2, rules 2 and 3).
 *
 * A switch becomes a fork the first time a caller learns which implementation
 * it got. These two rules are the whole difference, and they are tests rather
 * than lint rules for the reason the file already gives: a lint rule can be
 * disabled inline.
 */
describe('the supplier port is a switch, not a fork', () => {
  const files = collectTsFiles(CORE_DIR).filter((file) => !file.includes('__tests__'));
  const outside = files.filter((file) => !relative(CORE_DIR, file).startsWith('supplier/'));

  it('finds files outside src/core/supplier to check', () => {
    expect(outside.length).toBeGreaterThan(0);
  });

  /**
   * Everything above the port goes through `supplier/index.ts`. Reaching an
   * adapter directly is how `actions/` ends up holding a reference to a
   * simulator that a real deployment does not have.
   */
  it('nothing outside src/core/supplier imports an adapter', () => {
    const violations: string[] = [];
    for (const file of outside) {
      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (specifier.includes('supplier/adapters/')) {
          violations.push(`${relative(CORE_DIR, file)} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  /**
   * No `if (mode === 'sim')` above the port. Any such conditional in `actions/`,
   * `selectors/`, `domain/` or `ui/` is the fork starting: it is a second place
   * that has to be updated for every stage, and the place that gets forgotten.
   */
  it('nothing outside src/core/supplier branches on the supplier mode', () => {
    const MODE_TEST =
      /\bmode\s*[=!]==?\s*['"](?:sim|erp)['"]|['"](?:sim|erp)['"]\s*[=!]==?\s*\bmode\b/;
    /**
     * `domain/config.ts` is where the mode is DECIDED — it validates a dealer's
     * payload and refuses an `erp` with no usable base URL. Deciding what the
     * mode is is not the same act as behaving differently because of it, and
     * this is the only file allowed the former.
     */
    const DECIDES_THE_MODE = new Set(['domain/config.ts']);
    const violations: string[] = [];
    for (const file of outside) {
      const name = relative(CORE_DIR, file);
      if (DECIDES_THE_MODE.has(name)) continue;
      if (MODE_TEST.test(readFileSync(file, 'utf8'))) violations.push(name);
    }
    expect(violations).toEqual([]);
  });
});

/**
 * The supplier seam is the one place in `src/core` that talks to a network, so
 * it gets a stricter rule than the rest of the directory: not just
 * framework-free, GLOBAL-free.
 *
 * An adapter that reached for `window.sessionStorage` or `location` would work
 * in a browser, pass review, then fail in the node test project or an embedded
 * Lit build — and, worse, it would take the CREDENTIAL-CUSTODY decision away
 * from the host that has to make it. `TokenStore` is injected precisely so
 * core never chooses where a bearer token lives.
 *
 * Comments are stripped before every scan below. This codebase's prose explains
 * at length why a token must not go near `localStorage`, and a check that fails
 * on the documentation of its own rule is a check somebody deletes.
 */
describe('the supplier adapters read no ambient browser global', () => {
  const files = collectTsFiles(join(CORE_DIR, 'supplier')).filter(
    (file) => !file.includes('__tests__'),
  );

  function codeOf(file: string): string {
    return readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
  }

  it('finds supplier source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  /**
   * No exceptions on this half, ever. These are the globals that decide where a
   * credential lives and whether a module can run outside a browser.
   */
  it('touches no DOM, storage or location global', () => {
    const BANNED = [
      /(?<!\w)window\s*\./,
      /(?<!\w)document\s*\./,
      /(?<!\w)localStorage\b/,
      /(?<!\w)sessionStorage\b/,
      /(?<!\w)location\s*\./,
      /(?<!\w)navigator\s*\./,
    ];
    const violations: string[] = [];
    for (const file of files) {
      const code = codeOf(file);
      for (const pattern of BANNED) {
        if (pattern.test(code)) {
          violations.push(`${relative(CORE_DIR, file)} reads ${pattern.source}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  /**
   * `globalThis` gets ONE allowance, and it is pinned here rather than waved
   * through.
   *
   * `platformFetch()` in `adapters/erp-client.ts` resolves the platform `fetch`
   * lazily, off `globalThis` rather than as a bare `fetch(...)`, and only on
   * the ERP arm of `createSupplier` — so the flag-off build never touches a
   * network global at all, and a runtime without one gets a loud throw rather
   * than a crash three frames later. That is a deliberate, argued design and
   * the ruling here is that it stands.
   *
   * What must not happen is a SECOND one appearing under cover of the first.
   * So the exception is stated as an exact-match assertion: one file, one
   * occurrence. A new `globalThis` anywhere in `supplier/` fails this, and
   * whoever adds it has to come and argue for it here.
   */
  it('reaches for globalThis in exactly one place, and it is platformFetch', () => {
    const readers = files
      .map((file) => ({ name: relative(CORE_DIR, file), code: codeOf(file) }))
      .filter((entry) => /\bglobalThis\b/.test(entry.code));

    expect(readers.map((entry) => entry.name)).toEqual(['supplier/adapters/erp-client.ts']);

    const client = readers[0];
    expect(client?.code.match(/\bglobalThis\b/g) ?? []).toHaveLength(1);
    expect(client?.code).toContain('export function platformFetch(): FetchLike | null {');
  });

  /**
   * The other half of the same argument: a bare `fetch(...)` call closes over
   * an ambient binding at module load, which is the thing `platformFetch` was
   * written to avoid. Every transport in here arrives as a parameter.
   */
  it('calls no bare fetch', () => {
    const violations = files
      .filter((file) => /(?<![\w.])fetch\s*\(/.test(codeOf(file)))
      .map((file) => relative(CORE_DIR, file));
    expect(violations).toEqual([]);
  });
});
