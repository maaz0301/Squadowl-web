'use client';

import Link from 'next/link';

import { Card } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { HomeHero } from '@/components/home/HomeHero';
import { HomeSectionLabel } from '@/components/home/HomeSectionLabel';
import { QuickAccessGrid, type QuickAccessItem } from '@/components/home/QuickAccessGrid';
import { canUseFeature } from '@/data/plans';
import { prefetchReports } from '@/features/prefetch';
import { useUser } from '@/state/authStore';
import { usePlatformBlockedFeaturesQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

interface HomeIntroProps {
  /** Which section the page under this is — its card gets the orange outline. */
  active: 'evaluations' | 'teams';
  /**
   * What the card does when its own section is the page. On the other page the
   * card links there instead.
   */
  onEvaluations?: () => void;
  onTeams?: () => void;
}

/**
 * The top of the home screens: brand banner, the organisation Dashboard card
 * (only on plans that include it) and Quick Access. Shared by the Evaluations
 * and Teams pages so the two read as one screen with two lists.
 */
export function HomeIntro({ active, onEvaluations, onTeams }: HomeIntroProps) {
  const colors = useThemeColors();
  const user = useUser();
  const planTier = user?.planTier ?? 'free';
  // Sections the founder has turned off platform-wide (the sidebar hides them
  // too). "View as" is exempt, same as the shell.
  const { data: platformBlocked } = usePlatformBlockedFeaturesQuery();
  const blocked = new Set(user?.impersonating ? [] : (platformBlocked ?? []));

  const allItems: QuickAccessItem[] = [
    {
      key: 'evaluations',
      label: 'Evaluations',
      caption: 'Create and manage your tryouts and evaluations',
      icon: 'assessments',
      active: active === 'evaluations',
      ...(onEvaluations ? { onClick: onEvaluations } : { href: '/dashboard' }),
    },
    {
      key: 'teams',
      label: 'Teams',
      caption: 'Manage rosters, schedules and team details',
      icon: 'teams',
      active: active === 'teams',
      ...(onTeams ? { onClick: onTeams } : { href: '/teams' }),
    },
    {
      key: 'reports',
      label: 'Reports',
      caption: 'View comparisons, analytics and export results',
      icon: 'barChart',
      href: '/reports',
      onWarm: prefetchReports,
    },
    {
      key: 'athletes',
      label: 'Athletes',
      caption: 'Add, manage and track athlete profiles',
      icon: 'registrations',
      href: '/shared-athletes',
    },
  ];

  const items = allItems.filter((i) => !(i.key === 'evaluations' || i.key === 'reports' ? blocked.has('evaluations') : i.key === 'teams' && blocked.has('teams')));

  return (
    <>
      {/* Compact brand banner — a strip, not a splash, so the sections below
          stay above the fold. */}
      <div className="mb-6">
        <HomeHero />
      </div>

      {canUseFeature(planTier, 'enterprise') && !blocked.has('dashboard') ? (
        <Link href="/enterprise" className="mb-6 block">
          <Card interactive className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: 'rgba(255,107,43,0.12)' }}
            >
              <Icon name="enterprise" size={20} color={colors.primary} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold" style={{ color: colors.ink }}>
                Dashboard
              </span>
              <span className="block text-xs" style={{ color: colors.inkMuted }}>
                Organization-wide reporting & members
              </span>
            </span>
            <Icon name="chevronRight" size={18} color={colors.inkMuted} />
          </Card>
        </Link>
      ) : null}

      {/* Quick Access — the hub's shortcuts, all in one card style. */}
      {items.length > 0 ? (
        <div className="mb-6">
          <HomeSectionLabel>Quick Access</HomeSectionLabel>
          <QuickAccessGrid items={items} />
        </div>
      ) : null}
    </>
  );
}
