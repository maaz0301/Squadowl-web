'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { useThemeColors, type AppTheme } from '@/theme/ThemeProvider';
import { Avatar, Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, Tabs, useAlert } from '@/components/ui';
import { useGuardianRostersQuery, useSetAvailabilityMutation } from '@/features/queries';
import type { SeasonEvent } from '@/data/types';

type FlatEvent = SeasonEvent & { seasonName: string; teamName: string; seasonId: string };

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
            className="flex-1 rounded-md py-2 text-center font-bold"
            style={{ backgroundColor: rsvp === 'yes' ? colors.success : colors.tile, color: rsvp === 'yes' ? '#fff' : colors.ink }}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => handleRsvp('maybe')}
            className="flex-1 rounded-md py-2 text-center font-bold"
            style={{ backgroundColor: rsvp === 'maybe' ? colors.warning : colors.tile, color: rsvp === 'maybe' ? '#fff' : colors.ink }}
          >
            Maybe
          </button>
          <button
            type="button"
            onClick={() => handleRsvp('no')}
            className="flex-1 rounded-md py-2 text-center font-bold"
            style={{ backgroundColor: rsvp === 'no' ? colors.danger : colors.tile, color: rsvp === 'no' ? '#fff' : colors.ink }}
          >
            No
          </button>
        </div>
      </div>
    </Card>
  );
}

export default function GuardianPortalPage() {
  const routeParams = useParams();
  const playerId = Array.isArray(routeParams?.id) ? routeParams.id[0] : (routeParams?.id as string);
  const colors = useThemeColors();
  const [tab, setTab] = useState('overview');

  const guardianQuery = useGuardianRostersQuery();

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

  let allEvents: FlatEvent[] = [];
  athlete.seasons.forEach((season) => {
    (season.events || []).forEach((event) => {
      allEvents.push({ ...event, seasonName: season.name, teamName: season.teamName, seasonId: season.id });
    });
  });
  allEvents = allEvents.sort((a, b) => {
    const aDate = new Date(`${a.date}T${a.startTime || '00:00'}`).getTime();
    const bDate = new Date(`${b.date}T${b.startTime || '00:00'}`).getTime();
    return aDate - bDate;
  });

  const overviewItems = [
    ...athlete.seasons.map((s) => ({ ...s, _type: 'season' as const })),
    ...athlete.tryouts.map((t) => ({ ...t, _type: 'tryout' as const })),
  ];

  return (
    <>
      <PageHeader title="Guardian Portal" showBack backHref="/dashboard" />

      <div className="mb-4 flex items-center gap-4">
        <Avatar first={athlete.firstName} last={athlete.lastName} size={64} uri={athlete.avatarUrl} />
        <div>
          <p className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            {athlete.firstName} {athlete.lastName}
          </p>
          <p className="mt-1 text-base" style={{ color: colors.inkMuted }}>
            {athlete.tryouts.length + athlete.seasons.length} Active Assignments
          </p>
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'schedule', label: 'Schedule', badge: allEvents.length || undefined },
          { key: 'info', label: 'Info' },
        ]}
        activeKey={tab}
        onChange={setTab}
        className="mb-4"
      />

      {tab === 'overview' ? (
        overviewItems.length === 0 ? (
          <EmptyState title="No assignments" message="This athlete isn't assigned to any tryouts or seasons yet." />
        ) : (
          <div>
            {overviewItems.map((item) => {
              const card = (
                <Card accent={item._type === 'tryout'} className="mb-3">
                  <div className="flex items-start justify-between">
                    <div className="mr-2 flex-1">
                      <p
                        className="mb-1 text-lg font-bold"
                        style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                      >
                        {item.name}
                      </p>
                      <p className="mb-2 text-sm" style={{ color: colors.inkMuted }}>
                        {item._type === 'season' ? `${item.teamName} · ${item.sport}` : `Tryout · ${item.sport}`}
                      </p>
                    </div>
                    <Badge label={item._type === 'season' ? 'Season' : 'Tryout'} variant={item._type === 'season' ? 'info' : 'brand'} />
                  </div>
                </Card>
              );
              return item._type === 'tryout' ? (
                <Link key={`tryout-${item.id}`} href={`/guardian/${playerId}/assessment/${item.id}`}>
                  {card}
                </Link>
              ) : (
                <div key={`season-${item.id}`}>{card}</div>
              );
            })}
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

          <Card>
            <p className="mb-2 text-lg font-bold" style={{ color: colors.ink }}>
              Account Link
            </p>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              This athlete is linked to your guardian account. You will receive notifications and updates
              regarding their tryouts and team events.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
