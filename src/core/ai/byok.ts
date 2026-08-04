import { type Result, err, ok } from '../lib/result';

/**
 * Bring-your-own-key.
 *
 * A developer (or a dealer running a pilot) can paste their own Anthropic key
 * instead of standing up a server with `ANTHROPIC_API_KEY`. Downstream, real
 * client deployments will use provider-issued inference keys held server-side;
 * this exists so the assistant is usable long before that.
 *
 * Two rules shape the whole design:
 *
 * 1. **The key still goes through our proxy**, never browser -> Anthropic
 *    direct. The proxy is where the model allowlist, the max_tokens ceiling,
 *    the rate limit, and abort propagation live, and none of those should
 *    switch off just because the key came from the user. The request is
 *    same-origin, so the key never crosses to a third party.
 *
 * 2. **It is a credential, so it is handled like one**: validated before it is
 *    stored, never logged, never put in an error string, shown only masked,
 *    removable in one tap, and storable for this tab only when the machine
 *    isn't yours.
 *
 * Storage deliberately sits OUTSIDE the `ln:` namespace: everything under that
 * prefix gets enumerated by Demo Reset and copied wholesale into the
 * corrupt-state backup, and a credential should be in neither.
 */

const STORAGE_KEY = 'lumbernow.anthropic-key';
const SCOPE_KEY = 'lumbernow.anthropic-key-scope';

/** The header the client sends and the proxy reads. Never `x-api-key`, so a
 *  forwarded key can never be confused with the SDK's placeholder. */
export const BYOK_HEADER = 'x-anthropic-byok';

/** `device` survives a reload; `session` dies with the tab. */
export type KeyScope = 'device' | 'session';

/**
 * Anthropic keys are `sk-ant-` followed by an opaque token. Checking the shape
 * up front turns a typo into an immediate, specific message instead of a 401
 * that surfaces halfway through a stream.
 */
export function isWellFormedKey(value: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{16,}$/.test(value.trim());
}

/** For display only — enough to recognise which key is loaded, never enough to use. */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 14) return '••••••••';
  return `${trimmed.slice(0, 11)}…${trimmed.slice(-4)}`;
}

function storageFor(scope: KeyScope): Storage | null {
  try {
    const store = scope === 'device' ? globalThis.localStorage : globalThis.sessionStorage;
    return store ?? null;
  } catch {
    // Safari private mode and similar throw on access rather than returning null.
    return null;
  }
}

/** The key in force, if any. Session scope wins — it is the more deliberate choice. */
export function readKey(): string | null {
  for (const scope of ['session', 'device'] as const) {
    const value = storageFor(scope)?.getItem(STORAGE_KEY);
    // Return the TRIMMED value, matching what was validated. saveKey already
    // trims, but storage is hand-editable, and surrounding whitespace in an
    // HTTP header value is a malformed request rather than a helpful one.
    if (value && isWellFormedKey(value)) return value.trim();
  }
  return null;
}

/**
 * Which scope holds the key in force. Mirrors readKey's validation so a
 * garbage value left in storage can't report a scope that readKey ignores —
 * the two must never disagree about whether a key exists.
 */
export function keyScope(): KeyScope | null {
  for (const scope of ['session', 'device'] as const) {
    const value = storageFor(scope)?.getItem(STORAGE_KEY);
    if (value && isWellFormedKey(value)) return scope;
  }
  return null;
}

export function hasKey(): boolean {
  return readKey() !== null;
}

export function saveKey(rawKey: string, scope: KeyScope = 'device'): Result<{ masked: string }> {
  const key = rawKey.trim();
  if (!key) return err('Paste your Anthropic API key.');
  if (!isWellFormedKey(key)) {
    // Deliberately does NOT echo what was pasted — an error string can end up
    // in a log, a screenshot, or a bug report.
    return err("That doesn't look like an Anthropic API key. They start with “sk-ant-”.");
  }

  const store = storageFor(scope);
  if (!store) return err('This browser is blocking storage, so the key cannot be saved here.');

  // Write BEFORE clearing. Reachability is not writability — iOS private mode
  // and a full quota both throw on setItem — and clearing first meant a failed
  // rotation destroyed the working key the contractor still had.
  try {
    store.setItem(STORAGE_KEY, key);
  } catch {
    return err('This browser refused to store the key (private mode, or storage is full).');
  }

  // Only now is it safe to drop the copy in the other scope.
  clearScope(scope === 'device' ? 'session' : 'device');
  notify();
  return ok({ masked: maskKey(key) });
}

/**
 * Moves an already-saved key between scopes. Exists because the scope choice
 * is a safety decision — "this tab only" on a borrowed laptop — and a picker
 * that looks applied while the key quietly stays in localStorage is worse than
 * no picker at all.
 */
export function moveKeyToScope(scope: KeyScope): Result<KeyScope> {
  const key = readKey();
  if (!key) return err('There is no key to move.');
  if (keyScope() === scope) return ok(scope);

  const saved = saveKey(key, scope);
  if (!saved.ok) return saved;
  return ok(scope);
}

function clearScope(scope: KeyScope): void {
  const store = storageFor(scope);
  try {
    store?.removeItem(STORAGE_KEY);
    store?.removeItem(SCOPE_KEY);
  } catch {
    // Nothing to do; the key was never stored here.
  }
}

export function clearKey(): void {
  clearScope('device');
  clearScope('session');
  notify();
}

/**
 * Change notification.
 *
 * The key deliberately lives outside the store system, so consumers have
 * nothing to subscribe to — and two independent KeySheets (the assistant's and
 * the More page's) can mutate it while both are mounted. Without this, one
 * would keep rendering a key the other just removed.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToKey(listener: Listener): () => void {
  listeners.add(listener);

  // Another tab changing the key counts as a change here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  const target = typeof window === 'undefined' ? null : window;
  target?.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    target?.removeEventListener('storage', onStorage);
  };
}

/**
 * The header block for an outgoing request. Empty when no key is configured,
 * so the proxy falls back to its own server-side key.
 */
export function byokHeaders(): Record<string, string> {
  const key = readKey();
  return key ? { [BYOK_HEADER]: key } : {};
}
