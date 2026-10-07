'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, PageHeader, Spinner, Textarea, useAlert } from '@/components/ui';
import { useIsFeedbackReviewerQuery, useSubmitFeedbackMutation } from '@/features/queries';
import { getDataSource } from '@/data';
import type { FeedbackAttachment } from '@/data/extras';

/** Mirrors the `feedback-attachments` bucket's own limits — see the migration. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/heic,application/pdf';
/** Enough for a bug report; keeps one submission from filling the bucket. */
const MAX_ATTACHMENTS = 6;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What each score means, shown next to the row so a 3 isn't left to interpretation. */
const RATING_WORDS = ['', 'Poor', 'Fair', 'Okay', 'Good', 'Excellent'] as const;

function RatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const colors = useThemeColors();
  // The chosen score is coloured by what it says, so a page of ratings can be
  // read down the right-hand edge without parsing the numbers.
  const tone = value <= 2 ? colors.danger : value === 3 ? colors.warning : colors.success;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-bold" style={{ color: colors.ink }}>
          {label}
        </label>
        <span className="text-xs font-bold" style={{ color: tone }}>
          {RATING_WORDS[value]}
        </span>
      </div>
      <div
        className="flex overflow-hidden rounded-xl border"
        style={{ borderColor: colors.border, backgroundColor: colors.tile }}
        role="radiogroup"
        aria-label={label}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${label}: ${n} out of 5 — ${RATING_WORDS[n]}`}
              onClick={() => onChange(n)}
              className="min-h-[44px] flex-1 text-sm font-bold tabular-nums transition-colors"
              style={{
                backgroundColor: active ? tone : 'transparent',
                color: active ? '#fff' : colors.inkMuted,
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function FeedbackPage() {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const submit = useSubmitFeedbackMutation();

  const [overallExperience, setOverallExperience] = useState(4);
  const [easeOfUse, setEaseOfUse] = useState(4);
  const [teamHubScheduling, setTeamHubScheduling] = useState(4);
  const [valueForMoney, setValueForMoney] = useState(4);
  const [whatIsWorkingWell, setWhatIsWorkingWell] = useState('');
  const [whatCanBeImproved, setWhatCanBeImproved] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Attachments are uploaded as they're picked rather than on submit, so the
  // coach can see what's attached — and take one off again — before sending.
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<FeedbackAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Thumbnails come from the picked File, not from the bucket: the bucket is
  // private, so showing the stored object back would mean minting a signed URL
  // per file straight after uploading it. Keyed by storage path so a removal
  // can revoke exactly the one it owns.
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const reviewerQuery = useIsFeedbackReviewerQuery();

  // Blob URLs outlive the component unless they're released, so the last set is
  // kept in a ref and revoked on unmount. A ref rather than a dependency: the
  // effect must run its cleanup exactly once, at the end, not on every upload.
  const previewsRef = useRef(previews);
  useEffect(() => {
    previewsRef.current = previews;
  });
  useEffect(
    () => () => {
      for (const url of Object.values(previewsRef.current)) URL.revokeObjectURL(url);
    },
    [],
  );

  const onFilesPicked = async (fileList: FileList | null) => {
    const picked = Array.from(fileList ?? []);
    // Clear the input straight away so re-picking the same file still fires a
    // change event after a failed or removed upload.
    if (fileRef.current) fileRef.current.value = '';
    if (picked.length === 0) return;

    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      await alert('Too many files', `You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    const files = picked.slice(0, room);
    const oversized = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (oversized.length > 0) {
      await alert(
        'File too large',
        `${oversized.map((f) => f.name).join(', ')} — attachments are limited to ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
      );
    }

    const toUpload = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    if (toUpload.length === 0) return;

    setUploading(true);
    const ds = getDataSource();
    const failed: string[] = [];
    for (const file of toUpload) {
      try {
        const uploaded = await ds.uploadFeedbackAttachment(file);
        setAttachments((cur) => [...cur, uploaded]);
        if (file.type.startsWith('image/')) {
          const url = URL.createObjectURL(file);
          setPreviews((cur) => ({ ...cur, [uploaded.path]: url }));
        }
      } catch (e) {
        // One bad file shouldn't discard the ones that did upload, so the
        // failures are collected and reported together at the end.
        failed.push(`${file.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      }
    }
    setUploading(false);
    if (failed.length > 0) await alert('Some files were not attached', failed.join('\n'));
    if (picked.length > room) {
      await alert('Some files were skipped', `You can attach up to ${MAX_ATTACHMENTS} files.`);
    }
  };

  const removeAttachment = async (attachment: FeedbackAttachment) => {
    setAttachments((cur) => cur.filter((a) => a.path !== attachment.path));
    setPreviews((cur) => {
      const url = cur[attachment.path];
      if (!url) return cur;
      URL.revokeObjectURL(url);
      const next = { ...cur };
      delete next[attachment.path];
      return next;
    });
    try {
      await getDataSource().deleteFeedbackAttachment(attachment.path);
    } catch {
      // The file is already off the form; a leftover object in the bucket is
      // not worth putting an error in front of the coach for.
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await submit.mutateAsync({
        overallExperience,
        easeOfUse,
        teamHubScheduling,
        valueForMoney,
        whatIsWorkingWell,
        whatCanBeImproved,
        attachments,
      });
      setSubmitted(true);
    } catch (err) {
      await alert('Error', err instanceof Error ? err.message : 'Could not submit feedback.');
    }
  };

  if (submitted) {
    return (
      <>
        <PageHeader title="Feedback" />
        <Card accent className="mt-4 flex flex-col items-center gap-4 py-12 text-center">
          <h2 className="text-2xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Thank you!
          </h2>
          <p className="max-w-md text-sm" style={{ color: colors.inkMuted }}>
            Your feedback helps us improve the coach and evaluator experience.
          </p>
          <Link href="/profile">
            <Button label="Back to Profile" />
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Team Feedback Survey"
        subtitle="Help us improve the platform"
      />

      <Card className="mt-4 max-w-2xl">
        <p className="mb-4 text-sm" style={{ color: colors.inkMuted }}>
          Rate your experience with evaluations, scoring, and Team Hub.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <RatingRow label="Overall experience" value={overallExperience} onChange={setOverallExperience} />
          <RatingRow label="Ease of use" value={easeOfUse} onChange={setEaseOfUse} />
          <RatingRow label="Team Hub & scheduling" value={teamHubScheduling} onChange={setTeamHubScheduling} />
          <RatingRow label="Value for money" value={valueForMoney} onChange={setValueForMoney} />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-bold" style={{ color: colors.ink }}>
              What&apos;s working well?
            </label>
            <Textarea
              rows={3}
              value={whatIsWorkingWell}
              onChange={(e) => setWhatIsWorkingWell(e.target.value)}
              placeholder="Tell us what features you love..."
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-bold" style={{ color: colors.ink }}>
              What can be improved?
            </label>
            <Textarea
              rows={3}
              value={whatCanBeImproved}
              onChange={(e) => setWhatCanBeImproved(e.target.value)}
              placeholder="Tell us what features or changes you would like to see..."
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold" style={{ color: colors.ink }}>
              Attachments
            </label>
            <p className="text-xs" style={{ color: colors.inkMuted }}>
              Screenshots help us reproduce a problem. PNG, JPG, GIF, WebP, HEIC or PDF, up to{' '}
              {formatBytes(MAX_ATTACHMENT_BYTES)} each.
            </p>

            {attachments.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                {attachments.map((a) => {
                  const preview = previews[a.path];
                  return (
                    <div
                      key={a.path}
                      className="group relative overflow-hidden rounded-xl border"
                      style={{ backgroundColor: colors.tile, borderColor: colors.border }}
                    >
                      <div className="flex h-24 items-center justify-center overflow-hidden">
                        {preview ? (
                          // Plain <img>: the source is a blob: URL for a file the
                          // user just picked, which next/image can't optimise and
                          // has no dimensions to reserve space for.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={preview} alt={a.name} className="h-full w-full object-cover" />
                        ) : (
                          <span aria-hidden className="text-3xl">
                            📄
                          </span>
                        )}
                      </div>
                      <div className="px-2 py-1.5">
                        <p className="truncate text-[11px] font-medium" style={{ color: colors.ink }}>
                          {a.name}
                        </p>
                        <p className="text-[10px]" style={{ color: colors.inkMuted }}>
                          {formatBytes(a.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(a)}
                        aria-label={`Remove ${a.name}`}
                        title="Remove"
                        className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_TYPES}
              multiple
              className="hidden"
              onChange={(e) => onFilesPicked(e.target.files)}
            />

            {attachments.length < MAX_ATTACHMENTS ? (
              // A drop target as well as a button: a screenshot is usually
              // already on the desktop or clipboard when someone writes a bug
              // report, and dragging it here is fewer steps than a file dialog.
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void onFilesPicked(e.dataTransfer.files);
                }}
                className="flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-5 text-center transition-colors"
                style={{
                  borderColor: dragging ? colors.primary : colors.border,
                  backgroundColor: dragging ? 'rgba(255,107,43,0.08)' : 'transparent',
                }}
              >
                {uploading ? (
                  <>
                    <Spinner size={22} />
                    <span className="text-sm font-bold" style={{ color: colors.ink }}>
                      Uploading...
                    </span>
                  </>
                ) : (
                  <>
                    <span aria-hidden className="text-2xl">
                      📎
                    </span>
                    <span className="text-sm font-bold" style={{ color: colors.ink }}>
                      Drop screenshots here, or click to browse
                    </span>
                    <span className="text-[11px]" style={{ color: colors.inkFaint }}>
                      {MAX_ATTACHMENTS - attachments.length} of {MAX_ATTACHMENTS} remaining
                    </span>
                  </>
                )}
              </button>
            ) : (
              <p className="text-[11px]" style={{ color: colors.inkFaint }}>
                Maximum of {MAX_ATTACHMENTS} files attached.
              </p>
            )}
          </div>

          <div className="pt-2">
            <Button type="submit" label="Submit Feedback" loading={submit.isPending} disabled={uploading} />
          </div>
        </form>
      </Card>

      {reviewerQuery.data ? (
        <Card className="mt-4 flex max-w-2xl flex-wrap items-center justify-between gap-3">
          <span className="text-sm" style={{ color: colors.inkMuted }}>
            You have access to the feedback portal.
          </span>
          <Link href="/feedback/reports">
            <Button label="Open Feedback Portal" variant="secondary" size="sm" />
          </Link>
        </Card>
      ) : null}
    </>
  );
}
