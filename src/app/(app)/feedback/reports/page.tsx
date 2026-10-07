'use client';

import { useMemo, useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  useAlert,
} from '@/components/ui';
import {
  useDeleteFeedbackSubmissionMutation,
  useFeedbackSubmissionsQuery,
  useIsFeedbackReviewerQuery,
} from '@/features/queries';
import { getDataSource } from '@/data';
import type { FeedbackAttachment, FeedbackReport } from '@/data/extras';

const RATINGS: [keyof Pick<
  FeedbackReport,
  'overallExperience' | 'easeOfUse' | 'teamHubScheduling' | 'valueForMoney'
>, string][] = [
  ['overallExperience', 'Overall'],
  ['easeOfUse', 'Ease of use'],
  ['teamHubScheduling', 'Team Hub'],
  ['valueForMoney', 'Value'],
];

/** Red below 3, amber at 3, green above — the same reading as the score heat elsewhere. */
function ratingVariant(score: number): 'danger' | 'warning' | 'success' {
  if (score <= 2) return 'danger';
  if (score === 3) return 'warning';
  return 'success';
}

/** The same three bands as hex, for the rails and bars that badges can't express. */
const TONE_HEX = { danger: '#f87171', warning: '#fb923c', success: '#22c55e' } as const;

function toneHex(score: number): string {
  return TONE_HEX[ratingVariant(score)];
}

/** "Jane Smith" → ["Jane", "Smith"]; an email or a single word still yields something to draw. */
function nameParts(report: FeedbackReport): [string, string] {
  const source = report.displayName || report.email || '?';
  const [first = '?', last = ''] = source.split(/[\s@.]+/).filter(Boolean);
  return [first, last];
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function averageOf(report: FeedbackReport): number {
  return (
    (report.overallExperience + report.easeOfUse + report.teamHubScheduling + report.valueForMoney) / 4
  );
}

/** One headline number in the summary strip above the list. */
function StatTile({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: string;
  color: string;
  hint?: string;
}) {
  const colors = useThemeColors();
  return (
    <Card padded={false} className="px-3 py-2.5" title={hint}>
      <p
        className="text-2xl font-bold tabular-nums leading-tight"
        style={{ color, fontFamily: 'var(--font-space-grotesk)' }}
      >
        {value}
      </p>
      <p className="text-[11px] uppercase tracking-wide" style={{ color: colors.inkMuted }}>
        {label}
      </p>
    </Card>
  );
}

/**
 * Every feedback submission, for the handful of people on the
 * `feedback_reviewers` allowlist.
 *
 * The gate is drawn twice on purpose. The database is the real one — the select
 * policy on `feedback_submissions` returns a non-reviewer only their own rows,
 * so there is nothing to leak even if this page rendered for them — and the
 * check below is what keeps a coach who guesses the URL from seeing a screen
 * that looks like it was meant for them.
 */
export default function FeedbackReportsPage() {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const reviewerQuery = useIsFeedbackReviewerQuery();
  const isReviewer = reviewerQuery.data === true;
  const submissionsQuery = useFeedbackSubmissionsQuery(isReviewer);
  const deleteSubmission = useDeleteFeedbackSubmissionMutation();

  const [search, setSearch] = useState('');
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const reports = useMemo(() => submissionsQuery.data ?? [], [submissionsQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) =>
      [r.displayName, r.email, r.whatIsWorkingWell, r.whatCanBeImproved]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q)),
    );
  }, [reports, search]);

  const openAttachment = async (attachment: FeedbackAttachment) => {
    setOpeningPath(attachment.path);
    try {
      const url = await getDataSource().getFeedbackAttachmentUrl(attachment.path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      await alert('Could not open', e instanceof Error ? e.message : 'That attachment is unavailable.');
    } finally {
      setOpeningPath(null);
    }
  };

  const removeSubmission = async (report: FeedbackReport) => {
    const [first, last] = nameParts(report);
    const who = report.displayName || report.email || `${first} ${last}`.trim() || 'this submission';
    const ok = await confirm({
      title: 'Remove Submission',
      message: `Are you sure you want to remove ${who}'s feedback? This can't be undone${report.attachments.length > 0 ? ', and its attachments will be deleted too.' : '.'}`,
      confirmLabel: 'Remove',
      destructive: true,
      requireText: 'DELETE',
    });
    if (!ok) return;

    setRemovingId(report.id);
    try {
      await deleteSubmission.mutateAsync({ id: report.id, attachments: report.attachments });
      toast('Submission removed.', 'success');
    } catch (e) {
      await alert('Could Not Remove', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setRemovingId(null);
    }
  };

  if (reviewerQuery.isLoading) return <LoadingState message="Loading..." />;

  if (!isReviewer) {
    return (
      <>
        <PageHeader title="Feedback Portal" />
        <EmptyState
          title="Not available"
          message="This portal is limited to the people who review submitted feedback."
        />
      </>
    );
  }

  const average = reports.length
    ? reports.reduce((sum, r) => sum + averageOf(r), 0) / reports.length
    : null;

  return (
    <>
      <PageHeader
        title="Feedback Portal"
        subtitle={
          reports.length
            ? `${reports.length} submission${reports.length === 1 ? '' : 's'}${average != null ? ` · ${average.toFixed(1)} average` : ''}`
            : undefined
        }
      />

      {submissionsQuery.isLoading ? (
        <LoadingState message="Loading feedback..." />
      ) : submissionsQuery.isError ? (
        <ErrorState message="Could not load feedback." onRetry={() => submissionsQuery.refetch()} />
      ) : reports.length === 0 ? (
        <EmptyState title="No feedback yet" message="Submitted surveys will appear here." />
      ) : (
        <>
          {/* One strip of headline numbers: how much feedback there is, how it
              scores overall, and how many came with a screenshot — which is the
              subset worth opening first when triaging bugs. */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Submissions" value={String(reports.length)} color={colors.ink} />
            <StatTile
              label="Average score"
              value={average != null ? `${average.toFixed(1)}/5` : '—'}
              color={average != null ? toneHex(Math.round(average)) : colors.ink}
            />
            <StatTile
              label="With attachments"
              value={String(reports.filter((r) => r.attachments.length > 0).length)}
              color={colors.info}
            />
            <StatTile
              label="Needs attention"
              hint="Averaging 2.5 or below"
              value={String(reports.filter((r) => averageOf(r) <= 2.5).length)}
              color={colors.danger}
            />
          </div>

          <Input
            className="mb-4 max-w-md"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or comment..."
          />

          {filtered.length === 0 ? (
            <EmptyState title="No matches" message={`Nothing matches "${search}".`} />
          ) : (
            <div className="flex flex-col gap-4">
              {filtered.map((report) => {
                const avg = averageOf(report);
                const [first, last] = nameParts(report);
                return (
                <Card
                  key={report.id}
                  className="relative flex flex-col gap-3 overflow-hidden pl-5"
                  // Rail colour is the submission's own average, so a page of
                  // cards can be triaged by scanning the left edge.
                  style={{ borderLeftWidth: 0 }}
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1.5"
                    style={{ backgroundColor: toneHex(Math.round(avg)) }}
                  />
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar first={first} last={last} size={36} />
                      <div className="min-w-0">
                        <p className="truncate font-bold" style={{ color: colors.ink }}>
                          {report.displayName || report.email || 'Unknown coach'}
                        </p>
                        {report.displayName && report.email ? (
                          <p className="truncate text-xs" style={{ color: colors.inkMuted }}>
                            {report.email}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        <Badge label={`${avg.toFixed(1)}/5 avg`} variant={ratingVariant(Math.round(avg))} />
                        <Button
                          label="Remove"
                          size="sm"
                          variant="danger"
                          loading={removingId === report.id}
                          onClick={() => removeSubmission(report)}
                        />
                      </div>
                      <span className="text-xs" style={{ color: colors.inkFaint }}>
                        {formatDate(report.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Bars rather than four more badges: the point of this row is
                      which of the four scores is the low one, and a length is
                      quicker to compare than a number. */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                    {RATINGS.map(([key, label]) => {
                      const score = report[key];
                      return (
                        <div key={key} className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="truncate text-[11px]" style={{ color: colors.inkMuted }}>
                              {label}
                            </span>
                            <span
                              className="text-[11px] font-bold tabular-nums"
                              style={{ color: toneHex(score) }}
                            >
                              {score}/5
                            </span>
                          </div>
                          <div
                            className="h-1.5 overflow-hidden rounded-full"
                            style={{ backgroundColor: colors.tile }}
                          >
                            <span
                              className="block h-full rounded-full"
                              style={{ width: `${(score / 5) * 100}%`, backgroundColor: toneHex(score) }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {report.whatIsWorkingWell ? (
                    <div>
                      <p className="text-xs font-bold" style={{ color: colors.inkMuted }}>
                        What&apos;s working well
                      </p>
                      <p className="whitespace-pre-wrap text-sm" style={{ color: colors.ink }}>
                        {report.whatIsWorkingWell}
                      </p>
                    </div>
                  ) : null}

                  {report.whatCanBeImproved ? (
                    <div>
                      <p className="text-xs font-bold" style={{ color: colors.inkMuted }}>
                        What can be improved
                      </p>
                      <p className="whitespace-pre-wrap text-sm" style={{ color: colors.ink }}>
                        {report.whatCanBeImproved}
                      </p>
                    </div>
                  ) : null}

                  {report.attachments.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-bold" style={{ color: colors.inkMuted }}>
                        Attachments
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {report.attachments.map((a) => (
                          <Button
                            key={a.path}
                            // The bucket is private, so each click mints its own
                            // short-lived signed URL rather than the card holding
                            // links that would expire while the page sat open.
                            label={`${a.contentType === 'application/pdf' ? '📄' : '🖼️'} ${a.name}`}
                            size="sm"
                            variant="secondary"
                            loading={openingPath === a.path}
                            onClick={() => openAttachment(a)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
