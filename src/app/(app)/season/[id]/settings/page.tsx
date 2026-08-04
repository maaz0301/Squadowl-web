'use client';

import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, LoadingState, useAlert } from '@/components/ui';
import { useSeasonQuery, useUpdateSeasonMutation, useDeleteSeasonMutation, useEmailScheduleMutation } from '@/features/queries';
import { useSeasonId } from '@/features/useSeasonId';

export default function SeasonSettingsPage() {
  const id = useSeasonId();
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, confirm } = useAlert();
  const seasonQuery = useSeasonQuery(id);
  const updateSeason = useUpdateSeasonMutation();
  const deleteSeason = useDeleteSeasonMutation();
  const emailSchedule = useEmailScheduleMutation();

  if (seasonQuery.isLoading) return <LoadingState />;
  if (seasonQuery.isError || !seasonQuery.data || !id) {
    return <ErrorState message="Could not load settings." onRetry={() => seasonQuery.refetch()} />;
  }
  const season = seasonQuery.data;

  const handleEmailSchedule = async () => {
    try {
      await emailSchedule.mutateAsync(id);
      await alert('Success', 'Public schedule email sent to all roster players and guardians.');
    } catch (e) {
      await alert('Email Failed', e instanceof Error ? e.message : 'Could not send schedule emails.');
    }
  };

  const archive = async () => {
    await updateSeason.mutateAsync({ id, updates: { archived: true } });
    router.replace('/dashboard');
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete Season',
      message: 'Are you sure you want to delete this season? This action cannot be undone and will delete all associated data.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteSeason.mutateAsync(id);
    router.replace('/dashboard');
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Card accent className="mb-4 flex flex-col gap-2">
        <p className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          {season.name}
        </p>
        <div>
          <Badge label={`Token: ${season.scheduleShareToken?.slice(0, 8)}...`} variant="info" />
        </div>
        {season.teamId ? (
          <div className="mt-2 border-t pt-2" style={{ borderColor: colors.border }}>
            <p className="mb-1 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
              Linked Team
            </p>
            <p style={{ color: colors.ink }}>{season.teamName}</p>
            <p className="mt-0.5 text-xs" style={{ color: colors.inkFaint }}>ID: {season.teamId}</p>
          </div>
        ) : (
          <div className="mt-2 border-t pt-2" style={{ borderColor: colors.border }}>
            <p style={{ color: colors.inkMuted }}>No linked team</p>
          </div>
        )}
      </Card>

      <Button
        label="Email Schedule to Players"
        variant="secondary"
        onClick={handleEmailSchedule}
        loading={emailSchedule.isPending}
        className="mb-4"
      />

      <Card className="flex flex-col gap-2">
        <p className="font-bold" style={{ color: colors.danger }}>Danger Zone</p>
        <Button label="Archive Season" variant="danger" onClick={archive} loading={updateSeason.isPending} />
        <Button label="Delete Season" variant="danger" onClick={handleDelete} loading={deleteSeason.isPending} />
      </Card>
    </div>
  );
}
