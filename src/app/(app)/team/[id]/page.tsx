'use client';

import { useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { useThemeColors, type AppTheme } from '@/theme/ThemeProvider';
import { useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardGridSkeleton,
  Chip,
  DateField,
  ErrorState,
  FormLock,
  Input,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  SectionLabel,
  Spinner,
  Tabs,
  TimeField,
  useAlert,
} from '@/components/ui';
import {
  useTeamsQuery,
  useTryoutsQuery,
  useTryoutSummariesQuery,
  useUpdateTeamMutation,
  useDeleteTeamMutation,
  useSetTryoutTeamMutation,
  useTeamRosterQuery,
  useAddTeamRosterPlayersMutation,
  useAddManualTeamPlayerMutation,
  useUploadTeamPlayerPhotoMutation,
  useRemoveTeamRosterPlayerMutation,
  useTeamRosterInvitesMutation,
  useSeasonsQuery,
  useSeasonQuery,
  useSeasonRealtimeSync,
  useAddTeamEventMutation,
  useUpdateSeasonEventMutation,
  useDeleteSeasonEventMutation,
  useUploadTeamLogoMutation,
  useSetAvailabilityMutation,
} from '@/features/queries';
import { queryKeys } from '@/lib/queryClient';
import { useUser, usePermissions } from '@/state/authStore';
import { canUseFeature, effectiveTierForTeam, isAtPlayerLimit } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { CreateEventFormSchema, type AddPlayerForm as AddPlayerFormValues, type CreateEventForm, type EventKind, type SeasonEvent, type TeamInviteResult } from '@/data/types';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { TeamManagersCard } from '@/components/TeamManagersCard';
import { TeamUnavailableState } from '@/components/TeamUnavailableState';
import { TeamBanner } from '@/components/TeamBanner';
import { TeamColorPicker } from '@/components/TeamColorPicker';
import { PlanGate } from '@/components/PlanGate';
import { AddPlayerForm } from '@/components/assessment/AddPlayerForm';
import { getDataSource } from '@/data';

function feeCentsFromInput(feeInput: string): number {
  const dollars = parseFloat(feeInput);
  return !feeInput.trim() || isNaN(dollars) || dollars <= 0 ? 0 : Math.round(dollars * 100);
}

type Rsvp = 'yes' | 'maybe' | 'no' | 'pending';

const RSVP_LABEL: Record<Rsvp, string> = {
  yes: 'Yes',
  maybe: 'Maybe',
  no: 'No',
  pending: 'No reply',
};

const RSVP_VARIANT: Record<Rsvp, 'success' | 'warning' | 'danger' | 'info'> = {
  yes: 'success',
  maybe: 'warning',
  no: 'danger',
  pending: 'info',
};

function PlayerDetailRow({ label, value, colors }: { label: string; value?: string; colors: AppTheme['colors'] }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-sm" style={{ color: colors.inkMuted }}>
        {label}
      </span>
      <span className="max-w-[65%] text-right text-sm font-medium" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '—'}
      </span>
    </div>
  );
}

function StatTile({
  label,
  value,
  colors,
}: {
  label: string;
  /** undefined while the count is still loading — rendered as an em dash. */
  value: number | undefined;
  colors: AppTheme['colors'];
}) {
  return (
    <div className="flex-1 rounded-xl p-3" style={{ backgroundColor: colors.tile }}>
      <p className="text-xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
        {value ?? '—'}
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
  const searchParams = useSearchParams();
  const { alert, confirm } = useAlert();
  const teamsQuery = useTeamsQuery();
  const tryoutSummariesQuery = useTryoutSummariesQuery(false);
  const updateTeam = useUpdateTeamMutation();
  const deleteTeam = useDeleteTeamMutation();
  const setTryoutTeam = useSetTryoutTeamMutation();
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const uploadLogo = useUploadTeamLogoMutation();
  const user = useUser();
  const { canManageTeam } = usePermissions();
  const qc = useQueryClient();
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [collectsFees, setCollectsFees] = useState(false);
  const [feeInput, setFeeInput] = useState('');
  const [showAttachModal, setShowAttachModal] = useState(false);
  const [showAddPlayers, setShowAddPlayers] = useState(false);
  const [pickedAthletes, setPickedAthletes] = useState<Set<string>>(new Set());
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateTryoutFilter, setCandidateTryoutFilter] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState('');
  const [viewPlayerId, setViewPlayerId] = useState<string | null>(null);
  // Full assessment reads (every roster entry joined to its athlete, every
  // evaluation, score and registration for the whole account) are the
  // heaviest query in the app — see listTryouts(). This page's badges, tab
  // counts, Assessments tab and Attach modal only need names/counts and run
  // off the light tryoutSummariesQuery above; only the add-players candidate
  // picker and an open player-detail modal need full athlete fields, so the
  // full read is deferred until one of those is actually open.
  const tryoutsQuery = useTryoutsQuery(false, showAddPlayers || !!viewPlayerId);
  const [enrollingAssessments, setEnrollingAssessments] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [tab, setTab] = useState(searchParams.get('tab') === 'settings' ? 'settings' : 'schedule');
  const [openRsvpEventId, setOpenRsvpEventId] = useState<string | null>(null);
  const [rsvpSearch, setRsvpSearch] = useState('');
  const [availabilityTarget, setAvailabilityTarget] = useState<{
    eventId: string;
    playerId: string;
    playerName: string;
    current: Rsvp;
  } | null>(null);

  const rosterQuery = useTeamRosterQuery(id);
  const [addPlayersProgress, setAddPlayersProgress] = useState<{ done: number; total: number } | null>(null);
  const addRosterPlayers = useAddTeamRosterPlayersMutation(id, (done, total) => setAddPlayersProgress({ done, total }));
  const addManualPlayer = useAddManualTeamPlayerMutation(id);
  const uploadTeamPlayerPhoto = useUploadTeamPlayerPhotoMutation(id);
  const removeRosterPlayer = useRemoveTeamRosterPlayerMutation(id);
  const sendInvites = useTeamRosterInvitesMutation(id);
  /** Which player's single-invite send is in flight, so only that row spins. */
  const [invitingAthleteId, setInvitingAthleteId] = useState<string | null>(null);

  // A player who never went through an assessment (no tryout roster to pull
  // them from) has no other way onto the team — this is that direct path.
  // Same AddPlayerForm the assessment roster uses, just attached to the team
  // roster instead of a tryout's participants.
  const [showAddManualPlayer, setShowAddManualPlayer] = useState(false);

  const submitManualPlayer = async (data: AddPlayerFormValues) => {
    try {
      const { athleteId } = await addManualPlayer.mutateAsync(data);
      if (athleteId && data.avatarUrl?.startsWith('blob:')) {
        try {
          await uploadTeamPlayerPhoto.mutateAsync({
            athleteId,
            fileUri: data.avatarUrl,
            fileType: 'image/jpeg',
          });
        } catch (e) {
          await alert(
            'Upload Error',
            `Failed to upload profile picture: ${e instanceof Error ? e.message : 'Unknown error'}`,
          );
        }
      }
      setShowAddManualPlayer(false);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not add this player.');
    }
  };

  // Events live on the season attached to this team, but that's an implementation
  // detail — the team screen is the only place a coach touches them.
  const seasonsQuery = useSeasonsQuery();
  const teamSeasonId = (seasonsQuery.data ?? []).find((s) => s.teamId === id)?.id;
  const seasonQuery = useSeasonQuery(teamSeasonId);
  // The Season Hub tab renders this season's schedule and RSVPs inline, so it
  // needs the same live updates the dedicated season pages get.
  useSeasonRealtimeSync(teamSeasonId);
  const [eventProgress, setEventProgress] = useState<{ phase: 'roster' | 'invites'; done: number; total: number } | null>(
    null,
  );
  const addEvent = useAddTeamEventMutation(
    id,
    teamsQuery.data?.find((t) => t.id === id)?.name ?? 'Team',
    teamSeasonId,
    (phase, done, total) => setEventProgress({ phase, done, total }),
  );
  const updateEvent = useUpdateSeasonEventMutation(teamSeasonId ?? '');
  const deleteEvent = useDeleteSeasonEventMutation(teamSeasonId ?? '');
  const setAvailability = useSetAvailabilityMutation(teamSeasonId ?? '');

  const eventForm = useForm<CreateEventForm>({
    resolver: zodResolver(CreateEventFormSchema),
    defaultValues: { type: 'Event', title: '', date: '', endDate: '', startTime: '', location: '', playerIds: [] },
  });
  const eventType = eventForm.watch('type');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // Deliberately not gated on tryoutsQuery. The full assessment read (rosters,
  // evaluations, scores, registrations for the whole account) only feeds the
  // Assessments tab and the add-players candidate picker, but waiting for it
  // held back the team's name, schedule and roster too — the slowest request on
  // the screen decided when any of it appeared. Each dependent piece now shows
  // its own placeholder while it lands.
  if (teamsQuery.isLoading) return <LoadingState message="Loading team..." />;
  if (teamsQuery.isError) {
    return (
      <>
        <PageHeader title="Team" showBack backHref="/teams" />
        <ErrorState message="Could not load team." onRetry={() => teamsQuery.refetch()} />
      </>
    );
  }

  const team = teamsQuery.data?.find((t) => t.id === id);
  if (!team) {
    return (
      <>
        <PageHeader title="Team" showBack backHref="/teams" />
        <TeamUnavailableState onRetry={() => teamsQuery.refetch()} />
      </>
    );
  }

  // Every surface that gates a paid feature on this screen uses the owning
  // club's tier for a delegated team, not the viewer's own — the club already
  // pays for the team, so a delegate coach shouldn't hit an upgrade wall
  // managing it.
  const effectiveTier = effectiveTierForTeam(team, user?.planTier ?? 'free');

  // Mirrors the DB write policies (teams_rw, teams_manager_update): a
  // delegated manager can edit this one team regardless of their own account
  // role, and everyone else needs owner/admin/coach on the account that owns
  // it. Without this gate, an account member with a lesser role (e.g. an
  // assessor who's also a member of the account for another reason) could
  // still see the Edit button, fill out the form, and hit Save only to be
  // rejected with a raw "new row violates row-level security policy" error.
  const canEditTeam = !!team.managed || canManageTeam;

  const tryoutsLoading = tryoutSummariesQuery.isLoading;
  const linkedTryouts = (tryoutSummariesQuery.data ?? []).filter((t) => t.teamId === team.id);
  const unlinkedTryouts = (tryoutSummariesQuery.data ?? []).filter((t) => !t.teamId);
  const canCollectFees = canUseFeature(effectiveTier, 'payments');

  const teamPlayers = rosterQuery.data ?? [];
  const onRoster = new Set(teamPlayers.map((p) => p.athleteId));
  const filteredTeamPlayers = playerSearch.trim()
    ? teamPlayers.filter((p) => `${p.first} ${p.last}`.toLowerCase().includes(playerSearch.trim().toLowerCase()))
    : teamPlayers;

  // The team_roster row carries the roster-scoped fields plus everything that
  // lives on the athlete itself — name, jersey, position, and the player/guardian
  // contact details. Only the assessment-scoped extras (medical notes, jersey
  // colour, registration source) still need the Player record, which the modal
  // looks up by athleteId across every assessment.
  const viewingRosterEntry = viewPlayerId ? teamPlayers.find((p) => p.athleteId === viewPlayerId) : undefined;
  const viewingFullPlayer = viewPlayerId
    ? (tryoutsQuery.data ?? []).flatMap((t) => t.roster ?? []).find((p) => p.athleteId === viewPlayerId)
    : undefined;
  // Link state comes off the athlete row now, so the badge is correct for a
  // player who was never on an assessment roster. The Player record stays as a
  // fallback for the case where only it resolved.
  const guardianLinked = !!(viewingRosterEntry?.linkedGuardianId ?? viewingFullPlayer?.linkedGuardianId);

  // Candidates: every athlete on any assessment roster, deduped. Already-on-team
  // athletes stay in the list and are flagged instead of hidden.
  const candidatesByAthlete = new Map<
    string,
    {
      athleteId: string;
      first: string;
      last: string;
      jersey?: string;
      pos?: string;
      yearOfBirth?: string;
      guardianEmail?: string;
      tryoutId: string;
      tryoutName: string;
      tryoutIds: Set<string>;
      tryoutNames: Set<string>;
      alreadyOnTeam: boolean;
    }
  >();
  for (const t of tryoutsQuery.data ?? []) {
    for (const p of t.roster ?? []) {
      const athleteId = p.athleteId;
      if (!athleteId) continue;
      const existing = candidatesByAthlete.get(athleteId);
      if (existing) {
        existing.tryoutIds.add(t.id);
        existing.tryoutNames.add(t.name);
        continue;
      }
      candidatesByAthlete.set(athleteId, {
        athleteId,
        first: p.first,
        last: p.last,
        jersey: p.jersey,
        pos: p.pos,
        yearOfBirth: p.yearOfBirth,
        guardianEmail: p.guardianEmail,
        tryoutId: t.id,
        tryoutName: t.name,
        tryoutIds: new Set([t.id]),
        tryoutNames: new Set([t.name]),
        alreadyOnTeam: onRoster.has(athleteId),
      });
    }
  }
  const candidates = [...candidatesByAthlete.values()].sort(
    (a, b) => Number(a.alreadyOnTeam) - Number(b.alreadyOnTeam),
  );
  // "Select all" and its available-count must track the ACTIVE assessment
  // filter, not the full cross-assessment candidate pool — otherwise picking
  // one assessment's tab still selects every athlete on the account when
  // "Select all" is clicked, which is what actually produced a batch of 1001
  // instead of the one assessment's roster.
  const filteredCandidates = candidates
    .filter((c) => !candidateTryoutFilter || c.tryoutIds.has(candidateTryoutFilter))
    .filter((c) =>
      candidateSearch.trim() ? `${c.first} ${c.last}`.toLowerCase().includes(candidateSearch.trim().toLowerCase()) : true,
    );
  const availableCount = filteredCandidates.filter((c) => !c.alreadyOnTeam).length;
  const isAddingPlayers = addRosterPlayers.isPending || enrollingAssessments;

  const addPickedPlayers = async () => {
    const picked = candidates.filter((c) => pickedAthletes.has(c.athleteId));
    if (picked.length === 0) return;
    // The roster lives on the owning club's account for a delegated team, so its
    // player cap is the club's, not the delegate's own — same reasoning as
    // effectiveTier everywhere else on this screen.
    if (isAtPlayerLimit(effectiveTier, teamPlayers.length + picked.length - 1)) {
      setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'));
      return;
    }
    const entries = picked.map((c) => ({ athleteId: c.athleteId, jersey: c.jersey, pos: c.pos, sourceTryoutId: c.tryoutId }));
    setAddPlayersProgress({ done: 0, total: entries.length });
    try {
      await addRosterPlayers.mutateAsync(entries);

      // Keep every assessment already linked to this team in sync: enroll each
      // picked athlete there too if they aren't already a participant on it.
      if (linkedTryouts.length > 0) {
        setEnrollingAssessments(true);
        // Build the (athlete, tryout) work list first — deferred, not started —
        // then run it through a bounded worker pool below. `picked.flatMap(...
        // .map((t) => getDataSource().addPlayer(...)))` looked bounded because
        // of the `await Promise.all(...)` after it, but `.map()`'s callback
        // calls and returns the promise immediately: every addPlayer() call —
        // up to players × linked assessments — fired over the wire in the same
        // tick, well past what the connection pool or a statement timeout can
        // absorb for a large batch. Promise.all was only ever waiting on
        // requests that had already all been fired at once.
        const enrollmentTasks = picked.flatMap((c) =>
          linkedTryouts
            .filter((t) => !c.tryoutIds.has(t.id))
            .map((t) => ({
              tryoutId: t.id,
              form: {
                athleteId: c.athleteId,
                first: c.first,
                last: c.last,
                jersey: c.jersey || '',
                pos: c.pos || '',
                yearOfBirth: c.yearOfBirth || '',
                guardianEmail: c.guardianEmail || '',
              },
            })),
        );
        if (enrollmentTasks.length > 0) {
          const ENROLLMENT_CONCURRENCY = 8;
          let nextIndex = 0;
          let completed = 0;
          setAddPlayersProgress({ done: 0, total: enrollmentTasks.length });
          const worker = async () => {
            while (nextIndex < enrollmentTasks.length) {
              const task = enrollmentTasks[nextIndex++];
              await getDataSource().addPlayer(task.tryoutId, task.form);
              completed++;
              setAddPlayersProgress({ done: completed, total: enrollmentTasks.length });
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(ENROLLMENT_CONCURRENCY, enrollmentTasks.length) }, worker),
          );
          for (const t of linkedTryouts) qc.invalidateQueries({ queryKey: queryKeys.tryout(t.id) });
          qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) });
        }
      }

      setPickedAthletes(new Set());
      setCandidateTryoutFilter(null);
      setShowAddPlayers(false);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not add players to the team.');
    } finally {
      setEnrollingAssessments(false);
      setAddPlayersProgress(null);
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

  /**
   * Report an invite send. Partial success is the normal outcome — see
   * TeamInviteResult — so this always names what went out, what bounced, and who
   * had no address on file, rather than collapsing to "sent" or "failed".
   */
  const reportInviteResult = async (result: TeamInviteResult) => {
    const lines: string[] = [];
    if (result.sent.length > 0) {
      lines.push(`Invites sent to ${result.sent.length} ${result.sent.length === 1 ? 'address' : 'addresses'}.`);
    }
    if (result.skipped.length > 0) {
      lines.push(`No email on file for: ${result.skipped.join(', ')}.`);
    }
    if (result.failed.length > 0) {
      lines.push(`Could not send to ${result.failed.map((f) => f.email).join(', ')}.`);
    }
    if (lines.length === 0) lines.push('There was nobody to invite.');
    await alert(result.sent.length > 0 ? 'Invites Sent' : 'No Invites Sent', lines.join('\n\n'));
  };

  const sendRosterInvites = async () => {
    const ok = await confirm({
      title: 'Send Invites',
      message:
        `Invite all ${teamPlayers.length} ${teamPlayers.length === 1 ? 'player' : 'players'} on ${team.name} to the portal? ` +
        'Each invite goes to the player\u2019s own email and their guardian\u2019s, wherever those are on file.',
      confirmLabel: 'Send',
    });
    if (!ok) return;
    try {
      await reportInviteResult(await sendInvites.mutateAsync(undefined));
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not send invites.');
    }
  };

  const sendPlayerInvite = async (athleteId: string) => {
    setInvitingAthleteId(athleteId);
    try {
      await reportInviteResult(await sendInvites.mutateAsync([athleteId]));
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not send invite.');
    } finally {
      setInvitingAthleteId(null);
    }
  };

  const teamSeason = seasonQuery.data;
  const today = new Date().toISOString().split('T')[0];
  // Both the "Upcoming" stat tile/tab badge and the Schedule tab itself stay
  // future-only — a past practice or game has nothing left to RSVP to.
  const upcomingEvents = [...(teamSeason?.events ?? [])]
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const scheduleEvents = upcomingEvents;

  // Availability is stored per invited season-roster player; the coach sees a
  // Yes/Maybe/No tally that expands into the actual names.
  //
  // Narrowed to the team's current players. The season roster this event's RSVP
  // rows hang off is a superset of team membership — seeded from every tryout
  // participant, never pruned when someone leaves the team — so tallying it raw
  // showed more names here than the "Players" tile on this same screen counts.
  // New events are invited off `team_roster` (see syncSeasonRosterFromTeam),
  // but events created before that still carry the wider list, so the filter
  // stays on the read too. Skipped until the roster has actually loaded —
  // an in-flight read is not an empty team, and filtering against it would
  // briefly claim nobody was invited.
  const rsvpSummary = (ev: SeasonEvent) => {
    const seasonRoster = teamSeason?.roster ?? [];
    const invited = rosterQuery.isSuccess
      ? seasonRoster.filter((p) => p.athleteId && onRoster.has(p.athleteId))
      : seasonRoster;
    const byId = new Map(invited.map((p) => [p.id, p]));
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
    // Name breaks the tie so the list is stable within a response group rather
    // than ordered by whatever the availability read happened to return.
    rows.sort(
      (a, b) => order.indexOf(a.response) - order.indexOf(b.response) || a.name.localeCompare(b.name),
    );
    return { counts, rows };
  };

  const openEventModal = (kind: EventKind) => {
    setEditingEventId(null);
    setEventProgress(null);
    eventForm.reset({
      type: kind,
      title: '',
      date: '',
      endDate: '',
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
    setEventProgress(null);
    eventForm.reset({
      type: ev.type,
      title: ev.title,
      date: ev.date,
      endDate: ev.endDate ?? '',
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
              endDate: data.endDate,
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
        setEventProgress(null);
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

  const startEdit = () => {
    setName(team.name);
    setSeason(team.season ?? '');
    setCollectsFees(team.collectsFees ?? false);
    setFeeInput(team.registrationFeeCents ? (team.registrationFeeCents / 100).toFixed(2) : '');
    setBrandColor(team.brandColor ?? null);
    setEditing(true);
  };

  const save = async () => {
    // Only touch fee fields when the coach's plan can actually collect fees — a
    // free-tier coach never sees the toggle below, so leave whatever's already
    // stored (e.g. from before a downgrade) untouched here.
    const feeUpdates = canCollectFees
      ? collectsFees
        ? { collectsFees: true, registrationFeeCents: feeCentsFromInput(feeInput) }
        : { collectsFees: false, registrationFeeCents: 0 }
      : {};
    try {
      await updateTeam.mutateAsync({
        id: team.id,
        // '' rather than undefined when no colour is picked: undefined is "leave
        // it alone" in updateTeam's patch builder, so clearing a colour has to be
        // an explicit empty value to reach the column as NULL.
        updates: {
          name: name.trim(),
          season: season.trim() || undefined,
          brandColor: brandColor ?? '',
          ...feeUpdates,
        },
      });
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to save team settings.');
      return;
    }
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
    try {
      await deleteTeam.mutateAsync(team.id);
      router.replace('/teams');
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not delete this team.');
    }
  };

  return (
    // Bleeds past `<main>`'s own padding so a personalized team reads as a
    // themed page top-to-bottom, not just a colored strip — a flat low-alpha
    // tint over the whole scroll, including behind the title bar. min-h-dvh
    // (viewport-relative, not a % of an ancestor's flex-computed height) so
    // a short page's tint reliably reaches the bottom of the screen instead
    // of stopping where the content does.
    <div
      className="-mx-4 -my-6 min-h-dvh px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      style={{ backgroundColor: team.brandColor ? `${team.brandColor}14` : undefined }}
    >
      <PageHeader title="Team" showBack backHref="/teams" />

      {/* The team's own branding leads the hub — logo, season, brand colour, and
          the "Managed" badge for a club-delegated team so it's never mistaken
          for one of the coach's own. This is the only place name/season show,
          so the header above stays generic instead of repeating them.
          linkToHub is off here since this is the hub. */}
      <TeamBanner
        team={team}
        linkToHub={false}
        className="mb-5"
        right={
          canEditTeam ? (
            <button
              type="button"
              onClick={startEdit}
              className="rounded-lg px-3 py-1.5 text-sm font-bold transition-colors hover:brightness-110"
              style={{ color: colors.ink, backgroundColor: colors.tile }}
            >
              Edit
            </button>
          ) : undefined
        }
      />

      <div className="mb-5 flex gap-2">
        <StatTile label="Players" value={teamPlayers.length} colors={colors} />
        <StatTile label="Upcoming" value={upcomingEvents.length} colors={colors} />
        <StatTile label="Evaluations" value={tryoutsLoading ? undefined : linkedTryouts.length} colors={colors} />
      </div>

      <Tabs
        tabs={[
          { key: 'schedule', label: 'Schedule', badge: upcomingEvents.length },
          { key: 'players', label: 'Players', badge: teamPlayers.length },
          { key: 'assessments', label: 'Evaluations', badge: tryoutsLoading ? undefined : linkedTryouts.length },
          { key: 'chat', label: 'Chat' },
          { key: 'settings', label: 'Settings' },
        ]}
        activeKey={tab}
        onChange={(k) => (k === 'chat' ? router.push(`/team/${id}/chat`) : setTab(k))}
        className="mb-5"
      />

      {tab === 'schedule' ? (
        <PlanGate feature="seasonHub" title="Season Hub" tierOverride={effectiveTier}>
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button label="+ Event" size="sm" onClick={() => openEventModal('Event')} />
          </div>

          {seasonsQuery.isLoading || seasonQuery.isLoading ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Loading events...
            </p>
          ) : scheduleEvents.length === 0 ? (
            <Card className="flex flex-col items-center gap-1 py-8 text-center">
              <span className="font-bold" style={{ color: colors.ink }}>
                No events yet
              </span>
              <span className="max-w-md text-sm" style={{ color: colors.inkMuted }}>
                Add an event — everyone on the roster is invited and their guardians can RSVP from the portal.
              </span>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {scheduleEvents.map((ev) => {
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
                      <div className="flex shrink-0 gap-1">
                        <Badge label={ev.type} variant={ev.type === 'Game' ? 'brand' : 'info'} />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setOpenRsvpEventId(expanded ? null : ev.id);
                        setRsvpSearch('');
                      }}
                      className="flex flex-wrap items-center gap-2 py-1 text-left"
                    >
                      <Badge label={`${rsvp.counts.yes} yes`} variant="success" size="lg" />
                      <Badge label={`${rsvp.counts.maybe} maybe`} variant="warning" size="lg" />
                      <Badge label={`${rsvp.counts.no} no`} variant="danger" size="lg" />
                      {rsvp.counts.pending > 0 ? <Badge label={`${rsvp.counts.pending} pending`} size="lg" /> : null}
                      <span className="ml-auto text-xs font-bold" style={{ color: colors.primary }}>
                        {expanded ? 'Hide RSVPs' : "Who's coming? Set RSVPs"}
                      </span>
                    </button>

                    {expanded ? (
                      <div className="flex flex-col gap-2">
                        {rsvp.rows.length > 8 ? (
                          <Input
                            placeholder="Search players by name"
                            value={rsvpSearch}
                            onChange={(e) => setRsvpSearch(e.target.value)}
                          />
                        ) : null}
                        <div className="overflow-hidden rounded-xl border" style={{ borderColor: colors.border }}>
                          {ev.availabilityUnavailable && rsvp.rows.length === 0 ? (
                            <p className="p-3 text-xs" style={{ color: colors.warning }}>
                              RSVPs couldn&apos;t be loaded for this event. Everyone invited is still
                              invited — reload to try again.
                            </p>
                          ) : rsvp.rows.length === 0 ? (
                            <p className="p-3 text-xs" style={{ color: colors.inkMuted }}>
                              Nobody was invited to this event yet.
                            </p>
                          ) : (
                            <>
                              <p
                                className="px-3 py-2 text-xs"
                                style={{
                                  color: ev.availabilityUnavailable ? colors.warning : colors.inkMuted,
                                  backgroundColor: colors.tile,
                                }}
                              >
                                {ev.availabilityUnavailable
                                  ? `Showing the ${rsvp.rows.length} RSVPs that loaded — the rest timed out. Reload to retry.`
                                  : 'Click a player to set their RSVP'}
                              </p>
                              {(() => {
                                const q = rsvpSearch.trim().toLowerCase();
                                const visible = q ? rsvp.rows.filter((r) => r.name.toLowerCase().includes(q)) : rsvp.rows;
                                if (visible.length === 0) {
                                  return (
                                    <p className="p-3 text-center text-xs" style={{ color: colors.inkMuted }}>
                                      No players match &quot;{rsvpSearch}&quot;.
                                    </p>
                                  );
                                }
                                return visible.map((r, i) => (
                                  <button
                                    type="button"
                                    key={r.playerId}
                                    onClick={() =>
                                      setAvailabilityTarget({
                                        eventId: ev.id,
                                        playerId: r.playerId,
                                        playerName: r.name,
                                        current: r.response,
                                      })
                                    }
                                    className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left transition-colors hover:brightness-125"
                                    style={{ borderTop: i === 0 ? 'none' : `1px solid ${colors.border}` }}
                                  >
                                    <span className="flex-1 text-sm font-bold" style={{ color: colors.ink }}>
                                      {r.name}
                                    </span>
                                    <Badge label={RSVP_LABEL[r.response]} variant={RSVP_VARIANT[r.response]} size="lg" />
                                  </button>
                                ));
                              })()}
                            </>
                          )}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex gap-2">
                      <Button label="Edit" variant="secondary" size="sm" onClick={() => openEditEventModal(ev)} />
                      <Button
                        label="Delete"
                        variant="ghost"
                        size="sm"
                        loading={deleteEvent.isPending && deleteEvent.variables === ev.id}
                        onClick={() => confirmDeleteEvent(ev.id, ev.title)}
                      />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
        </PlanGate>
      ) : tab === 'players' ? (
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              label="Add Players from Evaluations"
              size="sm"
              onClick={() => {
                setPickedAthletes(new Set());
                setShowAddPlayers(true);
              }}
            />
            <Button
              label="+ Add Player Manually"
              size="sm"
              variant="secondary"
              onClick={() => setShowAddManualPlayer(true)}
            />
            {canManageTeam && teamPlayers.length > 0 ? (
              <Button
                label="Send Invites"
                size="sm"
                variant="secondary"
                loading={sendInvites.isPending && invitingAthleteId === null}
                onClick={sendRosterInvites}
              />
            ) : null}
          </div>
          {teamPlayers.length > 0 ? (
            <Input
              containerClassName="mb-3"
              placeholder="Search players by name"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
            />
          ) : null}
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
                Pull players in from any evaluation roster to build this team.
              </span>
            </Card>
          ) : filteredTeamPlayers.length === 0 ? (
            <Card className="flex flex-col items-center gap-1 py-8 text-center">
              <span className="font-bold" style={{ color: colors.ink }}>
                No players match &quot;{playerSearch}&quot;.
              </span>
              <Button label="Clear search" variant="ghost" size="sm" onClick={() => setPlayerSearch('')} />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filteredTeamPlayers.map((p) => (
                <Card key={p.id} className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setViewPlayerId(p.athleteId)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Avatar first={p.first} last={p.last} size={36} pos={p.pos} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold" style={{ color: colors.ink }}>
                        {p.first} {p.last}
                      </span>
                      <span className="mt-0.5 block truncate text-xs" style={{ color: colors.inkMuted }}>
                        {[p.jersey ? `#${p.jersey}` : null, p.pos, p.sourceTryoutName].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                  <Button
                    label="Remove"
                    size="sm"
                    variant="ghost"
                    loading={removeRosterPlayer.isPending && removeRosterPlayer.variables === p.athleteId}
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
          {tryoutsLoading ? (
            <CardGridSkeleton count={2} lines={1} columns="sm:grid-cols-2" />
          ) : tryoutSummariesQuery.isError ? (
            <Card className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="font-bold" style={{ color: colors.ink }}>
                Could not load evaluations
              </span>
              <Button label="Retry" size="sm" variant="secondary" onClick={() => tryoutSummariesQuery.refetch()} />
            </Card>
          ) : linkedTryouts.length === 0 ? (
            <Card className="flex flex-col items-center gap-1 py-8 text-center">
              <span className="font-bold" style={{ color: colors.ink }}>
                No evaluations linked
              </span>
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                Create a tryout or evaluation for this team, or attach one you already have.
              </span>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                      {t.sport} · {t.eventType} · {t.playerCount} players
                    </span>
                  </span>
                  <Badge label="Open" variant="brand" />
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {canEditTeam ? (
            <Card className="flex flex-col items-start gap-2">
              <SectionLabel>Team</SectionLabel>
              <Button label="Edit Team Details" variant="secondary" size="sm" onClick={startEdit} />
            </Card>
          ) : null}

          <TeamManagersCard teamId={team.id} teamName={team.name} />

          {/* A delegated manager runs the team but doesn't own it — deleting the
              club's team isn't theirs to do, and the teams RLS grants them
              update but not delete, so the button would only ever fail. */}
          {team.managed ? null : (
            <Card className="flex flex-col items-start gap-2">
              <SectionLabel className="!text-[color:var(--c-danger)]">Danger Zone</SectionLabel>
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                Deleting a team removes its roster, schedule, and links to evaluations.
              </p>
              <Button label="Delete Team" variant="danger" size="sm" onClick={handleDelete} loading={deleteTeam.isPending} />
            </Card>
          )}
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

          <TeamColorPicker value={brandColor} onChange={setBrandColor} />

          {canCollectFees ? (
            <>
              <div className="flex flex-col gap-2">
                <SectionLabel>Are you collecting fees?</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  <Chip label="No" active={!collectsFees} onClick={() => setCollectsFees(false)} />
                  <Chip label="Yes" active={collectsFees} onClick={() => setCollectsFees(true)} />
                </div>
              </div>

              {collectsFees ? (
                <Card className="flex flex-col gap-2">
                  <Input
                    label="Fee per player (CAD)"
                    value={feeInput}
                    onChange={(e) => setFeeInput(e.target.value)}
                    placeholder="0.00"
                  />
                  <p className="text-xs" style={{ color: colors.inkMuted }}>
                    Saving this creates (or reuses) this team&apos;s season and adds everyone currently on the
                    roster to it — each player&apos;s guardian will then be asked to pay this fee, plus
                    TryoutHQ&apos;s 0.5% platform fee, from their portal.
                  </p>
                </Card>
              ) : null}
            </>
          ) : null}

          <Button label="Save Changes" onClick={save} loading={updateTeam.isPending} />
        </div>
      </Modal>

      <Modal visible={showAttachModal} title="Attach Evaluation" onClose={() => setShowAttachModal(false)}>
        {tryoutsLoading ? (
          <LoadingState message="Loading evaluations..." />
        ) : tryoutSummariesQuery.isError ? (
          <div className="flex flex-col items-center gap-2 p-3 text-center">
            <p style={{ color: colors.inkMuted }}>Could not load evaluations.</p>
            <Button label="Retry" size="sm" variant="secondary" onClick={() => tryoutSummariesQuery.refetch()} />
          </div>
        ) : unlinkedTryouts.length === 0 ? (
          <p className="p-3" style={{ color: colors.inkMuted }}>
            No evaluations available to link.
          </p>
        ) : (
          unlinkedTryouts.map((t) => (
            <button
              type="button"
              key={t.id}
              disabled={attachingId !== null}
              onClick={async () => {
                setAttachingId(t.id);
                try {
                  await setTryoutTeam.mutateAsync({ id: t.id, teamId: team.id });
                  setShowAttachModal(false);
                } catch (e) {
                  await alert('Error', e instanceof Error ? e.message : 'Could not link evaluation.');
                } finally {
                  setAttachingId(null);
                }
              }}
              className="flex w-full items-center justify-between gap-3 border-b p-3 text-left transition-colors hover:brightness-125 disabled:opacity-50"
              style={{ borderColor: colors.border }}
            >
              <span>
                <span className="block font-bold" style={{ color: colors.ink }}>
                  {t.name}
                </span>
                <span className="mt-1 block text-xs" style={{ color: colors.inkMuted }}>
                  {t.sport} · {t.playerCount} players
                </span>
              </span>
              {attachingId === t.id ? <Spinner size={18} /> : null}
            </button>
          ))
        )}
      </Modal>

      <Modal
        visible={showAddPlayers}
        title="Add Players from Evaluations"
        size="lg"
        onClose={() => setShowAddPlayers(false)}
        footer={
          <ModalFooter>
            {isAddingPlayers && addPlayersProgress && addPlayersProgress.total > 0 ? (
              <div className="mb-2 flex flex-col gap-1">
                <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: colors.tile }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(4, Math.round((addPlayersProgress.done / addPlayersProgress.total) * 100)))}%`,
                      backgroundColor: colors.primary,
                    }}
                  />
                </div>
                <p className="text-center text-xs" style={{ color: colors.inkMuted }}>
                  Added {addPlayersProgress.done} of {addPlayersProgress.total} players...
                </p>
              </div>
            ) : null}
            <Button
              label={
                pickedAthletes.size === 0 ? 'Select players to add' : `Add ${pickedAthletes.size} to ${team.name}`
              }
              disabled={pickedAthletes.size === 0}
              loading={isAddingPlayers}
              onClick={addPickedPlayers}
            />
          </ModalFooter>
        }
      >
        {isAddingPlayers ? (
          <LoadingState
            message={
              addPlayersProgress && addPlayersProgress.total > 0
                ? `Added ${addPlayersProgress.done} of ${addPlayersProgress.total} players...`
                : 'Adding players...'
            }
          />
        ) : tryoutsQuery.isLoading ? (
          <LoadingState message="Loading players..." />
        ) : tryoutsQuery.isError ? (
          <div className="flex flex-col items-center gap-2 py-3 text-center text-sm">
            <p style={{ color: colors.inkMuted }}>Could not load players from evaluations.</p>
            <Button label="Retry" size="sm" variant="secondary" onClick={() => tryoutsQuery.refetch()} />
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-3 text-sm" style={{ color: colors.inkMuted }}>
            No evaluations have players yet — add players to an evaluation roster first.
          </p>
        ) : (
          <>
            <Input
              containerClassName="mb-3"
              value={candidateSearch}
              onChange={(e) => setCandidateSearch(e.target.value)}
              placeholder="Search players by name"
            />
            {linkedTryouts.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                <Chip label="All" active={candidateTryoutFilter === null} onClick={() => setCandidateTryoutFilter(null)} />
                {linkedTryouts.map((t) => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    active={candidateTryoutFilter === t.id}
                    onClick={() => setCandidateTryoutFilter(candidateTryoutFilter === t.id ? null : t.id)}
                  />
                ))}
              </div>
            ) : null}
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: colors.inkMuted }}>
                Athletes from all of your evaluations. Click to select.
              </span>
              {availableCount > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setPickedAthletes((prev) =>
                      prev.size === availableCount
                        ? new Set()
                        : new Set(filteredCandidates.filter((c) => !c.alreadyOnTeam).map((c) => c.athleteId)),
                    )
                  }
                  className="text-xs font-bold"
                  style={{ color: colors.primary }}
                >
                  {pickedAthletes.size === availableCount ? 'Clear all' : 'Select all'}
                </button>
              ) : null}
            </div>

            {filteredCandidates.length === 0 ? (
              <p className="py-4 text-center text-sm" style={{ color: colors.inkMuted }}>
                No players match &quot;{candidateSearch}&quot;.
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              {filteredCandidates.map((c) => {
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
        visible={showAddManualPlayer}
        title="Add Player Manually"
        onClose={() => {
          if (addManualPlayer.isPending || uploadTeamPlayerPhoto.isPending) return;
          setShowAddManualPlayer(false);
        }}
        hideDefaultFooter
      >
        <AddPlayerForm
          loading={addManualPlayer.isPending || uploadTeamPlayerPhoto.isPending}
          onSubmit={submitManualPlayer}
        />
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
          <FormLock busy={addEvent.isPending || updateEvent.isPending} className="flex flex-col gap-3">
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
              name="endDate"
              render={({ field, fieldState }) => (
                <DateField
                  label="End Date (optional)"
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                  disablePast
                  minDate={eventForm.watch('date') || undefined}
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
              name="endTime"
              render={({ field, fieldState }) => (
                <TimeField label="End Time" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
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
          </FormLock>

          {addEvent.isPending && eventProgress && eventProgress.total > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: colors.tile }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(4, Math.round((eventProgress.done / eventProgress.total) * 100)))}%`,
                    backgroundColor: colors.primary,
                  }}
                />
              </div>
              <p className="text-center text-xs" style={{ color: colors.inkMuted }}>
                {eventProgress.phase === 'roster'
                  ? `Adding ${eventProgress.done} of ${eventProgress.total} players to the roster...`
                  : `Sending invites to ${eventProgress.done} of ${eventProgress.total} guardians...`}
              </p>
            </div>
          ) : null}
          <Button
            label={editingEventId ? 'Update Event' : 'Save Event'}
            onClick={submitEvent}
            loading={addEvent.isPending || updateEvent.isPending}
          />
        </div>
      </Modal>

      <LimitReachedModal visible={!!limitMsg} onClose={() => setLimitMsg(null)} message={limitMsg ?? ''} />

      <Modal
        visible={!!availabilityTarget}
        title={availabilityTarget?.playerName ?? 'Availability'}
        onClose={() => setAvailabilityTarget(null)}
      >
        <div className="flex flex-col gap-2">
          <p className="mb-2 text-sm" style={{ color: colors.inkMuted }}>
            Set this player&apos;s availability for the event. This overrides whatever they (or their guardian)
            submitted.
          </p>
          {(['yes', 'maybe', 'no'] as const).map((option) => (
            <Button
              key={option}
              label={RSVP_LABEL[option]}
              variant={availabilityTarget?.current === option ? 'primary' : 'secondary'}
              loading={setAvailability.isPending}
              onClick={async () => {
                if (!availabilityTarget) return;
                try {
                  await setAvailability.mutateAsync({
                    eventId: availabilityTarget.eventId,
                    playerId: availabilityTarget.playerId,
                    response: option,
                  });
                  setAvailabilityTarget(null);
                } catch (e) {
                  await alert('Error', e instanceof Error ? e.message : 'Could not update availability.');
                }
              }}
            />
          ))}
        </div>
      </Modal>

      <Modal
        visible={!!viewPlayerId}
        title={viewingRosterEntry ? `${viewingRosterEntry.first} ${viewingRosterEntry.last}` : 'Player'}
        onClose={() => setViewPlayerId(null)}
        hideDefaultFooter
      >
        {!viewingRosterEntry ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            This player may have been removed from the team.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {!viewingFullPlayer && (tryoutsQuery.isLoading || tryoutsQuery.isError) ? (
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                {tryoutsQuery.isLoading
                  ? 'Loading photo…'
                  : 'The player photo could not be loaded.'}{' '}
                {tryoutsQuery.isError ? (
                  <button
                    type="button"
                    className="underline"
                    style={{ color: colors.primary }}
                    onClick={() => tryoutsQuery.refetch()}
                  >
                    Retry
                  </button>
                ) : null}
              </p>
            ) : null}
            <div className="flex flex-col items-center gap-2 py-2">
              <Avatar
                first={viewingRosterEntry.first}
                last={viewingRosterEntry.last}
                pos={viewingRosterEntry.pos}
                uri={viewingFullPlayer?.avatarUrl}
                size={72}
              />
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                #{viewingRosterEntry.jersey ?? '—'} · {viewingRosterEntry.pos ?? '—'}
              </span>
              {viewingFullPlayer?.registrationSource === 'qr' ? <Badge label="QR Registered" variant="info" /> : null}
            </div>

            <Card className="flex flex-col gap-2">
              <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                Details
              </span>
              <PlayerDetailRow
                label="Year of Birth"
                value={viewingRosterEntry.yearOfBirth ? String(viewingRosterEntry.yearOfBirth) : undefined}
                colors={colors}
              />
              <PlayerDetailRow
                label="Player Email"
                value={viewingRosterEntry.playerEmail ?? viewingFullPlayer?.playerEmail}
                colors={colors}
              />
            </Card>

            <Card className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                  Guardian
                </span>
                <Badge
                  label={guardianLinked ? 'Account Linked' : 'Not Linked'}
                  variant={guardianLinked ? 'success' : 'default'}
                />
              </div>
              <PlayerDetailRow
                label="Name"
                value={viewingRosterEntry.guardianName ?? viewingFullPlayer?.guardianName}
                colors={colors}
              />
              <PlayerDetailRow
                label="Email"
                value={viewingRosterEntry.guardianEmail ?? viewingFullPlayer?.guardianEmail}
                colors={colors}
              />
              <PlayerDetailRow
                label="Phone"
                value={viewingRosterEntry.guardianPhone ?? viewingFullPlayer?.guardianPhone}
                colors={colors}
              />
            </Card>

            <Card className="flex flex-col gap-2">
              <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                Additional Info
              </span>
              <PlayerDetailRow
                label="Medical"
                value={viewingRosterEntry.medicalInfo ?? viewingFullPlayer?.medicalInfo}
                colors={colors}
              />
            </Card>

            {canManageTeam ? (
              <Button
                label="Send Invite"
                variant="secondary"
                disabled={!viewingRosterEntry.playerEmail && !viewingRosterEntry.guardianEmail}
                loading={invitingAthleteId === viewingRosterEntry.athleteId}
                onClick={() => sendPlayerInvite(viewingRosterEntry.athleteId)}
              />
            ) : null}
            {canManageTeam && !viewingRosterEntry.playerEmail && !viewingRosterEntry.guardianEmail ? (
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                Add a player or guardian email to this athlete before inviting them.
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
