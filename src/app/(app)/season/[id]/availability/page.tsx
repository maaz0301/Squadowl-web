'use client';

import { useMemo } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useGuardianRostersQuery, useSeasonQuery, useSetAvailabilityMutation } from '@/features/queries';
import { useSeasonId } from '@/features/useSeasonId';
import { usePermissions } from '@/state/authStore';

const RESPONSE_VARIANT = {
  yes: 'success' as const,
  maybe: 'warning' as const,
  no: 'danger' as const,
  pending: 'default' as const,
};

export default function SeasonAvailabilityPage() {
  const id = useSeasonId();
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);
  const setAvailability = useSetAvailabilityMutation(id ?? '');
  const { isGuardian } = usePermissions();
  // A guardian reaching this coach screen may adjust RSVPs for their own
  // linked athlete(s) only — never the whole team's. `getGuardianRosters()` is
  // the same authoritative "my children" list the guardian portal itself
  // reads from, so this can't be fooled by a mismatched name/email on the row.
  const guardianRostersQuery = useGuardianRostersQuery(isGuardian);
  const myAthleteIds = useMemo(
    () => new Set((guardianRostersQuery.data ?? []).map((a) => a.id)),
    [guardianRostersQuery.data],
  );

  if (seasonQuery.isLoading || (isGuardian && guardianRostersQuery.isLoading)) return <LoadingState />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load availability." onRetry={() => seasonQuery.refetch()} />;
  }
  const season = seasonQuery.data;
  // getSeason() publishes events and roster ahead of the RSVP read, which the
  // schedule benefits from — but every row on this page *is* an RSVP, and
  // rendering the partial would show a roster of 'pending' badges that quietly
  // become real answers a second later. Nothing to show early here.
  if (season.events.some((e) => e.availabilityPending)) {
    return <LoadingState message="Loading availability..." />;
  }

  if (season.events.length === 0) {
    return <EmptyState title="No events" message="Add an event to track availability." />;
  }

  const visibleRoster = isGuardian
    ? season.roster.filter((p) => p.athleteId && myAthleteIds.has(p.athleteId))
    : season.roster;

  if (isGuardian && visibleRoster.length === 0) {
    return (
      <EmptyState
        title="No linked athlete here"
        message="We couldn't find one of your athletes on this team's roster."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {season.events.map((event) => (
        <Card key={event.id} className="flex flex-col gap-3">
          <p className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            {event.title} · {event.date}
          </p>
          {visibleRoster.map((player) => {
            const response = (event.availability?.[player.id] ?? 'pending') as keyof typeof RESPONSE_VARIANT;
            return (
              <div key={player.id} className="flex flex-col gap-2 border-b pb-2" style={{ borderColor: colors.border }}>
                <div className="flex items-center justify-between">
                  <span style={{ color: colors.ink }}>
                    {player.firstName} {player.lastName}
                  </span>
                  <Badge label={response} variant={RESPONSE_VARIANT[response]} />
                </div>
                <div className="flex gap-2">
                  {(['yes', 'maybe', 'no'] as const).map((r) => (
                    <Button
                      key={r}
                      label={r}
                      size="sm"
                      variant={response === r ? 'primary' : 'ghost'}
                      onClick={() => setAvailability.mutate({ eventId: event.id, playerId: player.id, response: r })}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </Card>
      ))}
    </div>
  );
}
