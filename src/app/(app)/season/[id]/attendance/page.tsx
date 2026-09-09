'use client';

import { useMemo } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useGuardianRostersQuery, useSeasonQuery } from '@/features/queries';
import { useSeasonId } from '@/features/useSeasonId';
import { usePermissions } from '@/state/authStore';

export default function SeasonAttendancePage() {
  const id = useSeasonId();
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);
  const { isGuardian } = usePermissions();
  // Same scoping as the Availability tab: a guardian sees only their own
  // linked athlete(s), never the whole roster's attendance.
  const guardianRostersQuery = useGuardianRostersQuery(isGuardian);
  const myAthleteIds = useMemo(
    () => new Set((guardianRostersQuery.data ?? []).map((a) => a.id)),
    [guardianRostersQuery.data],
  );

  const stats = useMemo(() => {
    const season = seasonQuery.data;
    if (!season) return [];
    const roster = isGuardian
      ? season.roster.filter((p) => p.athleteId && myAthleteIds.has(p.athleteId))
      : season.roster;
    return roster.map((player) => {
      let yes = 0;
      let maybe = 0;
      let no = 0;
      let pending = 0;
      for (const event of season.events) {
        const resp = event.availability?.[player.id] ?? 'pending';
        if (resp === 'yes') yes++;
        else if (resp === 'maybe') maybe++;
        else if (resp === 'no') no++;
        else pending++;
      }
      const total = season.events.length || 1;
      const rate = Math.round((yes / total) * 100);
      return { player, yes, maybe, no, pending, rate };
    });
  }, [seasonQuery.data, isGuardian, myAthleteIds]);

  if (seasonQuery.isLoading || (isGuardian && guardianRostersQuery.isLoading)) {
    return <LoadingState message="Loading attendance..." />;
  }
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load attendance." onRetry={() => seasonQuery.refetch()} />;
  }

  const season = seasonQuery.data;
  // Every number on this page is computed from the RSVP rows, so the partial
  // season getSeason() publishes first would render a full roster at 0%
  // attendance before correcting itself. Wait for the second pass.
  if (season.events.some((e) => e.availabilityPending)) {
    return <LoadingState message="Loading attendance..." />;
  }

  return (
    <>
      <Card accent className="mb-5 flex flex-col gap-1">
        <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          Attendance Overview
        </span>
        <span style={{ color: colors.inkMuted }}>
          Based on availability responses across {season.events.length} events.
        </span>
      </Card>

      {stats.length === 0 ? (
        <EmptyState
          title={isGuardian ? 'No linked athlete here' : 'No roster'}
          message={
            isGuardian
              ? "We couldn't find one of your athletes on this team's roster."
              : 'Add players to track attendance.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {stats.map((item) => (
            <Card key={item.player.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-bold" style={{ color: colors.ink }}>
                  {item.player.firstName} {item.player.lastName}
                </span>
                <span className="block text-sm" style={{ color: colors.inkMuted }}>
                  Yes {item.yes} · Maybe {item.maybe} · No {item.no}
                </span>
              </span>
              <Badge
                label={`${item.rate}%`}
                variant={item.rate >= 80 ? 'success' : item.rate >= 50 ? 'warning' : 'danger'}
              />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
