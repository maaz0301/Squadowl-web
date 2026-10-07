'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, CardGridSkeleton, EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui';
import { HomePanel, PanelRow } from '@/components/home/HomePanel';
import { NavPending } from '@/components/NavPending';
import { useState } from 'react';

import { useTryoutsQuery, useTryoutSummariesQuery } from '@/features/queries';
import { useSessionStore } from '@/state/sessionStore';
import { usePermissions, useUser } from '@/state/authStore';
import {
  buildReportSummary,
  listReportRubrics,
  topPerformersByRubric,
  REPORT_RECOMMENDATIONS,
  type EvaluationReportRow,
  type ReportRecommendation,
} from '@/data/reports';

/** An evaluation card before its scores have loaded. */
type PendingRow = Pick<EvaluationReportRow, 'id' | 'name' | 'sport' | 'eventType' | 'date' | 'players'> & {
  pending: true;
};
type ListRow = EvaluationReportRow | PendingRow;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const score = (n: number | null) => (n === null ? '—' : n.toFixed(1));

/** Insights across the coach's evaluations: progress, scoring, leaders and the calls made. */
export default function ReportsPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  // Two reads, started together. The light one (names, sports, headcounts — the
  // dashboard has usually cached it already) paints the page straight away; the
  // heavy one carries every evaluation and score and fills in the numbers when it
  // lands. Waiting on the heavy one alone left a skeleton up for many seconds.
  const summariesQuery = useTryoutSummariesQuery(false);
  const tryoutsQuery = useTryoutsQuery(false);

  // A staff assessor's finished evaluations leave their list (same rule as the
  // Evaluations page); coaches and admins are never filtered.
  const user = useUser();
  const { role } = usePermissions();
  const myEmail = user?.email?.toLowerCase();
  const isVisible = (t: { assessors: { status?: string; userId?: string | null; email?: string }[] }) =>
    role !== 'assessor' ||
    !t.assessors.some(
      (a) =>
        a.status === 'completed' &&
        ((!!user?.id && a.userId === user.id) || (!!myEmail && a.email?.toLowerCase() === myEmail)),
    );
  const fullData = tryoutsQuery.data?.filter(isVisible);
  const lightData = summariesQuery.data?.filter(isVisible);

  const scoresReady = !!fullData;
  const scoresFailed = tryoutsQuery.isError && !scoresReady;
  const summary = buildReportSummary(fullData ?? []);

  // Top performers can be ranked on the overall score or on any one measure.
  const [leaderFocus, setLeaderFocus] = useState('overall');
  const rubricOptions = listReportRubrics(fullData ?? []);
  const focusRubric = rubricOptions.find((r) => r.key === leaderFocus);
  const leaders = focusRubric
    ? topPerformersByRubric(fullData ?? [], focusRubric.key).map((p) => ({ ...p, unit: p.unit }))
    : summary.topPerformers.map((p) => ({ ...p, unit: undefined as string | undefined }));
  const leaderValue = (n: number, unit?: string) =>
    !focusRubric
      ? score(n)
      : unit
        ? `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')} ${unit}`
        : n.toFixed(1);

  // Until the scores arrive the list is built from the light read: same cards,
  // same buttons, no progress figures.
  const rows: ListRow[] = scoresReady
    ? summary.rows
    : [...(lightData ?? [])]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((t) => ({
          pending: true as const,
          id: t.id,
          name: t.name,
          sport: t.sport,
          eventType: t.eventType,
          date: t.tryoutDate ?? null,
          players: t.playerCount,
        }));
  const evaluationCount = scoresReady ? summary.evaluationCount : rows.length;

  // Same colours the app already uses for these calls; grey for "no call yet".
  const recColor: Record<ReportRecommendation, string> = {
    Make: colors.success,
    Keep: colors.info,
    Bubble: colors.warning,
    Release: colors.danger,
    Undecided: colors.inkFaint,
  };

  if (summariesQuery.isLoading && !scoresReady) {
    return (
      <>
        <PageHeader title="Reports" subtitle="Insights across your evaluations" />
        <CardGridSkeleton count={4} lines={2} columns="sm:grid-cols-2 lg:grid-cols-4" />
      </>
    );
  }
  if (summariesQuery.isError && !scoresReady) {
    return (
      <ErrorState
        message="Could not load your evaluations."
        onRetry={() => {
          summariesQuery.refetch();
          tryoutsQuery.refetch();
        }}
      />
    );
  }
  if (evaluationCount === 0) {
    return (
      <>
        <PageHeader title="Reports" subtitle="Insights across your evaluations" />
        <EmptyState
          title="No evaluations yet"
          message="Create an evaluation and score players to see progress, leaders and recommendations here."
          actionLabel="Go to Evaluations"
          onAction={() => router.push('/dashboard')}
        />
      </>
    );
  }

  const waiting = scoresFailed ? 'unavailable' : 'calculating…';
  const kpis = [
    { label: 'Evaluations', value: `${evaluationCount}`, caption: 'in your account' },
    {
      label: 'Players scored',
      value: scoresReady ? `${summary.scoredPlayerCount}` : '—',
      caption: scoresReady ? `of ${summary.playerCount} · ${pct(summary.completion)}` : waiting,
    },
    {
      label: 'Scores recorded',
      value: scoresReady ? `${summary.scoresRecorded}` : '—',
      caption: scoresReady ? 'evaluations entered' : waiting,
    },
    {
      label: 'Average score',
      value: scoresReady ? score(summary.avgOverall) : '—',
      caption: scoresReady ? 'out of 5' : waiting,
    },
  ];
  const calculating = (
    <p className="flex items-center gap-2 text-sm" style={{ color: colors.inkMuted }}>
      {scoresFailed ? (
        <>
          Could not calculate scores.
          <button type="button" onClick={() => tryoutsQuery.refetch()} className="font-bold" style={{ color: colors.primary }}>
            Retry
          </button>
        </>
      ) : (
        <>
          <Spinner size={14} color={colors.primary} />
          Calculating from your scores…
        </>
      )}
    </p>
  );
  const recTotal = REPORT_RECOMMENDATIONS.reduce((n, r) => n + summary.recommendations[r], 0);

  return (
    <>
      <PageHeader title="Reports" subtitle="Insights across your evaluations" />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="flex flex-col gap-1">
            <span className="text-xs font-bold tracking-wider uppercase" style={{ color: colors.inkMuted }}>
              {k.label}
            </span>
            <span className="text-3xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
              {k.value}
            </span>
            <span className="text-xs" style={{ color: colors.inkMuted }}>
              {k.caption}
            </span>
          </Card>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <HomePanel icon="barChart" label="Recommendations">
          {!scoresReady ? (
            calculating
          ) : recTotal === 0 ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              No players scored yet. Calls appear here as coaches recommend Make, Keep, Bubble or Release.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex h-2.5 overflow-hidden rounded-full" role="img" aria-label="Recommendation split">
                {REPORT_RECOMMENDATIONS.filter((r) => summary.recommendations[r] > 0).map((r) => (
                  <span key={r} style={{ flex: summary.recommendations[r], backgroundColor: recColor[r] }} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {REPORT_RECOMMENDATIONS.map((r) => (
                  <span key={r} className="flex items-center gap-1.5 text-sm" style={{ color: colors.ink }}>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: recColor[r] }} />
                    {r} <span style={{ color: colors.inkMuted }}>{summary.recommendations[r]}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </HomePanel>

        <HomePanel icon="profile" label="Top performers">
          {!scoresReady ? (
            calculating
          ) : summary.topPerformers.length === 0 ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Leaders appear once players have been scored.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <select
                aria-label="Rank top performers by"
                value={focusRubric ? focusRubric.key : 'overall'}
                onChange={(e) => setLeaderFocus(e.target.value)}
                className="rounded-md border px-2 py-2 text-sm font-semibold"
                style={{ backgroundColor: colors.tile, borderColor: colors.border, color: colors.ink }}
              >
                <option value="overall">Top overall performers</option>
                {rubricOptions.length > 0 ? (
                  <optgroup label="Top in a measure">
                    {rubricOptions.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              {leaders.map((p, i) => (
                <Link
                  key={`${p.evaluationId}-${p.playerId}`}
                  href={`/assessment/${p.evaluationId}/player/${p.playerId}`}
                  className="block"
                  onClick={() => setCurrentTryout(p.evaluationId)}
                >
                  <PanelRow>
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      style={{
                        backgroundColor: i === 0 ? colors.primary : colors.tile,
                        color: i === 0 ? '#ffffff' : colors.inkMuted,
                      }}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-bold" style={{ color: colors.ink }}>
                        {p.name}
                      </span>
                      <span className="block truncate text-xs" style={{ color: colors.inkMuted }}>
                        {p.evaluationName}
                        {p.pos ? ` · ${p.pos}` : ''}
                      </span>
                    </span>
                    <Badge label={leaderValue(p.overall, p.unit)} variant="brand" />
                    <NavPending />
                  </PanelRow>
                </Link>
              ))}
            </div>
          )}
        </HomePanel>
      </div>

      <h2 className="mb-3 text-xs font-bold tracking-wider uppercase" style={{ color: colors.inkMuted }}>
        By evaluation
      </h2>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map((row) => {
          const item = 'pending' in row ? null : row;
          return (
          <Card key={row.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                  {row.name}
                </p>
                <p className="text-sm" style={{ color: colors.inkMuted }}>
                  {row.sport} · {row.eventType}
                  {row.date ? ` · ${row.date}` : ''}
                  {item ? '' : ` · ${row.players} ${row.players === 1 ? 'player' : 'players'}`}
                </p>
              </div>
              {item ? (
                <Badge label={`Avg ${score(item.avgOverall)}`} variant={item.avgOverall === null ? 'default' : 'brand'} />
              ) : null}
            </div>

            {item ? (
            <div className="flex flex-col gap-1.5">
              <div
                className="h-2 overflow-hidden rounded-full"
                style={{ backgroundColor: colors.tile }}
                role="progressbar"
                aria-valuenow={Math.round(item.completion * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-2" style={{ width: pct(item.completion), backgroundColor: colors.primary }} />
              </div>
              <div className="flex justify-between text-xs" style={{ color: colors.inkMuted }}>
                <span>
                  {item.scoredPlayers} of {item.players} {item.players === 1 ? 'player' : 'players'} scored · {pct(item.completion)}
                </span>
                {item.unscored > 0 ? (
                  <span className="font-bold" style={{ color: colors.warning }}>
                    {item.unscored} to go
                  </span>
                ) : item.players > 0 ? (
                  <span className="font-bold" style={{ color: colors.success }}>
                    Complete
                  </span>
                ) : null}
              </div>
              {item.top ? (
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  Leader: <span style={{ color: colors.ink }}>{item.top.name}</span> · {score(item.top.overall)}
                </p>
              ) : null}
            </div>
            ) : (
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                {scoresFailed ? 'Scores unavailable' : 'Loading scores…'}
              </p>
            )}

            <div className="flex gap-2">
              {(
                [
                  ['Results', 'results', true],
                  ['Compare', 'compare', false],
                  ['Export', 'export', false],
                ] as const
              ).map(([label, path, primary]) => (
                <Link
                  key={path}
                  href={`/assessment/${row.id}/${path}`}
                  onClick={() => setCurrentTryout(row.id)}
                  className="flex min-h-10 flex-1 items-center justify-center rounded-xl border text-sm font-bold transition-[filter] hover:brightness-110"
                  style={{
                    backgroundColor: primary ? colors.primary : colors.tile,
                    borderColor: primary ? 'transparent' : colors.border,
                    color: primary ? '#ffffff' : colors.ink,
                  }}
                >
                  {label}
                </Link>
              ))}
            </div>
          </Card>
          );
        })}
      </div>
    </>
  );
}
