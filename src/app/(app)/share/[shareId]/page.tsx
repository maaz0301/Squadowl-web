'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';

import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Modal, PageHeader } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import { AssessmentHistory } from '@/components/player/AssessmentHistory';
import { useAuthStore, usePermissions } from '@/state/authStore';
import {
  useAcceptAthleteShareMutation,
  useAddShareCommentMutation,
  useAthleteShareQuery,
  usePlayerProfileQuery,
  useRejectAthleteShareMutation,
  useShareCommentsQuery,
  useTryoutsQuery,
} from '@/features/queries';
import type { AthleteShareStatus } from '@/data/types';
import type { ThemeColors } from '@/theme/tokens';

const STATUS_VARIANT: Record<AthleteShareStatus, 'brand' | 'success' | 'danger' | 'default'> = {
  shared: 'brand',
  assigned: 'success',
  declined: 'danger',
  withdrawn: 'default',
  released: 'danger',
};

const STATUS_MESSAGE: Record<AthleteShareStatus, string> = {
  shared: 'Waiting for a response.',
  assigned: 'Accepted and placed into an evaluation.',
  declined: 'This coach declined the share.',
  withdrawn: 'This athlete was placed with another coach.',
  released: 'The coach has released this player from their roster.',
};

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

function Row({ label, value, colors }: { label: string; value?: string; colors: ThemeColors }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3">
      <span className="text-sm" style={{ color: colors.inkMuted }}>{label}</span>
      <span className="flex-1 text-right text-sm font-medium" style={{ color: colors.ink }}>{value}</span>
    </div>
  );
}

export default function ShareDetailPage() {
  const { shareId } = useParams<{ shareId: string }>();
  const colors = useThemeColors();
  const { isGuardian } = usePermissions();
  const currentUserId = useAuthStore((s) => s.session?.user?.id);

  const [commentBody, setCommentBody] = useState('');
  const [tryoutPickerVisible, setTryoutPickerVisible] = useState(false);

  const shareQuery = useAthleteShareQuery(shareId);
  const commentsQuery = useShareCommentsQuery(shareId);
  const tryoutsQuery = useTryoutsQuery();
  const addCommentMutation = useAddShareCommentMutation();
  const acceptMutation = useAcceptAthleteShareMutation();
  const rejectMutation = useRejectAthleteShareMutation();
  // RLS on athlete_shares only lets two kinds of viewer load a given share at
  // all: the guardian who created it, or staff on its coach_account_id — so
  // "not the guardian" reliably means "coach" here, unlike the global
  // usePermissions().isGuardian flag (false for an owner/coach account even
  // when that same person also matches this share by guardian_user_id).
  const isShareGuardian = !!currentUserId && shareQuery.data?.guardianUserId === currentUserId;
  // The guardian already has direct RLS access to their own athlete's live
  // evaluations (same grant the player-profile page relies on), so their
  // view isn't limited to the frozen athlete_assessments snapshot the way the
  // coach's is — see the render block below for why the coach still uses it.
  const guardianProfileQuery = usePlayerProfileQuery(isShareGuardian ? shareQuery.data?.athleteId : undefined);
  // Once accepted, the coach's account holds a live grant on the same athlete
  // row (see athlete_account_access / accept_athlete_share), so profile
  // fields can come from a live query instead of the frozen share snapshot —
  // 'shared'/'declined'/'withdrawn'/'released' states have no grant yet/anymore.
  const isLiveEligible = !isShareGuardian && shareQuery.data?.status === 'assigned';
  const coachProfileQuery = usePlayerProfileQuery(isLiveEligible ? shareQuery.data?.athleteId : undefined);

  if (shareQuery.isLoading) return <LoadingState message="Loading..." />;
  if (shareQuery.isError || !shareQuery.data) {
    return <ErrorState message="Could not load this share." onRetry={() => shareQuery.refetch()} />;
  }

  const share = shareQuery.data;
  const comments = commentsQuery.data ?? [];
  const canRespond = !isGuardian && share.status === 'shared';
  // Prefer the live profile (kept in sync with the original account and any
  // other granted coach) once it's fetched; fall back to the frozen snapshot
  // for pending/declined/withdrawn/released shares, where no grant exists.
  const liveProfile = coachProfileQuery.data;
  const athleteView = liveProfile
    ? {
        firstName: liveProfile.first,
        lastName: liveProfile.last,
        avatarUrl: liveProfile.avatarUrl,
        position: liveProfile.currentPosition,
        yearOfBirth: liveProfile.yearOfBirth,
        guardianName: liveProfile.guardianName,
        guardianEmail: liveProfile.guardianEmail,
        guardianPhone: liveProfile.guardianPhone,
        medicalInfo: liveProfile.medicalInfo,
        about: liveProfile.aboutChild,
      }
    : {
        firstName: share.athlete.firstName,
        lastName: share.athlete.lastName,
        avatarUrl: share.athlete.avatarUrl,
        position: share.athlete.position,
        yearOfBirth: share.athlete.yearOfBirth ? String(share.athlete.yearOfBirth) : undefined,
        guardianName: share.athlete.guardianName,
        guardianEmail: share.athlete.guardianEmail,
        guardianPhone: share.athlete.guardianPhone,
        medicalInfo: share.athlete.medicalInfo,
        about: share.athlete.about,
      };

  const handleSendComment = async () => {
    const body = commentBody.trim();
    if (!body) return;
    try {
      await addCommentMutation.mutateAsync({ shareId, body });
      setCommentBody('');
    } catch (error) {
      alert(`Could Not Send\n\n${(error as Error)?.message || 'Please try again.'}`);
    }
  };

  const handleAccept = async (tryoutId: string) => {
    setTryoutPickerVisible(false);
    try {
      await acceptMutation.mutateAsync({ shareId, tryoutId });
    } catch (error) {
      alert(`Accept Failed\n\n${(error as Error)?.message || 'Could not accept this share.'}`);
    }
  };

  const handleReject = async () => {
    if (!confirm(`Decline the shared profile for ${share.athlete.firstName} ${share.athlete.lastName}?`)) return;
    try {
      await rejectMutation.mutateAsync(shareId);
    } catch (error) {
      alert(`Decline Failed\n\n${(error as Error)?.message || 'Could not decline this share.'}`);
    }
  };

  return (
    <>
      <PageHeader title={`${athleteView.firstName} ${athleteView.lastName}`} showBack />

      <div className="flex flex-col items-center gap-2 py-4">
        <Avatar first={athleteView.firstName} last={athleteView.lastName} pos={athleteView.position} size={72} uri={athleteView.avatarUrl} />
        <Badge label={STATUS_MESSAGE[share.status]} variant={STATUS_VARIANT[share.status]} />
      </div>

      <Card className="mb-4 flex flex-col gap-2">
        <p className="font-display font-bold" style={{ color: colors.ink }}>Athlete Details</p>
        <Row label="Position" value={athleteView.position} colors={colors} />
        <Row label="Year of Birth" value={athleteView.yearOfBirth} colors={colors} />
        <Row label="Guardian" value={athleteView.guardianName} colors={colors} />
        <Row label="Guardian Email" value={athleteView.guardianEmail} colors={colors} />
        <Row label="Guardian Phone" value={athleteView.guardianPhone} colors={colors} />
        <Row label="Medical" value={athleteView.medicalInfo} colors={colors} />
        <Row label="About" value={athleteView.about} colors={colors} />
      </Card>

      <Card className="mb-4 flex flex-col gap-2">
        <p className="font-display font-bold" style={{ color: colors.ink }}>Shared With</p>
        <div className="flex items-center gap-3">
          <Avatar first={share.coach.displayName} last="" size={44} uri={share.coach.avatarUrl} />
          <div>
            <p className="font-bold" style={{ color: colors.ink }}>{share.coach.displayName}</p>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              {share.coach.accountName}
              {share.coach.sport ? ` · ${share.coach.sport}` : ''}
            </p>
          </div>
        </div>
      </Card>

      {canRespond ? (
        <div className="mb-4 flex gap-2">
          <Button label="Accept" className="flex-1" onClick={() => setTryoutPickerVisible(true)} loading={acceptMutation.isPending} />
          <Button label="Reject" variant="danger" className="flex-1" onClick={handleReject} loading={rejectMutation.isPending} />
        </div>
      ) : null}

      {/* Development history/trends are shown to both sides: the guardian gets
          a live view via guardianProfileQuery (their own RLS grant on the
          source athlete, not this share), while the coach sees the snapshot
          frozen at share time, since their account has no RLS access to query
          the original account's evaluations live — see the migration comment
          on athlete_shares.athlete_assessments. Export stays coach-only by
          product requirement. */}
      {isShareGuardian
        ? guardianProfileQuery.data && (
            <AssessmentHistory assessments={guardianProfileQuery.data.assessments} colors={colors} />
          )
        : (
            <AssessmentHistory
              assessments={share.assessments}
              colors={colors}
              exportFileName={slugify(share.athlete.firstName, share.athlete.lastName)}
            />
          )}

      <p className="text-md mb-3 mt-2 font-display font-bold" style={{ color: colors.ink }}>Comments</p>
      {comments.length === 0 ? (
        <EmptyState title="No comments yet" message="Start the conversation below." />
      ) : (
        comments.map((c) => (
          <Card key={c.id} className="mb-2 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold" style={{ color: colors.ink }}>{c.authorName}</span>
              <Badge label={c.authorRole === 'coach' ? 'Coach' : 'Guardian'} variant={c.authorRole === 'coach' ? 'brand' : 'default'} />
            </div>
            <p style={{ color: colors.ink }}>{c.body}</p>
          </Card>
        ))
      )}

      <div className="mt-2 flex items-end gap-2">
        <Input
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          placeholder="Write a comment..."
          containerClassName="flex-1"
        />
        <Button label="Send" onClick={handleSendComment} loading={addCommentMutation.isPending} disabled={!commentBody.trim()} />
      </div>

      <Modal visible={tryoutPickerVisible} title="Assign to Evaluation" onClose={() => setTryoutPickerVisible(false)}>
        <div className="flex flex-col gap-2">
          {(tryoutsQuery.data ?? []).length === 0 ? (
            <p style={{ color: colors.inkMuted }}>You don&apos;t have any evaluations yet. Create one first.</p>
          ) : (
            (tryoutsQuery.data ?? []).map((t) => (
              <Button key={t.id} label={t.name} variant="ghost" onClick={() => handleAccept(t.id)} />
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
