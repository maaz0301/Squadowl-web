'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, EmptyState, ErrorState, Input, LoadingState, PageHeader } from '@/components/ui';
import { useSeasonsQuery, useTryoutsQuery } from '@/features/queries';
import { globalSearch } from '@/data/extras';
import { useSessionStore } from '@/state/sessionStore';

export default function SearchPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const tryoutsQuery = useTryoutsQuery(true);
  const seasonsQuery = useSeasonsQuery();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);

  const results = useMemo(() => {
    if (!tryoutsQuery.data) return { assessments: [], players: [], seasons: [] };
    const seasons = (seasonsQuery.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      teamName: s.teamName,
    }));
    return globalSearch(tryoutsQuery.data, seasons, query);
  }, [tryoutsQuery.data, seasonsQuery.data, query]);

  if (tryoutsQuery.isLoading || seasonsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutsQuery.isError || seasonsQuery.isError) {
    return (
      <>
        <PageHeader title="Search" showBack />
        <ErrorState
          message="Could not load search data."
          onRetry={() => {
            tryoutsQuery.refetch();
            seasonsQuery.refetch();
          }}
        />
      </>
    );
  }

  const hasQuery = query.trim().length > 0;
  const items = [
    ...results.assessments.map((a) => ({ type: 'evaluation' as const, ...a })),
    ...results.players.map((p) => ({ type: 'player' as const, ...p })),
    ...results.seasons.map((s) => ({ type: 'season' as const, ...s })),
  ];

  const open = (item: (typeof items)[number]) => {
    if (item.type === 'evaluation') {
      setCurrentTryout(item.id);
      router.push(`/assessment/${item.id}/roster`);
    } else if (item.type === 'player') {
      setCurrentTryout(item.tryoutId);
      router.push(`/assessment/${item.tryoutId}/player/${item.id}`);
    } else {
      router.push(`/season/${item.id}`);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Search" showBack />

      <Input
        label="Search evaluations, players, seasons"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Tryout name, player, team..."
        autoFocus
      />

      <div className="mt-5">
        {!hasQuery ? (
          <EmptyState title="Start typing" message="Search across evaluations, rosters, and seasons." />
        ) : items.length === 0 ? (
          <EmptyState title="No results" message={`Nothing matched "${query.trim()}".`} />
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <Card key={`${item.type}-${item.id}`} interactive onClick={() => open(item)}>
                <p className="mb-1 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
                  {item.type}
                </p>
                <p className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                  {item.name}
                </p>
                {item.type === 'player' ? (
                  <p className="text-sm" style={{ color: colors.inkMuted }}>
                    {item.tryoutName}
                  </p>
                ) : null}
                {item.type === 'season' ? (
                  <p className="text-sm" style={{ color: colors.inkMuted }}>
                    {item.teamName}
                  </p>
                ) : null}
                {item.type === 'evaluation' ? (
                  <p className="text-sm" style={{ color: colors.inkMuted }}>
                    {item.sport}
                  </p>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
