'use client';

import { Chip, DateField } from '@/components/ui';
import {
  MAX_RECURRING_EVENTS,
  WEEKDAY_LABELS,
  WEEKDAY_NAMES,
  expandRecurrence,
  weekdayOf,
} from '@/lib/recurrence';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * "Repeat" for a new event: weekly on chosen days until a date. Lets a coach
 * build a whole calendar (every Tuesday and Thursday practice until the season
 * ends) in one save. Everyone invited is told once about the lot, not once per
 * event.
 */
export function RepeatField({
  date,
  weekdays,
  until,
  onChange,
  error,
}: {
  date?: string;
  weekdays?: number[];
  until?: string;
  onChange: (next: { weekdays: number[]; until: string }) => void;
  error?: string;
}) {
  const colors = useThemeColors();
  const days = weekdays ?? [];
  const repeating = days.length > 0;
  const count = date ? expandRecurrence(date, days, until).length : 0;

  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    // Unticking the last day would silently turn this back into a single
    // event, so keep at least one: "Does not repeat" is the way to opt out.
    if (next.length === 0) return;
    onChange({ weekdays: next, until: until ?? '' });
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        Repeat
      </span>
      <div className="flex flex-wrap">
        <Chip label="Does not repeat" active={!repeating} onClick={() => onChange({ weekdays: [], until: '' })} />
        <Chip
          label="Weekly"
          active={repeating}
          onClick={() => {
            if (repeating) return;
            const dow = date ? weekdayOf(date) : null;
            onChange({ weekdays: [dow ?? 1], until: '' });
          }}
        />
      </div>

      {repeating ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            {WEEKDAY_LABELS.map((label, d) => {
              const active = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  aria-label={WEEKDAY_NAMES[d]}
                  aria-pressed={active}
                  className="flex h-9 w-9 items-center justify-center rounded-full border text-xs font-bold"
                  style={{
                    backgroundColor: active ? 'rgba(255,107,43,0.12)' : colors.tile,
                    borderColor: active ? colors.primary : colors.border,
                    color: active ? colors.primary : colors.inkMuted,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <DateField
            label="Repeat until"
            value={until}
            onChange={(v) => onChange({ weekdays: days, until: v })}
            error={error}
            disablePast
            minDate={date || undefined}
          />
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            {!until
              ? 'Pick the last date to repeat until.'
              : count > 1
                ? `Creates ${count} events. Everyone invited gets one email for all of them.${count >= MAX_RECURRING_EVENTS ? ` Capped at ${MAX_RECURRING_EVENTS}.` : ''}`
                : 'No other dates fall on the days you picked. Only the first event will be created.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
