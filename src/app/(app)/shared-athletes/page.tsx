'use client';

import Link from 'next/link';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Badge, Card, CardGridSkeleton, EmptyState, ErrorState, PageHeader } from '@/components/ui';
import { useSharedAthletesForCoachQuery } from '@/features/queries';
import type { AthleteShare, AthleteShareStatus } from '@/data/types';
import type { ThemeColors } from '@/theme/tokens';

const STATUS_VARIANT: Record<AthleteShareStatus, 'brand' | 'success' | 'danger' | 'default'> = {
  shared: 'brand',
  assigned: 'success',
  declined: 'danger',
  withdrawn: 'default',
  released: 'danger',
};

const STATUS_LABEL: Record<AthleteShareStatus, string> = {
  shared: 'Pending',
  assigned: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  released: 'Released',
};

function ShareRow({ share, colors }: { share: AthleteShare; colors: ThemeColors }) {
  return (
    <Link href={`/share/${share.id}`}>
      <Card interactive className="mb-2 flex items-center gap-3">
        <Avatar first={share.athlete.firstName} last={share.athlete.lastName} pos={share.athlete.position} size={44} uri={share.athlete.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold" style={{ color: colors.ink }}>
            {share.athlete.firstName} {share.athlete.lastName}
          </p>
          <p className="truncate text-sm" style={{ color: colors.inkMuted }}>
            {share.athlete.guardianName ? `Shared by ${share.athlete.guardianName}` : 'Shared profile'}
          </p>
        </div>
        <Badge label={STATUS_LABEL[share.status]} variant={STATUS_VARIANT[share.status]} />
      </Card>
    </Link>
  );
}

export default function SharedAthletesPage() {
  const colors = useThemeColors();
  const sharedQuery = useSharedAthletesForCoachQuery();

  if (sharedQuery.isLoading) {
    // Keep the page header up while loading, like Archived, so the content area
    // doesn't blank out and jump when the data arrives.
    return (
      <>
        <PageHeader title="Shared Athletes" showBack />
        <CardGridSkeleton count={3} lines={2} />
      </>
    );
  }
  if (sharedQuery.isError) {
    return (
      <>
        <PageHeader title="Shared Athletes" />
        <ErrorState message="Could not load shared athletes." onRetry={() => sharedQuery.refetch()} />
      </>
    );
  }

  const shares = sharedQuery.data ?? [];

  return (
    <>
      <PageHeader title="Shared Athletes" showBack />
      {shares.length === 0 ? (
        <EmptyState
          title="No shared athletes yet"
          message="When a guardian shares their athlete's profile with you, it will show up here."
        />
      ) : (
        <div>
          {shares.map((s) => (
            <ShareRow key={s.id} share={s} colors={colors} />
          ))}
        </div>
      )}
    </>
  );
}
