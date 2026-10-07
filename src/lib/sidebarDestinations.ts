/**
 * Routes that are direct sidebar destinations. The user got there by clicking a
 * persistent nav item, so there is no "back" to go to and PageHeader never draws
 * a back chevron on them, whatever the page asks for. Drill-down pages
 * (/team/[id], /assessment/[id], /season/[id]...) are not listed and keep theirs.
 *
 * Keep in step with the links built in components/AppShell.tsx.
 */
const SIDEBAR_DESTINATIONS = new Set([
  '/dashboard',
  '/teams',
  '/calendar',
  '/library',
  '/reports',
  '/search',
  '/my-athletes',
  '/archived-assessments',
  '/shared-athletes',
  '/enterprise',
  '/payments',
  '/organization/members',
  '/loyalty',
  '/upgrade',
  '/feedback',
  '/feedback/reports',
  '/profile',
  '/founder',
  '/founder/feature-blocks',
  '/founder/analytics',
  '/founder/billing',
  '/founder/users',
  '/founder/support',
  '/founder/announcements',
  '/founder/email-log',
  '/founder/audit-log',
]);

export function isSidebarDestination(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return SIDEBAR_DESTINATIONS.has(clean);
}
