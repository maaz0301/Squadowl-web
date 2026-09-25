'use client';

import { Icon, type IconName } from '@/components/Icons';
import { Spinner } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';

interface Counts {
  yes: number;
  maybe: number;
  no: number;
  pending: number;
}

/**
 * The selected event's RSVP tally as four tiles. Colours here are meaning
 * (going / maybe / not going / waiting), not decoration, so they stay
 * green / amber / red / blue.
 */
export function TeamStatusTiles({ counts, loading }: { counts: Counts; loading?: boolean }) {
  const colors = useThemeColors();

  const tiles: { key: string; value: number; label: string; caption: string; color: string; icon: IconName }[] = [
    { key: 'yes', value: counts.yes, label: 'Yes', caption: 'Attending', color: '#22c55e', icon: 'check' },
    { key: 'maybe', value: counts.maybe, label: 'Maybe', caption: 'Maybe', color: '#f59e0b', icon: 'question' },
    { key: 'no', value: counts.no, label: 'No', caption: 'Not attending', color: '#ef4444', icon: 'close' },
    { key: 'pending', value: counts.pending, label: 'Pending', caption: 'Pending', color: '#38bdf8', icon: 'clock' },
  ];

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3">
        <Spinner size={16} color={colors.primary} />
        <span className="text-sm" style={{ color: colors.inkMuted }}>
          Loading RSVPs...
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.key}
          className="flex h-[52px] items-center gap-2 rounded-xl border px-2.5"
          style={{ backgroundColor: `${t.color}1f`, borderColor: `${t.color}66` }}
          aria-label={`${t.value} ${t.label}`}
        >
          <span
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: t.color }}
          >
            <Icon name={t.icon} size={12} color="#ffffff" strokeWidth={3} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold" style={{ color: colors.ink }}>
              {t.value} {t.label}
            </span>
            <span className="block truncate text-[10px]" style={{ color: colors.inkMuted }}>
              {t.caption}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
