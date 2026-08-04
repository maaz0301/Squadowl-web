'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';

import { PlanGate } from '@/components/PlanGate';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, Input, LoadingState, PageHeader } from '@/components/ui';
import { usePortalInviteMutation, useSeasonQuery } from '@/features/queries';
import { useSeasonId } from '@/features/useSeasonId';

export default function SeasonPlayerPage() {
  const id = useSeasonId();
  const routeParams = useParams();
  const playerId = Array.isArray(routeParams?.playerId) ? routeParams.playerId[0] : (routeParams?.playerId as string);
  const colors = useThemeColors();
  const seasonQuery = useSeasonQuery(id);
  const portalInvite = usePortalInviteMutation(id ?? '');
  const [email, setEmail] = useState('');

  if (seasonQuery.isLoading) return <LoadingState />;
  const player = seasonQuery.data?.roster.find((p) => p.id === playerId);
  if (!player) {
    return (
      <>
        <PageHeader title="Player" showBack backHref={`/season/${id}/roster`} />
        <EmptyState title="Player not found" message="This player may have been removed from the roster." />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`${player.firstName} ${player.lastName}`} showBack backHref={`/season/${id}/roster`} />
      <Card className="mb-4 flex flex-col gap-2">
        <p style={{ color: colors.inkMuted }}>Jersey #{player.jersey ?? '—'}</p>
        <p style={{ color: colors.ink }}>{player.guardianEmail ?? 'No guardian email'}</p>
        {player.portalInviteSentAt ? (
          <div>
            <Badge label={`Invited ${new Date(player.portalInviteSentAt).toLocaleDateString()}`} variant="success" />
          </div>
        ) : null}
      </Card>

      <PlanGate feature="guardianPortal" title="Guardian Portal (Coach+)">
        <Card accent className="flex flex-col gap-3">
          <p className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Send Portal Invite
          </p>
          <Input label="Email" value={email || player.guardianEmail || ''} onChange={(e) => setEmail(e.target.value)} />
          <Button
            label="Send Invite"
            loading={portalInvite.isPending}
            onClick={() => portalInvite.mutate({ playerId, email: email || player.guardianEmail || '' })}
          />
        </Card>
      </PlanGate>
    </div>
  );
}
