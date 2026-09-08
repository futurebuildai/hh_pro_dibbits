import type { TeamRole } from '@core/domain/team';
import { cn } from '@ui/lib/cn';

/**
 * Initials chip. The TINT is keyed to role, so "who can do what" is legible at
 * a glance across every surface that shows people.
 *
 * The initials themselves are near-black rather than the role colour, and that
 * is a contrast decision rather than a stylistic one. Role-coloured text on a
 * tint of the same hue measured 4.43:1 — just under AA — and the owner tint is
 * derived from `--brand`, which a DEALER sets, so no fixed value could keep it
 * safe. A dark ink on a light tint passes for any hue a dealer can choose.
 * Colour still carries the role; it is simply no longer carrying the text.
 */

const ROLE_TINTS: Record<TeamRole, string> = {
  owner: 'color-mix(in oklch, var(--brand), transparent 86%)',
  pm: 'color-mix(in oklch, var(--stage-order), transparent 86%)',
  ap: 'color-mix(in oklch, var(--success), transparent 86%)',
  field: 'var(--surface-3)',
};

/**
 * THE SAME DEFECT, ONE SURFACE OVER.
 *
 * Every tint above is a wash of a PLATFORM hue over an assumed light card, and
 * the near-black ink assumes the same. Inside the shell frame that assumption
 * breaks: a dealer who sets a navy `--brand-chrome` gets a navy-derived wash on
 * navy carrying near-black initials — the exact invisible chip `npm run a11y`
 * already caught once at 4.43:1, arrived at from the other direction.
 *
 * So the chrome variant anchors on the chrome's OWN pair. `--brand-chrome-accent`
 * is by construction legible against `--brand-chrome` (it is the accent the
 * emitter borrowed from the opposite theme for exactly that reason), and
 * `--brand-chrome-on` is the ink the whole frame already uses. Both default to
 * `--brand` / `--text` in `theme.css`, so an unbranded deployment renders the
 * chip it renders today.
 *
 * Role hue is deliberately not preserved here. The shell shows exactly ONE
 * person — whoever you are acting as — so there is no second chip to compare a
 * hue against, and the role legend lives on the Team page, which stays on a
 * card and keeps the measured pairing above.
 */
const CHROME_TINT = 'color-mix(in oklch, var(--brand-chrome-accent), transparent 86%)';

export function Avatar({
  initials,
  role,
  size = 'md',
  onChrome,
  className,
}: {
  initials: string;
  role: TeamRole;
  size?: 'sm' | 'md' | 'lg' | undefined;
  /**
   * Opt in when this chip sits on the shell frame (sidebar, mobile header)
   * rather than inside `<main>`. Off by default: `<main>` is platform-coloured
   * on every deployment and the card pairing is the measured one.
   */
  onChrome?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        size === 'sm' && 'h-7 w-7 text-[10.5px]',
        size === 'md' && 'h-9 w-9 text-[12.5px]',
        size === 'lg' && 'h-11 w-11 text-[15px]',
        className,
      )}
      style={
        onChrome
          ? { background: CHROME_TINT, color: 'var(--brand-chrome-on)' }
          : { background: ROLE_TINTS[role], color: 'var(--text)' }
      }
    >
      {initials}
    </span>
  );
}
