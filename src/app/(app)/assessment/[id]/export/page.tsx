'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, ErrorState, Input, LoadingState, SectionLabel, useAlert } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { CoachOnlyState } from '@/components/assessment/CoachOnlyState';
import { useTryoutQuery, useShareLinkMutation, usePlatformBlockedFeaturesQuery } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { useTerms } from '@/lib/terms';
import type { ExportFormat } from '@/data/types';

export default function ExportPage() {
  const id = useAssessmentId();
  const router = useRouter();
  const colors = useThemeColors();
  const { alert, toast } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  // A team someone else owns is run on that team's plan, not the viewer's own.
  const effectiveTier = useEffectivePlanTier(tryoutQuery.data?.teamId);
  const terms = useTerms(tryoutQuery.data?.settings.customLabels);
  const shareMut = useShareLinkMutation(id!);
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  if (tryoutQuery.isLoading || !id) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load export." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  if (!tryout.viewerIsOwner) return <CoachOnlyState what="export this evaluation" labels={tryout.settings.customLabels} />;
  const tier = effectiveTier;
  const exportsAllowed = canUseFeature(tier, 'exports') || tier !== 'free';
  const allowedFormats = getPlanDefinition(tier).limits.exports;

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
          {tryout.roster.length} {(tryout.roster.length === 1 ? terms.player : terms.players).toLowerCase()} · {tryout.evals.length}{' '}
          {tryout.evals.length === 1 ? 'evaluation' : 'evaluations'}
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
            {allowedFormats.includes('pdf') ? (
              <Button
                label="Export PDF"
                variant="secondary"
                onClick={() => handleExport('pdf')}
                loading={isExporting === 'pdf'}
              />
            ) : null}
            {allowedFormats.includes('xlsx') ? (
              <Button
                label="Export XLSX"
                variant="secondary"
                onClick={() => handleExport('xlsx')}
                loading={isExporting === 'xlsx'}
              />
            ) : null}
          </div>
          {!allowedFormats.includes('pdf') ? (
            <Card accent className="flex flex-col gap-2">
              <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                PDF Export
              </span>
              <span style={{ color: colors.inkMuted }}>Requires the Coach+ plan or higher. You&apos;re on {tier}.</span>
              {!billingBlocked ? <Button label="View Plans" onClick={() => router.push('/upgrade')} /> : null}
            </Card>
          ) : null}
          {!allowedFormats.includes('xlsx') ? (
            <Card accent className="flex flex-col gap-2">
              <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                XLSX Export
              </span>
              <span style={{ color: colors.inkMuted }}>Requires the Club plan or higher. You&apos;re on {tier}.</span>
              {!billingBlocked ? <Button label="View Plans" onClick={() => router.push('/upgrade')} /> : null}
            </Card>
          ) : null}
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
