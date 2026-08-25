'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useTryoutQuery, useAiCompareMutation } from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { playerDisplayName } from '@/data/rubrics';
import { mockAiCompare } from '@/data/teamBuilder';

export default function ComparePage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const tryoutQuery = useTryoutQuery(id);
  const aiCompare = useAiCompareMutation(id!);
  const [selected, setSelected] = useState<string[]>([]);

  if (tryoutQuery.isLoading) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <>
        <PageHeader title="Compare Players" showBack />
        <ErrorState message="Could not load compare data." onRetry={() => tryoutQuery.refetch()} />
      </>
    );
  }

  const tryout = tryoutQuery.data;
  const toggle = (playerId: string) => {
    setSelected((prev) =>
      prev.includes(playerId) ? prev.filter((p) => p !== playerId) : prev.length < 4 ? [...prev, playerId] : prev,
    );
  };

  const heuristic = selected.length >= 2 ? mockAiCompare(tryout, selected) : null;
  const aiError = aiCompare.isError || (aiCompare.data as { error?: unknown } | undefined)?.error;

  return (
    <>
      <PageHeader title="Compare Players" subtitle="Select 2–4 athletes" showBack backHref={href('results')} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="flex flex-col gap-2">
          {tryout.roster.map((item) => {
            const isSelected = selected.includes(item.id);
            return (
              <Card
                key={item.id}
                interactive
                accent={isSelected}
                className="flex items-center justify-between gap-4"
                onClick={() => toggle(item.id)}
              >
                <span className="font-bold" style={{ color: colors.ink }}>
                  {playerDisplayName(item)}
                </span>
                {isSelected ? <Badge label="Selected" variant="brand" /> : null}
              </Card>
            );
          })}
        </div>

        <div className="lg:sticky lg:top-4">
          {heuristic ? (
            <PlanGate feature="aiSummaries" title="AI Compare">
              <Card accent className="flex flex-col gap-2">
                <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                  Standard Comparison
                </span>
                <span style={{ color: colors.inkMuted }}>{heuristic.summary}</span>
                <span style={{ color: colors.primary }}>{heuristic.edge}</span>
                <span>
                  <Badge label={`Best fit: ${heuristic.best_fit}`} variant="info" />
                </span>

                <div className="mt-2 border-t pt-3" style={{ borderColor: colors.border }}>
                  <p className="mb-2 font-bold" style={{ color: colors.primary }}>
                    Deep AI Insights
                  </p>
                  <Button
                    label="Run Deep AI Compare"
                    onClick={() => aiCompare.mutate(selected)}
                    loading={aiCompare.isPending}
                    size="sm"
                    className="mb-2"
                  />
                  {aiError ? (
                    <div
                      className="mt-1 rounded-xl border p-3"
                      style={{ backgroundColor: colors.tile, borderColor: colors.border }}
                    >
                      <p className="mb-1 text-sm font-bold" style={{ color: colors.ink }}>
                        ⚠️ Cannot generate comparison
                      </p>
                      <p className="text-sm" style={{ color: colors.inkMuted }}>
                        {(aiCompare.data as { message?: string } | undefined)?.message ||
                          aiCompare.error?.message ||
                          'Make sure the selected players have been scored before running AI Compare.'}
                      </p>
                    </div>
                  ) : aiCompare.data ? (
                    <div className="flex flex-col gap-2">
                      <span style={{ color: colors.inkMuted }}>{aiCompare.data.summary}</span>
                      <span style={{ color: colors.primary }}>{aiCompare.data.edge}</span>
                      <span>
                        <Badge label={`Best fit: ${aiCompare.data.best_fit}`} variant="brand" />
                      </span>
                      <span className="text-sm" style={{ color: colors.ink }}>
                        Watch: {aiCompare.data.watch_list.join(', ')}
                      </span>
                      <span className="text-sm italic" style={{ color: colors.inkMuted }}>
                        {aiCompare.data.recommendation}
                      </span>
                    </div>
                  ) : null}
                </div>
              </Card>
            </PlanGate>
          ) : (
            <Card>
              <p className="italic" style={{ color: colors.inkMuted }}>
                Select at least 2 athletes to compare.
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
