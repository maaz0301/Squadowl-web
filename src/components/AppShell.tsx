'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { lockBodyScroll } from '@/lib/scrollLock';
import { useTheme, useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Button, LoadingState, ThemeToggle } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icons';
import { useAuthStore, usePermissions, useUser } from '@/state/authStore';
import { useIsFeedbackReviewerQuery, useGuardianRostersQuery, usePlatformBlockedFeaturesQuery } from '@/features/queries';
import { useIsFounderQuery } from '@/features/founderQueries';
import { featureForPath, trackFeatureUse } from '@/lib/analytics';
import { ImpersonationBanner, SuspendedAccountScreen, TrialEndingNotice } from '@/components/AccountAccessNotices';
import { prefetchRoute } from '@/features/prefetch';
import { AnnouncementBanner } from '@/components/AnnouncementBanner';
import { NavPending } from '@/components/NavPending';
import { SubscriptionEndingBanner } from '@/components/SubscriptionEndingBanner';
import { canUseFeature } from '@/data/plans';
import { APP_CONFIG } from '@/config/app';
import { blockableFeatureForPath } from '@/lib/blockableFeatures';
import { FeatureBlockedScreen } from '@/components/AccountAccessNotices';

/** Mirrors is_founder() in 20260916120000_founder_org_management.sql. */
const FOUNDER_EMAIL = 'founder@tryout.ca';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Highlight for any route beneath this prefix. */
  match?: string;
  /**
   * Highlight only on this exact path, not on the routes nested under it.
   *
   * For the pair of entries that share a prefix — /feedback and the reviewers'
   * /feedback/reports — where the default prefix match would light both up at
   * once on the deeper one.
   */
  exact?: boolean;
}

export function AppShell({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  const { isDark } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const user = useUser();
  const logout = useAuthStore((s) => s.logout);
  const { isGuardian, canManageOrganization } = usePermissions();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A tap on a nav item shouldn't leave the mobile drawer hanging open.
  // Adjusted during render on route change (React's documented "storing
  // information from previous renders" pattern) rather than in an effect,
  // which would paint one frame with the drawer still open.
  const [drawerPathname, setDrawerPathname] = useState(pathname);
  if (pathname !== drawerPathname) {
    setDrawerPathname(pathname);
    setDrawerOpen(false);
  }

  // While the drawer is up it owns the screen: the page behind it must not
  // scroll (iOS in particular happily scrolls the body under a fixed overlay),
  // and Escape should close it like any other dialog.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const releaseScroll = lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', onKey);
      releaseScroll();
    };
  }, [drawerOpen]);

  const planTier = user?.planTier ?? 'free';

  // The feedback portal is limited to an email allowlist held in the database
  // (`feedback_reviewers`), not to a plan or a role — so whether to draw the
  // link is a question only the server can answer. Guardians never see the
  // secondary nav at all, so they are not asked.
  const { data: isFeedbackReviewer } = useIsFeedbackReviewerQuery(!isGuardian);
  const { data: isFounder, isLoading: founderLoading } = useIsFounderQuery(!isGuardian);

  // The founder account operates the platform; it isn't a coach. It gets only
  // the console (and its profile, for the password) — no evaluations, teams or
  // billing of its own personal account. The address check only decides
  // whether to wait for the answer before painting, so no other user is held
  // up; is_founder() on the server stays the real gate. While viewing as an
  // organization the founder gets that organization's normal app instead,
  // under the read-only banner.
  const founderMode = isFounder === true && !user?.impersonating;
  const awaitingFounderCheck =
    founderLoading && user?.email.toLowerCase() === FOUNDER_EMAIL && !user.impersonating;
  const founderRouteAllowed = pathname.startsWith('/founder') || pathname.startsWith('/profile');

  useEffect(() => {
    if (founderMode && !founderRouteAllowed) router.replace('/founder');
  }, [founderMode, founderRouteAllowed, router]);

  // Feature usage for the founder's Analytics page. Not while viewing as — that
  // is the founder looking, not the customer using it (the server also skips
  // platform admins).
  const trackedFeature = user && !user.impersonating && !isFounder ? featureForPath(pathname) : null;
  useEffect(() => {
    if (trackedFeature) trackFeatureUse(trackedFeature);
  }, [trackedFeature, pathname]);

  // RLS has already cut a suspended account's data off; this just says so
  // rather than leaving every screen to fail on its own. The founder is never
  // blocked, and neither is "view as" — looking at a suspended org is the point.
  const blocked = user?.accessStatus === 'suspended' && !user.impersonating && !isFounder;

  // The founder blocked the section the current route belongs to (see
  // blockedFeatures below) — checked once that's in scope, further down.
  const routeBlockedFeature = blockableFeatureForPath(pathname, isGuardian);

  // Shares its cache with the dashboard's own read (same query key), so this
  // costs nothing extra — it just lets the sidebar know whether this
  // coach/assessor account is *also* linked as a guardian on some athlete
  // (e.g. coaching one team while parenting a player on another), so the
  // guardian-only "My Athletes" link can be folded into their nav too.
  const { data: guardianAthletes } = useGuardianRostersQuery(!isGuardian);
  const hasGuardianAthletes = !isGuardian && (guardianAthletes?.length ?? 0) > 0;

  // Hub sections the founder has turned off for the whole platform (see
  // src/lib/blockableFeatures.ts). A UI-level gate, so it's exempt for the
  // founder's own console and for "view as", same as the suspended check above.
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const blockedFeatures =
    founderMode || user?.impersonating ? new Set<string>() : new Set(platformBlockedFeatures ?? []);
  const hideIfBlocked = (items: NavItem[]) =>
    items.filter((item) => {
      const feature = blockableFeatureForPath(item.href, isGuardian);
      return !feature || !blockedFeatures.has(feature);
    });
  const featureBlocked = !!routeBlockedFeature && blockedFeatures.has(routeBlockedFeature);

  const primaryUnfiltered: NavItem[] = founderMode
    ? [
        { href: '/founder', label: 'Founder Console', icon: 'admin', exact: true },
        { href: '/founder/feature-blocks', label: 'Feature Blocks', icon: 'lock' },
        { href: '/founder/analytics', label: 'Analytics', icon: 'chart' },
        { href: '/founder/billing', label: 'Billing & Revenue', icon: 'payments' },
        { href: '/founder/users', label: 'Users', icon: 'members' },
        { href: '/founder/support', label: 'Support Inbox', icon: 'inbox' },
        { href: '/founder/announcements', label: 'Announcements', icon: 'megaphone' },
        { href: '/founder/email-log', label: 'Email Log', icon: 'mail' },
        { href: '/founder/audit-log', label: 'Audit Log', icon: 'history' },
        { href: '/profile', label: 'Profile', icon: 'profile' },
      ]
    : isGuardian
    ? [
        { href: '/dashboard', label: 'My Athletes', icon: 'teams' },
        { href: '/library', label: 'Library', icon: 'library' },
        { href: '/profile', label: 'Profile', icon: 'profile' },
      ]
    : [
        { href: '/dashboard', label: 'Evaluations', icon: 'assessments', match: '/assessment' },
        { href: '/teams', label: 'Teams', icon: 'teams', match: '/team' },
        { href: '/calendar', label: 'Calendar', icon: 'calendar' },
        { href: '/library', label: 'Library', icon: 'library' },
        { href: '/rubric-library', label: 'Rubrics Library', icon: 'rubrics' },
        { href: '/reports', label: 'Reports', icon: 'barChart' },
        { href: '/compare', label: 'Compare', icon: 'compare' },
        { href: '/search', label: 'Search', icon: 'search' },
        ...(hasGuardianAthletes
          ? ([{ href: '/my-athletes', label: 'My Athletes', icon: 'teams' }] as NavItem[])
          : []),
      ];
  const primary = hideIfBlocked(primaryUnfiltered);

  const secondaryUnfiltered: NavItem[] = isGuardian || founderMode
    ? []
    : [
        { href: '/archived-assessments', label: 'Archived', icon: 'archive' },
        { href: '/athlete-hub', label: 'Athlete Hub', icon: 'teams' },
        ...(canUseFeature(planTier, 'enterprise')
          ? ([{ href: '/enterprise', label: 'Dashboard', icon: 'enterprise' }] as NavItem[])
          : []),
        ...(canUseFeature(planTier, 'payments')
          ? ([{ href: '/payments', label: 'Payments', icon: 'payments' }] as NavItem[])
          : []),
        ...(canManageOrganization
          ? ([{ href: '/organization/members', label: 'Members', icon: 'members' }] as NavItem[])
          : []),
        { href: '/loyalty', label: 'Loyalty Program', icon: 'gift' },
        { href: '/upgrade', label: 'Plans & Billing', icon: 'upgrade' },
        { href: '/feedback', label: 'Feedback', icon: 'feedback', exact: true },
        ...(isFeedbackReviewer
          ? ([{ href: '/feedback/reports', label: 'Feedback Portal', icon: 'feedback' }] as NavItem[])
          : []),
      ];
  const secondary = hideIfBlocked(secondaryUnfiltered);

  const isActive = (item: NavItem) =>
    pathname === item.href ||
    (!item.exact && pathname.startsWith(`${item.href}/`)) ||
    (!!item.match && pathname.startsWith(item.match));

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item);
    // Hover, keyboard focus and the touch that precedes a tap are all a few
    // hundred milliseconds of warning before the click. Next already prefetches
    // the route's code on hover; this starts the screen's *data* on the same
    // signal, so by the time the page mounts the query is usually already in
    // flight or answered. Repeat signals are free — a warm cache short-circuits.
    //
    // The id and the guardian flag travel with it because a couple of these
    // reads are keyed on the user, and /dashboard means a different screen
    // depending on which one of them is asking.
    const warm = () => prefetchRoute(item.href, { userId: user?.id, isGuardian });
    return (
      <Link
        href={item.href}
        onMouseEnter={warm}
        onFocus={warm}
        onTouchStart={warm}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-colors"
        style={{
          backgroundColor: active ? 'rgba(255,107,43,0.12)' : 'transparent',
          color: active ? colors.primary : colors.inkMuted,
        }}
      >
        <Icon name={item.icon} size={19} color={active ? colors.primary : colors.inkMuted} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {/* Only ever visible when the warm-up didn't win the race — the wrapper
            holds its size, and stays invisible for the first ~120ms. */}
        <NavPending />
      </Link>
    );
  };

  const renderSidebar = (onDismiss?: () => void) => (
    <>
      <div className="mb-6 flex items-center gap-2">
        <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2.5 px-1">
          <Image src="/images/squadowl_emblem.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0" />
          <Image src={isDark ? '/images/squadowl_wordmark_dark.png' : '/images/squadowl_wordmark_light.png'} alt={APP_CONFIG.appName} width={520} height={124} sizes="140px" className="h-7 w-auto min-w-0" />
        </Link>
        {onDismiss ? (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onDismiss}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform active:scale-95"
            style={{ backgroundColor: colors.tile }}
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>

      <nav className="flex flex-col gap-1">
        {primary.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>

      {secondary.length ? (
        <>
          <p
            className="mt-6 mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.12em]"
            style={{ color: colors.inkFaint }}
          >
            Manage
          </p>
          <nav className="flex flex-col gap-1">
            {secondary.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </nav>
        </>
      ) : null}

      <div className="mt-auto pt-6">
        <Link
          href="/profile"
          className="flex items-center gap-3 rounded-xl border p-2.5 transition-colors hover:brightness-110"
          style={{ borderColor: colors.border, backgroundColor: colors.tile }}
        >
          <Avatar
            first={(user?.displayName ?? 'Coach').split(' ')[0] ?? 'C'}
            last={(user?.displayName ?? '').split(' ')[1] ?? ''}
            size={34}
            uri={user?.avatarUrl}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold" style={{ color: colors.ink }}>
              {user?.displayName ?? 'Coach'}
            </span>
            {!isGuardian && !founderMode ? (
              <span className="block truncate text-xs capitalize" style={{ color: colors.inkMuted }}>
                {planTier} plan
              </span>
            ) : null}
          </span>
        </Link>
        {!isGuardian && !founderMode && planTier !== 'club' && !blockedFeatures.has('billing') ? (
          <Button
            label="Upgrade"
            size="sm"
            fullWidth
            className="mt-2"
            onClick={() => router.push('/upgrade')}
          />
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              await logout();
              router.push('/login');
            }}
            className="flex min-h-11 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-colors hover:brightness-125"
            style={{ color: colors.inkMuted }}
          >
            <Icon name="logout" size={19} color={colors.inkMuted} />
            Sign out
          </button>
          {/* Lives here rather than floating over the sidebar, where it used to
              sit on top of the Sign out row at narrow desktop heights. */}
          <span className="hidden lg:block">
            <ThemeToggle />
          </span>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-dvh" style={{ backgroundColor: colors.bg }}>
      {/* Desktop sidebar */}
      <aside
        className="sticky top-0 hidden h-dvh w-62 shrink-0 flex-col overflow-y-auto border-r p-4 lg:flex"
        style={{
          backgroundColor: colors.bgSecondary,
          borderColor: colors.border,
          paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {renderSidebar()}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ backgroundColor: colors.overlay, animation: 'aas-fade-in 0.15s ease-out' }}
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="flex h-full w-[min(84vw,288px)] flex-col overflow-y-auto overscroll-contain border-r p-4"
            style={{
              backgroundColor: colors.bgSecondary,
              borderColor: colors.border,
              animation: 'aas-slide-in-left 0.22s cubic-bezier(0.32, 0.72, 0, 1)',
              paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))',
              paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
              paddingLeft: 'calc(1rem + env(safe-area-inset-left, 0px))',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderSidebar(() => setDrawerOpen(false))}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar. Padding carries the notch inset on top of its own
            spacing so the row never sits under the status bar or a cutout. */}
        <header
          className="app-topbar sticky top-0 z-30 flex items-center gap-2 border-b lg:hidden"
          style={{
            borderColor: colors.border,
            paddingTop: 'calc(0.625rem + env(safe-area-inset-top, 0px))',
            paddingBottom: '0.625rem',
            paddingLeft: 'calc(0.75rem + env(safe-area-inset-left, 0px))',
            paddingRight: 'calc(0.75rem + env(safe-area-inset-right, 0px))',
          }}
        >
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl active:scale-95 transition-transform"
            style={{ backgroundColor: colors.tile }}
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M3 12h18M3 18h18" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
            </svg>
          </button>
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2">
            <Image
              src="/images/squadowl_emblem.png"
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 shrink-0"
            />
            <Image src={isDark ? '/images/squadowl_wordmark_dark.png' : '/images/squadowl_wordmark_light.png'} alt={APP_CONFIG.appName} width={520} height={124} sizes="140px" className="h-6 w-auto min-w-0" />
          </Link>
          <ThemeToggle />
        </header>

        {/* .app-main publishes --page-gutter per breakpoint so .edge-bleed
            strips can cancel exactly this element's horizontal padding. */}
        <main
          className={cn('app-main w-full flex-1 px-4 py-6 sm:px-6 lg:px-8')}
          style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <ImpersonationBanner />
          <AnnouncementBanner enabled={!!user} />
          {awaitingFounderCheck || (founderMode && !founderRouteAllowed) ? (
            <LoadingState message="Loading..." />
          ) : blocked ? (
            <SuspendedAccountScreen />
          ) : featureBlocked && routeBlockedFeature ? (
            <FeatureBlockedScreen feature={routeBlockedFeature} />
          ) : (
            <>
              <TrialEndingNotice />
              <SubscriptionEndingBanner />
              {children}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
