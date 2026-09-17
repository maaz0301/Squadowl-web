'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import type { AnnouncementSeverity } from '@/data/founder/types';
import { useActiveAnnouncementsQuery } from '@/features/founderQueries';

const DISMISSED_KEY = 'dismissedAnnouncements';

const TONE: Record<AnnouncementSeverity, { bg: string; border: string }> = {
  info: { bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.35)' },
  warning: { bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.4)' },
  critical: { bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.45)' },
};

function readDismissed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Live founder announcements, shown to every signed-in user. Critical ones can't be dismissed. */
export function AnnouncementBanner({ enabled }: { enabled: boolean }) {
  const colors = useThemeColors();
  const { data } = useActiveAnnouncementsQuery(enabled);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  const visible = (data ?? []).filter((a) => a.severity === 'critical' || !dismissed.includes(a.id));
  if (!visible.length) return null;

  const dismiss = (id: string) => {
    // Only live ids are kept, so the list can't grow forever.
    const next = [...dismissed.filter((d) => data?.some((a) => a.id === d)), id];
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: dismissed for this visit only.
    }
  };

  return (
    <div className="mb-5 flex flex-col gap-2">
      {visible.map((a) => (
        <div
          key={a.id}
          role={a.severity === 'critical' ? 'alert' : 'status'}
          className="flex items-start gap-3 rounded-xl border px-4 py-3"
          style={{ backgroundColor: TONE[a.severity].bg, borderColor: TONE[a.severity].border }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold break-words" style={{ color: colors.ink }}>
              {a.title}
            </p>
            <p className="text-sm break-words whitespace-pre-line" style={{ color: colors.inkMuted }}>
              {a.message}
            </p>
          </div>
          {a.severity !== 'critical' ? (
            <button
              type="button"
              aria-label="Dismiss announcement"
              onClick={() => dismiss(a.id)}
              className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg leading-none hover:brightness-125"
              style={{ color: colors.inkMuted }}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
