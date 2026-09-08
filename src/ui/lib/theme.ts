/**
 * The viewer's light/dark preference.
 *
 * Until now `theme.css` carried a complete, first-class dark palette that
 * NOTHING could reach: `:root[data-theme="dark"]` was only ever stamped by
 * `scripts/capture-guide.mjs`, so dark mode existed solely to be
 * screenshotted. There was no toggle, and no `prefers-color-scheme` rule
 * either. This module is the missing half.
 *
 * Light is the DEFAULT and stays the default. That is a product decision, not
 * an oversight: contractors read this in trucks and in direct sun, and the
 * palette is measured for that. `system` is offered, but a viewer has to ask
 * for it — a dark OS is a statement about someone's laptop at night, not about
 * the phone in their hand on a site at noon.
 *
 * Lives in `src/ui/`, not `src/core/`: it touches `document` and
 * `localStorage`, and core is framework-free AND runs in a node test project
 * where neither exists.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

/** Matches the `hh:` namespace the persistence layer already owns. */
export const THEME_KEY = 'hh:theme';

const CHOICES: ThemeChoice[] = ['light', 'dark', 'system'];

export function readThemeChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return CHOICES.includes(raw as ThemeChoice) ? (raw as ThemeChoice) : 'light';
  } catch {
    // A private window, blocked site data, or a thumbnail renderer: the
    // accessor itself throws. A missing preference is not an error state.
    return 'light';
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return choice;
}

/**
 * Stamp the attribute the stylesheet actually keys on.
 *
 * Only 'dark' sets it; 'light' REMOVES it, so light stays the bare `:root`
 * case. That matters for the dealer branding tag: `brandingCss` emits
 * `:root:root` and `:root:root[data-theme="dark"]`, and leaving a
 * `data-theme="light"` attribute behind would be a third state neither block
 * describes.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (resolveTheme(choice) === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Preference is lost on reload, but the current session still switches.
  }
  applyTheme(choice);
  for (const fn of listeners) fn(choice);
}

const listeners = new Set<(choice: ThemeChoice) => void>();

export function subscribeTheme(fn: (choice: ThemeChoice) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Called once from `main.tsx`. Re-applies on OS change, but ONLY while the
 * viewer has chosen 'system' — otherwise a laptop flipping to night mode would
 * override an explicit choice.
 */
export function startTheme(): void {
  applyTheme(readThemeChoice());
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (readThemeChoice() === 'system') applyTheme('system');
    });
  } catch {
    // matchMedia is absent in some embedded webviews; the stamp above stands.
  }
}
