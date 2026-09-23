/**
 * The hub sections a founder can turn off for the whole platform from the
 * console — a lighter tool than Suspend (see
 * supabase/migrations/20260923120000_founder_feature_blocks.sql). This is a
 * UI-level gate: the app hides the nav item and shows a blocked screen in its
 * place, not a data boundary enforced by RLS.
 */
export const BLOCKABLE_FEATURES = [
  'evaluations',
  'teams',
  'dashboard',
  'profile',
  'myAthletes',
  'organization',
  'loyalty',
  'billing',
] as const;

export type BlockableFeature = (typeof BLOCKABLE_FEATURES)[number];

export const BLOCKABLE_FEATURE_LABEL: Record<BlockableFeature, string> = {
  evaluations: 'Evaluations',
  teams: 'Teams',
  dashboard: 'Dashboard',
  profile: 'Profile',
  myAthletes: 'My Athletes',
  organization: 'Manage Organization',
  loyalty: 'Loyalty Program',
  billing: 'Plans & Billing',
};

export function isBlockableFeature(value: string): value is BlockableFeature {
  return (BLOCKABLE_FEATURES as readonly string[]).includes(value);
}

/**
 * Which section a route belongs to, or null if it isn't gated. Deliberately
 * narrow — only these named top-level destinations, not every page nested
 * under them (e.g. a team's own detail page keeps working even when "Teams"
 * is blocked, since that isn't one of the named sections).
 */
export function blockableFeatureForPath(pathname: string, isGuardian: boolean): BlockableFeature | null {
  if (pathname === '/profile' || pathname.startsWith('/profile/')) return 'profile';
  if (pathname === '/teams' || pathname.startsWith('/teams/')) return 'teams';
  if (pathname === '/enterprise' || pathname.startsWith('/enterprise/')) return 'dashboard';
  if (pathname === '/organization' || pathname.startsWith('/organization/')) return 'organization';
  if (pathname === '/loyalty' || pathname.startsWith('/loyalty/')) return 'loyalty';
  if (pathname === '/upgrade' || pathname.startsWith('/upgrade/')) return 'billing';
  if (!isGuardian && (pathname === '/my-athletes' || pathname.startsWith('/my-athletes/'))) return 'myAthletes';
  if (!isGuardian && (pathname === '/dashboard' || pathname.startsWith('/dashboard/'))) return 'evaluations';
  return null;
}
