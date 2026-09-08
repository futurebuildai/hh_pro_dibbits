import type { TeamMember } from '../domain/team';
import { DEMO_TEAM } from './demo-seed';

/**
 * The contractor's people, from the swappable demo layer.
 *
 * Four seats, one per role, so the demo can show what each role sees without
 * anyone having to invent a coworker first. The account's named contact is the
 * owner and the default actor. Ty has no email on purpose — a field hand who
 * has never been sent a login is exactly the case the Team screen has to
 * render without falling over.
 */
export const SEED_TEAM: TeamMember[] = DEMO_TEAM;
