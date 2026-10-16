'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { Card } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icons';
import { useSeasonsQuery, useTryoutQuery } from '@/features/queries';
import { computePlayerResults } from '@/data/scoring';
import { MONTH_NAMES, todayKey } from '@/lib/monthGrid';
import { useThemeColors } from '@/theme/ThemeProvider';
import type { TryoutSummary } from '@/data/types';

const BRIGHT = '#F8FAFC';
const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export type LiveKind = 'today' | 'upcoming' | 'latest';

/** The evaluation to feature: today's, else the next upcoming one, else the most recently touched with players. */
export function pickLiveTryout(tryouts: TryoutSummary[]): { tryout: TryoutSummary; kind: LiveKind } | null {
  const open = tryouts.filter((t) => !t.archived && t.playerCount > 0);
  const today = todayKey();
  const scheduledToday = open.find((t) => t.tryoutDate === today);
  if (scheduledToday) return { tryout: scheduledToday, kind: 'today' };
  const upcoming = open
    .filter((t) => t.tryoutDate && t.tryoutDate > today)
    .sort((a, b) => (a.tryoutDate! + (a.startTime ?? '')).localeCompare(b.tryoutDate! + (b.startTime ?? '')))[0];
  if (upcoming) return { tryout: upcoming, kind: 'upcoming' };
  const latest = [...open].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return latest ? { tryout: latest, kind: 'latest' } : null;
}

/** Featured evaluation with scoring progress and a one-click way into scoring. */
export function LiveTryoutCard({ tryout, kind, onResume }: { tryout: TryoutSummary; kind: LiveKind; onResume: () => void }) {
  const colors = useThemeColors();
  const { data } = useTryoutQuery(tryout.id);
  const total = data?.roster.length ?? tryout.playerCount;
  const scored = useMemo(() => (data ? computePlayerResults(data).filter((r) => r.evalCount > 0).length : 0), [data]);
  const pct = total > 0 ? Math.round((scored / total) * 100) : 0;
  const when = [kind === 'upcoming' ? tryout.tryoutDate : undefined, tryout.startTime, tryout.rink].filter(Boolean).join(' · ');
  const label = kind === 'today' ? 'LIVE TODAY' : kind === 'upcoming' ? 'UPCOMING EVALUATION' : 'LATEST EVALUATION';

  return (
    <div
      className="flex flex-col gap-3 overflow-hidden rounded-3xl border p-5"
      style={{
        borderColor: colors.border,
        backgroundColor: colors.tile,
        backgroundImage: 'linear-gradient(225deg, rgba(255,107,43,0.32) 0%, rgba(255,107,43,0) 65%)',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className="rounded-md px-2.5 py-1 text-xs font-extrabold tracking-wider"
          style={{ backgroundColor: 'rgba(255,107,43,0.14)', color: colors.primary }}
        >
          {label}
        </span>
        {when ? <span className="truncate text-sm" style={{ color: BRIGHT }}>{when}</span> : null}
      </div>
      <div>
        <h2 className="text-2xl font-bold sm:text-3xl" style={{ color: BRIGHT, fontFamily: 'var(--font-space-grotesk)' }}>
          {tryout.name}
        </h2>
        <p className="mt-0.5 text-base" style={{ color: BRIGHT }}>{tryout.sport} · {tryout.eventType}</p>
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-sm" style={{ color: BRIGHT }}>
          <span>{scored} of {total} {total === 1 ? 'player' : 'players'} scored</span>
          <span className="font-extrabold" style={{ color: colors.primary }}>{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full" style={{ backgroundColor: colors.border }}>
          <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: colors.primary }} />
        </div>
      </div>
      <button
        type="button"
        onClick={onResume}
        className="flex h-14 items-center justify-center gap-2 rounded-2xl text-lg font-bold transition-[filter] hover:brightness-110"
        style={{ backgroundColor: colors.primary, color: '#0B1220' }}
      >
        {scored > 0 ? 'Resume scoring' : 'Start scoring'}
        <span aria-hidden>→</span>
      </button>
    </div>
  );
}

export interface HubAction {
  key: string;
  label: string;
  icon: IconName;
  onClick: () => void;
}

/** Big shortcut tiles: icon chip over a two-line label. */
export function HubActions({ actions }: { actions: HubAction[] }) {
  const colors = useThemeColors();
  return (
    <div className="grid grid-cols-3 gap-3">
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={a.onClick}
          className="flex min-h-[120px] flex-col items-start gap-3 rounded-2xl border p-4 text-left transition-[filter,transform] hover:-translate-y-0.5 hover:brightness-110"
          style={{ backgroundColor: colors.tile, borderColor: colors.border }}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: 'rgba(255,107,43,0.2)' }}>
            <Icon name={a.icon} size={20} color={colors.primary} />
          </span>
          <span className="whitespace-pre-line text-base font-bold" style={{ color: BRIGHT }}>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

function addDays(key: string, n: number) {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface WeekItem {
  key: string;
  date: string;
  time?: string;
  title: string;
  sub: string;
  tag: string;
  isEval: boolean;
  href: string;
}

/** The next seven days across every team: events and evaluations together, each tagged. */
export function ThisWeek({ tryouts }: { tryouts: TryoutSummary[] }) {
  const colors = useThemeColors();
  const seasonsQuery = useSeasonsQuery();
  const items = useMemo(() => {
    const from = todayKey();
    const to = addDays(from, 7);
    const eventItems: WeekItem[] = (seasonsQuery.data ?? []).flatMap((s) =>
      s.events.map((ev) => ({
        key: `e-${ev.id}`,
        date: ev.date,
        time: ev.startTime,
        title: ev.title,
        sub: [ev.startTime, ev.location ?? s.teamName].filter(Boolean).join(' · '),
        tag: String(ev.type).replace(/^./, (c) => c.toUpperCase()),
        isEval: false,
        href: s.teamId ? `/team/${s.teamId}?tab=schedule&event=${ev.id}` : '/calendar',
      })),
    );
    const evalItems: WeekItem[] = tryouts
      .filter((t) => !t.archived && t.tryoutDate)
      .map((t) => ({
        key: `t-${t.id}`,
        date: t.tryoutDate as string,
        time: t.startTime,
        title: t.name,
        sub: [t.startTime, t.rink].filter(Boolean).join(' · ') || `${t.playerCount} ${t.playerCount === 1 ? 'player' : 'players'}`,
        tag: 'Evaluation',
        isEval: true,
        href: `/assessment/${t.id}/roster`,
      }));
    return [...eventItems, ...evalItems]
      .filter((i) => i.date >= from && i.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
      .slice(0, 8);
  }, [seasonsQuery.data, tryouts]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-2xl font-bold" style={{ color: BRIGHT, fontFamily: 'var(--font-space-grotesk)' }}>This week</h2>
        <Link href="/calendar" className="text-sm font-extrabold" style={{ color: colors.primary }}>See all</Link>
      </div>
      {items.length === 0 ? (
        <Card><p className="text-sm" style={{ color: colors.inkMuted }}>Nothing scheduled in the next 7 days.</p></Card>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((it) => {
            const d = new Date(`${it.date}T12:00:00`);
            return (
              <Link
                key={it.key}
                href={it.href}
                className="flex items-center gap-4 rounded-2xl border px-4 py-3 transition-[filter] hover:brightness-110"
                style={{ backgroundColor: colors.tile, borderColor: colors.border }}
              >
                <span className="flex w-10 flex-col items-center leading-tight">
                  <span className="text-xs font-extrabold" style={{ color: colors.primary }}>{WEEKDAY[d.getDay()]}</span>
                  <span className="text-2xl font-bold" style={{ color: BRIGHT, fontFamily: 'var(--font-space-grotesk)' }}>{d.getDate()}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-bold" style={{ color: BRIGHT }}>{it.title}</span>
                  <span className="block truncate text-sm" style={{ color: '#CBD5E1' }}>{it.sub || MONTH_NAMES[d.getMonth()]}</span>
                </span>
                <span
                  className="rounded-full border px-2.5 py-1 text-xs font-extrabold"
                  style={{
                    backgroundColor: it.isEval ? 'rgba(255,107,43,0.16)' : 'rgba(59,130,246,0.16)',
                    borderColor: it.isEval ? 'rgba(255,107,43,0.4)' : 'rgba(59,130,246,0.4)',
                    color: it.isEval ? colors.primary : '#93C5FD',
                  }}
                >
                  {it.tag}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
