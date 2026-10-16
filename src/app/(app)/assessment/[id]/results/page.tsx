'use client';

import { useTerms } from '@/lib/terms';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { themeTokens } from '@/theme/tokens';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { CoachOnlyState } from '@/components/assessment/CoachOnlyState';
import { useResultsQuery } from '@/features/queries';
import { useAssessmentHref, useAssessmentId, useIsAssessorOnly } from '@/features/useAssessmentId';
import { getScoreHeatLevel, isGoaliePosition, playerDisplayName } from '@/data/rubrics';
import { ScoredDonut } from '@/components/compare/ScoredDonut';
import { rosterPositionGroups } from '@/data/positions';
import { getPlayerCategories } from '@/data/rubrics';
import { compareResultsBestFirst, formatMetricRaw, metricSummaries } from '@/data/scoring';

export default function ResultsPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const router = useRouter();
  const { data: tryout, results, isLoading, isError, refetch } = useResultsQuery(id);
  const isAssessorOnly = useIsAssessorOnly(tryout?.viewerIsOwner);
  const terms = useTerms(tryout?.settings.customLabels, tryout?.sport);
  const [tab, setTab] = useState('overall');

  if (isLoading) return <LoadingState message="Loading results..." />;
  if (isError || !tryout) return <ErrorState message="Could not load results." onRetry={() => refetch()} />;
  if (!tryout.viewerIsOwner) return <CoachOnlyState what="see the results" labels={tryout.settings.customLabels} />;

  const sorted = [...results].sort(compareResultsBestFirst(tryout));
  const skaters = sorted.filter((r) => !isGoaliePosition(r.player.pos));
  const goalies = sorted.filter((r) => isGoaliePosition(r.player.pos));

  const inGroup = (r: (typeof sorted)[number], codes: string[]) => codes.includes((r.player.pos ?? '').trim().toUpperCase());
  const groups = rosterPositionGroups(tryout.sport, sorted.map((r) => r.player)).filter((g) => sorted.some((r) => inGroup(r, g.codes)));
  const activeGroup = groups.find((g) => g.key === tab);
  const visible = activeGroup ? sorted.filter((r) => inGroup(r, activeGroup.codes)) : sorted;
  const ringColors = ['#FF6B2B', '#3B82F6', '#94A3B8', '#22C55E'];
  const coverage = new Map<string, { label: string; n: number }>();
  for (const r of sorted) {
    for (const c of getPlayerCategories(tryout.sport, r.player.pos, tryout.settings.customRubrics)) {
      const cur = coverage.get(c.key) ?? { label: c.label, n: 0 };
      if (r.categoryScores[c.key] != null) cur.n += 1;
      coverage.set(c.key, cur);
    }
  }
  const rings = [...coverage.values()]
    .slice(0, ringColors.length)
    .map((c, i) => ({ label: c.label, pct: (c.n / Math.max(1, sorted.length)) * 100, color: ringColors[i] }));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button label="Team Builder" size="sm" onClick={() => router.push(href('team-builder'))} />
        <Button label="Compare" size="sm" variant="secondary" onClick={() => router.push(href('compare'))} />
        {!isAssessorOnly ? (
          <>
            <Button label="Export" size="sm" variant="secondary" onClick={() => router.push(href('export'))} />
            <Button label="Import" size="sm" variant="secondary" onClick={() => router.push(`${href('scan-sheet')}${href('scan-sheet').includes('?') ? '&' : '?'}from=results`)} />
          </>
        ) : null}
        {sorted.length > 0 ? (
          <span className="ml-auto flex gap-2">
            <Badge label={tryout.sport === 'Skating' ? `${skaters.length} ${skaters.length === 1 ? terms.player : terms.players}` : `${skaters.length} Skaters`} variant="brand" />
            {tryout.sport === 'Skating' ? null : <Badge label={`${goalies.length} Goalies`} variant="info" />}
          </span>
        ) : null}
      </div>

      {sorted.length > 0 && rings.length > 0 ? (
        <div className="mb-4">
          <ScoredDonut scored={sorted.filter((r) => r.evalCount > 0).length} total={sorted.length} rings={rings} />
        </div>
      ) : null}
      {groups.length > 0 ? (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {[{ key: 'overall', label: 'Overall' }, ...groups].map((g) => {
            const on = tab === g.key;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => setTab(g.key)}
                className="shrink-0 rounded-2xl border px-5 py-2.5 text-sm font-bold transition-[filter] hover:brightness-110"
                style={{
                  backgroundColor: on ? colors.primary : colors.tile,
                  borderColor: on ? colors.primary : colors.border,
                  color: on ? '#ffffff' : colors.ink,
                }}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          title={sorted.length > 0 ? 'No players in this group' : 'No results yet'}
          message={sorted.length > 0 ? 'Pick another tab to see more players.' : terms.t('Score players to see the leaderboard.')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((item, index) => {
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
                  {(() => {
                    const metrics = metricSummaries(tryout, item.player);
                    if (!metrics.length) return null;
                    return (
                      <span className="block truncate text-xs" style={{ color: colors.inkMuted }}>
                        {metrics.map((m) => `${m.label} ${formatMetricRaw(m)}${m.capped ? ' (at max)' : ''}`).join(' · ')}
                      </span>
                    );
                  })()}
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
