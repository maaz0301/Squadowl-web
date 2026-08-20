'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { useImportLibraryPlayersMutation, useTryoutsQuery, useTryoutQuery } from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { buildRosterLibrary } from '@/data/extras';
import { isAtPlayerLimit } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { useUser } from '@/state/authStore';
import { LimitReachedModal } from '@/components/LimitReachedModal';

export default function RosterLibraryPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const router = useRouter();
  const tryoutsQuery = useTryoutsQuery(true);
  const currentTryoutQuery = useTryoutQuery(id);
  const user = useUser();
  const importPlayers = useImportLibraryPlayersMutation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  const library = useMemo(() => {
    if (!tryoutsQuery.data) return [];
    return buildRosterLibrary(tryoutsQuery.data, id);
  }, [tryoutsQuery.data, id]);

  if (tryoutsQuery.isLoading) return <LoadingState message="Loading library..." />;
  if (tryoutsQuery.isError || !tryoutsQuery.data) {
    return (
      <>
        <PageHeader title="Roster Library" showBack backHref={href('roster')} />
        <ErrorState message="Could not load library." onRetry={() => tryoutsQuery.refetch()} />
      </>
    );
  }

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const importSelected = async () => {
    const entries = library
      .filter((e) => selected.has(e.key))
      .map((e) => ({ first: e.first, last: e.last, jersey: e.jersey, pos: e.pos }));
    if (!entries.length) return;

    if (
      isAtPlayerLimit(
        user?.planTier ?? 'free',
        (currentTryoutQuery.data?.roster.length ?? 0) + entries.length - 1,
      )
    ) {
      setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'players', 'players'));
      return;
    }

    await importPlayers.mutateAsync({ tryoutId: id!, entries });
    router.push(href('roster'));
  };

  return (
    <>
      <PageHeader
        title="Roster Library"
        subtitle="Import players from other assessments in your account"
        showBack
        backHref={href('roster')}
        right={
          selected.size > 0 ? (
            <Button
              label={`Import ${selected.size} player${selected.size > 1 ? 's' : ''}`}
              loading={importPlayers.isPending}
              onClick={importSelected}
            />
          ) : null
        }
      />

      {library.length === 0 ? (
        <EmptyState title="Library empty" message="Add players to other assessments first." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {library.map((item) => {
            const isSelected = selected.has(item.key);
            return (
              <Card
                key={item.key}
                interactive
                accent={isSelected}
                className="flex items-center justify-between gap-4"
                onClick={() => toggle(item.key)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold" style={{ color: colors.ink }}>
                    {item.first} {item.last}
                  </span>
                  <span className="block truncate text-sm" style={{ color: colors.inkMuted }}>
                    From {item.sourceTryoutName}
                  </span>
                </span>
                <Badge label={isSelected ? 'Selected' : 'Select'} variant={isSelected ? 'brand' : 'info'} />
              </Card>
            );
          })}
        </div>
      )}

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
