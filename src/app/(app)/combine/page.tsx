'use client';

import { useMemo } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { useTryoutsQuery } from '@/features/queries';
import { useSessionStore } from '@/state/sessionStore';
import { computePlayerResults } from '@/data/scoring';

export default function CombinePage() {
  const colors = useThemeColors();
  const tryoutsQuery = useTryoutsQuery(false);
  const combineIds = useSessionStore((s) => s.combineTryoutIds);
  const setCombineTryoutIds = useSessionStore((s) => s.setCombineTryoutIds);

  const combined = useMemo(() => {
    if (!tryoutsQuery.data || combineIds.length < 2) return [];
    const selected = tryoutsQuery.data.filter((t) => combineIds.includes(t.id));
    const rows: { name: string; sport: string; avg: number; count: number }[] = [];
    for (const t of selected) {
      const results = computePlayerResults(t);
      const avg = results.length
        ? results.reduce((sum, r) => sum + r.overall, 0) / results.length
        : 0;
      rows.push({ name: t.name, sport: t.sport, avg, count: results.length });
    }
    return rows.sort((a, b) => b.avg - a.avg);
  }, [tryoutsQuery.data, combineIds]);

  if (tryoutsQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutsQuery.isError) {
    return (
      <>
        <PageHeader title="Combine Assessments" showBack backHref="/dashboard" />
        <ErrorState message="Could not load assessments." onRetry={() => tryoutsQuery.refetch()} />
      </>
    );
  }

  if (combineIds.length < 2) {
    return (
      <>
        <PageHeader title="Combine Assessments" showBack backHref="/dashboard" />
        <EmptyState
          title="Select 2+ assessments"
          message="From the dashboard, tap Combine mode and select assessments to compare side-by-side."
          actionLabel="Go to Dashboard"
          onAction={() => (window.location.href = '/dashboard')}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Combined View"
        subtitle={`${combineIds.length} assessments selected`}
        showBack
        backHref="/dashboard"
      />

      <Card accent className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm" style={{ color: colors.inkMuted }}>
          Cross-assessment comparison using average overall scores.
        </p>
        <div>
          <Button label="Clear Selection" variant="ghost" size="sm" onClick={() => setCombineTryoutIds([])} />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {combined.map((item, index) => (
          <Card key={item.name} className="flex items-center justify-between">
            <div className="min-w-0 pr-2">
              <span
                className="block truncate font-bold text-base"
                style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
              >
                #{index + 1} {item.name}
              </span>
              <span className="block text-sm" style={{ color: colors.inkMuted }}>
                {item.sport} · {item.count} scored
              </span>
            </div>
            <Badge label={item.avg.toFixed(1)} variant="brand" />
          </Card>
        ))}
      </div>
    </>
  );
}
