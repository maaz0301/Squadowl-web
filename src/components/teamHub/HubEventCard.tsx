'use client';

import { Badge } from '@/components/ui';
import { Icon } from '@/components/Icons';
import { useThemeColors } from '@/theme/ThemeProvider';
import type { SeasonEvent } from '@/data/types';
import { useHubSurfaces } from './hubTheme';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** "YYYY-MM-DD" -> the three lines of the date block. Local date, no timezone shift. */
function dateParts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return { month: '', day: iso, weekday: '' };
  return { month: MONTHS[m - 1], day: String(d), weekday: WEEKDAYS[new Date(y, m - 1, d).getDay()] };
}

/**
 * One upcoming event: date block, venue, "title · time", who's invited, type
 * tag. Selecting it points Team Status, RSVPs and the action row at it, shown
 * by the orange left edge.
 */
export function HubEventCard({
  event,
  selected,
  playerCount,
  evaluatorCount,
  onSelect,
}: {
  event: SeasonEvent;
  selected: boolean;
  playerCount: number;
  evaluatorCount: number;
  onSelect: () => void;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const { month, day, weekday } = dateParts(event.date);

  const time = event.startTime ? `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}` : null;
  const headline = event.location?.trim() || event.title;
  const subline = [event.location?.trim() ? event.title : null, time].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="flex w-full items-center gap-3 rounded-2xl border py-3 pr-3 pl-2.5 text-left transition-[filter] hover:brightness-110"
      style={{
        backgroundColor: s.panelBg,
        borderColor: selected ? s.orangeBorder : s.panelBorder,
        borderLeftWidth: 3,
        borderLeftColor: selected ? colors.primary : s.panelBorder,
      }}
    >
      <span
        className="flex h-[58px] w-12 shrink-0 flex-col items-center justify-center rounded-xl border"
        style={{ backgroundColor: s.isDark ? 'rgba(8,14,28,0.7)' : colors.tile, borderColor: s.panelBorder }}
      >
        <span className="text-[10px] leading-none font-bold" style={{ color: colors.primary }}>
          {month}
        </span>
        <span
          className="text-xl leading-6 font-bold"
          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
        >
          {day}
        </span>
        <span className="text-[9px] leading-none font-medium" style={{ color: colors.inkMuted }}>
          {weekday}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Icon name="mapPin" size={13} color={colors.primary} />
          <span className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: colors.ink }}>
            {headline}
          </span>
        </span>
        {subline ? (
          <span className="mt-0.5 block truncate text-xs" style={{ color: colors.inkMuted }}>
            {subline}
          </span>
        ) : null}
        <span className="mt-1.5 flex items-center gap-3 text-[11px]" style={{ color: colors.inkMuted }}>
          <span className="flex items-center gap-1">
            <Icon name="teams" size={12} color={colors.inkFaint} />
            {playerCount} players
          </span>
          {evaluatorCount > 0 ? (
            <span className="flex items-center gap-1">
              <Icon name="profile" size={12} color={colors.inkFaint} />
              {evaluatorCount} {evaluatorCount === 1 ? 'evaluator' : 'evaluators'}
            </span>
          ) : null}
        </span>
      </span>

      <span className="flex flex-col items-end gap-2 self-stretch justify-between">
        <Badge label={event.type} variant={event.type === 'Game' ? 'brand' : 'info'} />
        <Icon name="chevronRight" size={16} color={colors.inkMuted} strokeWidth={2.5} />
      </span>
    </button>
  );
}
