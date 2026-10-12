'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { useThemeColors, type AppTheme } from '@/theme/ThemeProvider';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Spinner, Tabs, useAlert } from '@/components/ui';
import {
  useCreateTeamFeePaymentMutation,
  useGuardianRealtimeSync,
  useGuardianRostersQuery,
  useLeaveSeasonMutation,
  useSetAvailabilityMutation,
  useChatUnreadCount,
} from '@/features/queries';
import type { GuardianRosterAthlete, SeasonEvent } from '@/data/types';
import { ChatUnreadBadge } from '@/components/ChatUnreadBadge';
import { AddToCalendar } from '@/components/AddToCalendar';
import { EventDiscussion } from '@/components/EventDiscussion';
import { TeamFeed } from '@/components/teamHub/TeamFeed';
import { useUser } from '@/state/authStore';
import { MapLink } from '@/components/MapLink';
import { GuardianAthleteInfo } from '@/components/GuardianAthleteInfo';

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
      message: `Remove this athlete from ${season.teamName ?? 'this team'} (${season.name})? You'll stop getting this team's schedule and messages. The coach's roster is not changed, and only the coach can add you back.`,
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
  const user = useUser();
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
          <MapLink location={item.location} label={item.title} size="sm" variant="inline" />
        </p>
      ) : null}

      <div className="mt-4 border-t pt-3" style={{ borderColor: colors.border }}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-bold" style={{ color: colors.inkMuted }}>
            RSVP
          </p>
          <span className="flex items-center gap-2">
            <MapLink location={item.location} label={item.title} size="sm" />
            <AddToCalendar event={item} teamName={item.teamName} size="sm" />
          </span>
        </div>
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
        <EventDiscussion seasonId={item.seasonId} eventId={item.id} currentUserId={user?.id} />
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
  const { alert } = useAlert();
  const user = useUser();
  const [tab, setTab] = useState('overview');

  const guardianQuery = useGuardianRostersQuery();
  // Keeps this page in sync with a coach's event edits without needing to
  // navigate away and back for the cache to refresh.
  useGuardianRealtimeSync();

  // The athlete can leave this list while the page is open (the guardian just left their only
  // team, or deleted them). Go back to the dashboard instead of stranding them on a dead end.
  const athleteGone = guardianQuery.isSuccess && !guardianQuery.data?.some((a) => a.id === playerId);
  useEffect(() => {
    if (athleteGone) router.replace('/dashboard');
  }, [athleteGone, router]);

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
          <p className="mt-0.5 text-sm font-bold" style={{ color: colors.primary }}>
            {[...new Set(athlete.seasons.map((se) => se.teamName).filter(Boolean))].join(' · ') || 'Not on a team yet'}
          </p>
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'schedule', label: 'Schedule', badge: allEvents.length || undefined },
          { key: 'feed', label: 'News' },
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
      ) : tab === 'feed' ? (
        athlete.seasons.length === 0 ? (
          <EmptyState title="No teams yet" message="News from a team appears here once this athlete is on its roster." />
        ) : (
          <div className="space-y-8">
            {athlete.seasons.map((season) => (
              <div key={season.id}>
                {athlete.seasons.length > 1 ? (
                  <h2 className="mb-3 text-lg font-bold" style={{ color: colors.ink }}>{season.teamName}</h2>
                ) : null}
                <TeamFeed
                  seasonId={season.id}
                  events={season.events ?? []}
                  canPost={false}
                  canPostOrg={false}
                  currentUserId={user?.id}
                  onViewSchedule={() => setTab('schedule')}
                />
              </div>
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
        <GuardianAthleteInfo athleteId={athlete.id} firstName={athlete.firstName} lastName={athlete.lastName} />
      )}

    </>
  );
}
