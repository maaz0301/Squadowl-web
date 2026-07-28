'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, ErrorState, Input, LoadingState, SectionLabel, useAlert } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useTryoutQuery, useExportTryoutMutation, useShareLinkMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { canUseFeature } from '@/data/plans';
import { useUser } from '@/state/authStore';
import type { ExportFormat } from '@/data/types';

export default function ExportPage() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const { alert, toast } = useAlert();
  const user = useUser();
  const tryoutQuery = useTryoutQuery(id);
  const shareMut = useShareLinkMutation(id!);
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  if (tryoutQuery.isLoading || !id) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load export." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  const tier = user?.planTier ?? 'free';
  const exportsAllowed = canUseFeature(tier, 'exports') || tier !== 'free';

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(format);
    try {
      const { exportTryoutData } = await import('@/lib/exportData');
      await exportTryoutData(tryout, format);
      toast(`${format.toUpperCase()} downloaded`, 'success');
    } catch (e) {
      await alert('Export failed', e instanceof Error ? e.message : 'Could not build the export file.');
    } finally {
      setIsExporting(null);
    }
  };

  const handleShare = async () => {
    const link = await shareMut.mutateAsync(tryout.name);
    const url = `https://tryouthq.app/?share=${link.token}`;
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      toast('Share link copied to clipboard', 'success');
    } catch {
      // Clipboard can be blocked; the link is shown below either way.
    }
  };

  return (
    <div className="max-w-3xl">
      <Card className="mb-5 flex flex-col gap-1">
        <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          {tryout.name}
        </span>
        <span style={{ color: colors.inkMuted }}>
          {tryout.roster.length} players · {tryout.evals.length} evaluations
        </span>
      </Card>

      {exportsAllowed ? (
        <div className="mb-6 flex flex-col gap-3">
          <SectionLabel>Export Formats</SectionLabel>
          <div className="flex flex-wrap gap-3">
            <Button
              label="Export CSV"
              variant="secondary"
              onClick={() => handleExport('csv')}
              loading={isExporting === 'csv'}
            />
            <PlanGate feature="exports">
              <Button
                label="Export PDF"
                variant="secondary"
                onClick={() => handleExport('pdf')}
                loading={isExporting === 'pdf'}
              />
              <Button
                label="Export XLSX"
                variant="secondary"
                onClick={() => handleExport('xlsx')}
                loading={isExporting === 'xlsx'}
              />
            </PlanGate>
          </div>
        </div>
      ) : (
        <PlanGate feature="exports" title="Exports require Coach plan+" />
      )}

      <PlanGate feature="shareLinks" title="Share Links (Club+)">
        <Card accent className="flex flex-col gap-3">
          <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Shareable Results Link
          </span>
          <span className="text-sm" style={{ color: colors.inkMuted }}>
            Create a 7-day read-only link for team assignments or results.
          </span>
          <div className="flex flex-wrap items-end gap-3">
            <Button label="Create Share Link" onClick={handleShare} loading={shareMut.isPending} />
            {shareUrl ? (
              <Input
                containerClassName="flex-1 min-w-[260px]"
                label="Link"
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
            ) : null}
          </div>
        </Card>
      </PlanGate>
    </div>
  );
}
