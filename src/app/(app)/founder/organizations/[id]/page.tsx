'use client';

import { use, useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Tabs, useAlert } from '@/components/ui';
import {
  ArchiveBadges,
  FounderArchiveToggle,
  FounderLinkCard,
  FounderNotAvailable,
  FounderSection,
  isHiddenByDefault,
  useShowArchived,
} from '@/components/founder/FounderUi';
import { FounderActionRow, TryoutStateButtons, UpdatedBadge } from '@/components/founder/FounderEditor';
import { ViewAsButton } from '@/components/founder/ViewAsButton';
import { EditAccessModal, SuspendOrganizationModal } from '@/components/founder/OrganizationModals';
import { AUDIT_ACTION_LABEL, STATUS_BADGE, formatDate, planLabel } from '@/components/founder/labels';
import type { FounderOrganizationDetail } from '@/data/founder/types';
import {
  useFounderOrgEvaluationsQuery,
  useFounderOrganizationQuery,
  useIsFounderQuery,
  useSetOrganizationSuspendedMutation,
} from '@/features/founderQueries';
import { daysUntil } from '@/lib/accountAccess';

/**
 * One organization, seen from the founder console.
 *
 * Deliberately not "view as": the founder stays in the console and reads the
 * organization's facts from here, rather than the app switching into the
 * organization's own coach screens.
 */
export default function FounderOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const founderQuery = useIsFounderQuery();
  const query = useFounderOrganizationQuery(id, founderQuery.data === true);

  if (founderQuery.isLoading || (founderQuery.data === true && query.isLoading)) {
    return <LoadingState message="Loading organization..." />;
  }

  if (founderQuery.data !== true) return <FounderNotAvailable />;

  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="Organization" showBack backHref="/founder" />
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Could not load this organization.'}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  return <OrganizationDetail detail={query.data} />;
}

function OrganizationDetail({ detail }: { detail: FounderOrganizationDetail }) {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const reactivate = useSetOrganizationSuspendedMutation();
  const [suspending, setSuspending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState('overview');
  const showArchived = useShowArchived();
  const teams = showArchived ? detail.teams : detail.teams.filter((t) => !t.archived);
  const assignedEvaluations = showArchived
    ? detail.assignedEvaluations
    : detail.assignedEvaluations.filter((a) => !isHiddenByDefault(a));
  const hiddenAssignedCount = detail.assignedEvaluations.length - assignedEvaluations.length;

  const { org } = detail;
  const badge = STATUS_BADGE[org.accessStatus];
  const suspended = org.accessStatus === 'suspended';

  const statusDetail = org.suspendedAt
    ? `Suspended ${formatDate(org.suspendedAt)}${org.suspendedReason ? ` — ${org.suspendedReason}` : ''}`
    : suspended && org.trialEndsAt
      ? `Trial ended ${formatDate(org.trialEndsAt)}`
      : org.accessStatus === 'trial' && org.trialEndsAt
        ? `Trial ends in ${daysUntil(org.trialEndsAt)} day${daysUntil(org.trialEndsAt) === 1 ? '' : 's'}`
        : null;

  const handleReactivate = async () => {
    const ok = await confirm({
      title: 'Reactivate Organization',
      message: `Restore access for every member of ${org.name}?`,
      confirmLabel: 'Reactivate',
    });
    if (!ok) return;
    try {
      await reactivate.mutateAsync({ accountId: org.id, suspended: false });
      toast(`${org.name} reactivated.`, 'success');
    } catch (e) {
      await alert('Could Not Reactivate', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const stats = [
    { label: 'Members', value: detail.members.length },
    { label: 'Active teams', value: org.teamCount },
    { label: 'Evaluations', value: detail.tryoutCount },
    { label: 'Seasons', value: detail.seasonCount },
  ];

  return (
    <>
      <PageHeader title={org.name || 'Untitled organization'} subtitle="Founder Console" showBack backHref="/founder" />

      <Card className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge label={badge.label} variant={badge.variant} />
          <Badge label={planLabel(org.planTier)} variant="brand" />
          {org.isComp ? <Badge label="Comp" /> : null}
          {org.accountType === 'individual' ? <Badge label="Individual" /> : null}
        </div>
        <p className="text-sm break-all" style={{ color: colors.inkMuted }}>
          Owner: {org.ownerEmail ?? 'none'}
          {detail.sport ? ` · ${detail.sport}` : ''} · Created {formatDate(org.createdAt)}
          {org.subscriptionStatus && org.subscriptionStatus !== 'none' ? ` · Stripe: ${org.subscriptionStatus}` : ''}
        </p>
        {statusDetail ? (
          <p className="text-sm break-words" style={{ color: suspended ? colors.danger : colors.info }}>
            {statusDetail}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <ViewAsButton accountId={org.id} accountName={org.name} variant="primary" />
          <Button label="Plan & Access" size="sm" variant="secondary" onClick={() => setEditing(true)} />
          {suspended ? (
            <Button label="Reactivate" size="sm" loading={reactivate.isPending} onClick={handleReactivate} />
          ) : (
            <Button label="Suspend" size="sm" variant="danger" onClick={() => setSuspending(true)} />
          )}
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="flex flex-col gap-0.5">
            <span className="text-2xl font-bold" style={{ color: colors.ink }}>
              {s.value}
            </span>
            <span className="text-xs" style={{ color: colors.inkMuted }}>
              {s.label}
            </span>
          </Card>
        ))}
      </div>

      <Tabs
        tabs={[
          { key: 'overview', label: `Members (${detail.members.length})` },
          { key: 'teams', label: `Teams (${teams.length})` },
          { key: 'evaluations', label: `Evaluations (${detail.tryoutCount})` },
          { key: 'activity', label: 'Activity' },
        ]}
        activeKey={tab}
        onChange={setTab}
        className="mb-2"
      />
      <div className="mb-4">
        <FounderArchiveToggle />
      </div>

      {tab === 'overview' ? (
        <>
          <FounderSection title="Members">
            {detail.members.length === 0 ? (
              <EmptyState title="No members" message="Nobody belongs to this organization." />
            ) : (
              detail.members.map((m) => (
                <Card key={m.userId} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold break-words" style={{ color: colors.ink }}>
                      {m.displayName || m.email || 'Unnamed member'}
                    </p>
                    {m.email && m.displayName ? (
                      <p className="text-xs break-all" style={{ color: colors.inkMuted }}>
                        {m.email}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge label={m.role} />
                    <span className="text-xs" style={{ color: colors.inkFaint }}>
                      Joined {formatDate(m.joinedAt)}
                    </span>
                  </div>
                </Card>
              ))
            )}
          </FounderSection>

          {/* Delegated team managers and invited-only assessors have no
              memberships row (see FounderOrganizationDetail's comments), so
              without this they're connected to the organization but never
              show up anywhere above. */}
          <FounderSection title={`Managed Teams (${detail.managedTeams.length})`}>
            {detail.managedTeams.length === 0 ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>
                No team is delegated to a manager outside the organization&apos;s own staff.
              </p>
            ) : (
              detail.managedTeams.map((m, i) => (
                <FounderLinkCard key={`${m.teamId}-${m.userId ?? i}`} href={`/founder/organizations/${org.id}/teams/${m.teamId}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words" style={{ color: colors.ink }}>
                      {m.name || m.email || 'Unnamed manager'}
                    </p>
                    <p className="text-xs break-words" style={{ color: colors.inkMuted }}>
                      Manages {m.teamName}
                    </p>
                  </div>
                  <Badge label={m.role} />
                </FounderLinkCard>
              ))
            )}
          </FounderSection>

          <FounderSection
            title={`Assigned Evaluations (${assignedEvaluations.length})${!showArchived && hiddenAssignedCount ? ` · ${hiddenAssignedCount} hidden` : ''}`}
          >
            {assignedEvaluations.length === 0 ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>
                No one is individually assigned to an evaluation as an assessor.
              </p>
            ) : (
              assignedEvaluations.map((a, i) => (
                <FounderLinkCard
                  key={`${a.tryoutId}-${a.userId ?? a.email ?? i}`}
                  // A deleted evaluation can't be opened in full; the coach read behind that page skips it.
                  href={a.deletedAt ? undefined : `/founder/organizations/${org.id}/evaluations/${a.tryoutId}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words" style={{ color: colors.ink }}>
                      {a.name || a.email || 'Unnamed assessor'}
                    </p>
                    <p className="text-xs break-words" style={{ color: colors.inkMuted }}>
                      Assigned to {a.tryoutName}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ArchiveBadges deletedAt={a.deletedAt} />
                    {a.status ? <Badge label={a.status} /> : null}
                  </div>
                </FounderLinkCard>
              ))
            )}
          </FounderSection>
        </>
      ) : null}

      {tab === 'teams' ? (
        <FounderSection title="Teams">
          {teams.length === 0 ? (
            <EmptyState
              title="No teams"
              message={
                detail.teams.length
                  ? 'Every team is archived. Turn on "Show archived & deleted" to see them.'
                  : "This organization hasn't created a team yet."
              }
            />
          ) : (
            teams.map((t) => (
              <FounderLinkCard key={t.id} href={`/founder/organizations/${org.id}/teams/${t.id}`}>
                <p className="min-w-0 flex-1 font-semibold break-words" style={{ color: colors.ink }}>
                  {t.name || 'Untitled team'}
                </p>
                <div className="flex items-center gap-2">
                  <UpdatedBadge id={t.id} />
                  <ArchiveBadges archived={t.archived} />
                  <span className="text-xs" style={{ color: colors.inkFaint }}>
                    Created {formatDate(t.createdAt)}
                  </span>
                </div>
              </FounderLinkCard>
            ))
          )}
        </FounderSection>
      ) : null}

      {tab === 'evaluations' ? <OrgEvaluationsTab orgId={org.id} /> : null}

      {tab === 'activity' ? (
        <FounderSection title="Founder activity">
          {detail.auditLog.length === 0 ? (
            <EmptyState
              title="Nothing logged"
              message="Suspensions and plan changes for this organization appear here."
            />
          ) : (
            detail.auditLog.map((entry) => (
              <Card key={entry.id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold" style={{ color: colors.ink }}>
                    {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
                  </p>
                  <span className="text-xs" style={{ color: colors.inkFaint }}>
                    {formatDate(entry.createdAt, true)}
                  </span>
                </div>
                <p className="text-xs break-all" style={{ color: colors.inkMuted }}>
                  by {entry.actorEmail ?? 'unknown'}
                </p>
                {entry.reason ? (
                  <p className="text-sm break-words" style={{ color: colors.inkMuted }}>
                    Reason: {entry.reason}
                  </p>
                ) : null}
              </Card>
            ))
          )}
        </FounderSection>
      ) : null}

      <SuspendOrganizationModal org={suspending ? org : null} onClose={() => setSuspending(false)} />
      <EditAccessModal key={editing ? org.id : 'none'} org={editing ? org : null} onClose={() => setEditing(false)} />
    </>
  );
}

const EVALUATION_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'team', label: 'With a team' },
  { key: 'none', label: 'Without a team' },
];

function OrgEvaluationsTab({ orgId }: { orgId: string }) {
  const colors = useThemeColors();
  const [filter, setFilter] = useState('all');
  const showArchived = useShowArchived();
  const query = useFounderOrgEvaluationsQuery(orgId);

  if (query.isLoading) return <LoadingState message="Loading evaluations..." />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : 'Could not load evaluations.'}
        onRetry={() => query.refetch()}
      />
    );
  }

  const all = query.data ?? [];
  const items = all
    .filter((e) => showArchived || !isHiddenByDefault(e))
    .filter((e) => (filter === 'team' ? !!e.teamId : filter === 'none' ? !e.teamId : true));
  const hiddenCount = all.filter(isHiddenByDefault).length;

  return (
    <FounderSection title="Evaluations">
      <Tabs tabs={EVALUATION_FILTERS} activeKey={filter} onChange={setFilter} className="mb-1" />
      {!showArchived && hiddenCount ? (
        <p className="text-xs" style={{ color: colors.inkFaint }}>
          {hiddenCount} archived or deleted {hiddenCount === 1 ? 'evaluation is' : 'evaluations are'} hidden.
        </p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          title="No evaluations"
          message={all.length ? 'Nothing matches this filter.' : 'This organization has not run an evaluation yet.'}
        />
      ) : (
        items.map((ev) => (
          <FounderLinkCard
            key={ev.id}
            // A deleted evaluation can't be opened in full; the coach read behind that page skips it.
            href={ev.deletedAt ? undefined : `/founder/organizations/${orgId}/evaluations/${ev.id}`}
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words" style={{ color: colors.ink }}>
                {ev.name || 'Untitled evaluation'}
              </p>
              <p className="text-xs break-words" style={{ color: colors.inkMuted }}>
                {[ev.teamName ?? 'No team', ev.date, ev.location].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <UpdatedBadge id={ev.id} />
              {ev.eventType ? <Badge label={ev.eventType} variant="brand" /> : null}
              <ArchiveBadges archived={ev.archived} deletedAt={ev.deletedAt} />
              <Badge label={`${ev.playerCount} players`} />
            </div>
            {ev.deletedAt ? (
              <FounderActionRow>
                <TryoutStateButtons tryout={ev} />
              </FounderActionRow>
            ) : null}
          </FounderLinkCard>
        ))
      )}
    </FounderSection>
  );
}
