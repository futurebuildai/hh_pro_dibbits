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

  /**
   * The supplier port is the seam a real ERP connects through, and the ERP
   * adapter is the one place in `src/core` that talks to a network. It stays
   * framework-free the same way everything else here does — but it also has to
   * stay GLOBAL-free, which is a stricter rule and a new one.
   *
   * An adapter that reads `globalThis.fetch`, `window.sessionStorage` or
   * `location` would work in a browser, pass review, and then fail in the node
   * test project or in an embedded Lit build — and worse, it would take its
   * credential custody decision away from the host that has to make it. Every
   * capability the adapter needs is injected.
   */
  it('the supplier adapters read no ambient browser global', () => {
    const BANNED_GLOBALS = [
      /\bglobalThis\s*\.\s*fetch\b/,
      /(?<!\w)window\s*\./,
      /(?<!\w)document\s*\./,
      /(?<!\w)localStorage\b/,
      /(?<!\w)sessionStorage\b/,
      /(?<!\w)location\s*\./,
    ];
    const violations: string[] = [];

    for (const file of files) {
      const relativePath = relative(CORE_DIR, file);
      if (!relativePath.startsWith('supplier/')) continue;
      if (relativePath.includes('__tests__')) continue;
      // Comments are stripped: this file's own prose explains at length why a
      // token must not go near `localStorage`, and a check that fails on the
      // documentation of the rule it enforces is a check nobody will keep.
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const pattern of BANNED_GLOBALS) {
        if (pattern.test(source)) violations.push(`${relativePath} reads ${pattern.source}`);
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
