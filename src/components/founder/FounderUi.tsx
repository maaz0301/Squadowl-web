'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, EmptyState, PageHeader, Switch } from '@/components/ui';
import type { Evaluation } from '@/data/types';
import { useFounderArchiveStore } from '@/state/founderArchiveStore';
import { formatDate } from './labels';

/** Small building blocks shared by the founder console's detail pages. */

export function FounderSection({ title, children }: { title: string; children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-[0.08em]" style={{ color: colors.inkFaint }}>
        {title}
      </h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** Label/value pairs; empty values are left out rather than shown as dashes. */
export function FounderDetails({ rows }: { rows: [string, ReactNode | undefined][] }) {
  const colors = useThemeColors();
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
      {shown.map(([label, value]) => (
        <div key={label} className="flex min-w-0 gap-1.5">
          <dt className="shrink-0" style={{ color: colors.inkFaint }}>
            {label}:
          </dt>
          <dd className="min-w-0 break-words whitespace-pre-line" style={{ color: colors.inkMuted }}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A card that opens another founder page; without an href it is the same card, dimmed and not clickable. */
export function FounderLinkCard({
  href,
  className,
  children,
}: {
  href?: string;
  className?: string;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  const card = (
    <Card className={className ?? 'flex flex-wrap items-center justify-between gap-2'}>
      {children}
      {href ? (
        <span aria-hidden className="shrink-0" style={{ color: colors.inkFaint }}>
          ›
        </span>
      ) : null}
    </Card>
  );
  if (!href) return <div className="opacity-70">{card}</div>;
  return (
    <Link href={href} className="block transition hover:brightness-110">
      {card}
    </Link>
  );
}

/** Scores as the coach screens show them: one decimal, a dash when nothing has been scored. */
export function formatScore(score: number | undefined): string {
  return score && score > 0 ? score.toFixed(1) : '—';
}

/** "stick_handling" → "Stick handling", for score keys no rubric could label. */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Label → score chips, in the order given. */
export function ScoreChips({ scores }: { scores: { label: string; value: number }[] }) {
  const colors = useThemeColors();
  if (!scores.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {scores.map((s) => (
        <span
          key={s.label}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs"
          style={{ borderColor: colors.border, backgroundColor: colors.tile, color: colors.inkMuted }}
        >
          {s.label}
          <strong style={{ color: colors.ink }}>{formatScore(s.value)}</strong>
        </span>
      ))}
    </div>
  );
}

/** The founder-only gate every detail page draws before loading anything. */
export function FounderNotAvailable() {
  return (
    <>
      <PageHeader title="Founder Console" showBack backHref="/dashboard" />
      <EmptyState title="Not available" message="This console is limited to the founder account." />
    </>
  );
}

/** One individual evaluation: who scored it, when, every score, and their notes. */
export function EvaluationEntry({
  evaluation: e,
  skillLabel,
  overall,
  actions,
  badge,
}: {
  evaluation: Evaluation;
  skillLabel: Map<string, string>;
  overall?: number;
  /** Edit / delete buttons, when the page offers them. */
  actions?: ReactNode;
  /** e.g. an "Updated just now" badge. */
  badge?: ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border p-3" style={{ borderColor: colors.border }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold break-words" style={{ color: colors.ink }}>
          {e.evaluator || 'Unknown assessor'}
          <span style={{ color: colors.inkMuted }}> · {e.session}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {badge}
          {e.recommendation ? <Badge label={e.recommendation} variant="info" /> : null}
          {overall !== undefined ? <Badge label={`Overall ${formatScore(overall)}`} variant="brand" /> : null}
          <span className="text-xs" style={{ color: colors.inkFaint }}>
            {formatDate(e.createdAt, true)}
          </span>
        </div>
      </div>
      <ScoreChips
        scores={Object.entries(e.scores).map(([key, value]) => ({
          label: skillLabel.get(key) ?? humanizeKey(key),
          value,
        }))}
      />
      <FounderDetails
        rows={[
          ['Strengths', e.strengths],
          ['To improve', e.improve],
          ['Source', e.source],
        ]}
      />
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Whether archived and soft-deleted rows are shown, shared by every founder page. */
export function useShowArchived(): boolean {
  return useFounderArchiveStore((s) => s.showArchived);
}

/** Visible when a row is either archived or deleted. */
export function isHiddenByDefault(row: { archived?: boolean; deletedAt?: number }): boolean {
  return !!row.archived || !!row.deletedAt;
}

export function FounderArchiveToggle({ hiddenCount }: { hiddenCount?: number }) {
  const colors = useThemeColors();
  const show = useFounderArchiveStore((s) => s.showArchived);
  const setShow = useFounderArchiveStore((s) => s.setShowArchived);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Switch checked={show} onChange={setShow} label="Show archived & deleted" />
      {!show && hiddenCount ? (
        <span className="text-xs" style={{ color: colors.inkFaint }}>
          {hiddenCount} hidden
        </span>
      ) : null}
    </div>
  );
}

/** "Archived" / "Deleted <date>" badges for a row the organization put away. */
export function ArchiveBadges({ archived, deletedAt }: { archived?: boolean; deletedAt?: number }) {
  return (
    <>
      {deletedAt ? <Badge label={`Deleted ${formatDate(deletedAt)}`} variant="danger" /> : null}
      {archived ? <Badge label="Archived" /> : null}
    </>
  );
}
