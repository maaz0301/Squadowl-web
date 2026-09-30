'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Switch,
  Tabs,
  useAlert,
} from '@/components/ui';
import {
  CreateOrganizationModal,
  EditAccessModal,
  SuspendOrganizationModal,
} from '@/components/founder/OrganizationModals';
import { STATUS_BADGE, formatDate, planLabel } from '@/components/founder/labels';
import type { FounderOrganization } from '@/data/founder/types';
import {
  useFounderOrganizationsQuery,
  useIsFounderQuery,
  useSetOrganizationSuspendedMutation,
} from '@/features/founderQueries';
import { daysUntil, type AccountAccessStatus } from '@/lib/accountAccess';
import { useDebouncedValue } from '@/lib/hooks';
import { ViewAsButton } from '@/components/founder/ViewAsButton';
import { scrollToTop } from '@/lib/scrollToTop';

const PAGE_SIZE = 25;

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'trial', label: 'Trial' },
  { key: 'suspended', label: 'Suspended' },
];

/**
 * Founder console — founder@tryout.ca only.
 *
 * Like the feedback portal, the gate is drawn twice: every RPC behind this page
 * refuses anyone else server-side, and the check here keeps a guessed URL from
 * rendering a screen that looks like it was meant for them.
 */
export default function FounderPage() {
  const founderQuery = useIsFounderQuery();
  const [creating, setCreating] = useState(false);

  if (founderQuery.isLoading) return <LoadingState message="Loading..." />;

  if (founderQuery.data !== true) {
    return (
      <>
        <PageHeader title="Founder Console" showBack backHref="/dashboard" />
        <EmptyState title="Not available" message="This console is limited to the founder account." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Founder Console"
        subtitle="Organizations, access and pilot onboarding"
        right={<Button label="+ New Organization" size="sm" onClick={() => setCreating(true)} />}
      />
      <OrganizationsView />
      <CreateOrganizationModal visible={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function OrganizationsView() {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [includeIndividual, setIncludeIndividual] = useState(false);
  const [page, setPage] = useState(0);
  const [suspending, setSuspending] = useState<FounderOrganization | null>(null);
  const [editing, setEditing] = useState<FounderOrganization | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Search runs server-side, so wait for typing to settle before asking.
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const query = useFounderOrganizationsQuery({
    search: debouncedSearch || undefined,
    status: status === 'all' ? undefined : (status as AccountAccessStatus),
    includeIndividual,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const reactivate = useSetOrganizationSuspendedMutation();
  const router = useRouter();

  // Any filter change starts back at page one.
  const resetPage =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(0);
    };

  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleReactivate = async (org: FounderOrganization) => {
    const ok = await confirm({
      title: 'Reactivate Organization',
      message: `Restore access for every member of ${org.name}?`,
      confirmLabel: 'Reactivate',
    });
    if (!ok) return;
    setBusyId(org.id);
    try {
      await reactivate.mutateAsync({ accountId: org.id, suspended: false });
      toast(`${org.name} reactivated.`, 'success');
    } catch (e) {
      await alert('Could Not Reactivate', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Input
          containerClassName="w-full md:max-w-sm"
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          placeholder="Search by name or owner email..."
        />
        <Switch
          checked={includeIndividual}
          onChange={resetPage(setIncludeIndividual)}
          label="Include individual coach accounts"
        />
      </div>
      <Tabs tabs={STATUS_TABS} activeKey={status} onChange={resetPage(setStatus)} className="mb-4" />

      {query.isLoading ? (
        <LoadingState message="Loading organizations..." />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Could not load organizations.'}
          onRetry={() => query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={debouncedSearch || status !== 'all' ? 'No matches' : 'No organizations yet'}
          message={
            debouncedSearch || status !== 'all'
              ? 'Try a different search or status.'
              : 'Create one with “New Organization”.'
          }
        />
      ) : (
        <>
          <p className="mb-2 text-xs" style={{ color: colors.inkMuted }}>
            {total} {total === 1 ? 'account' : 'accounts'}
            {query.isFetching ? ' · updating…' : ''}
          </p>
          <div className="flex flex-col gap-3" style={{ opacity: query.isPlaceholderData ? 0.6 : 1 }}>
            {items.map((org) => (
              <OrganizationRow
                key={org.id}
                org={org}
                busy={busyId === org.id}
                onSuspend={() => setSuspending(org)}
                onReactivate={() => handleReactivate(org)}
                onEdit={() => setEditing(org)}
                onView={() => router.push(`/founder/organizations/${org.id}`)}
              />
            ))}
          </div>
          {pageCount > 1 ? (
            <div className="mt-4 flex items-center justify-between gap-2">
              <Button
                label="Previous"
                size="sm"
                variant="secondary"
                disabled={page === 0}
                onClick={() => {
                  setPage((p) => p - 1);
                  scrollToTop();
                }}
              />
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                Page {page + 1} of {pageCount}
              </span>
              <Button
                label="Next"
                size="sm"
                variant="secondary"
                disabled={page + 1 >= pageCount}
                onClick={() => {
                  setPage((p) => p + 1);
                  scrollToTop();
                }}
              />
            </div>
          ) : null}
        </>
      )}

      <SuspendOrganizationModal org={suspending} onClose={() => setSuspending(null)} />
      <EditAccessModal key={editing?.id ?? 'none'} org={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function OrganizationRow({
  org,
  busy,
  onSuspend,
  onReactivate,
  onEdit,
  onView,
}: {
  org: FounderOrganization;
  busy: boolean;
  onSuspend: () => void;
  onReactivate: () => void;
  onEdit: () => void;
  onView: () => void;
}) {
  const colors = useThemeColors();
  const badge = STATUS_BADGE[org.accessStatus];
  const suspended = org.accessStatus === 'suspended';

  const statusDetail = org.suspendedAt
    ? `Suspended ${formatDate(org.suspendedAt)}${org.suspendedReason ? ` — ${org.suspendedReason}` : ''}`
    : suspended && org.trialEndsAt
      ? `Trial ended ${formatDate(org.trialEndsAt)}`
      : org.accessStatus === 'trial' && org.trialEndsAt
        ? `Trial ends in ${daysUntil(org.trialEndsAt)} day${daysUntil(org.trialEndsAt) === 1 ? '' : 's'}`
        : null;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-bold break-words" style={{ color: colors.ink }}>
            {org.name || 'Untitled organization'}
          </p>
          <p className="text-sm break-all" style={{ color: colors.inkMuted }}>
            {org.ownerEmail ?? 'No owner'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <Badge label={badge.label} variant={badge.variant} />
          <Badge label={planLabel(org.planTier)} variant="brand" />
          {org.isComp ? <Badge label="Comp" /> : null}
          {org.accountType === 'individual' ? <Badge label="Individual" /> : null}
        </div>
      </div>

      <p className="text-xs" style={{ color: colors.inkFaint }}>
        {org.memberCount} member{org.memberCount === 1 ? '' : 's'} · {org.teamCount} team
        {org.teamCount === 1 ? '' : 's'} · Created {formatDate(org.createdAt)}
        {org.subscriptionStatus && org.subscriptionStatus !== 'none' ? ` · Stripe: ${org.subscriptionStatus}` : ''}
      </p>
      {statusDetail ? (
        <p className="text-sm break-words" style={{ color: suspended ? colors.danger : colors.info }}>
          {statusDetail}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button label="View Details" size="sm" variant="secondary" disabled={busy} onClick={onView} />
        <ViewAsButton accountId={org.id} accountName={org.name} variant="ghost" />
        <Button label="Plan & Access" size="sm" variant="ghost" disabled={busy} onClick={onEdit} />
        {suspended ? (
          <Button label="Reactivate" size="sm" variant="primary" disabled={busy} onClick={onReactivate} />
        ) : (
          <Button label="Suspend" size="sm" variant="danger" disabled={busy} onClick={onSuspend} />
        )}
      </div>
    </Card>
  );
}
