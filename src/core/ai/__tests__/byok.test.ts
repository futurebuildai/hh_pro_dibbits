import { beforeEach, describe, expect, it } from 'vitest';
import { resolveKey } from '../../../../server/claude-proxy';
import {
  BYOK_HEADER,
  byokHeaders,
  clearKey,
  hasKey,
  isWellFormedKey,
  keyScope,
  maskKey,
  moveKeyToScope,
  readKey,
  saveKey,
  subscribeToKey,
} from '../byok';

/**
 * The bring-your-own-key path, including the proxy's precedence rule.
 *
 * These assert the security properties, not just the happy path: a malformed
 * key never reaches storage or the wire, an error never echoes the secret, and
 * the masked form is never usable.
 */

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const REAL = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryStorage(),
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: memoryStorage(),
  });
});

describe('key validation', () => {
  it('accepts a real-shaped Anthropic key', () => {
    expect(isWellFormedKey(REAL)).toBe(true);
    expect(isWellFormedKey(`  ${REAL}  `)).toBe(true);
  });

  it('rejects the things people actually paste by mistake', () => {
    for (const bad of [
      '',
      'sk-ant-',
      'hunter2',
      'sk-proj-abcdefghijklmnopqrstuvwx', // an OpenAI key
      'Bearer sk-ant-api03-abcdefghijklmnopqrst',
      `${REAL} extra`,
    ]) {
      expect(isWellFormedKey(bad), bad).toBe(false);
    }
  });

  it('never stores a malformed key, and never echoes it back', () => {
    const result = saveKey('not-a-key-at-all');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // An error string ends up in logs and screenshots; it must not carry the secret.
    expect(result.error).not.toContain('not-a-key-at-all');
    expect(readKey()).toBeNull();
  });
});

describe('masking', () => {
  it('shows enough to recognise the key and not enough to use it', () => {
    const masked = maskKey(REAL);
    expect(masked).toContain('sk-ant-api');
    expect(masked).toContain(REAL.slice(-4));
    expect(masked).not.toBe(REAL);
    expect(isWellFormedKey(masked)).toBe(false);
  });
});

describe('storage scopes', () => {
  it('keeps a device key across reloads', () => {
    expect(saveKey(REAL, 'device').ok).toBe(true);
    expect(readKey()).toBe(REAL);
    expect(keyScope()).toBe('device');
    expect(hasKey()).toBe(true);
  });

  it('keeps a session key only in sessionStorage', () => {
    expect(saveKey(REAL, 'session').ok).toBe(true);
    expect(sessionStorage.getItem('lumbernow.anthropic-key')).toBe(REAL);
    expect(localStorage.getItem('lumbernow.anthropic-key')).toBeNull();
    expect(keyScope()).toBe('session');
  });

  it('never leaves a stale key behind when the scope changes', () => {
    saveKey(REAL, 'device');
    const second = 'sk-ant-api03-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    saveKey(second, 'session');

    expect(localStorage.getItem('lumbernow.anthropic-key')).toBeNull();
    expect(readKey()).toBe(second);
  });

  it('clears both scopes at once', () => {
    saveKey(REAL, 'device');
    clearKey();
    expect(readKey()).toBeNull();
    expect(hasKey()).toBe(false);
    expect(keyScope()).toBeNull();
  });

  /**
   * The credential deliberately lives outside the `ln:` namespace: Demo Reset
   * enumerates and wipes that prefix, and the corrupt-state backup copies it
   * wholesale into another storage slot. A key belongs in neither.
   */
  it('stays out of the ln: state namespace', () => {
    saveKey(REAL, 'device');
    const lnKeys = Object.keys(localStorage).filter((key) => key.startsWith('ln:'));
    expect(lnKeys).toHaveLength(0);
  });
});

describe('the outgoing header', () => {
  it('is empty when no key is configured, so the server key is used', () => {
    expect(byokHeaders()).toEqual({});
  });

  it('carries the key once one is set', () => {
    saveKey(REAL, 'device');
    expect(byokHeaders()).toEqual({ [BYOK_HEADER]: REAL });
  });
});

describe('the proxy key precedence', () => {
  it('spends the caller-supplied key when one is forwarded', () => {
    const resolved = resolveKey({ [BYOK_HEADER]: REAL }, 'sk-ant-server-key-aaaaaaaaaaaaaaaaaaaa');
    expect(resolved).toEqual({ key: REAL, source: 'byok' });
  });

  it('falls back to the server key when nothing is forwarded', () => {
    const serverKey = 'sk-ant-api03-serverserverserverserverserver';
    expect(resolveKey({}, serverKey)).toEqual({ key: serverKey, source: 'server' });
  });

  /**
   * A malformed header must not be forwarded upstream as somebody's typo —
   * and must not shadow a perfectly good server key either.
   */
  it('ignores a malformed forwarded key rather than forwarding it', () => {
    const serverKey = 'sk-ant-api03-serverserverserverserverserver';
    expect(resolveKey({ [BYOK_HEADER]: 'garbage' }, serverKey)).toEqual({
      key: serverKey,
      source: 'server',
    });
    // Header injection attempts are just malformed keys.
    expect(resolveKey({ [BYOK_HEADER]: ['a', 'b'] }, serverKey)?.source).toBe('server');
  });

  it('reports no key at all when neither side has one', () => {
    expect(resolveKey({}, undefined)).toBeNull();
    expect(resolveKey({ [BYOK_HEADER]: 'nope' }, undefined)).toBeNull();
  });
});

describe('hand-edited storage', () => {
  it('normalises whitespace rather than putting it in an HTTP header', () => {
    localStorage.setItem('lumbernow.anthropic-key', `  ${REAL}\t`);
    expect(readKey()).toBe(REAL);
    expect(byokHeaders()[BYOK_HEADER]).toBe(REAL);
  });

  it('never lets keyScope disagree with readKey about a garbage value', () => {
    localStorage.setItem('lumbernow.anthropic-key', 'not-a-key');
    expect(readKey()).toBeNull();
    expect(hasKey()).toBe(false);
    // A scope reported here with no key behind it would strand the UI showing
    // "saved on this device" with nothing usable.
    expect(keyScope()).toBeNull();
  });

  it('refuses a key carrying a CRLF header-injection payload', () => {
    expect(isWellFormedKey(`${REAL}\r\nX-Injected: 1`)).toBe(false);
    localStorage.setItem('lumbernow.anthropic-key', `${REAL}\r\nX-Injected: 1`);
    expect(readKey()).toBeNull();
  });

  /**
   * A trailing newline is how a key arrives from `cat key.txt` or a sloppy
   * copy, so it is accepted — but it must be normalised away, never carried
   * into the header where a bare CR/LF would be request smuggling.
   */
  it('accepts a trailing-newline paste but strips it before the wire', () => {
    expect(saveKey(`${REAL}\n`).ok).toBe(true);
    expect(readKey()).toBe(REAL);
    const header = byokHeaders()[BYOK_HEADER] ?? '';
    expect(header).toBe(REAL);
    expect(/[\r\n]/.test(header)).toBe(false);
  });
});

describe('rotation safety', () => {
  it('keeps the working key when the write fails', () => {
    saveKey(REAL, 'device');

    // A full quota / iOS private mode throws on setItem even though the store
    // is reachable — the case that used to destroy the key before writing.
    const broken = {
      ...localStorage,
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: broken });

    const result = saveKey('sk-ant-api03-replacementreplacementreplacement', 'device');
    expect(result.ok).toBe(false);
    expect(readKey()).toBe(REAL); // still usable
  });
});

describe('moving an existing key between scopes', () => {
  it('actually relocates it, rather than only looking selected', () => {
    saveKey(REAL, 'device');
    expect(moveKeyToScope('session').ok).toBe(true);

    expect(keyScope()).toBe('session');
    expect(sessionStorage.getItem('lumbernow.anthropic-key')).toBe(REAL);
    // The whole point: it must be GONE from the device store.
    expect(localStorage.getItem('lumbernow.anthropic-key')).toBeNull();
    expect(readKey()).toBe(REAL);
  });

  it('refuses when there is nothing to move', () => {
    expect(moveKeyToScope('session').ok).toBe(false);
  });
});

describe('change notification', () => {
  it('tells subscribers when a key is saved, moved, or removed', () => {
    let calls = 0;
    const unsubscribe = subscribeToKey(() => {
      calls += 1;
    });

    saveKey(REAL, 'device');
    expect(calls).toBe(1);
    moveKeyToScope('session');
    expect(calls).toBe(2);
    clearKey();
    expect(calls).toBe(3);

    unsubscribe();
    saveKey(REAL, 'device');
    expect(calls).toBe(3);
  });
});
