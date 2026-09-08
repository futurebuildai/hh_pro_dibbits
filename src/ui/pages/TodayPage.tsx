import { activeMember } from '@core/actions/team';
import { getContext } from '@core/boot';
import { sessionStore, teamStore } from '@core/stores/root';
import { useStore } from '@ui/hooks/useStore';

/**
 * The Today dashboard, pass 1: a real greeting header.
 *
 * The rep card, 7-day strip, matrix, and "Needs you" selector are later passes.
 * For now this is a landing screen that says who is acting and which account
 * this is, so the new Today tab is not a dead route.
 */

export function TodayPage() {
  useStore(teamStore, (state) => state);
  const account = useStore(sessionStore, (state) => state.account);
  const acting = activeMember();

  const now = getContext().clock.nowIso();
  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="mx-auto max-w-3xl p-4 pb-24 lg:px-6 lg:py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          {acting ? `${greeting}, ${acting.name.split(' ')[0]}` : greeting}
        </h1>
        {account ? <p className="mt-1 text-[15px] text-text-muted">{account.name}</p> : null}
      </header>
    </div>
  );
}
