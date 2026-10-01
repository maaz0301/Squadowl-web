'use client';

import Link from 'next/link';
import { Avatar, Card, SectionLabel } from '@/components/ui';
import type { useThemeColors } from '@/theme/ThemeProvider';
import { useAlert } from '@/components/ui/Alert';
import { useRemoveGuardianAthleteMutation } from '@/features/queries';
import type { GuardianRosterAthlete } from '@/data/types';

export function GuardianAthleteCard({
  athlete,
  colors,
}: {
  athlete: GuardianRosterAthlete;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const { alert, confirm } = useAlert();
  const removeAthlete = useRemoveGuardianAthleteMutation();

  const handleDelete = async (e: React.MouseEvent) => {
    // The card is one big link; this button must not navigate.
    e.preventDefault();
    e.stopPropagation();
    const name = `${athlete.firstName} ${athlete.lastName}`;
    const ok = await confirm({
      title: 'Delete Athlete',
      message: `Remove ${name} from My Athletes? Their team and evaluation records stay with the coach.`,
      confirmLabel: 'Delete',
      destructive: true,
      requireText: 'DELETE',
    });
    if (!ok) return;
    try {
      await removeAthlete.mutateAsync(athlete.id);
    } catch (err) {
      await alert('Could Not Delete', err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

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
          <button
            type="button"
            onClick={handleDelete}
            disabled={removeAthlete.isPending}
            className="ml-auto text-xs font-bold"
            style={{ color: colors.danger }}
            aria-label={`Delete ${athlete.firstName} ${athlete.lastName}`}
          >
            Delete
          </button>
        </div>

        {athlete.seasons.length === 0 ? (
          <p className="mt-3 text-sm" style={{ color: colors.inkMuted }}>
            No active seasons assigned yet.
          </p>
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
