'use client';

import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { useThemeColors, type AppTheme } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  DateField,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  SectionLabel,
  Tabs,
  TimeField,
  useAlert,
} from '@/components/ui';
import {
  useTeamsQuery,
  useTryoutsQuery,
  useUpdateTeamMutation,
  useDeleteTeamMutation,
  useUpdateTryoutMutation,
  useGenerateTestDataMutation,
  useClearTestDataMutation,
  useTeamRosterQuery,
  useAddTeamRosterPlayersMutation,
  useRemoveTeamRosterPlayerMutation,
  useSeasonsQuery,
  useSeasonQuery,
  useAddTeamEventMutation,
  useUpdateSeasonEventMutation,
  useDeleteSeasonEventMutation,
  useUploadTeamLogoMutation,
} from '@/features/queries';
import { useUser } from '@/state/authStore';
import { canUseFeature } from '@/data/plans';
import { CreateEventFormSchema, EVENT_KINDS, type CreateEventForm, type EventKind, type SeasonEvent } from '@/data/types';
import { DummyDataModal } from '@/components/DummyDataModal';
import type { DummyDataOptions } from '@/data/testDataGenerator';

type Rsvp = 'yes' | 'maybe' | 'no' | 'pending';

const RSVP_LABEL: Record<Rsvp, string> = {
  yes: 'Yes',
  maybe: 'Maybe',
  no: 'No',
  pending: 'No reply',
};

const RSVP_VARIANT: Record<Rsvp, 'success' | 'warning' | 'danger' | 'default'> = {
  yes: 'success',
  maybe: 'warning',
  no: 'danger',
  pending: 'default',
};

function StatTile({ label, value, colors }: { label: string; value: number; colors: AppTheme['colors'] }) {
  return (
    <div className="flex-1 rounded-xl p-3" style={{ backgroundColor: colors.tile }}>
      <p className="text-xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
        {value}
      </p>
      <p className="mt-0.5 text-xs" style={{ color: colors.inkMuted }}>
        {label}
      </p>
    </div>
  );
}

export default function TeamDetailPage() {
  const routeParams = useParams();
  const id = Array.isArray(routeParams?.id) ? routeParams.id[0] : (routeParams?.id as string);
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, confirm } = useAlert();
  const teamsQuery = useTeamsQuery();
  const tryoutsQuery = useTryoutsQuery(false);
  const updateTeam = useUpdateTeamMutation();
  const deleteTeam = useDeleteTeamMutation();
  const updateTryout = useUpdateTryoutMutation();
  const uploadLogo = useUploadTeamLogoMutation();
  const user = useUser();
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [showDummy, setShowDummy] = useState(false);
  const [showAddPlayers, setShowAddPlayers] = useState(false);
  const [pickedAthletes, setPickedAthletes] = useState<Set<string>>(new Set());
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [tab, setTab] = useState('schedule');
  const [openRsvpEventId, setOpenRsvpEventId] = useState<string | null>(null);

  const rosterQuery = useTeamRosterQuery(id);
  const addRosterPlayers = useAddTeamRosterPlayersMutation(id);
  const removeRosterPlayer = useRemoveTeamRosterPlayerMutation(id);

  // Events live on the season attached to this team, but that's an implementation
  // detail — the team screen is the only place a coach touches them.
  const seasonsQuery = useSeasonsQuery();
  const teamSeasonId = (seasonsQuery.data ?? []).find((s) => s.teamId === id)?.id;
  const seasonQuery = useSeasonQuery(teamSeasonId);
  const addEvent = useAddTeamEventMutation(
    id,
    teamsQuery.data?.find((t) => t.id === id)?.name ?? 'Team',
    teamSeasonId,
  );
  const updateEvent = useUpdateSeasonEventMutation(teamSeasonId ?? '');
  const deleteEvent = useDeleteSeasonEventMutation(teamSeasonId ?? '');

  const eventForm = useForm<CreateEventForm>({
    resolver: zodResolver(CreateEventFormSchema),
    defaultValues: { type: 'Practice', title: '', date: '', startTime: '', location: '', playerIds: [] },
  });
  const eventType = eventForm.watch('type');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // Resolve the dummy-data target before the early returns so hooks stay unconditional.
  const linkedForHooks = (tryoutsQuery.data ?? []).filter((t) => t.teamId === id);
  const dummyTarget = linkedForHooks[0];
  const genTest = useGenerateTestDataMutation(dummyTarget?.id ?? '');
  const clearTest = useClearTestDataMutation(dummyTarget?.id ?? '');

  if (teamsQuery.isLoading || tryoutsQuery.isLoading) return <LoadingState message="Loading team..." />;
  if (teamsQuery.isError || tryoutsQuery.isError) {
    return (
      <>
        <PageHeader title="Team" showBack backHref="/teams" />
        <ErrorState
          message="Could not load team."
          onRetry={() => {
            teamsQuery.refetch();
            tryoutsQuery.refetch();
          }}
        />
      </>
    );
  }

  const team = teamsQuery.data?.find((t) => t.id === id);
  if (!team) {
    return (
      <>
        <PageHeader title="Team" showBack backHref="/teams" />
        <ErrorState message="Team not found." onRetry={() => teamsQuery.refetch()} />
      </>
    );
  }

  const linkedTryouts = (tryoutsQuery.data ?? []).filter((t) => t.teamId === team.id);
  const unlinkedTryouts = (tryoutsQuery.data ?? []).filter((t) => !t.teamId);
  const isAssociation = canUseFeature(user?.planTier ?? 'free', 'enterprise');

  const teamPlayers = rosterQuery.data ?? [];
  const onRoster = new Set(teamPlayers.map((p) => p.athleteId));

  // Candidates: every athlete on any assessment roster, deduped. Already-on-team
  // athletes stay in the list and are flagged instead of hidden.
  const candidates: {
    athleteId: string;
    first: string;
    last: string;
    jersey?: string;
    pos?: string;
    tryoutId: string;
    tryoutName: string;
    alreadyOnTeam: boolean;
  }[] = [];
  const seenCandidates = new Set<string>();
  for (const t of tryoutsQuery.data ?? []) {
    for (const p of t.roster ?? []) {
      const athleteId = p.athleteId;
      if (!athleteId || seenCandidates.has(athleteId)) continue;
      seenCandidates.add(athleteId);
      candidates.push({
        athleteId,
        first: p.first,
        last: p.last,
        jersey: p.jersey,
        pos: p.pos,
        tryoutId: t.id,
        tryoutName: t.name,
        alreadyOnTeam: onRoster.has(athleteId),
      });
    }
  }
  candidates.sort((a, b) => Number(a.alreadyOnTeam) - Number(b.alreadyOnTeam));
  const availableCount = candidates.filter((c) => !c.alreadyOnTeam).length;

  const addPickedPlayers = async () => {
    const entries = candidates
      .filter((c) => pickedAthletes.has(c.athleteId))
      .map((c) => ({ athleteId: c.athleteId, jersey: c.jersey, pos: c.pos, sourceTryoutId: c.tryoutId }));
    if (entries.length === 0) return;
    try {
      await addRosterPlayers.mutateAsync(entries);
      setPickedAthletes(new Set());
      setShowAddPlayers(false);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not add players to the team.');
    }
  };

  const confirmRemovePlayer = async (athleteId: string, label: string) => {
    const ok = await confirm({
      title: 'Remove Player',
      message: `Remove ${label} from ${team.name}?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) removeRosterPlayer.mutate(athleteId);
  };

  const teamSeason = seasonQuery.data;
  const upcomingEvents = [...(teamSeason?.events ?? [])]
    .filter((e) => e.date >= new Date().toISOString().split('T')[0])
    .sort((a, b) => a.date.localeCompare(b.date));

  // Availability is stored per invited season-roster player; the coach sees a
  // Yes/Maybe/No tally that expands into the actual names.
  const rsvpSummary = (ev: SeasonEvent) => {
    const byId = new Map((teamSeason?.roster ?? []).map((p) => [p.id, p]));
    const counts: Record<Rsvp, number> = { yes: 0, maybe: 0, no: 0, pending: 0 };
    const rows = Object.entries(ev.availability ?? {})
      .filter(([playerId]) => byId.has(playerId))
      .map(([playerId, response]) => {
        const r = (response ?? 'pending') as Rsvp;
        counts[r] += 1;
        const player = byId.get(playerId)!;
        return { playerId, name: `${player.firstName} ${player.lastName}`, response: r };
      });
    const order: Rsvp[] = ['yes', 'maybe', 'no', 'pending'];
    rows.sort((a, b) => order.indexOf(a.response) - order.indexOf(b.response));
    return { counts, rows };
  };

  const openEventModal = (kind: EventKind) => {
    setEditingEventId(null);
    eventForm.reset({
      type: kind,
      title: '',
      date: '',
      startTime: '',
      endTime: '',
      location: '',
      notes: '',
      playerIds: [],
    });
    setShowAddEvent(true);
  };

  const openEditEventModal = (ev: SeasonEvent) => {
    setEditingEventId(ev.id);
    eventForm.reset({
      type: ev.type,
      title: ev.title,
      date: ev.date,
      startTime: ev.startTime ?? '',
      endTime: ev.endTime ?? '',
      location: ev.location ?? '',
      notes: ev.notes ?? '',
      playerIds: [],
    });
    setShowAddEvent(true);
  };

  const submitEvent = eventForm.handleSubmit(
    async (data) => {
      const [y, m, d] = data.date.split('-').map(Number);
      const [hour, min] = (data.startTime || '00:00').split(':').map(Number);
      if (new Date(y, m - 1, d, hour, min) < new Date()) {
        const msg = 'Event must be scheduled from today onwards.';
        eventForm.setError('date', { type: 'manual', message: msg });
        await alert('Validation Error', msg);
        return;
      }
      try {
        if (editingEventId) {
          await updateEvent.mutateAsync({
            eventId: editingEventId,
            updates: {
              type: data.type,
              title: data.title,
              date: data.date,
              startTime: data.startTime,
              endTime: data.endTime,
              location: data.location,
              notes: data.notes,
            },
          });
        } else {
          await addEvent.mutateAsync(data);
        }
        setShowAddEvent(false);
        setEditingEventId(null);
      } catch (e) {
        await alert('Error', e instanceof Error ? e.message : 'Could not save the event.');
      }
    },
    async (errors) => {
      await alert(
        'Validation Error',
        errors.date?.message || errors.title?.message || 'Please check the required fields.',
      );
    },
  );

  const confirmDeleteEvent = async (eventId: string, label: string) => {
    const ok = await confirm({
      title: 'Delete Event',
      message: `Delete "${label}"?`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) deleteEvent.mutate(eventId);
  };

  const runDummy = async (options: DummyDataOptions) => {
    try {
      const res = await genTest.mutateAsync(options);
      setShowDummy(false);
      await alert(
        'Dummy data added',
        `Added ${res.players} players and ${res.evaluations} evaluations to ${dummyTarget?.name}.`,
      );
    } catch (e) {
      await alert(
        'Error',
        e instanceof Error && e.message === 'NO_RUBRICS'
          ? 'Add at least one rubric to that assessment before generating scored players.'
          : e instanceof Error
            ? e.message
            : 'Failed to generate dummy data.',
      );
    }
  };

  const runClearDummy = async () => {
    try {
      const res = await clearTest.mutateAsync();
      await alert('Cleared', `Removed ${res.removed} generated record${res.removed === 1 ? '' : 's'}.`);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to clear dummy data.');
    }
  };

  const startEdit = () => {
    setName(team.name);
    setSeason(team.season ?? '');
    setEditing(true);
  };

  const save = async () => {
    await updateTeam.mutateAsync({
      id: team.id,
      updates: { name: name.trim(), season: season.trim() || undefined },
    });
    setEditing(false);
  };

  const onLogoPicked = async (file: File | undefined) => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    try {
      await uploadLogo.mutateAsync({ teamId: team.id, fileUri: objectUrl, fileType: file.type || 'image/jpeg' });
    } catch (e) {
      await alert('Logo Upload Error', `Failed to upload logo: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete Team',
      message:
        'Are you sure you want to delete this team? This action cannot be undone and will delete all associated data.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteTeam.mutateAsync(team.id);
    router.replace('/teams');
  };

  return (
    <>
      <PageHeader
        title={team.name}
        subtitle={team.season || undefined}
        showBack
        backHref="/teams"
        right={<Button label="Edit" variant="ghost" size="sm" onClick={startEdit} />}
      />

      <div className="mb-5 flex gap-2">
        <StatTile label="Players" value={teamPlayers.length} colors={colors} />
        <StatTile label="Upcoming" value={upcomingEvents.length} colors={colors} />
        <StatTile label="Assessments" value={linkedTryouts.length} colors={colors} />
      </div>

      <Tabs
        tabs={[
          { key: 'schedule', label: 'Schedule', badge: upcomingEvents.length },
          { key: 'players', label: 'Players', badge: teamPlayers.length },
          { key: 'assessments', label: 'Assessments', badge: linkedTryouts.length },
          { key: 'settings', label: 'Settings' },
        ]}
        activeKey={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === 'schedule' ? (
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button label="+ Practice" size="sm" onClick={() => openEventModal('Practice')} />
            <Button label="+ Game" size="sm" variant="secondary" onClick={() => openEventModal('Game')} />
          </div>

          {seasonsQuery.isLoading || seasonQuery.isLoading ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Loading events...
            </p>
          ) : upcomingEvents.length === 0 ? (
            <Card className="flex flex-col items-center gap-1 py-8 text-center">
              <span className="font-bold" style={{ color: colors.ink }}>
                No upcoming events
              </span>
              <span className="max-w-md text-sm" style={{ color: colors.inkMuted }}>
                Add a practice or game — everyone on the roster is invited and their guardians can RSVP from
                the portal.
              </span>
            </Card>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {upcomingEvents.map((ev) => {
                const rsvp = rsvpSummary(ev);
                const expanded = openRsvpEventId === ev.id;
                return (
                  <Card key={ev.id} className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-bold" style={{ color: colors.ink }}>
                          {ev.title}
                        </p>
                        <p className="mt-0.5 text-sm" style={{ color: colors.inkMuted }}>
                          {ev.date}
                          {ev.startTime ? ` · ${ev.startTime}` : ''}
                          {ev.location ? ` · ${ev.location}` : ''}
                        </p>
                      </div>
                      <Badge label={ev.type} variant={ev.type === 'Game' ? 'brand' : 'info'} />
                    </div>

                    <button
                      type="button"
                      onClick={() => setOpenRsvpEventId(expanded ? null : ev.id)}
                      className="flex flex-wrap items-center gap-2 py-1 text-left"
                    >
                      <Badge label={`${rsvp.counts.yes} yes`} variant="success" />
                      <Badge label={`${rsvp.counts.maybe} maybe`} variant="warning" />
                      <Badge label={`${rsvp.counts.no} no`} variant="danger" />
                      {rsvp.counts.pending > 0 ? <Badge label={`${rsvp.counts.pending} pending`} /> : null}
                      <span className="ml-auto text-xs font-bold" style={{ color: colors.primary }}>
                        {expanded ? 'Hide' : 'Who?'}
                      </span>
                    </button>

                    {expanded ? (
                      <div className="rounded-xl border" style={{ borderColor: colors.border }}>
                        {rsvp.rows.length === 0 ? (
                          <p className="p-3 text-xs" style={{ color: colors.inkMuted }}>
                            Nobody was invited to this event yet.
                          </p>
                        ) : (
                          rsvp.rows.map((r, i) => (
                            <div
                              key={r.playerId}
                              className="flex items-center justify-between gap-2 px-3 py-2"
                              style={{ borderTop: i === 0 ? 'none' : `1px solid ${colors.border}` }}
                            >
                              <span className="flex-1 text-sm" style={{ color: colors.ink }}>
                                {r.name}
                              </span>
                              <Badge label={RSVP_LABEL[r.response]} variant={RSVP_VARIANT[r.response]} />
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}

                    <div className="flex gap-2">
                      <Button label="Edit" variant="secondary" size="sm" onClick={() => openEditEventModal(ev)} />
                      <Button
                        label="Delete"
                        variant="ghost"
                        size="sm"
                        onClick={() => confirmDeleteEvent(ev.id, ev.title)}
                      />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ) : tab === 'players' ? (
        <div>
          <Button
            label="Add Players from Assessments"
            size="sm"
            className="mb-4"
            onClick={() => {
              setPickedAthletes(new Set());
              setShowAddPlayers(true);
            }}
          />
          {rosterQuery.isLoading ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Loading roster...
            </p>
          ) : teamPlayers.length === 0 ? (
            <Card className="flex flex-col items-center gap-1 py-8 text-center">
              <span className="font-bold" style={{ color: colors.ink }}>
                No players yet
              </span>
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                Pull players in from any assessment roster to build this team.
              </span>
            </Card>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {teamPlayers.map((p) => (
                <Card key={p.id} className="flex items-center gap-3">
                  <Avatar first={p.first} last={p.last} size={36} pos={p.pos} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold" style={{ color: colors.ink }}>
                      {p.first} {p.last}
                    </span>
                    <span className="mt-0.5 block truncate text-xs" style={{ color: colors.inkMuted }}>
                      {[p.jersey ? `#${p.jersey}` : null, p.pos, p.sourceTryoutName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Button
                    label="Remove"
                    size="sm"
                    variant="ghost"
                    onClick={() => confirmRemovePlayer(p.athleteId, `${p.first} ${p.last}`)}
                  />
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : tab === 'assessments' ? (
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              label="Create"
              size="sm"
              onClick={() => router.push(`/assessment/new?teamId=${team.id}`)}
            />
            <Button
              label="Attach Existing"
              variant="secondary"
              size="sm"
              onClick={() => setShowAttachModal(true)}
            />
          </div>
          {linkedTryouts.length === 0 ? (
            <Card className="flex flex-col items-center gap-1 py-8 text-center">
              <span className="font-bold" style={{ color: colors.ink }}>
                No assessments linked
              </span>
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                Create a tryout or evaluation for this team, or attach one you already have.
              </span>
            </Card>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {linkedTryouts.map((t) => (
                <Card
                  key={t.id}
                  interactive
                  className="flex items-center justify-between gap-3"
                  onClick={() => router.push(`/assessment/${t.id}/roster`)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold" style={{ color: colors.ink }}>
                      {t.name}
                    </span>
                    <span className="mt-0.5 block text-xs" style={{ color: colors.inkMuted }}>
                      {t.sport} · {t.eventType} · {t.roster?.length ?? 0} players
                    </span>
                  </span>
                  <Badge label="Open" variant="brand" />
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col items-start gap-2">
            <SectionLabel>Team</SectionLabel>
            <Button label="Edit Team Details" variant="secondary" size="sm" onClick={startEdit} />
          </Card>

          {isAssociation ? (
            <Card className="flex flex-col items-start gap-2">
              <SectionLabel>Testing Tools</SectionLabel>
              {dummyTarget ? (
                <>
                  <p className="text-xs" style={{ color: colors.inkMuted }}>
                    Generate dummy players — optionally scored — into <strong>{dummyTarget.name}</strong>. They
                    appear under Players.
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Button label="Dummy Players" size="sm" onClick={() => setShowDummy(true)} />
                    <Button
                      label="Clear Dummy Data"
                      size="sm"
                      variant="ghost"
                      loading={clearTest.isPending}
                      onClick={runClearDummy}
                    />
                  </div>
                </>
              ) : (
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  Link an assessment to this team first — dummy players are added to an assessment&apos;s
                  roster, which is what fills the Players list.
                </p>
              )}
            </Card>
          ) : null}

          <Card className="flex flex-col items-start gap-2">
            <SectionLabel className="!text-[color:var(--c-danger)]">Danger Zone</SectionLabel>
            <p className="text-xs" style={{ color: colors.inkMuted }}>
              Deleting a team removes its roster, schedule, and links to assessments.
            </p>
            <Button label="Delete Team" variant="danger" size="sm" onClick={handleDelete} loading={deleteTeam.isPending} />
          </Card>
        </div>
      )}

      <Modal visible={editing} title="Edit Team" onClose={() => setEditing(false)} hideDefaultFooter>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => logoFileRef.current?.click()}
            disabled={uploadLogo.isPending}
            className="flex flex-col items-center gap-1 self-center"
          >
            <Avatar first={team.name} last="" uri={team.logoUrl} size={72} />
            <span className="text-xs" style={{ color: colors.primary }}>
              {uploadLogo.isPending ? 'Uploading...' : 'Change Team Logo'}
            </span>
          </button>
          <input
            ref={logoFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onLogoPicked(e.target.files?.[0])}
          />
          <Input label="Team name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Season" value={season} onChange={(e) => setSeason(e.target.value)} />
          <Button label="Save Changes" onClick={save} loading={updateTeam.isPending} />
        </div>
      </Modal>

      <Modal visible={showAttachModal} title="Attach Assessment" onClose={() => setShowAttachModal(false)}>
        {unlinkedTryouts.length === 0 ? (
          <p className="p-3" style={{ color: colors.inkMuted }}>
            No assessments available to link.
          </p>
        ) : (
          unlinkedTryouts.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={async () => {
                try {
                  await updateTryout.mutateAsync({ id: t.id, updates: { teamId: team.id } });
                  setShowAttachModal(false);
                } catch (e) {
                  await alert('Error', e instanceof Error ? e.message : 'Could not link assessment.');
                }
              }}
              className="block w-full border-b p-3 text-left transition-colors hover:brightness-125"
              style={{ borderColor: colors.border }}
            >
              <span className="block font-bold" style={{ color: colors.ink }}>
                {t.name}
              </span>
              <span className="mt-1 block text-xs" style={{ color: colors.inkMuted }}>
                {t.sport} · {t.roster.length} players
              </span>
            </button>
          ))
        )}
      </Modal>

      <Modal
        visible={showAddPlayers}
        title="Add Players from Assessments"
        size="lg"
        onClose={() => setShowAddPlayers(false)}
        footer={
          <ModalFooter>
            <Button
              label={
                pickedAthletes.size === 0 ? 'Select players to add' : `Add ${pickedAthletes.size} to ${team.name}`
              }
              disabled={pickedAthletes.size === 0}
              loading={addRosterPlayers.isPending}
              onClick={addPickedPlayers}
            />
          </ModalFooter>
        }
      >
        {candidates.length === 0 ? (
          <p className="py-3 text-sm" style={{ color: colors.inkMuted }}>
            No assessments have players yet — add players to an assessment roster first.
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: colors.inkMuted }}>
                Athletes from all of your assessments. Click to select.
              </span>
              {availableCount > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setPickedAthletes((prev) =>
                      prev.size === availableCount
                        ? new Set()
                        : new Set(candidates.filter((c) => !c.alreadyOnTeam).map((c) => c.athleteId)),
                    )
                  }
                  className="text-xs font-bold"
                  style={{ color: colors.primary }}
                >
                  {pickedAthletes.size === availableCount ? 'Clear all' : 'Select all'}
                </button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              {candidates.map((c) => {
                const picked = pickedAthletes.has(c.athleteId);
                return (
                  <button
                    type="button"
                    key={c.athleteId}
                    disabled={c.alreadyOnTeam}
                    onClick={() =>
                      setPickedAthletes((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.athleteId)) next.delete(c.athleteId);
                        else next.add(c.athleteId);
                        return next;
                      })
                    }
                    className="flex items-center gap-3 rounded-xl border px-2 py-3 text-left"
                    style={{
                      borderColor: picked ? colors.primary : colors.border,
                      backgroundColor: picked ? 'rgba(255,107,43,0.12)' : 'transparent',
                      opacity: c.alreadyOnTeam ? 0.5 : 1,
                    }}
                  >
                    <Avatar first={c.first} last={c.last} size={32} pos={c.pos} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold" style={{ color: colors.ink }}>
                        {c.first} {c.last}
                      </span>
                      <span className="mt-0.5 block truncate text-xs" style={{ color: colors.inkMuted }}>
                        {[c.jersey ? `#${c.jersey}` : null, c.pos, c.tryoutName].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {c.alreadyOnTeam ? (
                      <Badge label="On Team" variant="success" />
                    ) : picked ? (
                      <Badge label="Selected" variant="brand" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Modal>

      <Modal
        visible={showAddEvent}
        title={editingEventId ? `Edit ${eventType}` : `Add ${eventType}`}
        onClose={() => {
          setShowAddEvent(false);
          setEditingEventId(null);
        }}
        hideDefaultFooter
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {EVENT_KINDS.map((t) => (
              <Chip key={t} label={t} active={eventType === t} onClick={() => eventForm.setValue('type', t)} />
            ))}
          </div>
          <Controller
            control={eventForm.control}
            name="title"
            render={({ field, fieldState }) => (
              <Input label="Title" {...field} error={fieldState.error?.message} />
            )}
          />
          <Controller
            control={eventForm.control}
            name="date"
            render={({ field, fieldState }) => (
              <DateField
                label="Date"
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message}
                disablePast
              />
            )}
          />
          <Controller
            control={eventForm.control}
            name="startTime"
            render={({ field, fieldState }) => (
              <TimeField
                label="Start Time"
                value={field.value}
                onChange={field.onChange}
                error={fieldState.error?.message}
                disablePast
                dateValue={eventForm.watch('date')}
              />
            )}
          />
          <Controller
            control={eventForm.control}
            name="location"
            render={({ field }) => <Input label="Location" {...field} value={field.value ?? ''} />}
          />
          {editingEventId ? null : (
            <p className="text-xs" style={{ color: colors.inkMuted }}>
              Everyone on the roster is invited by default.
            </p>
          )}
          <Button
            label={editingEventId ? 'Update Event' : 'Save Event'}
            onClick={submitEvent}
            loading={addEvent.isPending || updateEvent.isPending}
          />
        </div>
      </Modal>

      <DummyDataModal
        variant="assessment"
        visible={showDummy}
        loading={genTest.isPending}
        hasRubrics={(dummyTarget?.settings.customRubrics?.length ?? 0) > 0}
        onAddRubrics={() => {
          setShowDummy(false);
          if (dummyTarget) router.push(`/assessment/${dummyTarget.id}/rubrics`);
        }}
        onClose={() => setShowDummy(false)}
        onSubmit={runDummy}
      />
    </>
  );
}
