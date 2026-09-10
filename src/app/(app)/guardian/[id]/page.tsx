'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { useThemeColors, type AppTheme } from '@/theme/ThemeProvider';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Modal, PageHeader, Spinner, Tabs, useAlert } from '@/components/ui';
import {
  useAddFamilyContactMutation,
  useCreateTeamFeePaymentMutation,
  useFamilyContactsQuery,
  useGuardianRealtimeSync,
  useGuardianRostersQuery,
  useLeaveSeasonMutation,
  useRemoveFamilyContactMutation,
  useSetAvailabilityMutation,
  useChatUnreadCount,
} from '@/features/queries';
import type { GuardianRosterAthlete, SeasonEvent } from '@/data/types';
import { ChatUnreadBadge } from '@/components/ChatUnreadBadge';

type FlatEvent = SeasonEvent & { seasonName: string; teamName: string; seasonId: string };
type GuardianSeason = GuardianRosterAthlete['seasons'][number];

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SeasonFeeRow({ season, playerId }: { season: GuardianSeason; playerId: string }) {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const payFeeMutation = useCreateTeamFeePaymentMutation();
  const [paying, setPaying] = useState(false);

  const payFee = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      setPaying(true);
      const origin = window.location.origin;
      const returnPath = `/guardian/${playerId}`;
      const res = await payFeeMutation.mutateAsync({
        seasonRosterId: season.seasonRosterId,
        successUrl: `${origin}${returnPath}?feePaid=true`,
        cancelUrl: `${origin}${returnPath}?feePaid=false`,
      });
      if (res?.url) {
        window.location.href = res.url;
      }
    } catch (err) {
      await alert('Payment Error', err instanceof Error ? err.message : 'Something went wrong.');
      setPaying(false);
    }
  };

  return (
    <div className="mt-3 flex items-center justify-between border-t pt-3" style={{ borderColor: colors.border }}>
      <p className="text-sm font-bold" style={{ color: colors.ink }}>
        Team fee: {money(season.registrationFeeCents ?? 0)}
      </p>
      {season.feeStatus === 'unpaid' ? (
        <Button label="Pay Now" size="sm" loading={paying} onClick={payFee} />
      ) : (
        <Badge label={season.feeStatus === 'waived' ? 'Waived' : 'Paid'} variant="success" />
      )}
    </div>
  );
}

function LeaveTeamRow({ season }: { season: GuardianSeason }) {
  const colors = useThemeColors();
  const { alert, confirm } = useAlert();
  const leaveSeasonMutation = useLeaveSeasonMutation();

  const confirmLeave = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: 'Leave Team',
      message: `Remove this athlete from ${season.teamName ?? 'this team'} (${season.name})? You'll need a new invite to rejoin.`,
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!ok) return;
    try {
      await leaveSeasonMutation.mutateAsync(season.seasonRosterId);
    } catch (err) {
      await alert('Could Not Leave', err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  return (
    <div className="mt-3 flex justify-end border-t pt-3" style={{ borderColor: colors.border }}>
      <Button
        label="Leave Team"
        size="sm"
        variant="ghost"
        loading={leaveSeasonMutation.isPending}
        onClick={confirmLeave}
        style={{ color: colors.danger }}
      />
    </div>
  );
}

function EventCard({ item, playerId, colors }: { item: FlatEvent; playerId: string; colors: AppTheme['colors'] }) {
  const { alert } = useAlert();
  const rsvpMutation = useSetAvailabilityMutation(item.seasonId);
  const rsvp = item.availability?.[playerId] || 'pending';

  const handleRsvp = async (response: 'yes' | 'maybe' | 'no') => {
    try {
      await rsvpMutation.mutateAsync({ eventId: item.id, playerId, response });
    } catch (e) {
      await alert('RSVP Failed', e instanceof Error ? e.message : 'Could not save your response.');
    }
  };

  return (
    <Card className="mb-3">
      <div className="mb-2 flex items-start justify-between">
        <div className="mr-2 flex-1">
          <p className="text-base font-bold" style={{ color: colors.ink }}>
            {item.title}
          </p>
          <p className="text-sm" style={{ color: colors.primary }}>
            {item.seasonName}
          </p>
        </div>
        <Badge label={item.type} variant="info" />
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium" style={{ color: colors.inkMuted }}>
          {item.date}
        </span>
        {item.startTime || item.endTime ? (
          <span className="text-sm font-medium" style={{ color: colors.inkMuted }}>
            · {item.startTime} {item.endTime ? `- ${item.endTime}` : ''}
          </span>
        ) : null}
      </div>
      {item.location ? (
        <p className="mt-1 text-sm font-medium" style={{ color: colors.inkMuted }}>
          {item.location}
        </p>
      ) : null}

      <div className="mt-4 border-t pt-3" style={{ borderColor: colors.border }}>
        <p className="mb-2 text-sm font-bold" style={{ color: colors.inkMuted }}>
          RSVP
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleRsvp('yes')}
            disabled={rsvpMutation.isPending}
            className="flex-1 rounded-md py-2 text-center font-bold disabled:opacity-50"
            style={{ backgroundColor: rsvp === 'yes' ? colors.success : colors.tile, color: rsvp === 'yes' ? '#fff' : colors.ink }}
          >
            {rsvpMutation.isPending && rsvpMutation.variables?.response === 'yes' ? <Spinner size={16} /> : 'Yes'}
          </button>
          <button
            type="button"
            onClick={() => handleRsvp('maybe')}
            disabled={rsvpMutation.isPending}
            className="flex-1 rounded-md py-2 text-center font-bold disabled:opacity-50"
            style={{ backgroundColor: rsvp === 'maybe' ? colors.warning : colors.tile, color: rsvp === 'maybe' ? '#fff' : colors.ink }}
          >
            {rsvpMutation.isPending && rsvpMutation.variables?.response === 'maybe' ? <Spinner size={16} /> : 'Maybe'}
          </button>
          <button
            type="button"
            onClick={() => handleRsvp('no')}
            disabled={rsvpMutation.isPending}
            className="flex-1 rounded-md py-2 text-center font-bold disabled:opacity-50"
            style={{ backgroundColor: rsvp === 'no' ? colors.danger : colors.tile, color: rsvp === 'no' ? '#fff' : colors.ink }}
          >
            {rsvpMutation.isPending && rsvpMutation.variables?.response === 'no' ? <Spinner size={16} /> : 'No'}
          </button>
        </div>
      </div>
    </Card>
  );
}

export default function GuardianPortalPage() {
  const routeParams = useParams();
  const playerId = Array.isArray(routeParams?.id) ? routeParams.id[0] : (routeParams?.id as string);
  const router = useRouter();
  const searchParams = useSearchParams();
  const colors = useThemeColors();
  const { alert, confirm } = useAlert();
  const [tab, setTab] = useState('overview');

  const guardianQuery = useGuardianRostersQuery();
  // Keeps this page in sync with a coach's event edits without needing to
  // navigate away and back for the cache to refresh.
  useGuardianRealtimeSync();

  const familyContactsQuery = useFamilyContactsQuery(playerId);
  const addFamilyContact = useAddFamilyContactMutation(playerId);
  const removeFamilyContact = useRemoveFamilyContactMutation(playerId);
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactRelationship, setContactRelationship] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const submitFamilyContact = async () => {
    if (!contactName.trim()) {
      await alert('Missing Info', 'Enter at least a name.');
      return;
    }
    try {
      await addFamilyContact.mutateAsync({
        name: contactName.trim(),
        relationship: contactRelationship.trim() || undefined,
        email: contactEmail.trim() || undefined,
        phone: contactPhone.trim() || undefined,
      });
      setContactName('');
      setContactRelationship('');
      setContactEmail('');
      setContactPhone('');
      setShowAddContact(false);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not add this contact.');
    }
  };

  const confirmRemoveContact = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Remove Contact',
      message: `Remove ${name} from this athlete's family contacts?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeFamilyContact.mutateAsync(id);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not remove this contact.');
    }
  };

  // Stripe redirects back here after a team-fee checkout — the webhook that
  // flips fee_status to 'paid' can lag a moment behind, so refetch a few
  // times instead of trusting the very first response back.
  useEffect(() => {
    const feePaid = searchParams.get('feePaid');
    if (!feePaid) return;
    router.replace(`/guardian/${playerId}`);
    if (feePaid === 'true') {
      let cancelled = false;
      (async () => {
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (cancelled) return;
          await guardianQuery.refetch();
        }
      })();
      alert('Payment Received', "Thanks! We're confirming it now — it'll show as Paid shortly.");
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Ahead of the early returns below, because it is a hook. The Chat tab jumps
  // straight into the conversation when there is only one team to have it with,
  // so that is the only case where a badge on the tab means one thing; with
  // several teams each one carries its own badge in the list instead.
  const soleChatSeason = guardianQuery.data?.find((a) => a.id === playerId)?.seasons;
  const chatUnread = useChatUnreadCount(soleChatSeason?.length === 1 ? soleChatSeason[0].id : undefined);

  if (guardianQuery.isLoading) {
    return <LoadingState message="Loading portal..." />;
  }

  if (guardianQuery.isError) {
    return <ErrorState message="Failed to load player details." onRetry={() => guardianQuery.refetch()} />;
  }

  const athlete = guardianQuery.data?.find((a) => a.id === playerId);

  if (!athlete) {
    return (
      <>
        <PageHeader title="Guardian Portal" showBack backHref="/dashboard" />
        <EmptyState title="Player not found" message="We couldn't find this player in your roster." />
      </>
    );
  }

  const today = new Date().toISOString().split('T')[0];
  let allEvents: FlatEvent[] = [];
  athlete.seasons.forEach((season) => {
    (season.events || []).forEach((event) => {
      allEvents.push({ ...event, seasonName: season.name, teamName: season.teamName, seasonId: season.id });
    });
  });
  // A past practice or game has nothing left to RSVP to.
  allEvents = allEvents.filter((event) => event.date >= today).sort((a, b) => {
    const aDate = new Date(`${a.date}T${a.startTime || '00:00'}`).getTime();
    const bDate = new Date(`${b.date}T${b.startTime || '00:00'}`).getTime();
    return aDate - bDate;
  });

  return (
    <>
      <PageHeader
        title="Guardian Portal"
        showBack
        backHref="/dashboard"
        right={<Button label="Share" size="sm" variant="secondary" onClick={() => router.push(`/guardian/${playerId}/share-directory`)} />}
      />

      <div className="mb-4 flex items-center gap-4">
        <Avatar first={athlete.firstName} last={athlete.lastName} size={64} uri={athlete.avatarUrl} />
        <div>
          <p className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            {athlete.firstName} {athlete.lastName}
          </p>
          <p className="mt-1 text-base" style={{ color: colors.inkMuted }}>
            {athlete.seasons.length} Active Assignments
          </p>
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'schedule', label: 'Schedule', badge: allEvents.length || undefined },
          { key: 'chat', label: 'Chat', badge: chatUnread || undefined },
          { key: 'info', label: 'Info' },
        ]}
        activeKey={tab}
        onChange={(k) => {
          if (k === 'chat' && athlete.seasons.length === 1) {
            router.push(`/guardian/${playerId}/chat/${athlete.seasons[0].id}`);
            return;
          }
          setTab(k);
        }}
        className="mb-4"
      />

      {tab === 'overview' ? (
        athlete.seasons.length === 0 ? (
          <EmptyState title="No assignments" message="This athlete isn't assigned to any seasons yet." />
        ) : (
          <div>
            {athlete.seasons.map((season) => (
              <Card key={season.id} className="mb-3">
                <div className="flex items-start justify-between">
                  <div className="mr-2 flex-1">
                    <p
                      className="mb-1 text-lg font-bold"
                      style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                    >
                      {season.name}
                    </p>
                    <p className="mb-2 text-sm" style={{ color: colors.inkMuted }}>
                      {season.teamName} · {season.sport}
                    </p>
                  </div>
                  <Badge label="Season" variant="info" />
                </div>
                {season.collectsFees ? <SeasonFeeRow season={season} playerId={playerId} /> : null}
                <LeaveTeamRow season={season} />
              </Card>
            ))}
          </div>
        )
      ) : tab === 'schedule' ? (
        allEvents.length === 0 ? (
          <EmptyState title="No events scheduled" message="There are no upcoming events for this athlete." />
        ) : (
          <div>
            {allEvents.map((event) => (
              <EventCard key={event.id} item={event} playerId={playerId} colors={colors} />
            ))}
          </div>
        )
      ) : tab === 'chat' ? (
        athlete.seasons.length === 0 ? (
          <EmptyState
            title="No team chat yet"
            message="This athlete has not been added to a team yet. Once a coach adds them to a roster, the team chat opens up here."
          />
        ) : (
          <div className="space-y-2">
            {athlete.seasons.map((s) => (
              <Card
                key={s.id}
                interactive
                onClick={() => router.push(`/guardian/${playerId}/chat/${s.id}`)}
                className="flex items-center justify-between"
              >
                <div>
                  <p className="font-bold" style={{ color: colors.ink }}>{s.teamName}</p>
                  <p className="text-sm" style={{ color: colors.inkMuted }}>{s.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <ChatUnreadBadge seasonId={s.id} />
                  <Badge label="Chat" variant="brand" />
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        <div>
          <Card className="mb-3">
            <p className="mb-2 text-lg font-bold" style={{ color: colors.ink }}>
              Basic Information
            </p>
            <div className="flex justify-between border-b py-2" style={{ borderColor: colors.border }}>
              <span style={{ color: colors.inkMuted }}>First Name</span>
              <span className="font-medium" style={{ color: colors.ink }}>{athlete.firstName}</span>
            </div>
            <div className="flex justify-between py-2">
              <span style={{ color: colors.inkMuted }}>Last Name</span>
              <span className="font-medium" style={{ color: colors.ink }}>{athlete.lastName}</span>
            </div>
          </Card>

          <Card className="mb-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-lg font-bold" style={{ color: colors.ink }}>
                Family Contacts
              </p>
              <Button label="+ Add" size="sm" variant="ghost" onClick={() => setShowAddContact(true)} />
            </div>
            <p className="mb-2 text-xs" style={{ color: colors.inkMuted }}>
              Other family members — a second parent, a grandparent, an emergency contact.
            </p>
            {familyContactsQuery.isLoading ? (
              <Spinner size={16} />
            ) : (familyContactsQuery.data ?? []).length === 0 ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>
                No additional contacts added yet.
              </p>
            ) : (
              (familyContactsQuery.data ?? []).map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b py-2" style={{ borderColor: colors.border }}>
                  <div className="mr-2 flex-1">
                    <p className="font-medium" style={{ color: colors.ink }}>
                      {c.name}
                      {c.relationship ? ` · ${c.relationship}` : ''}
                    </p>
                    {c.email ? <p className="text-xs" style={{ color: colors.inkMuted }}>{c.email}</p> : null}
                    {c.phone ? <p className="text-xs" style={{ color: colors.inkMuted }}>{c.phone}</p> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => confirmRemoveContact(c.id, c.name)}
                    className="px-2 text-lg font-bold"
                    style={{ color: colors.danger }}
                    aria-label={`Remove ${c.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </Card>

          <Card>
            <p className="mb-2 text-lg font-bold" style={{ color: colors.ink }}>
              Account Link
            </p>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              This athlete is linked to your guardian account. You will receive notifications and updates
              regarding their seasons and team events.
            </p>
          </Card>
        </div>
      )}

      <Modal
        visible={showAddContact}
        title="Add Family Contact"
        onClose={() => {
          if (addFamilyContact.isPending) return;
          setShowAddContact(false);
        }}
        hideDefaultFooter
      >
        <div className="flex flex-col gap-3">
          <Input label="Name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          <Input
            label="Relationship"
            value={contactRelationship}
            onChange={(e) => setContactRelationship(e.target.value)}
            placeholder="e.g. Grandmother, Emergency Contact"
          />
          <Input
            label="Email"
            type="email"
            autoCapitalize="none"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          <Input label="Phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          <Button
            label="Add Contact"
            onClick={submitFamilyContact}
            loading={addFamilyContact.isPending}
            disabled={!contactName.trim()}
          />
        </div>
      </Modal>
    </>
  );
}
