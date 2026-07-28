'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { useImportScanScoresMutation, useTryoutQuery } from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { getPlayerSubskills, playerDisplayName } from '@/data/rubrics';

export default function ScanSheetPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const router = useRouter();
  const tryoutQuery = useTryoutQuery(id);
  const importScores = useImportScanScoresMutation();
  const [imported, setImported] = useState(false);

  const preview = useMemo(() => {
    if (!tryoutQuery.data) return [];
    return tryoutQuery.data.roster.slice(0, 5).map((p) => {
      const subskills = getPlayerSubskills(
        tryoutQuery.data!.sport,
        p.pos,
        tryoutQuery.data!.settings.customRubrics,
      );
      const scores = subskills.slice(0, 3).map((r) => ({
        rubricKey: r.key,
        value: 3 + Math.floor(Math.random() * 2),
      }));
      return { player: p, scores };
    });
  }, [tryoutQuery.data]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading scan sheet..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <>
        <PageHeader title="Scan Sheet" showBack backHref={href('roster')} />
        <ErrorState message="Could not load scan sheet." onRetry={() => tryoutQuery.refetch()} />
      </>
    );
  }

  const tryout = tryoutQuery.data;

  const simulateImport = async () => {
    const scores = preview.flatMap((item) =>
      item.scores.map((sc) => ({ playerId: item.player.id, rubricKey: sc.rubricKey, value: sc.value })),
    );
    await importScores.mutateAsync({ tryoutId: id!, scores });
    setImported(true);
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Scan Sheet Import" showBack backHref={href('roster')} />

      <Card accent className="mb-5 flex flex-col items-start gap-2">
        <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          Paper score sheet → digital
        </span>
        <span style={{ color: colors.inkMuted }}>
          Camera OCR is not wired yet. This demo simulates importing scanned scores for the first 5 players.
        </span>
        <Badge label={`${tryout.roster.length} players on roster`} />
      </Card>

      <div className="flex flex-col gap-2">
        {preview.map((item) => (
          <Card key={item.player.id} className="flex flex-col gap-1">
            <span className="font-bold" style={{ color: colors.ink }}>
              {playerDisplayName(item.player)}
            </span>
            {item.scores.map((s) => (
              <span key={s.rubricKey} className="text-sm" style={{ color: colors.inkMuted }}>
                {s.rubricKey}: {s.value}
              </span>
            ))}
          </Card>
        ))}
      </div>

      <div className="mt-5">
        {imported ? (
          <Card accent className="flex flex-col items-center gap-3 py-5">
            <span className="font-bold" style={{ color: colors.success, fontFamily: 'var(--font-space-grotesk)' }}>
              Scores imported successfully
            </span>
            <Button label="View Results" onClick={() => router.push(href('results'))} />
          </Card>
        ) : (
          <Button label="Simulate Scan Import" loading={importScores.isPending} onClick={simulateImport} />
        )}
      </div>
    </div>
  );
}
