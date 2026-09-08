import { activeMember } from '@core/actions/team';
import { isEnabled } from '@core/config/runtime';
import { unreadCount } from '@core/domain/activity';
import { activityStore, sessionStore } from '@core/stores/root';
import { teamStore } from '@core/stores/root';
import { DealerLogo } from '@ui/components/brand/DealerLogo';
import { Avatar } from '@ui/components/team/Avatar';
import { PersonSwitcher } from '@ui/components/team/PersonSwitcher';
import { useStore } from '@ui/hooks/useStore';
import { cn } from '@ui/lib/cn';
import {
  Bell,
  CreditCard,
  LayoutGrid,
  MoreHorizontal,
  Search,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';

/**
 * The app shell.
 *
 * Four destinations, deliberately. Every extra top-level item is a decision the
 * contractor has to make before they can do anything, and "extra simple" was
 * the mandate. Orders, quotes, and invoices are not destinations — they are
 * stages of the board.
 *
 * Mobile is a bottom tab bar with the assistant raised in the centre: it is the
 * differentiating feature and it lands under the thumb. Desktop is a sidebar,
 * because a 1400px screen with a bottom bar wastes the whole left edge.
 */

export type PortalTab = 'board' | 'catalog' | 'pay' | 'more';

interface Props {
  tab: PortalTab;
  onTabChange: (tab: PortalTab) => void;
  onOpenAssistant: () => void;
  onOpenActivity: () => void;
  onOpenDemo: () => void;
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode | undefined;
  /** Sub-pages (order, project) render their own header with a back control. */
  hideChrome?: boolean | undefined;
  children: ReactNode;
}

const ALL_NAV: { id: PortalTab; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'board', label: 'Board', icon: LayoutGrid },
  { id: 'catalog', label: 'Catalog', icon: Search },
  { id: 'pay', label: 'Pay', icon: CreditCard },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

/**
 * A dealer who handles AR elsewhere turns payments off, and the Pay tab goes
 * with it. The centre assistant button is likewise the dealer's call.
 *
 * Hiding a tab is presentation only — the actions layer still guards every
 * mutation, so a flag is never the only thing standing between a contractor
 * and a mistake.
 */
function navItems() {
  return ALL_NAV.filter((item) => (item.id === 'pay' ? isEnabled('payments') : true));
}

export function PortalLayout({
  tab,
  onTabChange,
  onOpenAssistant,
  onOpenActivity,
  onOpenDemo,
  title,
  subtitle,
  actions,
  hideChrome,
  children,
}: Props) {
  const account = useStore(sessionStore, (state) => state.account);
  const unread = useStore(activityStore, unreadCount);
  useStore(teamStore, (state) => state);
  const acting = activeMember();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-surface-2 lg:flex">
      {/* ---- Desktop sidebar ----
          The shell frame, and the ONLY layer that opts into the chrome tokens.
          They are used unconditionally, with no `if`: theme.css defaults every
          --brand-chrome-* to the platform surface it replaces, so a dealer who
          sets no chrome colour still gets today's white sidebar. Everything
          under <main> stays platform-coloured, so "Order" looks like Order on
          every deployment. */}
      <aside className="hidden w-60 shrink-0 border-r border-brand-chrome-line bg-brand-chrome lg:flex lg:flex-col">
        <div className="border-b border-brand-chrome-line px-5 py-4">
          {/* The lockup, not a bare name: mark plus live wordmark. This is the
              ONE place the company name renders as TEXT in this component —
              the mobile header carries the mark alone, labelled. */}
          <DealerLogo variant="lockup" tone="reverse" size={24} className="text-brand-chrome-on" />
          <p className="truncate text-[12px] text-brand-chrome-muted">{account?.name ?? ''}</p>
        </div>

        <nav className="flex flex-col gap-0.5 p-3">
          {navItems().map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                // Active is a RAISED chrome pill, not the brand tint: --brand-tint
                // is a 90%-white wash of the identity colour, which on a navy
                // frame is a near-white slab, and on a white frame is invisible.
                // --brand-chrome-2 is defined relative to the chrome itself, so
                // it lifts correctly whichever way the frame goes.
                tab === item.id
                  ? 'bg-brand-chrome-2 text-brand-chrome-accent'
                  : 'text-brand-chrome-muted hover:bg-brand-chrome-2 hover:text-brand-chrome-on',
              )}
            >
              <item.icon size={17} strokeWidth={2} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-1 p-3">
          {acting ? (
            <button
              type="button"
              onClick={() => setSwitcherOpen(true)}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-brand-chrome-muted transition-colors hover:bg-brand-chrome-2 hover:text-brand-chrome-on"
            >
              {/* onChrome: the role tint is keyed to platform hues, and a
                  --brand-derived tint on a navy frame is navy-on-navy with
                  near-black initials. See Avatar. */}
              <Avatar initials={acting.initials} role={acting.role} size="sm" onChrome />
              <span className="truncate">{acting.name}</span>
            </button>
          ) : null}
          <SidebarAction icon={Bell} label="Activity" badge={unread} onClick={onOpenActivity} />
          <SidebarAction icon={Wand2} label="Demo controls" onClick={onOpenDemo} />
          {isEnabled('assistant') ? (
            <button
              type="button"
              onClick={onOpenAssistant}
              // A filled, pressable control, so it takes the ACTION role
              // (--brand-fill), not identity. The ink comes with it:
              // --brand-fill-on is derived by contrast at emit time, which is
              // what stops white-on-gold at 1.61:1.
              className="flex min-h-11 w-full items-center gap-2.5 rounded-lg bg-brand-fill px-3 text-sm font-medium text-brand-fill-on transition-colors hover:bg-brand-fill-hover"
            >
              <Sparkles size={16} strokeWidth={2} />
              Ask the assistant
            </button>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {hideChrome ? null : (
          // Chrome on BOTH breakpoints: this header is the top of the frame on
          // desktop as well as the only frame on a phone.
          <header className="sticky top-0 z-30 border-b border-brand-chrome-line bg-brand-chrome/95 px-4 py-3 backdrop-blur safe-top lg:static lg:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {/* The mark leads the title on a phone, where there is no
                    sidebar to carry the identity. MARK ONLY — the sidebar
                    lockup already renders the company name as text, and both
                    live in the same tree (they are separated by CSS, not by
                    mounting), so a second text node would make the name
                    ambiguous to `getByText` and announce it twice. The mark
                    carries its own aria-label instead. */}
                <DealerLogo
                  variant="mark"
                  tone="reverse"
                  size={26}
                  className="shrink-0 lg:hidden"
                />
                <div className="min-w-0">
                  <h1 className="truncate text-[17px] font-semibold text-brand-chrome-on tracking-tight">
                    {title}
                  </h1>
                  {subtitle ? (
                    <p className="truncate text-[12px] text-brand-chrome-muted">{subtitle}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {actions}
                {acting ? (
                  <button
                    type="button"
                    onClick={() => setSwitcherOpen(true)}
                    aria-label={`Acting as ${acting.name} — switch person`}
                    className="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-brand-chrome-2 lg:hidden"
                  >
                    <Avatar initials={acting.initials} role={acting.role} size="sm" onChrome />
                  </button>
                ) : null}
                {/* Desktop reaches these from the sidebar. */}
                <button
                  type="button"
                  onClick={onOpenDemo}
                  aria-label="Demo controls"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-brand-chrome-muted transition-colors hover:bg-brand-chrome-2 hover:text-brand-chrome-on lg:hidden"
                >
                  <Wand2 size={18} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={onOpenActivity}
                  aria-label={unread > 0 ? `Activity, ${unread} new` : 'Activity'}
                  className="relative flex h-10 w-10 items-center justify-center rounded-lg text-brand-chrome-muted transition-colors hover:bg-brand-chrome-2 hover:text-brand-chrome-on lg:hidden"
                >
                  <Bell size={18} strokeWidth={2} />
                  {unread > 0 ? (
                    <span
                      className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-semibold text-[9.5px] text-on-signal"
                      style={{ background: 'var(--danger)' }}
                    >
                      {unread > 9 ? '9+' : unread}
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
          </header>
        )}

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {/* ---- Mobile bottom bar ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-brand-chrome-line bg-brand-chrome/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-lg items-end justify-around px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5">
          {navItems()
            .slice(0, 2)
            .map((item) => (
              <TabButton key={item.id} item={item} active={tab === item.id} onClick={onTabChange} />
            ))}

          {/* Raised centre action — the assistant is the differentiator. */}
          {isEnabled('assistant') ? (
            <button
              type="button"
              onClick={onOpenAssistant}
              aria-label="Ask the assistant"
              // The action fill, plus a chrome RING — which is a measured fix,
              // not decoration. `-mt-5` lifts the top of this button clear of
              // the translucent tab bar and onto the page, where gold measures
              // 1.52:1 against --surface-2: no perceivable edge at all. The
              // ring reads 9.96:1 against the gold on its inner side and
              // 15.16:1 against the light page on its outer side, so the
              // button has a boundary on both grounds it overlaps. It costs
              // nothing on an unbranded deployment, where --brand-chrome is
              // just --surface.
              className="-mt-5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-fill text-brand-fill-on shadow-[var(--shadow-lifted)] ring-2 ring-brand-chrome transition-transform active:scale-95"
            >
              <Sparkles size={22} strokeWidth={2} />
            </button>
          ) : null}

          {navItems()
            .slice(2)
            .map((item) => (
              <TabButton key={item.id} item={item} active={tab === item.id} onClick={onTabChange} />
            ))}
        </div>
      </nav>

      <PersonSwitcher open={switcherOpen} onOpenChange={setSwitcherOpen} />
    </div>
  );
}

function SidebarAction({
  icon: Icon,
  label,
  badge,
  onClick,
}: {
  icon: typeof Bell;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-brand-chrome-muted transition-colors hover:bg-brand-chrome-2 hover:text-brand-chrome-on"
    >
      <Icon size={17} strokeWidth={2} />
      {label}
      {badge && badge > 0 ? (
        <span
          className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold text-on-signal"
          style={{ background: 'var(--danger)' }}
        >
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
}

function TabButton({
  item,
  active,
  onClick,
}: {
  item: (typeof ALL_NAV)[number];
  active: boolean;
  onClick: (tab: PortalTab) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(item.id)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 min-w-16 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 transition-colors',
        active ? 'text-brand-chrome-accent' : 'text-brand-chrome-muted',
      )}
    >
      <item.icon size={20} strokeWidth={active ? 2.4 : 2} />
      <span className="text-[10.5px] font-medium">{item.label}</span>
    </button>
  );
}
