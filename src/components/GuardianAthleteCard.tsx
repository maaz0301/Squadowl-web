import Link from 'next/link';
import { Avatar, Card, SectionLabel } from '@/components/ui';
import type { useThemeColors } from '@/theme/ThemeProvider';
import type { GuardianRosterAthlete } from '@/data/types';

export function GuardianAthleteCard({
  athlete,
  colors,
}: {
  athlete: GuardianRosterAthlete;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <Link href={`/guardian/${athlete.id}`}>
      <Card interactive className="h-full">
        <div className="flex items-center gap-3">
          <Avatar first={athlete.firstName} last={athlete.lastName} uri={athlete.avatarUrl} size={44} />
          <span
            className="text-base font-bold"
            style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
          >
            {athlete.firstName} {athlete.lastName}
          </span>
        </div>

        {athlete.tryouts.length === 0 && athlete.seasons.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: colors.inkMuted }}>
            No active tryouts or seasons assigned yet.
          </p>
        ) : null}

        {athlete.tryouts.length > 0 ? (
          <div className="mt-3">
            <SectionLabel className="mb-1">Tryouts</SectionLabel>
            {athlete.tryouts.map((t) => (
              <p key={t.participantId} className="text-sm" style={{ color: colors.primary }}>
                • {t.name} ({t.sport})
              </p>
            ))}
          </div>
        ) : null}

        {athlete.seasons.length > 0 ? (
          <div className="mt-3">
            <SectionLabel className="mb-1">Seasons</SectionLabel>
            {athlete.seasons.map((s) => (
              <p key={s.id} className="text-sm" style={{ color: colors.primary }}>
                • {s.name} — {s.teamName}
              </p>
            ))}
          </div>
        ) : null}
      </Card>
    </Link>
  );
}
