'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { lockBodyScroll } from '@/lib/scrollLock';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Button, ThemeToggle } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icons';
import { useAuthStore, usePermissions, useUser } from '@/state/authStore';
import { useIsFeedbackReviewerQuery } from '@/features/queries';
import { prefetchRoute } from '@/features/prefetch';
import { NavPending } from '@/components/NavPending';
import { canUseFeature } from '@/data/plans';
import { APP_CONFIG } from '@/config/app';

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

  const primary: NavItem[] = isGuardian
    ? [
        { href: '/dashboard', label: 'My Athletes', icon: 'teams' },
        { href: '/profile', label: 'Profile', icon: 'profile' },
      ]
    : [
        { href: '/dashboard', label: 'Evaluations', icon: 'assessments', match: '/assessment' },
        { href: '/teams', label: 'Teams', icon: 'teams', match: '/team' },
        { href: '/search', label: 'Search', icon: 'search' },
      ];

  const secondary: NavItem[] = isGuardian
    ? []
    : [
        { href: '/archived-assessments', label: 'Archived', icon: 'archive' },
        { href: '/shared-athletes', label: 'Shared Athletes', icon: 'share' },
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
          <Image src="/images/tryouthq_t_logo_v2.png" alt="" width={44} height={44} className="shrink-0" />
          <span
            className="truncate text-2xl font-bold tracking-tight"
            style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
          >
            {APP_CONFIG.appName}
          </span>
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
            {!isGuardian ? (
              <span className="block truncate text-xs capitalize" style={{ color: colors.inkMuted }}>
                {planTier} plan
              </span>
            ) : null}
          </span>
        </Link>
        {!isGuardian && planTier !== 'club' ? (
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
            className="flex min-h-[44px] flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-colors hover:brightness-125"
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
        className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col overflow-y-auto border-r p-4 lg:flex"
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
              src="/images/tryouthq_t_logo_v2.png"
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 shrink-0"
            />
            <span
              className="truncate text-xl font-bold tracking-tight"
              style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
            >
              {APP_CONFIG.appName}
            </span>
          </Link>
          <ThemeToggle />
        </header>

        {/* .app-main publishes --page-gutter per breakpoint so .edge-bleed
            strips can cancel exactly this element's horizontal padding. */}
        <main
          className={cn('app-main w-full flex-1 px-4 py-6 sm:px-6 lg:px-8')}
          style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
