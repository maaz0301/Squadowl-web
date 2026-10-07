'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader, Tabs } from '@/components/ui';
import {
  ArchiveBadges,
  FounderArchiveToggle,
  FounderDetails,
  FounderNotAvailable,
  isHiddenByDefault,
  useShowArchived,
} from '@/components/founder/FounderUi';
import {
  ATHLETE_FIELDS,
  FounderActionRow,
  SEASON_EVENT_KIND_OPTIONS,
  TryoutStateButtons,
  UpdatedBadge,
  useFounderAction,
  useFounderEditor,
  type FounderEditConfig,
  type FounderField,
} from '@/components/founder/FounderEditor';
import { formatDate } from '@/components/founder/labels';
import * as writes from '@/data/founder/founderWrites';
import type { FounderTeamDetail } from '@/data/founder/types';
import { useFounderTeamQuery, useIsFounderQuery } from '@/features/founderQueries';

type Edit = (config: FounderEditConfig) => void;

/**
 * One team inside an organization, from the founder console: the full roster,
 * staff, seasons with their schedules, and evaluations — all editable, without
 * switching the app into the organization. Writes go through
 * data/founder/founderWrites.ts.
 */
export default function FounderTeamPage({ params }: { params: Promise<{ id: string; teamId: string }> }) {
  const { id, teamId } = use(params);
  const founderQuery = useIsFounderQuery();
  const query = useFounderTeamQuery(teamId, founderQuery.data === true);
  const backHref = `/founder/organizations/${id}`;

  if (founderQuery.isLoading || (founderQuery.data === true && query.isLoading)) {
    return <LoadingState message="Loading team..." />;
  }

  if (founderQuery.data !== true) return <FounderNotAvailable />;

  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="Team" showBack backHref={backHref} />
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Could not load this team.'}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  return <TeamDetail team={query.data} orgId={id} backHref={backHref} />;
}

function TeamDetail({ team, orgId, backHref }: { team: FounderTeamDetail; orgId: string; backHref: string }) {
  const colors = useThemeColors();
  const [tab, setTab] = useState('players');
  const showArchived = useShowArchived();
  const { edit, modal } = useFounderEditor();
  const action = useFounderAction();
  const seasons = showArchived ? team.seasons : team.seasons.filter((s) => !s.archived);
  const evaluations = showArchived ? team.evaluations : team.evaluations.filter((e) => !isHiddenByDefault(e));
  const hiddenCount = team.seasons.length - seasons.length + (team.evaluations.length - evaluations.length);

  const tabs = [
    { key: 'players', label: `Players (${team.players.length})` },
    { key: 'seasons', label: `Seasons (${seasons.length})` },
    { key: 'evaluations', label: `Evaluations (${evaluations.length})` },
    { key: 'staff', label: `Staff (${team.staff.length})` },
  ];

  return (
    <>
      <PageHeader
        title={team.name || 'Untitled team'}
        subtitle={team.accountName ? `${team.accountName} · Founder Console` : 'Founder Console'}
        showBack
        backHref={backHref}
      />

      <Card className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <UpdatedBadge id={team.id} />
          {team.archived ? <Badge label="Archived" /> : <Badge label="Active" variant="success" />}
          {team.brandColor ? (
            <span
              aria-label={`Team colour ${team.brandColor}`}
              title={team.brandColor}
              className="inline-block h-5 w-5 rounded-full border"
              style={{ backgroundColor: team.brandColor, borderColor: colors.border }}
            />
          ) : null}
          {team.seasonLabel ? <Badge label={team.seasonLabel} variant="brand" /> : null}
          <Badge
            label={
              team.collectsFees
                ? `Collecting fees${team.registrationFeeCents ? ` · $${(team.registrationFeeCents / 100).toFixed(2)} per player` : ''}`
                : 'No fees'
            }
            variant={team.collectsFees ? 'info' : 'default'}
          />
          <span className="text-sm" style={{ color: colors.inkMuted }}>
            Created {formatDate(team.createdAt)}
          </span>
        </div>
        <FounderActionRow>
          <Button
            label="Edit Team"
            size="sm"
            variant="secondary"
            onClick={() =>
              edit({
                title: 'Edit Team',
                fields: [
                  { key: 'name', label: 'Team name' },
                  { key: 'seasonLabel', label: 'Season label' },
                  { key: 'brandColor', label: 'Team colour', type: 'color' },
                  {
                    key: 'collectsFees',
                    label: 'Are you collecting fees?',
                    type: 'choice',
                    options: [
                      { value: 'no', label: 'No' },
                      { value: 'yes', label: 'Yes' },
                    ],
                  },
                  {
                    key: 'fee',
                    label: 'Fee per player (CAD)',
                    type: 'number',
                    placeholder: '0.00',
                    hint: "Each player's guardian is asked to pay this, plus SquadOwl's 0.5% platform fee, from their portal. The organization needs a plan with payments and a connected Stripe account to receive it.",
                    showWhen: (v) => v.collectsFees === 'yes',
                  },
                ],
                initial: {
                  name: team.name,
                  seasonLabel: team.seasonLabel,
                  brandColor: team.brandColor,
                  collectsFees: team.collectsFees ? 'yes' : 'no',
                  fee: team.registrationFeeCents ? (team.registrationFeeCents / 100).toFixed(2) : '',
                },
                successMessage: 'Team updated.',
                updatedId: team.id,
                onSave: (v) => writes.updateTeam(orgId, team.id, v),
              })
            }
          />
          <Button
            label={team.archived ? 'Unarchive Team' : 'Archive Team'}
            size="sm"
            variant="ghost"
            disabled={action.pending}
            onClick={() =>
              action.run({
                write: () => writes.setTeamArchived(orgId, team.id, !team.archived, team.name),
                success: team.archived ? 'Team unarchived.' : 'Team archived.',
                updatedId: team.id,
                confirmTitle: team.archived ? 'Unarchive Team' : 'Archive Team',
                confirmMessage: team.archived
                  ? `Bring ${team.name} back into the organization's team list?`
                  : `Hide ${team.name} from the organization's team list? Nothing is deleted.`,
                confirmLabel: team.archived ? 'Unarchive' : 'Archive',
              })
            }
          />
        </FounderActionRow>
      </Card>

      <Tabs tabs={tabs} activeKey={tab} onChange={setTab} className="mb-2" />
      <div className="mb-4">
        <FounderArchiveToggle hiddenCount={hiddenCount} />
      </div>

      {tab === 'players' ? <PlayersTab team={team} orgId={orgId} edit={edit} /> : null}
      {tab === 'seasons' ? <SeasonsTab seasons={seasons} edit={edit} orgId={orgId} /> : null}
      {tab === 'evaluations' ? <EvaluationsTab evaluations={evaluations} orgId={orgId} /> : null}
      {tab === 'staff' ? <StaffTab team={team} /> : null}

      {modal}
    </>
  );
}

const ROSTER_FIELDS: FounderField[] = [
  { key: 'jersey', label: 'Jersey', section: 'On this team' },
  { key: 'position', label: 'Position' },
];

function PlayersTab({ team, orgId, edit }: { team: FounderTeamDetail; orgId: string; edit: Edit }) {
  const colors = useThemeColors();
  const router = useRouter();
  const action = useFounderAction();
  const [search, setSearch] = useState('');

  const term = search.trim().toLowerCase();
  const players = term
    ? team.players.filter((p) =>
        [p.firstName, p.lastName, p.playerEmail, p.guardianName, p.guardianEmail, p.jersey]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term)),
      )
    : team.players;

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          containerClassName="w-full md:max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players, guardians, emails..."
        />
        <Button
          label="+ Add Player"
          size="sm"
          onClick={() =>
            edit({
              title: 'Add Player to Team',
              fields: [...ATHLETE_FIELDS, ...ROSTER_FIELDS],
              initial: {},
              saveLabel: 'Add Player',
              successMessage: 'Player added.',
              onSave: (v) => writes.addPlayerToTeam(orgId, team.id, v),
            })
          }
        />
      </div>
      {team.players.length === 0 ? (
        <EmptyState title="No players" message="Nobody is on this team's roster." />
      ) : players.length === 0 ? (
        <EmptyState title="No matches" message="Try a different search." />
      ) : null}
      {players.map((p) => {
        const name = `${p.firstName} ${p.lastName}`.trim() || 'Unnamed player';
        return (
          <Card key={p.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold break-words" style={{ color: colors.ink }}>
                {p.jersey ? <span style={{ color: colors.primary }}>#{p.jersey} </span> : null}
                {name}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <UpdatedBadge id={p.id} />
                {p.position ? <Badge label={p.position} /> : null}
                {p.yearOfBirth ? <Badge label={`Born ${p.yearOfBirth}`} /> : null}
              </div>
            </div>
            <FounderDetails
              rows={[
                ['Player email', p.playerEmail],
                ['Guardian', p.guardianName],
                ['Guardian email', p.guardianEmail],
                ['Guardian phone', p.guardianPhone],
                ['Added', formatDate(p.addedAt)],
              ]}
            />
            <FounderActionRow>
              {p.athleteId ? (
                <Button
                  label="Profile"
                  size="sm"
                  variant="secondary"
                  onClick={() => router.push(`/founder/organizations/${orgId}/players/${p.athleteId}`)}
                />
              ) : null}
              <Button
                label="Edit"
                size="sm"
                variant="ghost"
                onClick={() =>
                  edit({
                    title: `Edit ${name}`,
                    fields: [...(p.athleteId ? ATHLETE_FIELDS : []), ...ROSTER_FIELDS],
                    initial: p,
                    successMessage: 'Player updated.',
                    updatedId: p.id,
                    onSave: async (v) => {
                      if (p.athleteId) await writes.updateAthlete(orgId, p.athleteId, v);
                      await writes.updateTeamRosterEntry(orgId, p.id, v, name);
                    },
                  })
                }
              />
              <Button
                label="Remove from Team"
                size="sm"
                variant="ghost"
                disabled={action.pending}
                onClick={() =>
                  action.run({
                    write: () => writes.removeTeamRosterEntry(orgId, p.id, name),
                    success: `${name} removed from the team.`,
                    confirmTitle: 'Remove from Team',
                    confirmMessage: `Take ${name} off ${team.name}? The player and their evaluation history are kept.`,
                    confirmLabel: 'Remove',
                    destructive: true,
                  })
                }
              />
            </FounderActionRow>
          </Card>
        );
      })}
    </div>
  );
}

const EVENT_FIELDS: FounderField[] = [
  { key: 'kind', label: 'Type', type: 'choice', options: SEASON_EVENT_KIND_OPTIONS },
  { key: 'title', label: 'Title' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'startTime', label: 'Start time', type: 'time' },
  { key: 'location', label: 'Location' },
];

function SeasonsTab({ seasons, edit, orgId }: { seasons: FounderTeamDetail['seasons']; edit: Edit; orgId: string }) {
  const colors = useThemeColors();
  const action = useFounderAction();
  if (seasons.length === 0) {
    return <EmptyState title="No seasons" message="This team has no seasons." />;
  }
  return (
    <div className="flex flex-col gap-3">
      {seasons.map((s) => (
        <Card key={s.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold break-words" style={{ color: colors.ink }}>
              {s.name || 'Untitled season'}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <UpdatedBadge id={s.id} />
              {s.archived ? <Badge label="Archived" /> : null}
              <Badge label={`${s.rosterCount} players`} />
              <Badge label={`${s.events.length} events`} />
            </div>
          </div>
          <FounderDetails
            rows={[
              ['Year', s.year],
              ['Division', s.division],
              ['Coach', s.coach],
            ]}
          />
          <FounderActionRow>
            <Button
              label="Edit Season"
              size="sm"
              variant="secondary"
              onClick={() =>
                edit({
                  title: 'Edit Season',
                  fields: [
                    { key: 'name', label: 'Season name' },
                    { key: 'year', label: 'Year' },
                    { key: 'division', label: 'Division' },
                    { key: 'coach', label: 'Coach' },
                  ],
                  initial: s,
                  successMessage: 'Season updated.',
                  updatedId: s.id,
                  onSave: (v) => writes.updateSeason(orgId, s.id, v),
                })
              }
            />
            <Button
              label="+ Add Event"
              size="sm"
              variant="ghost"
              onClick={() =>
                edit({
                  title: 'Add Event',
                  fields: EVENT_FIELDS,
                  initial: { kind: 'game' },
                  saveLabel: 'Add Event',
                  successMessage: 'Event added.',
                  onSave: (v) => writes.addSeasonEvent(orgId, s.id, v),
                })
              }
            />
          </FounderActionRow>
          {s.events.length ? (
            <div className="mt-1 flex flex-col divide-y" style={{ borderColor: colors.border }}>
              {s.events.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm"
                  style={{ borderColor: colors.border }}
                >
                  <span className="min-w-0 flex-1 break-words" style={{ color: colors.ink }}>
                    <UpdatedBadge id={e.id} />{' '}
                    <span className="capitalize" style={{ color: colors.inkMuted }}>
                      {e.kind}
                    </span>
                    {e.title ? ` · ${e.title}` : ''}
                    {e.location ? ` · ${e.location}` : ''}
                    <span className="block text-xs" style={{ color: colors.inkFaint }}>
                      {e.date ?? 'No date'}
                      {e.startTime ? ` ${e.startTime.slice(0, 5)}` : ''}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Button
                      label="Edit"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        edit({
                          title: 'Edit Event',
                          fields: EVENT_FIELDS,
                          initial: e,
                          successMessage: 'Event updated.',
                          updatedId: e.id,
                          onSave: (v) => writes.updateSeasonEvent(orgId, e.id, v),
                        })
                      }
                    />
                    <Button
                      label="Delete"
                      size="sm"
                      variant="ghost"
                      disabled={action.pending}
                      onClick={() =>
                        action.run({
                          write: () => writes.deleteSeasonEvent(orgId, e.id, e.title ?? e.kind),
                          success: 'Event deleted.',
                          confirmTitle: 'Delete Event',
                          confirmMessage: `Delete "${e.title ?? e.kind}" and its RSVPs? This can't be undone.`,
                          confirmLabel: 'Delete',
                          destructive: true,
                        })
                      }
                    />
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function EvaluationsTab({ evaluations, orgId }: { evaluations: FounderTeamDetail['evaluations']; orgId: string }) {
  const colors = useThemeColors();
  const router = useRouter();
  if (evaluations.length === 0) {
    return <EmptyState title="No evaluations" message="This team has no evaluations." />;
  }
  return (
    <div className="flex flex-col gap-3">
      {evaluations.map((ev) => (
        <Card key={ev.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold break-words" style={{ color: colors.ink }}>
              {ev.name || 'Untitled evaluation'}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <UpdatedBadge id={ev.id} />
              {ev.eventType ? <Badge label={ev.eventType} variant="brand" /> : null}
              <ArchiveBadges archived={ev.archived} deletedAt={ev.deletedAt} />
              <Badge label={`${ev.playerCount} players`} />
            </div>
          </div>
          <FounderDetails
            rows={[
              ['Date', ev.date],
              ['Location', ev.location],
            ]}
          />
          {ev.assessors.length ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold uppercase tracking-[0.08em]" style={{ color: colors.inkFaint }}>
                Assessors
              </p>
              {ev.assessors.map((a, i) => (
                <div
                  key={`${a.email ?? a.name}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 break-all" style={{ color: colors.ink }}>
                    {a.name || a.email || 'Unnamed assessor'}
                    {a.name && a.email ? <span style={{ color: colors.inkMuted }}> · {a.email}</span> : null}
                  </span>
                  {a.status ? <Badge label={a.status} /> : null}
                </div>
              ))}
            </div>
          ) : null}
          <FounderActionRow>
            {/* A deleted evaluation can't be opened in full; the coach read behind that page skips it. */}
            {!ev.deletedAt ? (
              <Button
                label="Open & Edit"
                size="sm"
                variant="secondary"
                onClick={() => router.push(`/founder/organizations/${orgId}/evaluations/${ev.id}`)}
              />
            ) : null}
            <TryoutStateButtons accountId={orgId} tryout={ev} />
          </FounderActionRow>
        </Card>
      ))}
    </div>
  );
}

function StaffTab({ team }: { team: FounderTeamDetail }) {
  const colors = useThemeColors();
  if (team.staff.length === 0) {
    return (
      <EmptyState
        title="No delegated staff"
        message="Nobody outside the organization's own members has been given this team."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {team.staff.map((m) => (
        <Card key={m.id} className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold break-words" style={{ color: colors.ink }}>
              {m.name || m.email || 'Unnamed'}
            </p>
            {m.name && m.email ? (
              <p className="text-xs break-all" style={{ color: colors.inkMuted }}>
                {m.email}
              </p>
            ) : null}
          </div>
          <Badge label={m.role} />
        </Card>
      ))}
    </div>
  );
}
