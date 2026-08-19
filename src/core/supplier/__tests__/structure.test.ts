import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createErpSupplier } from '../adapters/erp';
import { SUPPLIER_READ_METHODS, SUPPLIER_WRITE_METHODS, isWriteCapable } from '../port';

/**
 * Stage 1 is READ-ONLY, and this is the test that makes that structural rather
 * than aspirational.
 *
 * "The ERP adapter does not write" is a sentence in a spec. What is checkable
 * is that the object has no write METHOD on it — not a disabled one, not one
 * that throws "not implemented", absent — because a method that does not exist
 * cannot be called by a button, a stage effect, or an AI tool, and cannot be
 * re-enabled by deleting a guard. The same reasoning as
 * `__tests__/architecture.test.ts`: a lint rule can be disabled inline and a
 * test cannot.
 *
 * The source-level half exists because the runtime half only sees what was
 * built. A future adapter file that adds a `PUT` is caught here on the day it
 * is written, before anything wires it up.
 */

const ERP_DIR = join(__dirname, '..', 'adapters');
const ADAPTER_FILES = ['erp.ts', join('erp', 'client.ts'), join('erp', 'map.ts')];

function erpSupplier() {
  return createErpSupplier({
    baseUrl: 'https://erp.dibbits.example',
    fetch: () => Promise.resolve(new Response('{}', { status: 200 })),
  });
}

/** Own keys plus anything inherited — nothing hides on a prototype. */
function everyMember(value: object): Set<string> {
  const names = new Set<string>();
  let current: object | null = value;
  while (current && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key === 'string') names.add(key);
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return names;
}

describe('the ERP adapter exposes no write method', () => {
  const supplier = erpSupplier();
  const members = everyMember(supplier);

  it.each(SUPPLIER_WRITE_METHODS)('has no %s', (method) => {
    expect(members.has(method)).toBe(false);
    expect((supplier as unknown as Record<string, unknown>)[method]).toBeUndefined();
  });

  it('is not write-capable', () => {
    expect(isWriteCapable(supplier)).toBe(false);
  });

  it('carries nothing that even looks like a write', () => {
    // Broader than the four names: this catches a helpfully-added
    // `payInvoices`, `updateSiteInstructions` or `confirmPickup` before it can
    // acquire a caller.
    const writeish =
      /^(create|update|delete|remove|pay|submit|withdraw|cancel|confirm|set|post|put|save|send|request)/i;
    const offenders = [...members].filter(
      (name) =>
        writeish.test(name) &&
        !(SUPPLIER_READ_METHODS as readonly string[]).includes(name) &&
        name !== 'constructor',
    );

    expect(offenders).toEqual([]);
  });

  it('still answers every read the port declares', () => {
    for (const method of SUPPLIER_READ_METHODS) {
      expect(typeof (supplier as unknown as Record<string, unknown>)[method]).toBe('function');
    }
  });

  it('is exactly the reads plus its mode, and nothing else', () => {
    expect(Object.keys(supplier).sort()).toEqual([...SUPPLIER_READ_METHODS, 'mode'].sort());
  });
});

describe('the ERP adapter sources contain no mutating verb', () => {
  function sourceOf(file: string): string {
    return readFileSync(join(ERP_DIR, file), 'utf8');
  }

  it.each(ADAPTER_FILES)('%s issues no PUT, PATCH or DELETE', (file) => {
    const source = sourceOf(file);
    for (const verb of ['PUT', 'PATCH', 'DELETE']) {
      expect(source).not.toContain(`'${verb}'`);
      expect(source).not.toContain(`"${verb}"`);
    }
  });

  it('names the only two paths a POST may reach', () => {
    expect(sourceOf(join('erp', 'client.ts'))).toContain(
      "export const AUTH_PATHS = ['/login', '/token/refresh'] as const;",
    );
  });

  it('POSTs only through the auth-restricted door', () => {
    // `send('POST', ...)` exists once, inside the client, behind the allowlist.
    // The adapter itself reaches the network only through `get` and `authPost`.
    const adapter = sourceOf('erp.ts');
    expect(adapter).not.toContain("method: 'POST'");
    expect(adapter.match(/client\.authPost\(/g) ?? []).toHaveLength(1);
  });
});

/**
 * The mapper is a whitelist, and the cheapest way to keep it one is to forbid
 * the syntax that would end that. A single `{...raw}` in `map.ts` publishes
 * the dealer's floor the first time the server-side projection drifts.
 */
describe('the mapper never spreads a wire object', () => {
  it('builds every domain value from named fields', () => {
    // Comments stripped — the file's own header warns about `{...raw}` by
    // name, and a check that trips on its own documentation gets deleted.
    const source = readFileSync(join(ERP_DIR, 'erp', 'map.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const spreads = source.match(/\.\.\.(raw|body|row|hit|user|config|account|line)\b/g) ?? [];
    expect(spreads).toEqual([]);
  });
});

/**
 * Adapters are reachable only through `createSupplier`.
 *
 * The spec's rule for the eventual sim move is "nothing outside the adapter
 * may import from it"; the enforceable version today is that no module outside
 * `supplier/` imports an adapter directly. Anything that did would be choosing
 * its supplier for itself, which is the fork the switch exists to prevent.
 */
describe('nothing outside supplier/ reaches an adapter', () => {
  const CORE_DIR = join(__dirname, '..', '..');
  const SUPPLIER_DIR = join(CORE_DIR, 'supplier');

  function collect(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...collect(full));
      else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
    }
    return out;
  }

  it('finds no import of supplier/adapters outside supplier/', () => {
    const violations: string[] = [];
    for (const file of collect(join(CORE_DIR, '..'))) {
      if (file.startsWith(SUPPLIER_DIR)) continue;
      const source = readFileSync(file, 'utf8');
      if (/from\s+['"][^'"]*supplier\/adapters/.test(source)) {
        violations.push(relative(CORE_DIR, file));
      }
    }
    expect(violations).toEqual([]);
  });
});
