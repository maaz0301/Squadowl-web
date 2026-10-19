'use client';

import { useState } from 'react';

import { Badge, Card } from '@/components/ui';
import { usePlayerProfileQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * A player's earlier evaluation and fitness results, shown while scoring them
 * again. Every result names the team, the evaluation and the date it came from;
 * the player is one person across every team they are linked to, so this is the
 * same history wherever they are scored. Collapsed until opened.
 */
export function PastResultsPanel({ athleteId, excludeTryoutId }: { athleteId?: string; excludeTryoutId?: string }) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const profile = usePlayerProfileQuery(athleteId);
  const past = (profile.data?.assessments ?? []).filter((a) => a.evalCount > 0 && a.tryoutId !== excludeTryoutId);
  if (!athleteId || past.length === 0) return null;

  return (
    <Card className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="font-bold" style={{ color: colors.ink }}>
          Past results ({past.length})
        </span>
        <span className="text-sm font-bold" style={{ color: colors.primary }}>
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open ? (
        <ul className="mt-3 flex flex-col gap-3">
          {past.map((a) => (
            <li key={a.tryoutId} className="flex flex-col gap-0.5">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-bold" style={{ color: colors.ink }}>
                  {a.tryoutName}
                </span>
                {a.latestRecommendation ? <Badge label={a.latestRecommendation} variant="brand" /> : null}
              </span>
              <span className="text-xs" style={{ color: colors.inkMuted }}>
                {[a.teamName, a.eventType, a.date || 'No date'].filter(Boolean).join(' · ')}
              </span>
              <span className="text-sm" style={{ color: colors.ink }}>
                Overall {a.overall.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
