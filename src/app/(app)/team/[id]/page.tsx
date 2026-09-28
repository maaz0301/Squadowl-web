'use client';
'use no memo';

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
  TimeField,
  useAlert,
} from '@/components/ui';
import {
  useTeamsQuery,
  useTryoutsQuery,
  useTryoutSummariesQuery,
  useUpdateTeamMutation,
  useArchiveTeamMutation,
  useDeleteTeamMutation,
  useSetTryoutTeamMutation,
  useTeamRosterQuery,
  useTeamRosterPagesQuery,
  useTeamRosterAthleteIdsQuery,
  useAddTeamRosterPlayersMutation,
  useAddManualTeamPlayerMutation,
  useUpdateTeamRosterPlayerMutation,
  useImportTeamRosterPlayersMutation,
  useUploadTeamPlayerPhotoMutation,
  useRemoveTeamRosterPlayerMutation,
  useRemoveTeamRosterPlayersMutation,
  useTeamRosterInvitesMutation,
  useSeasonSummariesQuery,
  useSeasonQuery,
  useChatUnreadCount,
  useSeasonRealtimeSync,
  useAddTeamEventMutation,
  useUpdateSeasonEventMutation,
  useDeleteSeasonEventMutation,
  useAddAthletesToEventsMutation,
  useUploadTeamLogoMutation,
  useSetAvailabilityMutation,
  useGenerateTestDataMutation,
  useClearTestDataMutation,
  useCreateTryoutMutation,
} from '@/features/queries';
import { queryKeys } from '@/lib/queryClient';
import { prefetchNewAssessment } from '@/features/prefetch';
import { useDebouncedValue } from '@/lib/hooks';
import { exportTeamRosterData } from '@/lib/teamRosterExport';
import { useUser, usePermissions } from '@/state/authStore';
import { canUseFeature, effectiveTierForTeam, isAtPlayerLimit, canUseDummyData, playerRoom, assessmentRoom } from '@/data/plans';
import { useDummyDataBlockedTiers } from '@/features/useCanUseDummyData';
import { DUMMY_LIMITS, clampOption } from '@/data/testDataGenerator';
import { capImportRows, dropExistingPlayers, withSkippedRows } from '@/data/bulkTeamImport';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { CreateEventFormSchema, type AddPlayerForm as AddPlayerFormValues, type CreateEventForm, type EventKind, type SeasonEvent, type TeamInviteResult } from '@/data/types';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { TeamManagersCard } from '@/components/TeamManagersCard';
import { LetterTemplatesManager } from '@/components/letters/LetterTemplatesManager';
import { ImpersonationTeamPanel } from '@/components/founder/ImpersonationTeamPanel';
import { TeamUnavailableState } from '@/components/TeamUnavailableState';
import { Icon } from '@/components/Icons';
import { TeamHubHeader } from '@/components/teamHub/TeamHubHeader';
import { TeamHubTabs } from '@/components/teamHub/TeamHubTabs';
import { HubSectionLabel } from '@/components/teamHub/HubSection';
import { HubRowCard } from '@/components/teamHub/HubRowCard';
import { HubActionTile } from '@/components/teamHub/HubActionTile';
import { HubEventCard } from '@/components/teamHub/HubEventCard';
import { TeamStatusTiles } from '@/components/teamHub/TeamStatusTiles';
import { AddToCalendar } from '@/components/AddToCalendar';
import { MapLink, MapLocationHint } from '@/components/MapLink';
import { describeInviteResult, inviteNeedsAttention } from '@/lib/inviteResult';
import { TeamColorPicker } from '@/components/TeamColorPicker';
import { PlanGate } from '@/components/PlanGate';
import { AddPlayerForm, type ExtraFamilyContact } from '@/components/assessment/AddPlayerForm';
import { ImportPlayersModal } from '@/components/roster/ImportPlayersModal';
import { DeleteProgressModal } from '@/components/DeleteProgressModal';
import { getDataSource } from '@/data';

function feeCentsFromInput(feeInput: string): number {
  const dollars = parseFloat(feeInput);
  return !feeInput.trim() || isNaN(dollars) || dollars <= 0 ? 0 : Math.round(dollars * 100);
}

type Rsvp = 'yes' | 'maybe' | 'no' | 'pending';

/** Matches listTeamRosterPage's own page size — see TEAM_ROSTER_SCREEN_PAGE. */
const TEAM_ROSTER_PAGE = 50;

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

export default function TeamDetailPage() {
  const routeParams = useParams();
  const id = Array.isArray(routeParams?.id) ? routeParams.id[0] : (routeParams?.id as string);
  const colors = useThemeColors();
  const router = useRouter();
  // The Assessments tab's Create button: warm the form's route chunk and the
  // reads it mounts with on hover, so the click opens an already-loaded screen.
  const warmNewAssessment = () => {
    router.prefetch('/assessment/new');
    prefetchNewAssessment();
  };
  const searchParams = useSearchParams();
  const { alert, confirm } = useAlert();
  const teamsQuery = useTeamsQuery();
  const tryoutSummariesQuery = useTryoutSummariesQuery(false);
  const dummyBlockedTiers = useDummyDataBlockedTiers();
  // Dummy data generation writes onto a linked evaluation, so it targets this
  // team's first one — auto-created on demand below if there isn't one yet.
  // Computed off the route id (not `team.id`, which isn't resolved yet) so
  // these mutation hooks can be declared before any early return below.
  const dummyTryoutId = (tryoutSummariesQuery.data ?? []).find((t) => t.teamId === id)?.id ?? '';
  const [showTestGen, setShowTestGen] = useState(false);
  const [dummyProgress, setDummyProgress] = useState<{ done: number; total: number } | null>(null);
  const genTest = useGenerateTestDataMutation(dummyTryoutId, (done, total) => setDummyProgress({ done, total }));
  const clearTest = useClearTestDataMutation(dummyTryoutId);
  const createDummyTryout = useCreateTryoutMutation();
  const [preparingDummyTryout, setPreparingDummyTryout] = useState(false);
  const [dummyPlayerCount, setDummyPlayerCount] = useState('25');
  const updateTeam = useUpdateTeamMutation();
  const deleteTeam = useDeleteTeamMutation();
  const archiveTeam = useArchiveTeamMutation();
  const setTryoutTeam = useSetTryoutTeamMutation();
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const uploadLogo = useUploadTeamLogoMutation();
  const user = useUser();
  const { canManageTeam, canAssess } = usePermissions();
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
  // 'recent' is the default, unsorted (server created_at) order the paginated
  // read already gives. 'name'/'age' need the whole roster in memory to sort
  // correctly — see displayedPlayers below — so they switch off pagination.
  const [rosterSort, setRosterSort] = useState<'recent' | 'name' | 'age'>('recent');
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
  // The event Team Status, RSVPs and the action row are pointed at.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [rsvpSearch, setRsvpSearch] = useState('');
  const [availabilityTarget, setAvailabilityTarget] = useState<{
    eventId: string;
    playerId: string;
    playerName: string;
    current: Rsvp;
  } | null>(null);

  // Server-side, so it searches the whole roster rather than only the pages
  // already pulled down — debounced because every distinct term is a read.
  const debouncedPlayerSearch = useDebouncedValue(playerSearch);
  // The Players tab's list: one page (50) per read, the rest on demand. The
  // full roster read this replaces is several 200-row pages on a club-sized
  // team, each paying can_access_athlete() per row, and this page opens on the
  // schedule — so it is no longer on the path to anything the coach sees first.
  const rosterPages = useTeamRosterPagesQuery(id, debouncedPlayerSearch);
  // Team membership and headcount, without an athlete row per player: what the
  // stat tile, the tab badge, the plan's player limit, the picker's "already on
  // this team" flags and the RSVP narrowing all actually need.
  const rosterAthleteIdsQuery = useTeamRosterAthleteIdsQuery(id);
  // Only reads when a real sort is picked (see rosterSort) — an alphabetical or
  // age order has to be correct across the *whole* roster, not just the pages
  // already paged in, so those two modes read everyone once instead of paging.
  const fullRosterQuery = useTeamRosterQuery(id, rosterSort !== 'recent');
  const [addPlayersProgress, setAddPlayersProgress] = useState<{ done: number; total: number } | null>(null);
  const addRosterPlayers = useAddTeamRosterPlayersMutation(id, (done, total) => setAddPlayersProgress({ done, total }));
  const addManualPlayer = useAddManualTeamPlayerMutation(id);
  const updateRosterPlayer = useUpdateTeamRosterPlayerMutation(id);
  const uploadTeamPlayerPhoto = useUploadTeamPlayerPhotoMutation(id);
  const [showEditPlayer, setShowEditPlayer] = useState(false);
  const removeRosterPlayer = useRemoveTeamRosterPlayerMutation(id);
  const [removeProgress, setRemoveProgress] = useState<{ done: number; total: number } | null>(null);
  const removeRosterPlayers = useRemoveTeamRosterPlayersMutation(id, (done, total) =>
    setRemoveProgress({ done, total }),
  );
  // Players-tab select mode: pick several (or everyone) and remove them together.
  const [rosterSelectMode, setRosterSelectMode] = useState(false);
  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<string>>(new Set());
  // Which roster export is running (Options tab), so the buttons can't double-fire.
  const [exportingTeam, setExportingTeam] = useState<'xlsx' | 'pdf' | null>(null);
  const sendInvites = useTeamRosterInvitesMutation(id);
  /** Which player's single-invite send is in flight, so only that row spins. */
  const [invitingAthleteId, setInvitingAthleteId] = useState<string | null>(null);

  // A player who never went through an assessment (no tryout roster to pull
  // them from) has no other way onto the team — this is that direct path.
  // Same AddPlayerForm the assessment roster uses, just attached to the team
  // roster instead of a tryout's participants.
  const [showAddManualPlayer, setShowAddManualPlayer] = useState(false);
  // A club that already keeps its roster in a spreadsheet shouldn't have to
  // retype it — see ImportPlayersModal for the mapping step that makes an
  // arbitrary sheet usable.
  const [showImportPlayers, setShowImportPlayers] = useState(false);
  const importPlayers = useImportTeamRosterPlayersMutation(id);

  /** Create the athlete, put them on the roster, and upload the photo they were given. */
  const saveManualPlayer = async (data: AddPlayerFormValues) => {
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
    return athleteId;
  };

  /**
   * Add a player by hand and invite them, in one step — the invite is the point
   * of adding them, and making the coach save, reopen the profile and invite
   * from there was three steps to send one email.
   *
   * `emails` is what the form's Invite toggles marked; without it every address
   * the player has on file is mailed.
   */
  const addAndInviteManualPlayer = async (
    data: AddPlayerFormValues,
    emails?: string[],
    extraFamilyContacts?: ExtraFamilyContact[],
  ) => {
    let athleteId: string;
    try {
      athleteId = await saveManualPlayer(data);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not add this player.');
      return;
    }
    const contacts = (extraFamilyContacts ?? []).filter((c) => c.name.trim() || c.email.trim());
    if (athleteId && contacts.length > 0) {
      try {
        await Promise.all(
          contacts.map((c) =>
            getDataSource().addFamilyContact(athleteId, { name: c.name || c.email, email: c.email || undefined }),
          ),
        );
      } catch (e) {
        await alert(
          'Family Members Not Saved',
          `The player was saved, but the additional family members couldn't be added: ${e instanceof Error ? e.message : 'Unknown error'}`,
        );
      }
    }
    // The player is on the roster from here on, whatever the invite does — so
    // the form closes first and the send reports itself on top of the roster.
    setShowAddManualPlayer(false);
    offerAddToUpcomingEvents([athleteId]);
    try {
      setInvitingAthleteId(athleteId);
      await reportInviteResult(await sendInvites.mutateAsync({ athleteIds: [athleteId], emails }));
    } catch (e) {
      await alert(
        'Invite Not Sent',
        `${`${data.first} ${data.last}`.trim()} was added to the roster, but the invite could not be sent: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`,
      );
    } finally {
      setInvitingAthleteId(null);
    }
  };

  const submitManualPlayer = (
    data: AddPlayerFormValues,
    inviteEmails?: string[],
    extraFamilyContacts?: ExtraFamilyContact[],
  ) => addAndInviteManualPlayer(data, inviteEmails, extraFamilyContacts);

  // Events live on the season attached to this team, but that's an implementation
  // detail — the team screen is the only place a coach touches them.
  // Summaries, not the full seasons: all this needs is which season is attached
  // to this team, and listSeasons() assembles every season in the account —
  // every event and every roster entry joined to its athlete row — to answer
  // it. That read used to stand in front of the schedule before the season's
  // own read had even started.
  const seasonsQuery = useSeasonSummariesQuery();
  const teamSeasonId = (seasonsQuery.data ?? []).find((s) => s.teamId === id)?.id;
  const seasonQuery = useSeasonQuery(teamSeasonId);
  /** Badges the Chat tab, so a coach on the hub can see the team has written. */
  const chatUnread = useChatUnreadCount(teamSeasonId);
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
  const addAthletesToEvents = useAddAthletesToEventsMutation(teamSeasonId ?? '');

  // Offered right after a player lands on the roster, when the team already
  // has upcoming events — adding to team_roster/season_roster never touches
  // event_availability, so without this a player added after an event exists
  // stays invisible on that event's RSVP list and invite emails forever (see
  // addAthletesToEvents on DataSource). null = no prompt open; a non-null
  // (always non-empty) array is the athlete ids waiting on a yes/no.
  const [pendingEventInviteAthleteIds, setPendingEventInviteAthleteIds] = useState<string[] | null>(null);
  const [selectedInviteEventIds, setSelectedInviteEventIds] = useState<Set<string>>(new Set());
  // The import modal shows its own per-row summary before closing, so its
  // athlete ids are held here and the prompt is offered on close instead of
  // the moment the import call resolves — see the ImportPlayersModal wiring
  // below. Accumulates across "Import more players" rounds within one open
  // of the modal, since onClose (and this prompt) only fires once at the end.
  const [pendingImportAthleteIds, setPendingImportAthleteIds] = useState<string[]>([]);

  const offerAddToUpcomingEvents = (athleteIds: string[]) => {
    const ids = athleteIds.filter(Boolean);
    if (ids.length === 0 || upcomingEvents.length === 0) return;
    setSelectedInviteEventIds(new Set(upcomingEvents.map((e) => e.id)));
    setPendingEventInviteAthleteIds(ids);
  };

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

  // A manager of this team can create and run its evaluations, on the owning
  // club's plan (see effectiveTier) — their own account stays as it was. So
  // every manager, whatever role label their row carries, sees the tab.
  const canViewEvaluations = team.managed ? true : canManageTeam;

  const tryoutsLoading = tryoutSummariesQuery.isLoading;
  const linkedTryouts = (tryoutSummariesQuery.data ?? []).filter((t) => t.teamId === team.id);
  const unlinkedTryouts = (tryoutSummariesQuery.data ?? []).filter((t) => !t.teamId);
  const canCollectFees = canUseFeature(effectiveTier, 'payments');
  const showDummyTools = canUseDummyData(effectiveTier, dummyBlockedTiers);

  /**
   * Dummy roster players write onto a linked evaluation even though this flow
   * never shows one — most freshly created teams don't have one yet, and
   * making the coach go create and attach one first just to add a few test
   * players defeated the point of a one-tap tool. So this stands a bare one
   * up on the fly the first time it's needed, the same way generateDummyTeams
   * does for brand-new teams. No rubrics: this flow only ever generates
   * unscored roster players.
   */
  const ensureDummyTryoutId = async (): Promise<string> => {
    if (dummyTryoutId) return dummyTryoutId;
    const tryout = await createDummyTryout.mutateAsync({
      name: `${team.name} Evaluation`,
      sport: 'Hockey',
      eventType: 'Tryout',
      teamId: team.id,
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.tryouts(false) }),
      qc.invalidateQueries({ queryKey: queryKeys.tryoutSummaries(false) }),
    ]);
    return tryout.id;
  };

  const onRoster = new Set(rosterAthleteIdsQuery.data ?? []);
  // The rows on screen, flattened out of however many pages have been pulled
  // down. The search that used to filter this array is part of the read itself
  // now (see useTeamRosterPagesQuery), so a name on a page nobody has scrolled
  // to is still found.
  const listedPlayers = rosterPages.data?.pages.flatMap((page) => page.players) ?? [];
  // Falls back to what is on screen while that read is in flight, so the badge
  // and the empty-state checks never read as "no players" on a team that has
  // them.
  const playerCount = rosterAthleteIdsQuery.data?.length ?? listedPlayers.length;

  // What the Players tab actually renders. 'recent' is listedPlayers as-is —
  // paginated, server-searched, in the order the roster was built. 'name' and
  // 'age' instead sort the *whole* roster (fullRosterQuery), because sorting
  // only the pages already paged in would put e.g. "Aaron" from page 4 below
  // "Zach" from page 1 until someone scrolled far enough to load page 4 —
  // search here is applied client-side to match, since the full read doesn't
  // take a search param.
  const displayedPlayers = (() => {
    if (rosterSort === 'recent') return listedPlayers;
    const term = debouncedPlayerSearch.trim().toLowerCase();
    const all = fullRosterQuery.data ?? [];
    const matched = term
      ? all.filter(
          (p) =>
            `${p.first} ${p.last}`.toLowerCase().includes(term) ||
            (p.jersey ?? '').toLowerCase().includes(term),
        )
      : all;
    const sorted = [...matched];
    if (rosterSort === 'name') {
      sorted.sort((a, b) => a.first.localeCompare(b.first) || a.last.localeCompare(b.last));
    } else {
      // Oldest first, the usual reading order for a roster sorted "by age". A
      // missing birth year (never required to add a player) sinks to the
      // bottom on either sort rather than being guessed at as oldest.
      sorted.sort((a, b) => {
        if (a.yearOfBirth == null) return b.yearOfBirth == null ? 0 : 1;
        if (b.yearOfBirth == null) return -1;
        return a.yearOfBirth - b.yearOfBirth;
      });
    }
    return sorted;
  })();

  // The team_roster row carries the roster-scoped fields plus everything that
  // lives on the athlete itself — name, jersey, position, and the player/guardian
  // contact details. Only the assessment-scoped extras (medical notes, jersey
  // colour, registration source) still need the Player record, which the modal
  // looks up by athleteId across every assessment.
  const viewingRosterEntry = viewPlayerId ? listedPlayers.find((p) => p.athleteId === viewPlayerId) : undefined;
  const viewingFullPlayer = viewPlayerId
    ? (tryoutsQuery.data ?? []).flatMap((t) => t.roster ?? []).find((p) => p.athleteId === viewPlayerId)
    : undefined;
  // Link state comes off the athlete row now, so the badge is correct for a
  // player who was never on an assessment roster. The Player record stays as a
  // fallback for the case where only it resolved.
  const guardianLinked = !!(viewingRosterEntry?.linkedGuardianId ?? viewingFullPlayer?.linkedGuardianId);

  const editPlayerDefaultValues: Partial<AddPlayerFormValues> | undefined = viewingRosterEntry
    ? {
        athleteId: viewingRosterEntry.athleteId,
        first: viewingRosterEntry.first,
        last: viewingRosterEntry.last,
        jersey: viewingRosterEntry.jersey ?? '',
        pos: viewingRosterEntry.pos ?? '',
        yearOfBirth: viewingRosterEntry.yearOfBirth ? String(viewingRosterEntry.yearOfBirth) : '',
        playerEmail: viewingRosterEntry.playerEmail ?? viewingFullPlayer?.playerEmail ?? '',
        guardianName: viewingRosterEntry.guardianName ?? viewingFullPlayer?.guardianName ?? '',
        guardianEmail: viewingRosterEntry.guardianEmail ?? viewingFullPlayer?.guardianEmail ?? '',
        guardianPhone: viewingRosterEntry.guardianPhone ?? viewingFullPlayer?.guardianPhone ?? '',
        // Left undefined rather than '' when the viewer can't see it, so
        // saving other fields never blanks out medical info this account
        // isn't shown.
        medicalInfo: viewingRosterEntry.canViewMedical ? viewingRosterEntry.medicalInfo : undefined,
        // Not on TeamRosterPlayer itself — only the assessment-scoped Player
        // record carries a photo on web, same as the read-only card above.
        avatarUrl: viewingFullPlayer?.avatarUrl ?? '',
      }
    : undefined;

  const submitEditPlayer = async (data: AddPlayerFormValues) => {
    if (!viewingRosterEntry) return;
    try {
      if (data.avatarUrl?.startsWith('blob:')) {
        try {
          data.avatarUrl = await uploadTeamPlayerPhoto.mutateAsync({
            athleteId: viewingRosterEntry.athleteId,
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
      if (!viewingRosterEntry.canViewMedical) delete data.medicalInfo;
      // TeamRosterPlayer carries no avatarUrl on web (only the assessment-scoped
      // Player record does), so an untouched field here is unknown, not empty —
      // leaving it out of the write keeps a team-only player's existing photo
      // intact instead of blanking it on every unrelated edit.
      if (!viewingFullPlayer?.avatarUrl && !data.avatarUrl) delete data.avatarUrl;
      await updateRosterPlayer.mutateAsync({ athleteId: viewingRosterEntry.athleteId, form: data });
      setShowEditPlayer(false);
    } catch (err) {
      await alert('Save Error', `Failed to update player: ${err instanceof Error ? err.message : ''}`);
    }
  };

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

  // Dummy players land on both this team's roster and its linked evaluation's,
  // so they stop at whichever is closer to the plan's player cap. A team with
  // no evaluation yet gets one made on the fly, which must fit the evaluation
  // allowance too (a delegated team only counts its own).
  const summaries = tryoutSummariesQuery.data ?? [];
  const linkedSummary = summaries.find((t) => t.teamId === team.id);
  const dummyAssessmentCount = team.managed ? summaries.filter((t) => t.teamId === team.id).length : summaries.length;
  const dummyRoom = Math.min(
    playerRoom(effectiveTier, playerCount),
    linkedSummary ? playerRoom(effectiveTier, linkedSummary.playerCount ?? 0) : Number.POSITIVE_INFINITY,
  );
  const dummyBlocked = !linkedSummary && assessmentRoom(effectiveTier, dummyAssessmentCount) < 1;
  const dummyMax = Math.min(DUMMY_LIMITS.count.max, dummyRoom);
  const dummyCount = clampOption(dummyPlayerCount, { min: 1, max: Math.max(1, dummyMax) }, 25);
  const dummyNoRoom = dummyMax < 1 || dummyBlocked;

  // Same plan gate as adding a player by hand — a spreadsheet is a faster way
  // onto the roster, not a way around the cap. The roster's cap is the owning
  // club's for a delegated team (effectiveTier), as for every other add path.
  const openImportPlayers = () => {
    if (isAtPlayerLimit(effectiveTier, playerCount)) {
      setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'));
      return;
    }
    setShowImportPlayers(true);
  };

  const addPickedPlayers = async () => {
    const picked = candidates.filter((c) => pickedAthletes.has(c.athleteId));
    if (picked.length === 0) return;
    // The roster lives on the owning club's account for a delegated team, so its
    // player cap is the club's, not the delegate's own — same reasoning as
    // effectiveTier everywhere else on this screen.
    if (isAtPlayerLimit(effectiveTier, playerCount + picked.length - 1)) {
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
      offerAddToUpcomingEvents(picked.map((c) => c.athleteId));

      // Same rule as the manual add: landing on the roster is what earns the
      // portal invite, so it goes out here rather than waiting for someone to
      // press Send Invites afterwards. Only a bounce or a player with no
      // address on file is worth a dialog — a confirmation after every add is
      // noise that trains people to dismiss without reading.
      try {
        const result = await sendInvites.mutateAsync({ athleteIds: picked.map((c) => c.athleteId) });
        if (inviteNeedsAttention(result)) await reportInviteResult(result);
      } catch (e) {
        await alert(
          'Invites Not Sent',
          `The players were added to the roster, but their portal invites could not be sent: ${
            e instanceof Error ? e.message : 'Unknown error'
          }`,
        );
      }
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

  const exitRosterSelect = () => {
    setRosterSelectMode(false);
    setSelectedRosterIds(new Set());
  };

  const toggleRosterSelected = (athleteId: string) =>
    setSelectedRosterIds((prev) => {
      const next = new Set(prev);
      if (next.has(athleteId)) next.delete(athleteId);
      else next.add(athleteId);
      return next;
    });

  // With no search running, "all" means the whole team — the ids query already
  // holds every athlete, while the list itself only ever holds the pages pulled
  // so far. With a search running it means the matches on screen.
  const selectableRosterIds =
    debouncedPlayerSearch.trim() === ''
      ? (rosterAthleteIdsQuery.data ?? listedPlayers.map((p) => p.athleteId))
      : listedPlayers.map((p) => p.athleteId);
  const allRosterSelected =
    selectableRosterIds.length > 0 && selectableRosterIds.every((athleteId) => selectedRosterIds.has(athleteId));

  const confirmRemoveSelected = async () => {
    const ids = [...selectedRosterIds];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: 'Remove Players',
      message: `${ids.length} player${ids.length === 1 ? '' : 's'} will be removed from ${team.name}.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setRemoveProgress({ done: 0, total: ids.length });
    try {
      await removeRosterPlayers.mutateAsync(ids);
      exitRosterSelect();
    } catch (e) {
      await alert('Remove Failed', e instanceof Error ? e.message : 'Could not remove the selected players.');
    } finally {
      setRemoveProgress(null);
    }
  };

  /** Export the whole roster (not just the loaded page) as Excel or PDF. */
  const exportTeam = async (format: 'xlsx' | 'pdf') => {
    if (exportingTeam) return;
    setExportingTeam(format);
    try {
      const players = await getDataSource().listTeamRoster(team.id);
      if (players.length === 0) {
        await alert('Nothing to Export', 'This team has no players yet.');
        return;
      }
      await exportTeamRosterData({ name: team.name, season: team.season }, players, format);
    } catch (e) {
      await alert('Export Failed', e instanceof Error ? e.message : 'Could not export the team.');
    } finally {
      setExportingTeam(null);
    }
  };

  /**
   * Report an invite send. Partial success is the normal outcome — see
   * TeamInviteResult — so this always names what went out, what bounced, and who
   * had no address on file, rather than collapsing to "sent" or "failed".
   */
  const reportInviteResult = async (result: TeamInviteResult) => {
    const { title, message } = describeInviteResult(result);
    await alert(title, message);
  };

  const sendRosterInvites = async () => {
    const ok = await confirm({
      title: 'Send Invites',
      message:
        `Invite all ${playerCount} ${playerCount === 1 ? 'player' : 'players'} on ${team.name} to the portal? ` +
        'Each invite goes to the player\u2019s own email and their guardian\u2019s, wherever those are on file.',
      confirmLabel: 'Send',
    });
    if (!ok) return;
    try {
      await reportInviteResult(await sendInvites.mutateAsync({}));
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not send invites.');
    }
  };

  const sendPlayerInvite = async (athleteId: string) => {
    setInvitingAthleteId(athleteId);
    try {
      await reportInviteResult(await sendInvites.mutateAsync({ athleteIds: [athleteId] }));
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
  // The hub leads with the next three; "View All" opens every upcoming event.
  const shownEvents = showAllEvents ? scheduleEvents : scheduleEvents.slice(0, 3);
  const selectedEvent = shownEvents.find((e) => e.id === selectedEventId) ?? shownEvents[0];
  const hasHiddenEvents = scheduleEvents.length > 3;
  const evaluatorCount = new Set(
    linkedTryouts.flatMap((t) =>
      (t.assessors ?? [])
        .filter((a) => a.status !== 'declined')
        .map((a) => (a.userId ?? a.email ?? '').toLowerCase())
        .filter(Boolean),
    ),
  ).size;

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
    const invited = rosterAthleteIdsQuery.isSuccess
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
        const msg = 'The start time you picked has already passed. Choose a date and start time that are later than now.';
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

  const handleArchive = async () => {
    const ok = await confirm({
      title: 'Archive Team',
      message:
        'Archive this team? It moves to the Archived page with its roster and schedule, and you can restore it any time your plan has room.',
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    try {
      await archiveTeam.mutateAsync(team.id);
      router.replace('/teams');
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not archive this team.');
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
      <TeamHubHeader
        name={team.name}
        subtitle={team.season || undefined}
        logoUrl={team.logoUrl}
        backHref="/teams"
        extra={team.managed ? <Badge label="Managed" variant="info" /> : undefined}
        chatBadge={
          chatUnread > 0 ? (
            <span
              className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white"
              style={{ backgroundColor: colors.primary }}
            >
              {chatUnread > 99 ? '99+' : chatUnread}
            </span>
          ) : undefined
        }
        onChat={() => router.push(`/team/${id}/chat`)}
        onEdit={canEditTeam ? startEdit : undefined}
      />

      <TeamHubTabs
        tabs={[
          { key: 'schedule', label: 'Schedule', icon: 'calendar', badge: upcomingEvents.length },
          { key: 'players', label: 'Players', icon: 'teams', badge: playerCount },
          ...(canViewEvaluations
            ? [
                {
                  key: 'assessments',
                  label: 'Evaluations',
                  icon: 'assessments' as const,
                  badge: tryoutsLoading ? undefined : linkedTryouts.length,
                },
              ]
            : []),
          { key: 'settings', label: 'Options', icon: 'settings' },
        ]}
        activeKey={tab}
        onChange={(k) => {
          if (k !== 'players') exitRosterSelect();
          setTab(k);
        }}
      />

      {tab === 'schedule' ? (
        <PlanGate feature="seasonHub" title="Season Hub" tierOverride={effectiveTier}>
        <div>
          {seasonsQuery.isLoading || seasonQuery.isLoading ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Loading events...
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
              <div>
                <HubSectionLabel
                  icon="calendar"
                  label="Upcoming Events"
                  actionLabel={showAllEvents ? 'Show Less' : hasHiddenEvents ? 'View All' : undefined}
                  onAction={() => setShowAllEvents((v) => !v)}
                />
                {shownEvents.length === 0 ? (
                  <Card className="mb-2 flex flex-col items-center gap-1 py-8 text-center">
                    <span className="font-bold" style={{ color: colors.ink }}>
                      No events yet
                    </span>
                    <span className="max-w-md text-sm" style={{ color: colors.inkMuted }}>
                      Add an event — everyone on the roster is invited and their guardians can RSVP from the portal.
                    </span>
                  </Card>
                ) : (
                  <div className="flex flex-col gap-2">
                    {shownEvents.map((ev) => (
                      <HubEventCard
                        key={ev.id}
                        event={ev}
                        selected={selectedEvent?.id === ev.id}
                        playerCount={playerCount}
                        evaluatorCount={evaluatorCount}
                        onSelect={() => {
                          setSelectedEventId(ev.id);
                          setOpenRsvpEventId(null);
                          setRsvpSearch('');
                        }}
                      />
                    ))}
                  </div>
                )}

                {selectedEvent ? (
                  <div className="mt-3">
                    <AddToCalendar event={selectedEvent} teamName={team?.name} variant="row" />
                  </div>
                ) : null}

                <div className="mt-6">
                  <HubSectionLabel icon="calendar" label="Season Hub" />
                  <button
                    type="button"
                    onClick={() => openEventModal('Event')}
                    className="flex h-[50px] w-full items-center gap-3 rounded-2xl px-3 text-left text-base font-bold text-white shadow-[0_4px_14px_rgba(255,107,43,0.4)] transition-[filter] hover:brightness-110"
                    style={{ backgroundColor: colors.primary }}
                  >
                    <Icon name="calendarPlus" size={22} color="#ffffff" />
                    <span className="flex-1">+ Event</span>
                    <Icon name="chevronRight" size={18} color="#ffffff" strokeWidth={2.5} />
                  </button>
                </div>
              </div>

              {selectedEvent
                ? (() => {
                    const ev = selectedEvent;
                    const rsvp = rsvpSummary(ev);
                    const expanded = openRsvpEventId === ev.id;
                    return (
                      <div>
                        <HubSectionLabel icon="barChart" label="Team Status" />
                        {/* The event lands a round trip or two before its RSVPs do
                            (see getSeason's staged read) — a tally of zeroes in the
                            meantime would read as "nobody answered". */}
                        <div className="mb-3">
                          <TeamStatusTiles counts={rsvp.counts} loading={!!ev.availabilityPending} />
                        </div>

                        <HubRowCard
                          tone="orange"
                          icon="teams"
                          title={expanded ? 'Hide RSVPs' : 'Who’s coming? Set RSVPs'}
                          caption="Get a quick view of your team’s availability"
                          aria-expanded={expanded}
                          onClick={() => {
                            setOpenRsvpEventId(expanded ? null : ev.id);
                            setRsvpSearch('');
                          }}
                          trailing={
                            <Icon
                              name={expanded ? 'chevronUp' : 'chevronRight'}
                              size={16}
                              color={colors.primary}
                              strokeWidth={2.5}
                            />
                          }
                        />

                        <div className="mt-2 flex flex-col gap-2">
                    {expanded ? (
                      <div className="flex flex-col gap-2">
                        {rsvp.rows.length > 8 ? (
                          <Input
                            placeholder="Search players by name"
                            value={rsvpSearch}
                            onChange={(e) => setRsvpSearch(e.target.value)}
                          />
                        ) : null}
                        {/* Scrolls on its own instead of growing the page — a roster in the
                            hundreds used to push the whole page tall enough that scrolling
                            through it left the short left column behind, blank, above the fold. */}
                        <div
                          className="max-h-[60vh] overflow-y-auto overflow-x-hidden rounded-xl border"
                          style={{ borderColor: colors.border }}
                        >
                          {ev.availabilityPending ? (
                            <p className="p-3 text-xs" style={{ color: colors.inkMuted }}>
                              Loading RSVPs...
                            </p>
                          ) : ev.availabilityUnavailable && rsvp.rows.length === 0 ? (
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
                                className="sticky top-0 z-10 px-3 py-2 text-xs"
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

                        </div>

                        <div className="mt-3 flex gap-2">
                          <AddToCalendar event={ev} teamName={team?.name} variant="tile" />
                          <MapLink location={ev.location} label={ev.title} variant="tile" />
                          <HubActionTile icon="edit" label="Edit" onClick={() => openEditEventModal(ev)} />
                          <HubActionTile
                            icon="trash"
                            label="Delete"
                            danger
                            loading={deleteEvent.isPending && deleteEvent.variables === ev.id}
                            onClick={() => confirmDeleteEvent(ev.id, ev.title)}
                          />
                        </div>
                      </div>
                    );
                  })()
                : (
                  // selectedEvent is only undefined when shownEvents is empty
                  // (it falls back to shownEvents[0] otherwise), so this is the
                  // true "no events yet" state — without it the lg:grid-cols-2
                  // track on the left still reserved this column's width, just
                  // with nothing in it, which read as a broken layout on a wide
                  // screen rather than an empty one.
                  <div>
                    <HubSectionLabel icon="barChart" label="Team Status" />
                    <Card className="flex flex-col items-center gap-1 py-8 text-center">
                      <span className="font-bold" style={{ color: colors.ink }}>
                        Nothing to show yet
                      </span>
                      <span className="max-w-md text-sm" style={{ color: colors.inkMuted }}>
                        Add an event and RSVP counts, plus a quick way to set them per player, will show up here.
                      </span>
                    </Card>
                  </div>
                )}
            </div>
          )}
        </div>
        </PlanGate>
      ) : tab === 'players' ? (
        <div>
          {rosterSelectMode ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button label="← Back" variant="ghost" size="sm" onClick={exitRosterSelect} disabled={removeRosterPlayers.isPending} />
              <Button
                label={allRosterSelected ? 'Deselect All' : 'Select All'}
                variant="secondary"
                size="sm"
                disabled={removeRosterPlayers.isPending}
                onClick={() => setSelectedRosterIds(allRosterSelected ? new Set() : new Set(selectableRosterIds))}
              />
              <Button
                label={`Delete Selected${selectedRosterIds.size ? ` (${selectedRosterIds.size})` : ''}`}
                variant="danger"
                size="sm"
                disabled={selectedRosterIds.size === 0}
                loading={removeRosterPlayers.isPending}
                onClick={confirmRemoveSelected}
              />
            </div>
          ) : (
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
            <Button
              label="Import from File"
              size="sm"
              variant="secondary"
              onClick={() => openImportPlayers()}
            />
            {playerCount > 0 ? (
              <Button
                label="Select"
                size="sm"
                variant="secondary"
                // "Select all" targets the paginated list (see
                // selectableRosterIds below), so entering select mode drops
                // back to that order rather than leaving it out of step with
                // whatever's actually on screen under a name/age sort.
                onClick={() => {
                  setRosterSort('recent');
                  setRosterSelectMode(true);
                }}
              />
            ) : null}
            {canManageTeam && playerCount > 0 ? (
              <Button
                label="Send Invites"
                size="sm"
                variant="secondary"
                loading={sendInvites.isPending && invitingAthleteId === null}
                onClick={sendRosterInvites}
              />
            ) : null}
          </div>
          )}
          {playerCount > 0 ? (
            <Input
              containerClassName="mb-3"
              placeholder="Search players by name or jersey #"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
            />
          ) : null}
          {playerCount > 0 && !rosterSelectMode ? (
            <div className="mb-3 flex flex-wrap gap-2">
              <Chip label="Recent" active={rosterSort === 'recent'} onClick={() => setRosterSort('recent')} />
              <Chip label="A–Z" active={rosterSort === 'name'} onClick={() => setRosterSort('name')} />
              <Chip label="Age" active={rosterSort === 'age'} onClick={() => setRosterSort('age')} />
            </div>
          ) : null}
          {(rosterSort === 'recent' ? rosterPages.isLoading : fullRosterQuery.isLoading) ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Loading roster...
            </p>
          ) : (rosterSort === 'recent' ? rosterPages.isError : fullRosterQuery.isError) ? (
            // Distinct from "No players yet": an errored read rendered as a
            // genuinely empty roster reads as "this team has no players" when
            // it may well have hundreds.
            <Card className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="font-bold" style={{ color: colors.warning }}>
                Couldn&apos;t load the roster
              </span>
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                This team&apos;s players are still on the roster — reload to try again.
              </span>
              <Button
                label="Retry"
                variant="secondary"
                size="sm"
                onClick={() => (rosterSort === 'recent' ? rosterPages.refetch() : fullRosterQuery.refetch())}
              />
            </Card>
          ) : displayedPlayers.length === 0 && !playerSearch.trim() ? (
            <Card className="flex flex-col items-center gap-1 py-8 text-center">
              <span className="font-bold" style={{ color: colors.ink }}>
                No players yet
              </span>
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                Pull players in from any evaluation roster to build this team.
              </span>
            </Card>
          ) : displayedPlayers.length === 0 ? (
            <Card className="flex flex-col items-center gap-1 py-8 text-center">
              <span className="font-bold" style={{ color: colors.ink }}>
                No players match &quot;{playerSearch}&quot;.
              </span>
              <Button label="Clear search" variant="ghost" size="sm" onClick={() => setPlayerSearch('')} />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {displayedPlayers.map((p) => (
                <Card
                  key={p.id}
                  className="flex items-center gap-3"
                  style={rosterSelectMode && selectedRosterIds.has(p.athleteId) ? { borderColor: colors.primary } : undefined}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (rosterSelectMode) {
                        toggleRosterSelected(p.athleteId);
                        return;
                      }
                      setShowEditPlayer(false);
                      setViewPlayerId(p.athleteId);
                    }}
                    aria-pressed={rosterSelectMode ? selectedRosterIds.has(p.athleteId) : undefined}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    {rosterSelectMode ? (
                      // An indicator, not a nested control: the whole row toggles.
                      <span
                        aria-hidden
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-xs font-bold text-white"
                        style={{
                          borderColor: selectedRosterIds.has(p.athleteId) ? colors.primary : colors.border,
                          backgroundColor: selectedRosterIds.has(p.athleteId) ? colors.primary : 'transparent',
                        }}
                      >
                        {selectedRosterIds.has(p.athleteId) ? '✓' : ''}
                      </span>
                    ) : null}
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
                  {rosterSelectMode ? null : (
                    <Button
                      label="Remove"
                      size="sm"
                      variant="ghost"
                      loading={removeRosterPlayer.isPending && removeRosterPlayer.variables === p.athleteId}
                      onClick={() => confirmRemovePlayer(p.athleteId, `${p.first} ${p.last}`)}
                    />
                  )}
                </Card>
              ))}
            </div>
          )}
          {rosterSort === 'recent' && rosterPages.hasNextPage ? (
            <div className="mt-3 flex justify-center">
              <Button
                label={`Load ${TEAM_ROSTER_PAGE} more players`}
                variant="secondary"
                loading={rosterPages.isFetchingNextPage}
                onClick={() => rosterPages.fetchNextPage()}
              />
            </div>
          ) : null}
        </div>
      ) : tab === 'assessments' && canViewEvaluations ? (
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              label="Create"
              size="sm"
              onClick={() => router.push(`/assessment/new?teamId=${team.id}`)}
              onMouseEnter={warmNewAssessment}
              onFocus={warmNewAssessment}
              onTouchStart={warmNewAssessment}
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
                  className="flex items-center gap-3"
                  onClick={() => router.push(`/assessment/${t.id}/roster`)}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: 'rgba(255,107,43,0.12)' }}
                  >
                    <Icon name="assessments" size={20} color={colors.primary} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-bold" style={{ color: colors.ink }}>
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
          <TeamManagersCard teamId={team.id} teamName={team.name} />
          <ImpersonationTeamPanel teamId={team.id} />

          <Card className="flex flex-col items-start gap-2">
            <SectionLabel>Export Team</SectionLabel>
            <p className="text-xs" style={{ color: colors.inkMuted }}>
              Download the full roster with jersey, position, year of birth, and player and guardian contact
              details. Medical information is not included.
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              <Button
                label="Excel"
                size="sm"
                variant="secondary"
                loading={exportingTeam === 'xlsx'}
                disabled={exportingTeam !== null}
                onClick={() => exportTeam('xlsx')}
              />
              <Button
                label="PDF"
                size="sm"
                variant="secondary"
                loading={exportingTeam === 'pdf'}
                disabled={exportingTeam !== null}
                onClick={() => exportTeam('pdf')}
              />
            </div>
          </Card>

          {canViewEvaluations ? (
            <Card className="flex flex-col items-start gap-3 md:col-span-2">
              <div className="flex flex-col gap-1">
                <SectionLabel>Player Selection Letters</SectionLabel>
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  The Offer Letter (made the team) and the Roster Decision Letter (not selected). Write and edit
                  them here.
                </p>
              </div>
              <div className="w-full">
                <LetterTemplatesManager />
              </div>
              <div className="flex flex-col gap-2">
                <SectionLabel>Send letters</SectionLabel>
                {linkedTryouts.length === 0 ? (
                  <p className="text-xs" style={{ color: colors.inkFaint }}>
                    Sending is done from an evaluation. No evaluations are linked to this team yet — create or
                    attach one on the Evaluations tab.
                  </p>
                ) : (
                  <>
                    <p className="text-xs" style={{ color: colors.inkMuted }}>
                      Choose the players and send from the evaluation:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {linkedTryouts.map((t) => (
                        <Button
                          key={t.id}
                          label={t.name}
                          size="sm"
                          variant="secondary"
                          onClick={() => router.push(`/assessment/${t.id}/letters`)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Card>
          ) : null}

          {showDummyTools ? (
            <Card className="flex flex-col items-start gap-2">
              <SectionLabel>Dummy Data</SectionLabel>
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                Add a batch of realistic dummy players straight to this team&apos;s roster.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  label="Add Dummy Players"
                  size="sm"
                  loading={preparingDummyTryout}
                  onClick={async () => {
                    setPreparingDummyTryout(true);
                    try {
                      await ensureDummyTryoutId();
                      setShowTestGen(true);
                    } catch (e) {
                      await alert('Error', e instanceof Error ? e.message : 'Failed to prepare an evaluation.');
                    } finally {
                      setPreparingDummyTryout(false);
                    }
                  }}
                />
                {dummyTryoutId ? (
                  <Button
                    label="Clear Dummy Data"
                    size="sm"
                    variant="ghost"
                    loading={clearTest.isPending}
                    onClick={async () => {
                      try {
                        const res = await clearTest.mutateAsync();
                        await alert('Cleared', `Removed ${res.removed} generated record${res.removed === 1 ? '' : 's'}.`);
                      } catch (e) {
                        await alert('Error', e instanceof Error ? e.message : 'Failed to clear dummy data.');
                      }
                    }}
                  />
                ) : null}
              </div>
            </Card>
          ) : null}

          {/* A delegated manager runs the team but doesn't own it — deleting the
              club's team isn't theirs to do, and the teams RLS grants them
              update but not delete, so the button would only ever fail. */}
          {team.managed ? null : (
            <Card className="flex flex-col items-start gap-2">
              <SectionLabel className="!text-[color:var(--c-danger)]">Danger Zone</SectionLabel>
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                Archiving hides a team and keeps everything so you can restore it later. Deleting removes its
                roster, schedule, and links to evaluations for good.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button label="Archive Team" variant="secondary" size="sm" onClick={handleArchive} loading={archiveTeam.isPending} />
                <Button label="Delete Team" variant="danger" size="sm" onClick={handleDelete} loading={deleteTeam.isPending} />
              </div>
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

      <DeleteProgressModal visible={removeRosterPlayers.isPending} progress={removeProgress} />

      <ImportPlayersModal
        visible={showImportPlayers}
        onClose={() => {
          setShowImportPlayers(false);
          if (pendingImportAthleteIds.length > 0) {
            offerAddToUpcomingEvents(pendingImportAthleteIds);
            setPendingImportAthleteIds([]);
          }
        }}
        target={team.name}
        atLimit={isAtPlayerLimit(effectiveTier, playerCount)}
        onLimitReached={() => setLimitMsg(buildLimitReachedMessage(effectiveTier, 'players', 'players'))}
        onImport={async (rows, onProgress) => {
          // A spreadsheet is a faster way onto the roster, not a way around the
          // plan's player cap: players already here are set aside first (they add
          // nobody, so they shouldn't spend the cap), then what fits goes in and
          // the rest is listed as not added.
          const { fresh, duplicates } = dropExistingPlayers(rows, listedPlayers);
          const capped = capImportRows(fresh, playerRoom(effectiveTier, playerCount));
          const allowed = capped.allowed;
          const skipped = [...duplicates, ...capped.skipped];
          if (allowed.length === 0) {
            return withSkippedRows({ added: 0, failed: [], athleteIds: [], participantIds: [] }, skipped);
          }
          const result = withSkippedRows(await importPlayers.mutateAsync({ rows: allowed, onProgress }), skipped);
          // The mutation only marks the roster stale; on a capped plan, wait for
          // the fresh count so the "Import more" check that follows never runs
          // against the old one. Unlimited plans have no such check, so they
          // don't wait on a full roster re-read (a thousand players is seconds).
          if (Number.isFinite(playerRoom(effectiveTier, 0))) {
            await rosterAthleteIdsQuery.refetch({ cancelRefetch: false });
          }
          // Same rule as every other way onto this roster: the import is what
          // earns the portal invite. Scoped to the athletes the import actually
          // landed, so a re-import doesn't re-mail the players already there.
          //
          // No dialog on the way out, unlike the other add paths: the modal
          // shows its own per-row import summary the moment this returns, and a
          // second dialog in front of it — "no email on file for these four" —
          // buries the one the coach is waiting for. A player the invite
          // couldn't reach already reads as "No invite" on the roster.
          if (result.athleteIds?.length) {
            try {
              await sendInvites.mutateAsync({ athleteIds: result.athleteIds });
            } catch (e) {
              console.warn('Portal invites failed after a roster import:', e);
            }
            // Held until the modal actually closes (its own summary screen is
            // still ahead of this) and merged across "Import more players"
            // rounds — see pendingImportAthleteIds above.
            setPendingImportAthleteIds((prev) => [...prev, ...(result.athleteIds ?? [])]);
          }
          return result;
        }}
      />

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
          loading={addManualPlayer.isPending || uploadTeamPlayerPhoto.isPending || sendInvites.isPending}
          onSubmit={submitManualPlayer}
          showInvite
          showFamilyContacts={canEditTeam || canAssess}
          submitLabel="Save Player & Send Invite"
        />
      </Modal>

      <Modal
        visible={pendingEventInviteAthleteIds != null}
        title={pendingEventInviteAthleteIds && pendingEventInviteAthleteIds.length > 1 ? 'Add to Upcoming Events?' : 'Add to Upcoming Event?'}
        onClose={() => {
          if (addAthletesToEvents.isPending) return;
          setPendingEventInviteAthleteIds(null);
        }}
        footer={
          <ModalFooter>
            <Button
              label={
                selectedInviteEventIds.size === 0
                  ? 'Select events to add to'
                  : `Add to ${selectedInviteEventIds.size} ${selectedInviteEventIds.size === 1 ? 'event' : 'events'}`
              }
              disabled={selectedInviteEventIds.size === 0}
              loading={addAthletesToEvents.isPending}
              onClick={async () => {
                if (!pendingEventInviteAthleteIds || !teamSeasonId) return;
                try {
                  await addAthletesToEvents.mutateAsync({
                    eventIds: [...selectedInviteEventIds],
                    athleteIds: pendingEventInviteAthleteIds,
                  });
                } catch (e) {
                  await alert('Error', e instanceof Error ? e.message : 'Could not add this player to those events.');
                  return;
                }
                setPendingEventInviteAthleteIds(null);
              }}
            />
            <Button
              label="Not Now"
              variant="ghost"
              disabled={addAthletesToEvents.isPending}
              onClick={() => setPendingEventInviteAthleteIds(null)}
            />
          </ModalFooter>
        }
      >
        <p className="mb-3 text-sm" style={{ color: colors.inkMuted }}>
          {pendingEventInviteAthleteIds && pendingEventInviteAthleteIds.length > 1
            ? `These ${pendingEventInviteAthleteIds.length} players were just added to the team, which already has ${upcomingEvents.length === 1 ? 'an upcoming event' : `${upcomingEvents.length} upcoming events`}. Add them to:`
            : `This player was just added to the team, which already has ${upcomingEvents.length === 1 ? 'an upcoming event' : `${upcomingEvents.length} upcoming events`}. Add them to:`}
        </p>
        {upcomingEvents.map((ev) => {
          const selected = selectedInviteEventIds.has(ev.id);
          return (
            <button
              type="button"
              key={ev.id}
              onClick={() =>
                setSelectedInviteEventIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(ev.id)) next.delete(ev.id);
                  else next.add(ev.id);
                  return next;
                })
              }
              className="mb-2 flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left"
              style={{
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? 'rgba(255,107,43,0.12)' : 'transparent',
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-bold" style={{ color: colors.ink }}>
                  {ev.title}
                </span>
                <span className="mt-0.5 block text-xs" style={{ color: colors.inkMuted }}>
                  {ev.date}
                  {ev.startTime ? ` · ${ev.startTime}` : ''}
                </span>
              </span>
              {selected ? <Badge label="Selected" variant="brand" /> : null}
            </button>
          );
        })}
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
              render={({ field }) => (
                <div>
                  <Input
                    label="Location"
                    placeholder="Venue and street address"
                    {...field}
                    value={field.value ?? ''}
                  />
                  <MapLocationHint location={field.value} />
                </div>
              )}
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

      <Modal
        visible={showTestGen}
        title="Add Dummy Players"
        onClose={() => setShowTestGen(false)}
        footer={
          <ModalFooter>
            {genTest.isPending && dummyProgress && dummyProgress.total > 0 ? (
              <div className="flex w-full flex-col gap-1">
                <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: colors.tile }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(4, Math.round((dummyProgress.done / dummyProgress.total) * 100)))}%`,
                      backgroundColor: colors.primary,
                    }}
                  />
                </div>
                <p className="text-center text-xs" style={{ color: colors.inkMuted }}>
                  Adding {dummyProgress.done} of {dummyProgress.total} players...
                </p>
              </div>
            ) : null}
            <Button
              label={`Add ${dummyCount} Players`}
              loading={genTest.isPending || addRosterPlayers.isPending}
              disabled={dummyNoRoom}
              onClick={async () => {
                setDummyProgress(null);
                try {
                  if (dummyNoRoom) return;
                  const tryoutIdForRoster = await ensureDummyTryoutId();
                  const res = await genTest.mutateAsync({
                    target: 'roster',
                    count: dummyCount,
                    withScores: false,
                    sessionsPerPlayer: 1,
                  });
                  // generateTestData only writes onto the evaluation's own roster —
                  // this screen is the team's, so the same athletes still have to
                  // land on team_roster before the Players tab will show them.
                  if (res.athleteIds?.length) {
                    await addRosterPlayers.mutateAsync(
                      res.athleteIds.map((athleteId) => ({ athleteId, sourceTryoutId: tryoutIdForRoster })),
                    );
                  }
                  await alert('Dummy players added', `Added ${res.players} players to the roster.`);
                } catch (e) {
                  await alert('Error', e instanceof Error ? e.message : 'Failed to add dummy players.');
                } finally {
                  setShowTestGen(false);
                  setDummyProgress(null);
                }
              }}
            />
          </ModalFooter>
        }
      >
        <Input
          label={`How many players (1–${Math.max(1, dummyMax)})`}
          value={dummyPlayerCount}
          onChange={(e) => setDummyPlayerCount(e.target.value)}
          inputMode="numeric"
          placeholder="25"
        />
        <p className="mt-3 text-xs" style={{ color: dummyNoRoom ? colors.danger : colors.inkMuted }}>
          {dummyBlocked
            ? "Your plan's evaluation limit is reached, so this team can't get the evaluation dummy players are added through."
            : dummyMax < 1
              ? "This team is already at your plan's player limit, so no more dummy players can be added."
              : Number.isFinite(dummyRoom)
                ? `Dummy players stay within your plan: up to ${dummyMax} can be added here.`
                : ''}
        </p>
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
        onClose={() => {
          setViewPlayerId(null);
          setShowEditPlayer(false);
        }}
        hideDefaultFooter
      >
        {!viewingRosterEntry ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            This player may have been removed from the team.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {canManageTeam ? (
              <div className="flex justify-end">
                <Button label="Edit" variant="secondary" size="sm" onClick={() => setShowEditPlayer(true)} />
              </div>
            ) : null}
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

            {viewingRosterEntry.canViewMedical ? (
              <Card className="flex flex-col gap-2">
                <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                  Additional Info
                </span>
                <PlayerDetailRow label="Medical" value={viewingRosterEntry.medicalInfo} colors={colors} />
              </Card>
            ) : null}

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

      <Modal
        visible={showEditPlayer && !!viewingRosterEntry}
        title="Edit Player"
        size="lg"
        onClose={() => {
          if (updateRosterPlayer.isPending || uploadTeamPlayerPhoto.isPending) return;
          setShowEditPlayer(false);
        }}
        hideDefaultFooter
      >
        <AddPlayerForm
          defaultValues={editPlayerDefaultValues}
          loading={updateRosterPlayer.isPending || uploadTeamPlayerPhoto.isPending}
          showFamilyContacts={false}
          onSubmit={submitEditPlayer}
        />
      </Modal>
    </div>
  );
}
