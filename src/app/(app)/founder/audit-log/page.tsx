'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader, Select } from '@/components/ui';
import { AuditEntryCard } from '@/components/founder/AuditEntry';
import { FounderNotAvailable } from '@/components/founder/FounderUi';
import { AUDIT_CATEGORIES } from '@/components/founder/labels';
import { useFounderAuditPageQuery, useIsFounderQuery } from '@/features/founderQueries';
import { useDebouncedValue } from '@/lib/hooks';

const PAGE_SIZE = 50;

const PERIOD_OPTIONS = [
  { value: '', label: 'All time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const CATEGORY_OPTIONS = AUDIT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }));

export default function FounderAuditLogPage() {
  const founderQuery = useIsFounderQuery();
  if (founderQuery.isLoading) return <LoadingState message="Loading..." />;
  if (founderQuery.data !== true) return <FounderNotAvailable />;
  return <AuditLog />;
}

function AuditLog() {
  const colors = useThemeColors();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [days, setDays] = useState('');
  const [page, setPage] = useState(0);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const query = useFounderAuditPageQuery({
    search: debouncedSearch || undefined,
    actions: AUDIT_CATEGORIES.find((c) => c.value === category)?.actions,
    days: days ? Number(days) : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const entries = query.data?.entries ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Any filter change starts over from the newest entries.
  const onFilter = (apply: () => void) => {
    apply();
    setPage(0);
  };

  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle="Everything done through the founder console — which admin, what, and when"
      />
      <Card className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1.5fr_1fr]">
        <Input
          label="Search"
          value={search}
          onChange={(e) => onFilter(() => setSearch(e.target.value))}
          placeholder="Admin email, organization, user or reason"
        />
        <Select
          label="Type"
          value={category}
          onChange={(e) => onFilter(() => setCategory(e.target.value))}
          options={CATEGORY_OPTIONS}
        />
        <Select
          label="Period"
          value={days}
          onChange={(e) => onFilter(() => setDays(e.target.value))}
          options={PERIOD_OPTIONS}
        />
      </Card>

      {query.isLoading ? (
        <LoadingState message="Loading audit log..." />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Could not load the audit log.'}
          onRetry={() => query.refetch()}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nothing logged"
          message={
            debouncedSearch || category || days
              ? 'No entries match these filters.'
              : 'Actions taken in the founder console appear here.'
          }
        />
      ) : (
        <>
          <p className="mb-2 text-xs" style={{ color: colors.inkMuted }}>
            {total} entr{total === 1 ? 'y' : 'ies'}. Written by the database with each action; they cannot be edited.
          </p>
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <AuditEntryCard key={entry.id} entry={entry} />
            ))}
          </div>
          {pageCount > 1 ? (
            <div className="mt-4 flex items-center justify-between gap-3">
              <Button
                label="Previous"
                size="sm"
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              />
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                Page {page + 1} of {pageCount}
              </span>
              <Button
                label="Next"
                size="sm"
                variant="secondary"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              />
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
