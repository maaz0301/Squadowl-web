'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, ErrorState, LoadingState, PageHeader, Tabs } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import {
  useOrgQuery,
  useOrgMembersQuery,
  useTryoutsQuery,
  useTeamsQuery,
  useSeasonsQuery,
} from '@/features/queries';
import type { Tryout } from '@/data/types';

const ENT_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'actions', label: 'Actions' },
  { key: 'members', label: 'Members' },
] as const;

type EntTab = (typeof ENT_TABS)[number]['key'];

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  const colors = useThemeColors();
  return (
    <Card className="flex-1 min-w-[120px] gap-1 p-3">
      <span className="text-2xl font-bold block" style={{ color: tone ?? colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
        {value}
      </span>
      <span className="text-xs font-bold block" style={{ color: colors.ink }}>
        {label}
      </span>
      {hint ? (
        <span className="text-[10px] block" style={{ color: colors.inkMuted }}>
          {hint}
        </span>
      ) : null}
    </Card>
  );
}

function ShareBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const colors = useThemeColors();
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) {
    return (
      <span className="text-xs block" style={{ color: colors.inkMuted }}>
        No data yet.
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div key={p.label} style={{ flex: p.value, backgroundColor: p.color }} />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-xs" style={{ color: colors.inkMuted }}>
              {p.label} {p.value} ({Math.round((p.value / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function EnterprisePage() {
  const colors = useThemeColors();
  const [tab, setTab] = useState<EntTab>('overview');
  const orgQuery = useOrgQuery();
  const membersQuery = useOrgMembersQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const teamsQuery = useTeamsQuery();
  const seasonsQuery = useSeasonsQuery();

  const tryouts = tryoutsQuery.data ?? [];

  const metrics = useMemo(() => {
    let players = 0;
    let scoredPlayers = 0;
    let evaluations = 0;
    let regsTotal = 0;
    let regsPending = 0;
    let regsAdded = 0;
    let unpaid = 0;
    const recCounts: Record<string, number> = { Make: 0, Keep: 0, Bubble: 0, Release: 0 };
    const bySport: Record<string, number> = {};
    const needsAttention: { tryout: Tryout; unscored: number; pending: number }[] = [];

    for (const t of tryouts) {
      const roster = t.roster ?? [];
      const evals = t.evals ?? [];
      players += roster.length;
      evaluations += evals.length;
      bySport[t.sport] = (bySport[t.sport] ?? 0) + 1;

      const scoredIds = new Set(evals.map((e) => e.playerId));
      const unscored = roster.filter((p) => !scoredIds.has(p.id)).length;
      scoredPlayers += roster.length - unscored;

      for (const e of evals) {
        if (e.recommendation && recCounts[e.recommendation] !== undefined) {
          recCounts[e.recommendation]++;
        }
      }

      const regs = t.registrations ?? [];
      regsTotal += regs.length;
      const pending = regs.filter((r) => r.status === 'pending').length;
      regsPending += pending;
      regsAdded += regs.filter((r) => r.status === 'added').length;
      unpaid += regs.filter((r) => r.paymentStatus && r.paymentStatus !== 'paid').length;

      if (unscored > 0 || pending > 0) needsAttention.push({ tryout: t, unscored, pending });
    }

    needsAttention.sort((a, b) => b.unscored + b.pending - (a.unscored + a.pending));

    const largest = [...tryouts]
      .sort((a, b) => (b.roster?.length ?? 0) - (a.roster?.length ?? 0))
      .slice(0, 5);

    return {
      players,
      scoredPlayers,
      evaluations,
      regsTotal,
      regsPending,
      regsAdded,
      unpaid,
      recCounts,
      bySport,
      needsAttention,
      largest,
      scoredPct: players ? Math.round((scoredPlayers / players) * 100) : 0,
      convertedPct: regsTotal ? Math.round((regsAdded / regsTotal) * 100) : 0,
      avgSize: tryouts.length ? Math.round(players / tryouts.length) : 0,
      evalsPerPlayer: players ? (evaluations / players).toFixed(1) : '0',
    };
  }, [tryouts]);

  if (orgQuery.isLoading) return <LoadingState message="Loading org..." />;

  const org = orgQuery.data;
  const unscoredPlayers = metrics.players - metrics.scoredPlayers;

  return (
    <>
      <PageHeader title="Enterprise Dashboard" subtitle="Association & Org Intelligence" showBack backHref="/dashboard" />

      <PlanGate feature="enterprise" title="Enterprise Dashboard (Association)">
        <Tabs tabs={[...ENT_TABS]} activeKey={tab} onChange={(k) => setTab(k as EntTab)} className="mb-6" />

        {tab === 'overview' ? (
          <div className="space-y-6">
            {org ? (
              <Card accent className="flex flex-col gap-2">
                <h2 className="text-xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                  {org.orgName}
                </h2>
                <p className="text-sm" style={{ color: colors.inkMuted }}>/{org.orgSlug}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge label={`${membersQuery.data?.length ?? org.memberCount} members`} />
                  <Badge label={`${tryouts.length} assessments`} variant="brand" />
                  <Badge label={`${metrics.players} players`} variant="info" />
                </div>
              </Card>
            ) : (
              <ErrorState message="No organization found." onRetry={() => orgQuery.refetch()} />
            )}

            {tryoutsQuery.isLoading ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>Loading metrics...</p>
            ) : (
              <>
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="Players" value={`${metrics.players}`} hint={`${metrics.avgSize} avg / assessment`} />
                  <Stat label="Evaluations" value={`${metrics.evaluations}`} hint={`${metrics.evalsPerPlayer} per player`} />
                  <Stat
                    label="Scored"
                    value={`${metrics.scoredPct}%`}
                    hint={`${unscoredPlayers} unscored`}
                    tone={
                      metrics.scoredPct >= 75
                        ? colors.success
                        : metrics.scoredPct >= 40
                          ? colors.warning
                          : colors.danger
                    }
                  />
                  <Stat label="Teams" value={`${teamsQuery.data?.length ?? 0}`} />
                  <Stat label="Seasons" value={`${seasonsQuery.data?.length ?? 0}`} />
                  <Stat label="Registrations" value={`${metrics.regsTotal}`} hint={`${metrics.regsPending} pending`} />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="flex flex-col gap-3">
                    <h3 className="font-bold text-base" style={{ color: colors.ink }}>Scoring Progress</h3>
                    <ShareBar
                      parts={[
                        { label: 'Scored', value: metrics.scoredPlayers, color: colors.success },
                        { label: 'Unscored', value: unscoredPlayers, color: colors.border },
                      ]}
                    />
                  </Card>

                  <Card className="flex flex-col gap-3">
                    <h3 className="font-bold text-base" style={{ color: colors.ink }}>Recommendation Mix</h3>
                    <ShareBar
                      parts={[
                        { label: 'Make', value: metrics.recCounts.Make, color: colors.success },
                        { label: 'Keep', value: metrics.recCounts.Keep, color: colors.primary },
                        { label: 'Bubble', value: metrics.recCounts.Bubble, color: colors.warning },
                        { label: 'Release', value: metrics.recCounts.Release, color: colors.danger },
                      ]}
                    />
                  </Card>
                </div>

                <Card className="flex flex-col gap-3">
                  <h3 className="font-bold text-base" style={{ color: colors.ink }}>Registration Funnel</h3>
                  <ShareBar
                    parts={[
                      { label: 'Added', value: metrics.regsAdded, color: colors.success },
                      { label: 'Pending', value: metrics.regsPending, color: colors.warning },
                      {
                        label: 'Dismissed',
                        value: Math.max(0, metrics.regsTotal - metrics.regsAdded - metrics.regsPending),
                        color: colors.border,
                      },
                    ]}
                  />
                  <p className="text-xs" style={{ color: colors.inkMuted }}>
                    {metrics.convertedPct}% of registrations converted to roster players.
                  </p>
                </Card>

                {Object.keys(metrics.bySport).length > 0 ? (
                  <Card className="flex flex-col gap-2">
                    <h3 className="font-bold text-base" style={{ color: colors.ink }}>Assessments by Sport</h3>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(metrics.bySport)
                        .sort((a, b) => b[1] - a[1])
                        .map(([sport, count]) => (
                          <Badge key={sport} label={`${sport} · ${count}`} />
                        ))}
                    </div>
                  </Card>
                ) : null}

                {metrics.largest.length > 0 ? (
                  <Card className="flex flex-col gap-2">
                    <h3 className="font-bold text-base mb-2" style={{ color: colors.ink }}>Largest Assessments</h3>
                    <div className="divide-y" style={{ borderColor: colors.border }}>
                      {metrics.largest.map((t) => (
                        <Link key={t.id} href={`/assessment/${t.id}/roster`} className="block py-3 hover:opacity-80 transition-opacity">
                          <div className="flex justify-between items-center">
                            <div>
                              <span className="font-bold block" style={{ color: colors.ink }}>{t.name}</span>
                              <span className="text-xs block" style={{ color: colors.inkMuted }}>
                                {t.sport} · {t.evals?.length ?? 0} evaluations
                              </span>
                            </div>
                            <Badge label={`${t.roster?.length ?? 0} players`} variant="brand" />
                          </div>
                        </Link>
                      ))}
                    </div>
                  </Card>
                ) : null}
              </>
            )}
          </div>
        ) : null}



        {tab === 'actions' ? (
          <div className="space-y-6">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
              <Stat
                label="Pending Regs"
                value={`${metrics.regsPending}`}
                hint="awaiting review"
                tone={metrics.regsPending ? colors.warning : colors.ink}
              />
              <Stat
                label="Unscored"
                value={`${unscoredPlayers}`}
                hint="players with no eval"
                tone={unscoredPlayers ? colors.warning : colors.ink}
              />
              <Stat
                label="Unpaid"
                value={`${metrics.unpaid}`}
                hint="registrations"
                tone={metrics.unpaid ? colors.danger : colors.ink}
              />
            </div>

            <div>
              <h3 className="text-md font-bold mb-3" style={{ color: colors.ink }}>Needs Attention</h3>
              {metrics.needsAttention.length === 0 ? (
                <Card className="flex flex-col gap-1">
                  <span className="font-bold" style={{ color: colors.success }}>All clear</span>
                  <span className="text-xs" style={{ color: colors.inkMuted }}>
                    Every assessment is fully scored with no pending registrations.
                  </span>
                </Card>
              ) : (
                <div className="space-y-2">
                  {metrics.needsAttention.map(({ tryout: t, unscored, pending }) => (
                    <Link key={t.id} href={`/assessment/${t.id}/roster`} className="block">
                      <Card className="flex justify-between items-center hover:opacity-80 transition-opacity">
                        <span className="font-bold" style={{ color: colors.ink }}>{t.name}</span>
                        <div className="flex gap-2">
                          {pending > 0 ? <Badge label={`${pending} pending regs`} variant="warning" /> : null}
                          {unscored > 0 ? <Badge label={`${unscored} unscored`} variant="info" /> : null}
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'members' ? (
          <div className="space-y-4">
            {membersQuery.isLoading ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>Loading members...</p>
            ) : (membersQuery.data?.length ?? 0) === 0 ? (
              <Card>
                <p className="text-sm text-center" style={{ color: colors.inkMuted }}>
                  No members yet — invite staff from Organization Members.
                </p>
              </Card>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-2">
                  {(['admin', 'coach', 'assessor', 'guardian'] as const).map((role) => {
                    const count = (membersQuery.data ?? []).filter((m) => m.role === role).length;
                    return count > 0 ? <Badge key={role} label={`${role} · ${count}`} /> : null;
                  })}
                </div>
                <div className="space-y-2">
                  {(membersQuery.data ?? []).map((m) => (
                    <Card key={m.id} className="flex justify-between items-center">
                      <div>
                        <span className="font-bold block" style={{ color: colors.ink }}>{m.name || m.email}</span>
                        <span className="text-xs block" style={{ color: colors.inkMuted }}>{m.email}</span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge label={m.role} variant="brand" />
                        <Badge
                          label={m.status}
                          variant={m.status === 'active' ? 'success' : m.status === 'pending' ? 'warning' : 'default'}
                        />
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : null}
      </PlanGate>
    </>
  );
}
