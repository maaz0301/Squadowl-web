'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, EmptyState, ErrorState, Input, LoadingState, PageHeader, Tabs } from '@/components/ui';
import { FounderLinkCard, FounderNotAvailable } from '@/components/founder/FounderUi';
import { NewSupportTicketModal } from '@/components/founder/SupportModals';
import { formatDate } from '@/components/founder/labels';
import type { SupportTicketStatus } from '@/data/founder/types';
import { useIsFounderQuery, useSupportTicketsQuery } from '@/features/founderQueries';
import { useDebouncedValue } from '@/lib/hooks';

const STATUS_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];

export default function FounderSupportPage() {
  const founderQuery = useIsFounderQuery();
  if (founderQuery.isLoading) return <LoadingState message="Loading..." />;
  if (founderQuery.data !== true) return <FounderNotAvailable />;
  return <SupportInbox />;
}

function SupportInbox() {
  const colors = useThemeColors();
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const query = useSupportTicketsQuery({
    status: status === 'all' ? undefined : (status as SupportTicketStatus),
    search: debouncedSearch || undefined,
  });
  const tickets = query.data ?? [];

  return (
    <>
      <PageHeader
        title="Support Inbox"
        subtitle="Conversations with support@tryouthq.ca"
        right={<Button label="+ New Ticket" size="sm" onClick={() => setCreating(true)} />}
      />
      <Input
        containerClassName="mb-4 w-full md:max-w-sm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email or subject..."
      />
      <Tabs tabs={STATUS_TABS} activeKey={status} onChange={setStatus} className="mb-4" />

      {query.isLoading ? (
        <LoadingState message="Loading tickets..." />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Could not load tickets.'}
          onRetry={() => query.refetch()}
        />
      ) : tickets.length === 0 ? (
        <EmptyState
          title={debouncedSearch ? 'No matches' : status === 'open' ? 'Inbox zero' : 'No tickets'}
          message={debouncedSearch ? 'Try a different search.' : 'Log an email that came in, or start one with “New Ticket”.'}
        />
      ) : (
        <div className="flex flex-col gap-2" style={{ opacity: query.isPlaceholderData ? 0.6 : 1 }}>
          {tickets.map((t) => (
            <FounderLinkCard key={t.id} href={`/founder/support/${t.id}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold break-words" style={{ color: colors.ink }}>
                  {t.subject}
                </p>
                <p className="text-sm break-all" style={{ color: colors.inkMuted }}>
                  {t.email}
                </p>
                <p className="text-xs" style={{ color: colors.inkFaint }}>
                  {t.messageCount} message{t.messageCount === 1 ? '' : 's'} · updated {formatDate(t.updatedAt, true)}
                </p>
              </div>
              <Badge
                label={t.status === 'open' ? 'Open' : 'Resolved'}
                variant={t.status === 'open' ? 'warning' : 'success'}
              />
            </FounderLinkCard>
          ))}
        </div>
      )}

      <NewSupportTicketModal visible={creating} onClose={() => setCreating(false)} />
    </>
  );
}
