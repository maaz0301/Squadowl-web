'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, ThemeToggle } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icons';
import { useAuthStore, usePermissions, useUser } from '@/state/authStore';
import { canUseFeature } from '@/data/plans';
import { APP_CONFIG } from '@/config/app';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Highlight for any route beneath this prefix. */
  match?: string;
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

  const planTier = user?.planTier ?? 'free';

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
          ? ([{ href: '/enterprise', label: 'Enterprise', icon: 'enterprise' }] as NavItem[])
          : []),
        ...(canUseFeature(planTier, 'payments')
          ? ([{ href: '/payments', label: 'Payments', icon: 'payments' }] as NavItem[])
          : []),
        ...(canManageOrganization
          ? ([{ href: '/organization/members', label: 'Members', icon: 'members' }] as NavItem[])
          : []),
        { href: '/upgrade', label: 'Plans & Billing', icon: 'upgrade' },
        { href: '/feedback', label: 'Feedback', icon: 'feedback' },
      ];

  const isActive = (item: NavItem) =>
    pathname === item.href ||
    pathname.startsWith(`${item.href}/`) ||
    (!!item.match && pathname.startsWith(item.match));

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item);
    return (
      <Link
        href={item.href}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-colors"
        style={{
          backgroundColor: active ? 'rgba(255,107,43,0.12)' : 'transparent',
          color: active ? colors.primary : colors.inkMuted,
        }}
      >
        <Icon name={item.icon} size={19} color={active ? colors.primary : colors.inkMuted} />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  const sidebarInner = (
    <>
      <Link href="/dashboard" className="mb-6 flex items-center gap-2.5 px-1">
        <Image src="/images/tryouthq_t_logo_v2.png" alt="" width={44} height={44} />
        <span
          className="text-2xl font-bold tracking-tight"
          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
        >
          {APP_CONFIG.appName}
        </span>
      </Link>

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
            <span className="block truncate text-xs capitalize" style={{ color: colors.inkMuted }}>
              {planTier} plan
            </span>
          </span>
        </Link>
        <button
          type="button"
          onClick={async () => {
            await logout();
            router.push('/login');
          }}
          className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-colors hover:brightness-125"
          style={{ color: colors.inkMuted }}
        >
          <Icon name="logout" size={19} color={colors.inkMuted} />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-dvh" style={{ backgroundColor: colors.bg }}>
      {/* Desktop sidebar */}
      <aside
        className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r p-4 lg:flex"
        style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}
      >
        {sidebarInner}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ backgroundColor: colors.overlay }}
          onClick={() => setDrawerOpen(false)}
        >
          <aside
            className="flex h-full w-[268px] flex-col border-r p-4"
            style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarInner}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header
          className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b px-4 py-3 lg:hidden"
          style={{ backgroundColor: colors.bgSecondary, borderColor: colors.border }}
        >
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ backgroundColor: colors.tile }}
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18M3 12h18M3 18h18" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
            </svg>
          </button>
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2">
            <Image src="/images/tryouthq_t_logo_v2.png" alt="" width={48} height={48} className="shrink-0" />
            <span
              className="truncate text-2xl font-bold"
              style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
            >
              {APP_CONFIG.appName}
            </span>
          </Link>
          <ThemeToggle />
        </header>

        <main className={cn('w-full flex-1 px-4 py-6 sm:px-6 lg:px-8')}>{children}</main>
      </div>

      {/* Desktop theme toggle floats out of the way of page content. */}
      <div className="fixed bottom-5 left-5 z-20 hidden lg:block">
        <ThemeToggle />
      </div>
    </div>
  );
}
