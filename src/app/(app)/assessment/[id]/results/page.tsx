'use client';

import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { themeTokens } from '@/theme/tokens';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { CoachOnlyState } from '@/components/assessment/CoachOnlyState';
import { useResultsQuery } from '@/features/queries';
import { useAssessmentHref, useAssessmentId, useIsAssessorOnly } from '@/features/useAssessmentId';
import { getScoreHeatLevel, isGoaliePosition, playerDisplayName } from '@/data/rubrics';

export default function ResultsPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const router = useRouter();
  const { data: tryout, results, isLoading, isError, refetch } = useResultsQuery(id);
  const isAssessorOnly = useIsAssessorOnly(tryout?.viewerIsOwner);

  if (isLoading) return <LoadingState message="Loading results..." />;
  if (isError || !tryout) return <ErrorState message="Could not load results." onRetry={() => refetch()} />;
  if (!tryout.viewerIsOwner) return <CoachOnlyState what="see the results" />;

  const sorted = [...results].sort((a, b) => b.overall - a.overall);
  const skaters = sorted.filter((r) => !isGoaliePosition(r.player.pos));
  const goalies = sorted.filter((r) => isGoaliePosition(r.player.pos));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button label="Team Builder" size="sm" onClick={() => router.push(href('team-builder'))} />
        <Button label="Compare" size="sm" variant="secondary" onClick={() => router.push(href('compare'))} />
        {!isAssessorOnly ? (
          <Button label="Export" size="sm" variant="secondary" onClick={() => router.push(href('export'))} />
        ) : null}
        {sorted.length > 0 ? (
          <span className="ml-auto flex gap-2">
            <Badge label={`${skaters.length} Skaters`} variant="brand" />
            <Badge label={`${goalies.length} Goalies`} variant="info" />
          </span>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="No results yet" message="Score players to see the leaderboard." />
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((item, index) => {
            const heat = getScoreHeatLevel(item.overall);
            const heatColor = themeTokens.scoreColors[heat];
            return (
              <Card
                key={item.player.id}
                interactive
                className="flex items-center gap-3"
                onClick={() => router.push(href(`player/${item.player.id}`))}
              >
                <span
                  className="w-8 text-xl font-bold"
                  style={{ color: colors.inkMuted, fontFamily: 'var(--font-space-grotesk)' }}
                >
                  {index + 1}
                </span>
                <Avatar
                  first={item.player.first}
                  last={item.player.last}
                  pos={item.player.pos}
                  size={40}
                  uri={item.player.avatarUrl}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold" style={{ color: colors.ink }}>
                    {playerDisplayName(item.player)}
                  </span>
                  <span className="block text-sm" style={{ color: colors.inkMuted }}>
                    #{item.player.jersey ?? '—'} · {item.player.pos ?? '—'} · {item.evalCount} eval
                    {item.evalCount === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span
                    className="text-xl font-bold"
                    style={{ color: heatColor, fontFamily: 'var(--font-space-grotesk)' }}
                  >
                    {item.overall > 0 ? item.overall.toFixed(1) : '—'}
                  </span>
                  {item.latestRecommendation ? (
                    <Badge
                      label={item.latestRecommendation}
                      variant={
                        item.latestRecommendation === 'Make'
                          ? 'success'
                          : item.latestRecommendation === 'Release'
                            ? 'danger'
                            : 'default'
                      }
                    />
                  ) : null}
                </span>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
