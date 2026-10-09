'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Button, Card, CardGridSkeleton, EmptyState, ErrorState, Input, PageHeader } from '@/components/ui';
import { useAthleteHubQuery } from '@/features/queries';
import { playerDisplayName } from '@/data/rubrics';

/**
 * Every athlete under this subscription, whichever team or evaluation they came
 * in through, in one searchable list. Replaces the old Shared Athletes page,
 * which only listed profiles guardians pushed to a coach.
 */
export default function AthleteHubPage() {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  // The search runs on the server, so wait for a pause in typing.
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const hubQuery = useAthleteHubQuery(search);
  const athletes = useMemo(() => hubQuery.data?.pages.flatMap((p) => p.rows) ?? [], [hubQuery.data]);

  return (
    <>
      <PageHeader title="Athlete Hub" showBack />
      <div className="mb-3">
        <Input placeholder="Search by name or guardian" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {hubQuery.isLoading ? (
        <CardGridSkeleton count={6} lines={2} />
      ) : hubQuery.isError && athletes.length === 0 ? (
        <ErrorState message="Could not load athletes." onRetry={() => hubQuery.refetch()} />
      ) : athletes.length === 0 ? (
        <EmptyState
          title={search ? 'No matches' : 'No athletes yet'}
          message={search ? 'Try a different name.' : 'Players added to your teams and evaluations show up here.'}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {athletes.map((a) => (
              <Link key={a.id} href={`/player/${a.id}`}>
                <Card interactive className="flex items-center gap-3">
                  <Avatar first={a.first} last={a.last} pos={a.currentPosition} size={44} uri={a.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold" style={{ color: colors.ink }}>{playerDisplayName(a)}</p>
                    <p className="truncate text-sm" style={{ color: colors.inkMuted }}>
                      {[a.currentPosition, a.guardianName].filter(Boolean).join(' · ') || 'Athlete'}
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
          {hubQuery.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                label="Load more"
                variant="secondary"
                loading={hubQuery.isFetchingNextPage}
                onClick={() => hubQuery.fetchNextPage()}
              />
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
