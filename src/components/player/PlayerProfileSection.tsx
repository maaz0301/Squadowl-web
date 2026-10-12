'use client';

import { Button, Card, ErrorState, Spinner } from '@/components/ui';
import { AssessmentHistory } from '@/components/player/AssessmentHistory';
import { usePlayerProfileQuery } from '@/features/queries';
import { formatBirth } from '@/lib/birthDate';
import { useThemeColors } from '@/theme/ThemeProvider';
import { formatHeight } from '@/lib/height';

const slugify = (...parts: (string | undefined)[]) =>
  parts.filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'export';

/**
 * Everything the full player profile page shows, inline: the player's details
 * (with an Edit button), then season-over-season, score trend and the
 * evaluation history, each with a View button that opens its record.
 */
export function PlayerProfileSection({
  athleteId,
  onEditDetails,
}: {
  athleteId: string;
  /** Opens the edit form. Omit for a viewer who may not edit. */
  onEditDetails?: () => void;
}) {
  const colors = useThemeColors();
  const profileQuery = usePlayerProfileQuery(athleteId);
  const profile = profileQuery.data;

  if (profileQuery.isLoading) {
    return (
      <Card className="flex items-center gap-2">
        <Spinner size={16} />
        <span style={{ color: colors.inkMuted }}>Loading profile…</span>
      </Card>
    );
  }
  if (profileQuery.isError || !profile) {
    return <ErrorState message="Could not load this player's profile." onRetry={() => profileQuery.refetch()} />;
  }

  const row = (label: string, value?: string | number | null) => (
    <div className="flex justify-between gap-3">
      <span className="text-sm" style={{ color: colors.inkMuted }}>{label}</span>
      <span className="flex-1 text-right text-sm font-medium" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '—'}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display font-bold" style={{ color: colors.ink }}>Details</p>
          {onEditDetails ? <Button label="Edit" variant="secondary" size="sm" onClick={onEditDetails} /> : null}
        </div>
        {row('Date of Birth', formatBirth(profile.dateOfBirth, profile.yearOfBirth))}
        {row('Current Team', profile.currentTeam)}
        {profile.teams.length > 1 ? row('All Teams', profile.teams.map((t) => t.teamName).join(', ')) : null}
        {row('Position', profile.currentPosition)}
        {row('Level', profile.currentLevel)}
        {row('Jersey', profile.jersey)}
        {row('Height', formatHeight(profile.heightCm))}
        {row('Player Email', profile.playerEmail)}
        {row('Guardian', profile.guardianName)}
        {row('Guardian Email', profile.guardianEmail)}
        {row('Guardian Phone', profile.guardianPhone)}
        {profile.pastSeasons.length > 0
          ? row('Seasons', [...new Set(profile.pastSeasons.map((s) => s.seasonName))].join(', '))
          : null}
        {row('About', profile.aboutChild)}
        {profile.canViewMedical ? row('Medical', profile.medicalInfo) : null}
      </Card>

      <AssessmentHistory
        assessments={profile.assessments}
        colors={colors}
        exportFileName={slugify(profile.first, profile.last)}
        viewRecords
      />
    </div>
  );
}
