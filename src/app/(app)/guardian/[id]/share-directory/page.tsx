'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { Avatar, Badge, Button, Card, ErrorState, Input, LoadingState, PageHeader } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useAthleteSharesQuery, useFindCoachByEmailMutation, useShareAthleteMutation } from '@/features/queries';
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
  const [email, setEmail] = useState('');
  // The email a lookup actually ran for, so the empty/no-match state below
  // reads "no coach found for x@y.com" rather than re-running on every
  // keystroke — this is a real network round trip per search, not a filter
  // over an already-loaded list.
  const [searchedEmail, setSearchedEmail] = useState<string | null>(null);
  const [sharingCoachId, setSharingCoachId] = useState<string | null>(null);

  const sharesQuery = useAthleteSharesQuery(athleteId);
  const findCoach = useFindCoachByEmailMutation();
  const shareMutation = useShareAthleteMutation();

  const sharedCoachIds = useMemo(
    () => new Set((sharesQuery.data ?? []).map((s) => s.coach.userId)),
    [sharesQuery.data],
  );

  const handleFind = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setSearchedEmail(trimmed);
    findCoach.mutate(trimmed);
  };

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

  if (sharesQuery.isLoading) {
    return <LoadingState message="Loading..." />;
  }

  const shares = sharesQuery.data ?? [];
  const results = findCoach.data ?? [];

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
        Share by Email
      </p>
      <p className="mb-3 text-sm" style={{ color: colors.inkMuted }}>
        Enter the coach&apos;s email address to send them this athlete&apos;s profile.
      </p>
      <div className="mb-4 flex items-start gap-2">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="coach@example.com"
          type="email"
          autoCapitalize="none"
          autoCorrect="off"
          containerClassName="flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFind();
          }}
        />
        <Button label="Find" loading={findCoach.isPending} disabled={!email.trim()} onClick={handleFind} />
      </div>

      {findCoach.isPending ? (
        <LoadingState message="Looking up that email..." />
      ) : findCoach.isError ? (
        <ErrorState message={(findCoach.error as Error)?.message || 'Could not look up that email.'} onRetry={handleFind} />
      ) : searchedEmail && results.length === 0 ? (
        <Card className="flex flex-col items-center gap-1 py-6 text-center">
          <p className="font-bold" style={{ color: colors.ink }}>
            No coach found for {searchedEmail}
          </p>
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            Double-check the address, or ask them to create a SquadOwl account first.
          </p>
        </Card>
      ) : (
        results.map((c) => (
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
