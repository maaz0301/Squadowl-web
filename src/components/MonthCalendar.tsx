'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { AddToCalendar } from '@/components/AddToCalendar';
import { MapLink } from '@/components/MapLink';
import { Badge, Card, EmptyState } from '@/components/ui';
import type { SeasonEvent } from '@/data/types';
import { MONTH_NAMES, WEEKDAYS, addMonths, buildMonthGrid, eventsByDay, todayKey } from '@/lib/monthGrid';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * A month grid of a team's events: dots on days that have one, click a day to
 * list just that day's events. Shared by the team hub's Calendar tab and the
 * season's Calendar page, so both look and behave the same.
 */
export function MonthCalendar({
  events,
  teamName,
  teamNameFor,
  rosterSizeFor,
  eventHref,
  onAddEvent,
}: {
  events: SeasonEvent[];
  teamName?: string;
  /** For a calendar that mixes several teams: which team an event belongs to. Shown on each event. */
  teamNameFor?: (event: SeasonEvent) => string | undefined;
  /** How many players an event's availability poll goes to. Without it, no poll card is shown. */
  rosterSizeFor?: (event: SeasonEvent) => number | undefined;
  /** When given, a selected day offers "Add event on <date>" and hands the date back. */
  /** Where an event's full details are, when it can be opened (the team's schedule, for the all-teams calendar). */
  eventHref?: (event: SeasonEvent) => string | undefined;
  onAddEvent?: (date: string) => void;
}) {
  const colors = useThemeColors();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState<string | null>(null);
  // Any day inside the week the strip shows; moves a week at a time.
  const [weekBase, setWeekBase] = useState(() => todayKey());
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const dayMap = useMemo(() => eventsByDay(events), [events]);
  const weeks = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
  const today = todayKey();
  const go = (delta: number) => {
    setCursor((c) => addMonths(c.year, c.month, delta));
    setSelected(null);
  };

  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const weekDays = useMemo(() => {
    const base = new Date(`${weekBase}T12:00:00`);
    base.setDate(base.getDate() - base.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return { key: keyOf(d), day: d.getDate(), label: WEEKDAYS[d.getDay()].toUpperCase(), month: d.getMonth(), year: d.getFullYear() };
    });
  }, [weekBase]);
  const shiftWeek = (delta: number) => {
    const d = new Date(`${weekBase}T12:00:00`);
    d.setDate(d.getDate() + delta * 7);
    setWeekBase(keyOf(d));
    setSelected(null);
  };
  const weekKeys = weekDays.map((d) => d.key);

  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
  const shown = (
    selected
      ? (dayMap[selected] ?? [])
      : mode === 'week'
        ? weekKeys.flatMap((k) => dayMap[k] ?? [])
        : Object.entries(dayMap)
          .filter(([k]) => k.startsWith(monthPrefix))
          .flatMap(([, evs]) => evs)
          .filter((ev, i, all) => all.indexOf(ev) === i)
  )
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  const poll = (() => {
    for (const ev of shown) {
      const roster = rosterSizeFor?.(ev) ?? 0;
      if (ev.date < today || roster === 0 || ev.availabilityPending || ev.availabilityUnavailable) continue;
      const responded = Object.values(ev.availability ?? {}).filter((a) => a !== 'pending').length;
      if (responded < roster) return { event: ev, responded, total: roster };
    }
    return null;
  })();

  const navBtn = 'rounded-md px-3 py-1 text-xl font-bold';

  return (
    <div>
      <div className="mb-4 inline-flex rounded-2xl border p-1" style={{ backgroundColor: colors.tile, borderColor: colors.border }}>
        {(['week', 'month'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className="rounded-xl px-5 py-2 text-sm font-bold"
            style={{ backgroundColor: mode === m ? colors.primary : 'transparent', color: mode === m ? '#ffffff' : colors.ink }}
          >
            {m === 'week' ? 'Week' : 'Month'}
          </button>
        ))}
      </div>

      {mode === 'week' ? (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <button type="button" aria-label="Previous week" onClick={() => shiftWeek(-1)} className="rounded-md px-3 py-1 text-xl font-bold" style={{ color: colors.primary }}>‹</button>
            <h2 className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
              {MONTH_NAMES[weekDays[3].month]} {weekDays[3].year}
            </h2>
            <button type="button" aria-label="Next week" onClick={() => shiftWeek(1)} className="rounded-md px-3 py-1 text-xl font-bold" style={{ color: colors.primary }}>›</button>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map((d) => {
              const isSel = selected ? selected === d.key : d.key === today;
              const count = dayMap[d.key]?.length ?? 0;
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setSelected(selected === d.key ? null : d.key)}
                  aria-pressed={isSel}
                  className="flex flex-col items-center gap-0.5 rounded-2xl border py-3 transition-[filter] hover:brightness-110"
                  style={{
                    backgroundColor: isSel ? colors.primary : colors.tile,
                    borderColor: d.key === today && !isSel ? colors.primary : colors.border,
                    color: isSel ? '#ffffff' : colors.ink,
                  }}
                >
                  <span className="text-[10px] font-bold" style={{ color: isSel ? '#ffffff' : colors.inkMuted }}>{d.label}</span>
                  <span className="text-xl font-bold" style={{ fontFamily: 'var(--font-space-grotesk)' }}>{d.day}</span>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: count > 0 ? (isSel ? '#ffffff' : colors.primary) : 'transparent' }} />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
      <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" aria-label="Previous month" onClick={() => go(-1)} className={navBtn} style={{ color: colors.primary }}>
          ‹
        </button>
        <h2 className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          {MONTH_NAMES[cursor.month]} {cursor.year}
        </h2>
        <button type="button" aria-label="Next month" onClick={() => go(1)} className={navBtn} style={{ color: colors.primary }}>
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-1 text-center text-xs font-bold" style={{ color: colors.inkMuted }}>
            {d}
          </div>
        ))}
        {weeks.flat().map((key, i) => {
          if (!key) return <div key={i} />;
          const count = dayMap[key]?.length ?? 0;
          const isSel = selected === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(isSel ? null : key)}
              aria-pressed={isSel}
              aria-label={`${key}${count ? `, ${count} ${count === 1 ? 'event' : 'events'}` : ''}`}
              className="flex h-14 flex-col items-center justify-center rounded-md border sm:h-20"
              style={{
                backgroundColor: isSel ? colors.primary : colors.tile,
                borderColor: key === today ? colors.primary : colors.border,
                color: isSel ? '#ffffff' : colors.ink,
              }}
            >
              <span className="text-sm font-semibold">{Number(key.slice(8))}</span>
              {count > 0 ? (
                <span className="mt-0.5 flex items-center gap-0.5">
                  {Array.from({ length: Math.min(count, 3) }).map((_, n) => (
                    <span
                      key={n}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: isSel ? '#ffffff' : colors.primary }}
                    />
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      </div>
      )}

      {selected && mode === 'month' ? (
        <h3 className="mb-2 mt-6 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
          {`Events on ${selected}`}
        </h3>
      ) : (
        <div className="mt-6" />
      )}
      {selected && onAddEvent ? (
        <button
          type="button"
          onClick={() => onAddEvent(selected)}
          className="mb-3 flex h-[46px] w-full items-center justify-center rounded-2xl text-sm font-bold text-white transition-[filter] hover:brightness-110"
          style={{ backgroundColor: colors.primary }}
        >
          + Add event on {selected}
        </button>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState title="No events" message={selected ? 'Nothing scheduled this day.' : mode === 'week' ? 'Nothing scheduled this week.' : 'Nothing scheduled this month.'} />
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((ev, i) => (
            <div key={ev.id}>
            {mode === 'week' && (i === 0 || shown[i - 1].date !== ev.date) ? (
              <h3
                className="mb-2 mt-3 text-xs font-bold uppercase tracking-wider"
                style={{ color: ev.date === today ? colors.primary : colors.inkMuted }}
              >
                {ev.date === today ? 'Today' : new Date(`${ev.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}
              </h3>
            ) : null}
            <Card className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex w-12 flex-col items-center leading-tight">
                <span className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
                  {MONTH_NAMES[Number(ev.date.slice(5, 7)) - 1]?.slice(0, 3)}
                </span>
                <span className="text-2xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                  {ev.date.slice(8, 10)}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold" style={{ color: colors.ink }}>
                  {ev.title}
                </span>
                {teamNameFor?.(ev) ? (
                  <span className="block truncate text-xs font-semibold" style={{ color: colors.primary }}>
                    {teamNameFor(ev)}
                  </span>
                ) : null}
                <span className="block text-sm" style={{ color: colors.inkMuted }}>
                  {ev.startTime ?? '—'} ·{' '}
                  {ev.location ? <MapLink location={ev.location} label={ev.title} size="sm" variant="inline" /> : 'TBD'}
                </span>
              </span>
              <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                <MapLink location={ev.location} label={ev.title} size="sm" />
                <AddToCalendar event={ev} teamName={teamNameFor?.(ev) ?? teamName} size="sm" />
                <Badge label={ev.type} />
                {eventHref?.(ev) ? (
                  <Link
                    href={eventHref(ev)!}
                    className="rounded-md border px-2.5 py-1 text-xs font-bold transition-[filter] hover:brightness-110"
                    style={{ borderColor: colors.primary, color: colors.primary }}
                  >
                    View event ›
                  </Link>
                ) : null}
              </span>
            </Card>
            </div>
          ))}
        </div>
      )}

      {mode === 'week' && poll ? (
        <div className="mt-3 rounded-2xl border p-4" style={{ backgroundColor: colors.tile, borderColor: colors.border }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-bold" style={{ color: colors.ink }}>Availability poll</span>
            <span style={{ color: colors.ink }}>
              <span className="text-lg font-bold" style={{ fontFamily: 'var(--font-space-grotesk)' }}>{poll.responded}</span>
              <span className="text-xs" style={{ color: colors.inkMuted }}>/{poll.total}</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full" style={{ backgroundColor: colors.border }}>
            <div className="h-1.5 rounded-full" style={{ width: `${(poll.responded / poll.total) * 100}%`, backgroundColor: colors.primary }} />
          </div>
          <p className="mt-2 truncate text-xs" style={{ color: colors.inkMuted }}>
            {poll.event.title} · {poll.total - poll.responded} still to reply
          </p>
        </div>
      ) : null}
    </div>
  );
}
