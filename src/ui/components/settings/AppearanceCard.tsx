import { cn } from '@ui/lib/cn';
import {
  type ThemeChoice,
  readThemeChoice,
  resolveTheme,
  setThemeChoice,
  subscribeTheme,
} from '@ui/lib/theme';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

/**
 * Appearance, in the profile sheet.
 *
 * The dark palette has been complete and first-class in `theme.css` since the
 * design system was written, and until now nothing in the product could reach
 * it — only the guide capture script ever stamped the attribute, so dark mode
 * existed solely to be photographed. This is the control that makes it real.
 *
 * Light leads and is the default: the palette is measured for a phone in
 * direct sun, which is this product's stated premise. Dark is a genuine choice
 * beside it, not a hidden one.
 *
 * Real `<input type="radio">`s rather than buttons with `role="radio"`. The
 * roving-focus and arrow-key behaviour of a radio group is a surprising amount
 * of code to reimplement, and every reimplementation is worse than the one the
 * browser already ships.
 */

const OPTIONS: { id: ThemeChoice; label: string; icon: typeof Sun; hint: string }[] = [
  { id: 'light', label: 'Light', icon: Sun, hint: 'Built for daylight and gloves.' },
  { id: 'dark', label: 'Dark', icon: Moon, hint: 'Easier in a cab at night.' },
  { id: 'system', label: 'System', icon: Monitor, hint: 'Follow this device.' },
];

export function AppearanceCard() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice());
  const name = useId();

  // Another surface can change this; keep in step rather than going stale.
  useEffect(() => subscribeTheme(setChoice), []);

  const active = OPTIONS.find((option) => option.id === choice) ?? OPTIONS[0];

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="font-semibold text-[15px] tracking-tight">Appearance</h2>
      <p className="mt-0.5 text-[12.5px] text-text-muted">{active?.hint}</p>

      <fieldset className="mt-3 grid grid-cols-3 gap-2 border-0 p-0">
        <legend className="sr-only">Appearance</legend>
        {OPTIONS.map((option) => {
          const selected = option.id === choice;
          return (
            <label
              key={option.id}
              className={cn(
                'flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1',
                'rounded-lg border px-2 py-2 font-medium text-[12.5px] transition-colors',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                'has-[:focus-visible]:outline-brand',
                // Selection carries border weight and a fill as well as hue —
                // never colour alone.
                selected
                  ? 'border-brand bg-brand-tint text-brand'
                  : 'border-border text-text-muted hover:bg-surface-3 hover:text-text',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={selected}
                onChange={() => setThemeChoice(option.id)}
                className="sr-only"
              />
              <option.icon size={17} strokeWidth={2} aria-hidden />
              {option.label}
            </label>
          );
        })}
      </fieldset>

      {choice === 'system' ? (
        <p className="mt-2 text-[12px] text-text-subtle">
          Currently showing {resolveTheme('system')}.
        </p>
      ) : null}
    </section>
  );
}
