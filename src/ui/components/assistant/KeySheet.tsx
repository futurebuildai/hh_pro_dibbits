import {
  type KeyScope,
  clearKey,
  keyScope,
  maskKey,
  moveKeyToScope,
  readKey,
  saveKey,
} from '@core/ai/byok';
import { Button } from '@ui/components/ui/Button';
import { Sheet } from '@ui/components/ui/Sheet';
import { cn } from '@ui/lib/cn';
import { Check, ExternalLink, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Where a key gets pasted.
 *
 * It is a credential, so the sheet behaves like one: masked by default, an
 * explicit reveal, a storage choice that is stated in plain words rather than
 * buried, and removal that takes one tap. Nothing here ever renders the key
 * into a toast, an error, or a log.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Told when the key changes, so the caller can re-enable the assistant. */
  onChange?: (() => void) | undefined;
}

export function KeySheet({ open, onOpenChange, onChange }: Props) {
  const [draft, setDraft] = useState('');
  const [scope, setScope] = useState<KeyScope>('device');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = readKey();
  const existingScope = keyScope();

  // Reopening is a fresh attempt — never leave a half-typed key sitting in
  // state, and never prefill the field with the stored key.
  useEffect(() => {
    if (!open) return;
    setDraft('');
    setReveal(false);
    setError(null);
    setScope(keyScope() ?? 'device');
  }, [open]);

  // With a key already saved and no new one typed, the button commits the
  // SCOPE change instead. Without this, tapping "This tab only" on a borrowed
  // laptop looked applied while the key quietly stayed in localStorage —
  // the worst possible outcome for a control whose whole job is safety.
  const scopeOnly = Boolean(existing) && draft.trim().length === 0 && scope !== existingScope;

  function save() {
    const result = scopeOnly ? moveKeyToScope(scope) : saveKey(draft, scope);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft('');
    setError(null);
    onChange?.();
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Anthropic API key"
      description="The assistant runs on a real Claude model. Use your own key until the server has one."
      footer={
        <Button full size="lg" disabled={draft.trim().length === 0 && !scopeOnly} onClick={save}>
          {scopeOnly
            ? scope === 'session'
              ? 'Move to this tab only'
              : 'Save on this device'
            : existing
              ? 'Replace key'
              : 'Save key'}
        </Button>
      }
    >
      {existing ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-surface-inset p-3">
          <Check size={16} strokeWidth={2.5} style={{ color: 'var(--success)' }} />
          <span className="min-w-0 flex-1">
            <span className="text-data block truncate text-[13px]">{maskKey(existing)}</span>
            <span className="block text-[11.5px] text-text-muted">
              {existingScope === 'session' ? 'This tab only' : 'Saved on this device'}
            </span>
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              clearKey();
              onChange?.();
              onOpenChange(false);
            }}
          >
            <Trash2 size={14} strokeWidth={2} />
            Remove
          </Button>
        </div>
      ) : null}

      <label className="block">
        <span className="mb-1 block font-medium text-[13px]">
          {existing ? 'New key' : 'Your key'}
        </span>
        <div className="relative">
          <input
            // A password field by default: shoulder-surfing on a jobsite is
            // not a hypothetical, and browsers keep these out of autofill logs.
            type={reveal ? 'text' : 'password'}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="sk-ant-..."
            className="text-data min-h-12 w-full rounded-lg border border-border bg-surface pr-12 pl-3 text-[14px] outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={() => setReveal((value) => !value)}
            aria-label={reveal ? 'Hide key' : 'Show key'}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-text-muted"
          >
            {reveal ? <EyeOff size={17} strokeWidth={2} /> : <Eye size={17} strokeWidth={2} />}
          </button>
        </div>
      </label>

      {error ? (
        <p className="mt-2 text-[12.5px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      <p className="mt-4 mb-1.5 font-medium text-[13px]">Where to keep it</p>
      <div className="space-y-2">
        <ScopeOption
          active={scope === 'device'}
          title="On this device"
          detail="Stays until you remove it. Best for your own machine."
          onClick={() => setScope('device')}
        />
        <ScopeOption
          active={scope === 'session'}
          title="This tab only"
          detail="Gone when the tab closes. Use on a shared or client machine."
          onClick={() => setScope('session')}
        />
      </div>

      <div className="mt-4 rounded-lg bg-surface-inset p-3">
        <p className="text-[11.5px] leading-relaxed text-text-muted">
          Your key is stored in this browser and sent only to this app's own server, which forwards
          it to Anthropic and keeps no copy. Anyone with access to this browser profile can read it
          — on a machine that isn't yours, choose “this tab only”. Usage bills to your Anthropic
          account.
        </p>
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[12.5px] font-medium text-brand"
        >
          Get a key from the Anthropic Console
          <ExternalLink size={13} strokeWidth={2} />
        </a>
      </div>
    </Sheet>
  );
}

function ScopeOption({
  active,
  title,
  detail,
  onClick,
}: {
  active: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 text-left transition-colors',
        active ? 'border-brand bg-brand-tint' : 'border-border hover:bg-surface-2',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
          active ? 'border-brand' : 'border-border-strong',
        )}
      >
        {active ? <span className="h-2.5 w-2.5 rounded-full bg-brand" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-[13.5px]">{title}</span>
        <span className="block text-[11.5px] leading-snug text-text-muted">{detail}</span>
      </span>
    </button>
  );
}
