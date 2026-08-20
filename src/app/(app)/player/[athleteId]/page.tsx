'use client';

import { useParams } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Card, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { AssessmentHistory } from '@/components/player/AssessmentHistory';
import { usePlayerProfileQuery } from '@/features/queries';
import { usePermissions } from '@/state/authStore';
import { playerDisplayName } from '@/data/rubrics';
import type { ThemeColors } from '@/theme/tokens';

function Row({ label, value, colors }: { label: string; value?: string; colors: ThemeColors }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-sm" style={{ color: colors.inkMuted }}>{label}</span>
      <span className="flex-1 text-right text-sm font-medium" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '—'}
      </span>
    </div>
  );
}

function slugify(...parts: (string | undefined)[]): string {
  return (
    parts
      .filter(Boolean)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'export'
  );
}

export default function PlayerProfilePage() {
  const { athleteId } = useParams<{ athleteId: string }>();
  const colors = useThemeColors();
  const { isGuardian } = usePermissions();

  const profileQuery = usePlayerProfileQuery(athleteId);
  const profile = profileQuery.data;

  if (profileQuery.isLoading) return <LoadingState />;
  if (profileQuery.isError || !profile) {
    return (
      <>
        <PageHeader title="Player" showBack />
        <ErrorState message="Player not found." onRetry={() => profileQuery.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={playerDisplayName(profile)} showBack />

      <div className="flex flex-col items-center gap-2 py-4">
        <Avatar first={profile.first} last={profile.last} pos={profile.currentPosition} size={72} uri={profile.avatarUrl} />
        <span className="text-sm" style={{ color: colors.inkMuted }}>
          #{profile.jersey ?? '—'} · {profile.currentPosition ?? '—'}
        </span>
      </div>

      <Card className="mb-4 flex flex-col gap-2">
        <p className="font-display font-bold" style={{ color: colors.ink }}>Details</p>
        <Row label="Current Team" value={profile.currentTeam} colors={colors} />
        {profile.teams.length > 1 ? (
          <Row label="All Teams" value={profile.teams.map((t) => t.teamName).join(', ')} colors={colors} />
        ) : null}
        <Row label="Position" value={profile.currentPosition} colors={colors} />
        <Row label="Year of Birth" value={profile.yearOfBirth} colors={colors} />
        <Row label="Guardian" value={profile.guardianName} colors={colors} />
        <Row label="Guardian Email" value={profile.guardianEmail} colors={colors} />
        <Row label="Guardian Phone" value={profile.guardianPhone} colors={colors} />
      </Card>

      <Card className="mb-4 flex flex-col gap-2">
        <p className="font-display font-bold" style={{ color: colors.ink }}>Additional Info</p>
        <Row label="Medical" value={profile.medicalInfo} colors={colors} />
      </Card>

      {/* Guardians can view development history/trends, but export stays
          coach-only by product requirement — exportFileName is simply omitted
          for guardians, which hides the Export button (see AssessmentHistory).
          Rows are non-interactive for everyone here — this profile is a
          read-only summary, not an entry point into the scoring flow. */}
      <AssessmentHistory
        assessments={profile.assessments}
        colors={colors}
        exportFileName={isGuardian ? undefined : slugify(profile.first, profile.last)}
      />
    </>
  );
}
