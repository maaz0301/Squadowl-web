'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, Chip, ErrorState, Input, LoadingState, SectionLabel, Switch, useAlert } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { CoachOnlyState } from '@/components/assessment/CoachOnlyState';
import { useTryoutQuery, useShareLinkMutation, usePlatformBlockedFeaturesQuery, useTeamsQuery } from '@/features/queries';
import {
  DEFAULT_REPORT_CONTENT,
  PLAYERS_PER_PAGE_OPTIONS,
  reportLogoUrls,
  type PlayersPerPage,
  type ReportContent,
  type ReportLayout,
} from '@/lib/reportPdf';
import {
  buildPlayerFullResults,
  isReportFilterActive,
  reportFilterChoices,
  reportSortOptions,
  type ReportFilter,
  type ReportSort,
} from '@/data/resultsExport';
import { useAssessmentId } from '@/features/useAssessmentId';
import { canUseFeature, getPlanDefinition } from '@/data/plans';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { useTerms } from '@/lib/terms';
import { useUser } from '@/state/authStore';
import type { ExportFormat } from '@/data/types';

export default function ExportPage() {
  const id = useAssessmentId();
  const router = useRouter();
  const colors = useThemeColors();
  const { alert, toast } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  // A team someone else owns is run on that team's plan, not the viewer's own.
  const effectiveTier = useEffectivePlanTier(tryoutQuery.data?.teamId);
  const terms = useTerms(tryoutQuery.data?.settings.customLabels, tryoutQuery.data?.sport);
  const shareMut = useShareLinkMutation(id!);
  const { data: platformBlockedFeatures } = usePlatformBlockedFeaturesQuery();
  const billingBlocked = (platformBlockedFeatures ?? []).includes('billing');
  const [isExporting, setIsExporting] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [playersPerPage, setPlayersPerPage] = useState<PlayersPerPage>(1);
  const [continuous, setContinuous] = useState(false);
  const [sortBy, setSortBy] = useState<ReportSort>('jersey');
  const [printLogo, setPrintLogo] = useState(true);
  const [printAppLogo, setPrintAppLogo] = useState(true);
  const [layout, setLayout] = useState<ReportLayout>('cards');
  const [content, setContent] = useState<ReportContent>(DEFAULT_REPORT_CONTENT);
  const [topX, setTopX] = useState('');
  const [minScore, setMinScore] = useState('');
  const [scoredOnly, setScoredOnly] = useState(false);
  const [positions, setPositions] = useState<string[]>([]);
  const [birthYears, setBirthYears] = useState<string[]>([]);
  // The team's own logo, for club accounts. Looked up here (before the loading
  // guards below, since it is a hook) from the team this evaluation belongs to.
  const teamsQuery = useTeamsQuery();
  const teamLogoUrl = teamsQuery.data?.find((t) => t.id === tryoutQuery.data?.teamId)?.logoUrl;
  const organizationLogoUrl = useUser()?.organizationLogoUrl;

  if (tryoutQuery.isLoading || !id) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load export." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  if (!tryout.viewerIsOwner) return <CoachOnlyState what="export this evaluation" labels={tryout.settings.customLabels} />;
  const tier = effectiveTier;
  const exportsAllowed = canUseFeature(tier, 'exports') || tier !== 'free';
  const allowedFormats = getPlanDefinition(tier).limits.exports;
  // Logos on the printed report are a Club-plan touch.
  const clubMode = tier === 'club';

  const choices = reportFilterChoices(tryout);
  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  const setContentFlag = (key: keyof ReportContent) => (on: boolean) => setContent((c) => ({ ...c, [key]: on }));

  /** Only the filters the coach actually set; blank or invalid numbers are ignored. */
  const buildFilter = (): ReportFilter => {
    const top = parseInt(topX, 10);
    const min = parseFloat(minScore);
    return {
      topX: Number.isFinite(top) && top > 0 ? top : undefined,
      minScore: Number.isFinite(min) ? min : undefined,
      scoredOnly: scoredOnly || undefined,
      positions: positions.length ? positions : undefined,
      birthYears: birthYears.length ? birthYears : undefined,
    };
  };
  const filter = buildFilter();
  const filterActive = isReportFilterActive(filter);
  const matchCount = buildPlayerFullResults(tryout, sortBy, filter).length;

  const handleExport = async (format: ExportFormat) => {
    if (matchCount === 0) {
      await alert('No players match', 'Loosen the filters so at least one player is included.');
      return;
    }
    setIsExporting(format);
    try {
      const { exportTryoutData } = await import('@/lib/exportData');
      await exportTryoutData(
        tryout,
        format,
        format === 'pdf'
          ? {
              playersPerPage,
              continuous: continuous && playersPerPage === 1 && layout === 'cards',
              logoUrls: reportLogoUrls({
                club: clubMode,
                organizationLogoUrl: printLogo ? organizationLogoUrl : undefined,
                teamLogoUrl: printLogo ? teamLogoUrl : undefined,
                appLogo: printAppLogo,
              }),
              sortBy,
              filter,
              content,
              layout,
            }
          : { sortBy, filter },
      );
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
          {allowedFormats.includes('pdf') ? (
            <Card className="flex flex-col gap-3">
              <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                PDF layout
              </span>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Players per page
                </span>
                <div className="mt-2 flex flex-wrap">
                  {PLAYERS_PER_PAGE_OPTIONS.map((n) => (
                    <Chip
                      key={n}
                      label={n === 1 ? '1 (full detail)' : String(n)}
                      active={layout === 'cards' && playersPerPage === n && !(n === 1 && continuous)}
                      onClick={() => {
                        setLayout('cards');
                        setPlayersPerPage(n);
                        setContinuous(false);
                      }}
                    />
                  ))}
                  <Chip
                    label="Continuous (no gaps)"
                    active={layout === 'cards' && continuous}
                    onClick={() => {
                      setLayout('cards');
                      setPlayersPerPage(1);
                      setContinuous(true);
                    }}
                  />
                  <Chip
                    label="Compact list"
                    active={layout === 'list'}
                    onClick={() => {
                      setLayout('list');
                      setContinuous(false);
                    }}
                  />
                </div>
                <span className="text-xs" style={{ color: colors.inkMuted }}>
                  {layout === 'list'
                    ? 'A ranked list of names and scores only, with no comments, so a whole roster fits a page or two.'
                    : continuous
                    ? 'Players run one after another with no blank space, each with every evaluation listed.'
                    : playersPerPage === 1
                    ? 'One player per page, with every evaluation listed.'
                    : 'Several players per page: scores, ranks and notes. Individual evaluations are left out to keep each card small.'}
                </span>
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Order players by
                </span>
                <div className="mt-2 flex flex-wrap">
                  {reportSortOptions(tryout).map((o) => (
                    <Chip key={o.key} label={o.label} active={sortBy === o.key} onClick={() => setSortBy(o.key)} />
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Include players
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Top players only"
                    placeholder="All players"
                    inputMode="numeric"
                    value={topX}
                    onChange={(e) => setTopX(e.target.value.replace(/[^0-9]/g, ''))}
                  />
                  <Input
                    label="Overall score at least"
                    placeholder="Any score"
                    inputMode="decimal"
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value.replace(/[^0-9.]/g, ''))}
                  />
                </div>
                <Switch checked={scoredOnly} onChange={setScoredOnly} label="Scored players only (leave out incomplete)" />
                {choices.positions.length > 0 ? (
                  <div>
                    <span className="text-xs" style={{ color: colors.inkMuted }}>
                      Position
                    </span>
                    <div className="mt-1 flex flex-wrap">
                      {choices.positions.map((pos) => (
                        <Chip
                          key={pos}
                          label={pos}
                          active={positions.includes(pos)}
                          onClick={() => setPositions((l) => toggleIn(l, pos))}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {choices.birthYears.length > 0 ? (
                  <div>
                    <span className="text-xs" style={{ color: colors.inkMuted }}>
                      Age group (birth year)
                    </span>
                    <div className="mt-1 flex flex-wrap">
                      {choices.birthYears.map((y) => (
                        <Chip
                          key={y}
                          label={y}
                          active={birthYears.includes(y)}
                          onClick={() => setBirthYears((l) => toggleIn(l, y))}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                <span className="text-xs" style={{ color: filterActive && matchCount === 0 ? colors.danger : colors.inkMuted }}>
                  {filterActive
                    ? `${matchCount} of ${tryout.roster.length} players will be included.`
                    : 'Everyone is included. Pick any of the above to narrow it down.'}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Show on the report
                </span>
                <Switch checked={content.rubricScores} onChange={setContentFlag('rubricScores')} label="Individual rubric scores" />
                <Switch checked={content.position} onChange={setContentFlag('position')} label="Position / level" />
                <Switch checked={content.ranking} onChange={setContentFlag('ranking')} label="Overall ranking" />
                <Switch
                  checked={content.comments}
                  onChange={setContentFlag('comments')}
                  label="Comments (recommendation, strengths, areas to improve)"
                  disabled={layout === 'list'}
                />
                <Switch
                  checked={content.assessor}
                  onChange={setContentFlag('assessor')}
                  label="Assessor name"
                  disabled={layout !== 'cards' || playersPerPage !== 1}
                />
                <Switch
                  checked={content.date}
                  onChange={setContentFlag('date')}
                  label="Date of evaluation"
                  disabled={layout !== 'cards' || playersPerPage !== 1}
                />
                {layout !== 'cards' || playersPerPage !== 1 ? (
                  <span className="text-xs" style={{ color: colors.inkMuted }}>
                    Assessor and date appear with each evaluation, which only the one-player-per-page layout lists.
                  </span>
                ) : null}
              </div>
              {(clubMode && organizationLogoUrl) || teamLogoUrl ? (
                <label className="flex items-center gap-2 text-sm" style={{ color: colors.ink }}>
                  <input
                    type="checkbox"
                    checked={printLogo}
                    onChange={(e) => setPrintLogo(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Print the team logo at the top of every page
                </label>
              ) : null}
              {(clubMode && organizationLogoUrl) || teamLogoUrl ? (
                <label className="flex items-center gap-2 text-sm" style={{ color: colors.ink }}>
                  <input
                    type="checkbox"
                    checked={printAppLogo}
                    onChange={(e) => setPrintAppLogo(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Also print the SquadOwl logo
                </label>
              ) : null}
            </Card>
          ) : null}
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
