'use client';

import { Badge, Modal } from '@/components/ui';
import type { PlayerProfileAssessment } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

/** "ice_skating" -> "Ice skating": category and measure keys as a coach would read them. */
const titleize = (key: string) => {
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
};

/**
 * The permanent record of one evaluation in a player's history: what it was,
 * when and for whom, how the player finished, and every session that went into
 * it. Read-only; it is the "tombstone" a coach looks back at after the event.
 */
export function EvaluationRecordModal({
  assessment,
  onClose,
}: {
  assessment: PlayerProfileAssessment | null;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const a = assessment;
  const evaluators = a ? [...new Set((a.evaluations ?? []).map((e) => e.evaluator).filter(Boolean))] : [];
  const sessions = a ? [...(a.evaluations ?? [])].sort((x, y) => x.createdAt - y.createdAt) : [];

  const field = (label: string, value?: string | number | null) => (
    <div className="flex justify-between gap-3">
      <span className="text-sm" style={{ color: colors.inkMuted }}>{label}</span>
      <span className="flex-1 text-right text-sm font-medium" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '—'}
      </span>
    </div>
  );
  const heading = (text: string) => (
    <p className="mb-1.5 mt-1 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>{text}</p>
  );

  return (
    <Modal visible={!!a} title={a?.tryoutName ?? 'Evaluation'} size="lg" onClose={onClose}>
      {a ? (
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1.5">
            {heading('Record')}
            {field('Event type', a.eventType)}
            {field('Sport', a.sport)}
            {field('Date', a.date)}
            {field('Season', a.seasonName)}
            {field('Team', a.teamName)}
            {field('Position', a.position)}
            {field('Sessions scored', a.evalCount)}
            {field('Evaluators', evaluators.join(', '))}
          </div>

          <div className="flex flex-col gap-1.5">
            {heading('Result')}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm" style={{ color: colors.inkMuted }}>Overall score</span>
              <span className="text-lg font-bold" style={{ color: colors.primary }}>
                {a.evalCount > 0 ? a.overall.toFixed(1) : 'Not yet scored'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm" style={{ color: colors.inkMuted }}>Recommendation</span>
              {a.latestRecommendation ? <Badge label={a.latestRecommendation} variant="brand" /> : (
                <span className="text-sm" style={{ color: colors.inkFaint }}>—</span>
              )}
            </div>
            {Object.keys(a.categoryScores).length > 0 ? (
              <div className="mt-1 flex flex-col gap-1">
                {Object.entries(a.categoryScores).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3">
                    <span className="text-sm" style={{ color: colors.inkMuted }}>{titleize(key)}</span>
                    <span className="text-sm font-medium" style={{ color: colors.ink }}>{value.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {sessions.length > 0 ? (
            <div className="flex flex-col gap-2">
              {heading('Sessions')}
              {sessions.map((ev) => (
                <div
                  key={ev.id}
                  className="flex flex-col gap-0.5 rounded-md border px-3 py-2"
                  style={{ backgroundColor: colors.tile, borderColor: colors.border }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold" style={{ color: colors.ink }}>
                      {ev.session || 'Session'} · {ev.date || '—'}
                    </span>
                    <span className="text-sm font-bold" style={{ color: colors.primary }}>{ev.overall.toFixed(1)}</span>
                  </div>
                  <span className="text-xs" style={{ color: colors.inkMuted }}>
                    {ev.evaluator || 'Unknown evaluator'}
                    {ev.recommendation ? ` · ${ev.recommendation}` : ''}
                  </span>
                  {ev.strengths ? <span className="text-sm" style={{ color: colors.ink }}>+ {ev.strengths}</span> : null}
                  {ev.improve ? <span className="text-sm" style={{ color: colors.inkMuted }}>→ {ev.improve}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
