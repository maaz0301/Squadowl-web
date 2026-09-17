'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader, Select, Spinner } from '@/components/ui';
import { FounderNotAvailable } from '@/components/founder/FounderUi';
import { EMAIL_STATUS_BADGE, formatDate } from '@/components/founder/labels';
import type { EmailActivityFilter, EmailActivityMessage, EmailActivityStatus } from '@/data/founder/types';
import { useEmailActivityEventsQuery, useEmailActivityQuery, useIsFounderQuery } from '@/features/founderQueries';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'not_delivered', label: 'Not delivered' },
  { value: 'processed', label: 'Processing' },
];

const DAY_OPTIONS = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

export default function FounderEmailLogPage() {
  const founderQuery = useIsFounderQuery();
  if (founderQuery.isLoading) return <LoadingState message="Loading..." />;
  if (founderQuery.data !== true) return <FounderNotAvailable />;
  return <EmailLog />;
}

function EmailLog() {
  const colors = useThemeColors();
  const [toEmail, setToEmail] = useState('');
  const [status, setStatus] = useState('');
  const [days, setDays] = useState('7');
  // SendGrid rate-limits this API, so it's asked only when "Search" is pressed.
  const [filter, setFilter] = useState<EmailActivityFilter>({ days: 7 });
  const [emailError, setEmailError] = useState<string>();
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = useEmailActivityQuery(filter);
  const messages = query.data ?? [];

  const search = () => {
    const email = toEmail.trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) {
      setEmailError('Enter a valid email');
      return;
    }
    setEmailError(undefined);
    setExpanded(null);
    setFilter({
      toEmail: email || undefined,
      status: (status || undefined) as EmailActivityStatus | undefined,
      days: Number(days),
    });
  };

  return (
    <>
      <PageHeader title="Email Log" subtitle="Every email SendGrid sent for TryoutHQ, and whether it arrived" />
      <Card className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <Input
          label="Recipient"
          type="email"
          autoComplete="off"
          value={toEmail}
          onChange={(e) => setToEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          error={emailError}
          placeholder="Any recipient"
        />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} />
        <Select label="Period" value={days} onChange={(e) => setDays(e.target.value)} options={DAY_OPTIONS} />
        <Button label="Search" loading={query.isFetching} onClick={search} />
      </Card>

      {query.isLoading ? (
        <LoadingState message="Asking SendGrid..." />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Could not load the email log.'}
          onRetry={() => query.refetch()}
        />
      ) : messages.length === 0 ? (
        <EmptyState title="No emails found" message="Nothing matches in this period." />
      ) : (
        <>
          <p className="mb-2 text-xs" style={{ color: colors.inkMuted }}>
            {messages.length} email{messages.length === 1 ? '' : 's'}
            {messages.length >= 200 ? ' (latest 200 — narrow the search to see more)' : ''}
          </p>
          <div className="flex flex-col gap-2">
            {messages.map((m) => (
              <EmailRow
                key={m.msgId}
                message={m}
                expanded={expanded === m.msgId}
                onToggle={() => setExpanded((cur) => (cur === m.msgId ? null : m.msgId))}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function EmailRow({
  message: m,
  expanded,
  onToggle,
}: {
  message: EmailActivityMessage;
  expanded: boolean;
  onToggle: () => void;
}) {
  const colors = useThemeColors();
  const badge = EMAIL_STATUS_BADGE[m.status] ?? { label: m.status, variant: 'info' as const };

  return (
    <Card className="flex flex-col gap-2">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex flex-col gap-1 text-left">
        <div className="flex w-full flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 font-semibold break-words" style={{ color: colors.ink }}>
            {m.subject || '(no subject)'}
          </p>
          <Badge label={badge.label} variant={badge.variant} />
        </div>
        <p className="text-sm break-all" style={{ color: colors.inkMuted }}>
          To {m.toEmail} · from {m.fromEmail}
        </p>
        <p className="text-xs" style={{ color: colors.inkFaint }}>
          {Number.isFinite(m.lastEventTime) ? formatDate(m.lastEventTime, true) : ''} · {m.opensCount} open
          {m.opensCount === 1 ? '' : 's'} · {m.clicksCount} click{m.clicksCount === 1 ? '' : 's'} ·{' '}
          {expanded ? 'hide details' : 'details'}
        </p>
      </button>
      {expanded ? <EmailEvents msgId={m.msgId} /> : null}
    </Card>
  );
}

function EmailEvents({ msgId }: { msgId: string }) {
  const colors = useThemeColors();
  const query = useEmailActivityEventsQuery(msgId);

  if (query.isLoading) return <Spinner />;
  if (query.isError) {
    return (
      <p className="text-sm break-words" style={{ color: colors.danger }}>
        {query.error instanceof Error ? query.error.message : 'Could not load events.'}
      </p>
    );
  }
  const events = query.data ?? [];
  if (!events.length) return <p className="text-sm">No events recorded.</p>;

  return (
    <ol className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: colors.border }}>
      {events.map((e, i) => (
        <li key={`${e.name}-${i}`} className="text-sm break-words" style={{ color: colors.inkMuted }}>
          <strong style={{ color: colors.ink }}>{e.name}</strong>
          {Number.isFinite(e.time) ? ` · ${formatDate(e.time, true)}` : ''}
          {e.reason ? ` — ${e.reason}` : ''}
        </li>
      ))}
    </ol>
  );
}
