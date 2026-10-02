'use client';

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
  onAddEvent,
}: {
  events: SeasonEvent[];
  teamName?: string;
  /** For a calendar that mixes several teams: which team an event belongs to. Shown on each event. */
  teamNameFor?: (event: SeasonEvent) => string | undefined;
  /** When given, a selected day offers "Add event on <date>" and hands the date back. */
  onAddEvent?: (date: string) => void;
}) {
  const colors = useThemeColors();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState<string | null>(null);
  const dayMap = useMemo(() => eventsByDay(events), [events]);
  const weeks = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);
  const today = todayKey();
  const go = (delta: number) => {
    setCursor((c) => addMonths(c.year, c.month, delta));
    setSelected(null);
  };

  const monthPrefix = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
  const shown = (
    selected
      ? (dayMap[selected] ?? [])
      : Object.entries(dayMap)
          .filter(([k]) => k.startsWith(monthPrefix))
          .flatMap(([, evs]) => evs)
          .filter((ev, i, all) => all.indexOf(ev) === i)
  )
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  const navBtn = 'rounded-md px-3 py-1 text-xl font-bold';

  return (
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

      <h3 className="mb-2 mt-6 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
        {selected ? `Events on ${selected}` : `Events in ${MONTH_NAMES[cursor.month]}`}
      </h3>
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
        <EmptyState title="No events" message={selected ? 'Nothing scheduled this day.' : 'Nothing scheduled this month.'} />
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((ev) => (
            <Card key={ev.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="w-12 text-center text-2xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                {ev.date.slice(8, 10)}
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
              </span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
