'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useAthleteSharesQuery, useCoachDirectoryQuery, useShareAthleteMutation } from '@/features/queries';
import type { AthleteShare, AthleteShareStatus, CoachDirectoryEntry } from '@/data/types';
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

function ExistingShareRow({ share, colors, onClick }: { share: AthleteShare; colors: ThemeColors; onClick: () => void }) {
  return (
    <Card interactive className="mb-2 flex items-center gap-3" onClick={onClick}>
      <Avatar first={share.coach.displayName} last="" size={44} uri={share.coach.avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold" style={{ color: colors.ink }}>{share.coach.displayName}</p>
        <p className="truncate text-sm" style={{ color: colors.inkMuted }}>
          {share.coach.accountName}
          {share.coach.sport ? ` · ${share.coach.sport}` : ''}
        </p>
      </div>
      <Badge label={STATUS_LABEL[share.status]} variant={STATUS_VARIANT[share.status]} />
    </Card>
  );
}

function CoachRow({
  coach,
  alreadySharedWith,
  onShare,
  loading,
  colors,
}: {
  coach: CoachDirectoryEntry;
  alreadySharedWith: boolean;
  onShare: () => void;
  loading: boolean;
  colors: ThemeColors;
}) {
  return (
    <Card className="mb-2 flex items-center gap-3">
      <Avatar first={coach.displayName} last="" size={44} uri={coach.avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold" style={{ color: colors.ink }}>{coach.displayName}</p>
        <p className="truncate text-sm" style={{ color: colors.inkMuted }}>
          {coach.accountName}
          {coach.sport ? ` · ${coach.sport}` : ''}
        </p>
      </div>
      <Button
        label={alreadySharedWith ? 'Shared' : 'Share'}
        size="sm"
        variant={alreadySharedWith ? 'ghost' : 'primary'}
        disabled={alreadySharedWith}
        loading={loading}
        onClick={onShare}
      />
    </Card>
  );
}

export default function ShareDirectoryPage() {
  const { id: athleteId } = useParams<{ id: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [sharingCoachId, setSharingCoachId] = useState<string | null>(null);

  const sharesQuery = useAthleteSharesQuery(athleteId);
  const directoryQuery = useCoachDirectoryQuery();
  const shareMutation = useShareAthleteMutation();

  const sharedCoachIds = useMemo(
    () => new Set((sharesQuery.data ?? []).map((s) => s.coach.userId)),
    [sharesQuery.data],
  );

  const filteredCoaches = useMemo(() => {
    const list = directoryQuery.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.displayName.toLowerCase().includes(q) || c.accountName.toLowerCase().includes(q));
  }, [directoryQuery.data, query]);

  const handleShare = async (coach: CoachDirectoryEntry) => {
    setSharingCoachId(coach.userId);
    try {
      await shareMutation.mutateAsync({ athleteId, coachUserId: coach.userId, coachAccountId: coach.accountId });
    } catch (error) {
      alert(`Share Failed\n\n${(error as Error)?.message || 'Could not share this profile.'}`);
    } finally {
      setSharingCoachId(null);
    }
  };

  if (sharesQuery.isLoading || directoryQuery.isLoading) {
    return <LoadingState message="Loading coaches..." />;
  }

  if (directoryQuery.isError) {
    return (
      <>
        <PageHeader title="Share with a Coach" showBack />
        <ErrorState message="Could not load the coach directory." onRetry={() => directoryQuery.refetch()} />
      </>
    );
  }

  const shares = sharesQuery.data ?? [];

  return (
    <>
      <PageHeader title="Share with a Coach" showBack />

      {shares.length > 0 ? (
        <div className="mb-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Your Shares
          </p>
          {shares.map((s) => (
            <ExistingShareRow key={s.id} share={s} colors={colors} onClick={() => router.push(`/share/${s.id}`)} />
          ))}
        </div>
      ) : null}

      <p className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        Find a Coach
      </p>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by coach or club name..."
        containerClassName="mb-4"
      />

      {filteredCoaches.length === 0 ? (
        <EmptyState title="No coaches found" message="Try a different search." />
      ) : (
        filteredCoaches.map((c) => (
          <CoachRow
            key={`${c.accountId}-${c.userId}`}
            coach={c}
            alreadySharedWith={sharedCoachIds.has(c.userId)}
            loading={shareMutation.isPending && sharingCoachId === c.userId}
            onShare={() => handleShare(c)}
            colors={colors}
          />
        ))
      )}
    </>
  );
}
