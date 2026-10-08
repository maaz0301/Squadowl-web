'use client';

import Link from 'next/link';

import { Avatar } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { HomePanel, PanelRow } from '@/components/home/HomePanel';
import { useGuardianRostersQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * The athletes this account follows as a guardian. Rendered with the home
 * intro so it is there on every hub page (Evaluations, Teams), not only the
 * one that happened to own it. Nothing is drawn when there are none.
 */
export function MyAthletesPanel() {
  const colors = useThemeColors();
  const guardianQuery = useGuardianRostersQuery(true);
  const guardianAthletes = guardianQuery.data ?? [];
  if (guardianAthletes.length === 0) return null;

  return (
    <HomePanel
      icon="profile"
      label="My Athletes"
      className="mb-6"
      right={
        guardianAthletes.length > 3 ? (
          <Link href="/my-athletes" className="flex items-center gap-1 text-xs font-bold" style={{ color: colors.primary }}>
            View All
            <Icon name="chevronRight" size={12} color={colors.primary} strokeWidth={2.5} />
          </Link>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {guardianAthletes.slice(0, 3).map((ath) => (
          <Link key={ath.id} href={`/guardian/${ath.id}`} className="block">
            <PanelRow>
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[1.5px]"
                style={{ borderColor: colors.primary }}
              >
                <Avatar first={ath.firstName} last={ath.lastName} size={32} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-base font-bold"
                  style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                >
                  {ath.firstName} {ath.lastName}
                </span>
                <span className="block truncate text-xs" style={{ color: colors.inkMuted }}>
                  {ath.seasons.length === 0
                    ? 'No active seasons yet'
                    : ath.seasons.map((se) => se.name).join(' · ')}
                </span>
              </span>
              <Icon name="chevronRight" size={18} color={colors.inkMuted} strokeWidth={2.5} />
            </PanelRow>
          </Link>
        ))}
      </div>
    </HomePanel>
  );
}
