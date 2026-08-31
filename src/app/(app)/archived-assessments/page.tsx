'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  CardGridSkeleton,
  EmptyState,
  ErrorState,
  PageHeader,
  useAlert,
} from '@/components/ui';
import { useRestoreTryoutMutation, useTryoutSummariesQuery } from '@/features/queries';

export default function ArchivedAssessmentsPage() {
  const colors = useThemeColors();
  const { alert, toast } = useAlert();
  // Card fields only — see useTryoutSummariesQuery.
  const tryoutsQuery = useTryoutSummariesQuery(true);
  const restore = useRestoreTryoutMutation();
  // The mutation is shared across rows, so track which card fired it.
  const [restoringId, setRestoringId] = useState<string | null>(null);

  if (tryoutsQuery.isLoading) {
    return (
      <>
        <PageHeader
          title="Archived Evaluations"
          subtitle="Past evaluations you can restore at any time"
          showBack
          backHref="/dashboard"
        />
        <CardGridSkeleton count={3} lines={2} />
      </>
    );
  }
  if (tryoutsQuery.isError) {
    return (
      <>
        <PageHeader title="Archived Evaluations" showBack backHref="/dashboard" />
        <ErrorState message="Could not load archived evaluations." onRetry={() => tryoutsQuery.refetch()} />
      </>
    );
  }

  const archived = (tryoutsQuery.data ?? []).filter((t) => t.archived);

  const handleRestore = async (id: string, name: string) => {
    setRestoringId(id);
    try {
      await restore.mutateAsync(id);
      toast(`"${name}" restored`, 'success');
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not restore the evaluation.');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Archived Evaluations"
        subtitle="Past evaluations you can restore at any time"
        showBack
        backHref="/dashboard"
      />

      {archived.length === 0 ? (
        <EmptyState
          title="No archived evaluations"
          message="Evaluations you archive will appear here. You can restore them to active status at any time."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {archived.map((item) => (
            <Card key={item.id} className="flex h-full flex-col gap-2">
              <Link href={`/assessment/${item.id}/settings`} className="min-w-0">
                <span
                  className="block truncate text-lg font-bold"
                  style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                >
                  {item.name}
                </span>
                <span className="mt-1 block text-sm" style={{ color: colors.inkMuted }}>
                  {item.sport} · {item.playerCount} players
                </span>
              </Link>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                <Badge label="Archived" variant="warning" />
                <Button
                  label="Restore"
                  size="sm"
                  loading={restoringId === item.id}
                  disabled={restore.isPending}
                  onClick={() => handleRestore(item.id, item.name)}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
