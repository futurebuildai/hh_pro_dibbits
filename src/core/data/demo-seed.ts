import type { Location } from '../domain/catalog';
import type { Address } from '../domain/project';
import type { TeamMember, TeamRole } from '../domain/team';
import raw from './demo-seed.json';

/**
 * The typed door onto `demo-seed.json` — the demo tenant's places and people.
 *
 * Why a JSON layer at all: none of this is logic. Which town a job sits in and
 * what the crew are called are facts about one demo, and they were previously
 * spread across four TypeScript modules as literals — which is how the seeded
 * project addresses ended up reading `Belleville, SD 57104`: an Ontario city,
 * a South Dakota state code left over from the LumberNow fork, and a Sioux
 * Falls postcode, on every project. Nothing failed, because the UI only ever
 * renders `city, state`.
 *
 * What deliberately did NOT move here: the catalog. `products.json`,
 * `brands.json` and `product-colours.json` describe REAL manufacturers, and
 * the colour data is researched provenance that was checked against those
 * makers' own published swatches. Relocalising the catalog would mean
 * inventing that research again for a different set of products, so the
 * catalog stays as it is and the mismatch (Canadian-made pavers in a San Diego
 * yard) is a known, documented gap rather than a fabricated fix.
 */

interface RawYard {
  id: string;
  name: string;
  kind: 'yard';
  primary: boolean;
  line1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

interface RawSite {
  city: string;
  state: string;
  zip: string;
}

export interface DemoYard extends Location {
  primary: boolean;
  address: Address;
  phone: string;
  /** "Point Loma — 1849 Catalina Blvd", for will-call copy. */
  pickupLine: string;
}

const yardsRaw = raw.yards as RawYard[];

export const DEMO_YARDS: DemoYard[] = yardsRaw.map((yard) => ({
  id: yard.id,
  name: yard.name,
  kind: 'yard',
  primary: yard.primary,
  phone: yard.phone,
  address: {
    id: `addr_${yard.id}`,
    label: yard.name,
    line1: yard.line1,
    city: yard.city,
    state: yard.state,
    zip: yard.zip,
  },
  pickupLine: `${yard.name} — ${yard.line1}`,
}));

/**
 * The yard that holds the bulk of stock and fills will-call by default.
 *
 * Falls back to the first entry rather than throwing: a demo fixture with no
 * `primary: true` should look wrong, not take the whole app down on boot.
 */
export const PRIMARY_YARD: DemoYard =
  DEMO_YARDS.find((yard) => yard.primary) ?? (DEMO_YARDS[0] as DemoYard);

export const DC_LOCATION: Location = {
  id: raw.distributionCenter.id,
  name: raw.distributionCenter.name,
  kind: 'warehouse',
};

export const DEMO_LOCATIONS: Location[] = [
  ...DEMO_YARDS.map(({ id, name, kind }) => ({ id, name, kind })),
  DC_LOCATION,
];

export const DEMO_REGION: string = raw.region;

export const DEMO_ACCOUNT_FACTS = {
  id: raw.account.id,
  name: raw.account.name,
  accountNumber: raw.account.accountNumber,
  contactName: raw.account.contactName,
  phone: raw.account.phone,
  email: raw.account.email,
  licenseNumber: raw.account.licenseNumber,
  yard: raw.account.yard as Address,
};

export const DEMO_TEAM: TeamMember[] = (raw.team as { role: string }[]).map((member) => {
  const entry = member as RawTeamMember;
  return {
    id: entry.id,
    name: entry.name,
    role: entry.role as TeamRole,
    initials: entry.initials,
    createdAt: entry.createdAt,
    // exactOptionalPropertyTypes: an absent email must be ABSENT, not
    // `undefined` — the difference is what gets JSON-serialised into a save.
    ...(entry.email ? { email: entry.email } : {}),
  };
});

interface RawTeamMember {
  id: string;
  name: string;
  role: string;
  email?: string;
  initials: string;
  createdAt: string;
}

const sites = raw.sites as Record<string, RawSite>;

/**
 * Where a seeded project's site is. Unknown ids fall back to the primary
 * yard's town, so adding a project to `scenario.ts` without adding it here
 * produces a plausible address rather than a blank one.
 */
export function siteFor(projectId: string): RawSite {
  return (
    sites[projectId] ?? {
      city: PRIMARY_YARD.address.city,
      state: PRIMARY_YARD.address.state,
      zip: PRIMARY_YARD.address.zip,
    }
  );
}
