'use client';

import { use, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader } from '@/components/ui';
import {
  ArchiveBadges,
  EvaluationEntry,
  FounderArchiveToggle,
  FounderDetails,
  FounderLinkCard,
  FounderNotAvailable,
  FounderSection,
  ScoreChips,
  formatScore,
  humanizeKey,
  useShowArchived,
} from '@/components/founder/FounderUi';
import {
  ASSESSOR_ROLE_OPTIONS,
  ASSESSOR_STATUS_OPTIONS,
  ATHLETE_FIELDS,
  EVENT_TYPE_OPTIONS,
  FounderActionRow,
  TryoutStateButtons,
  UpdatedBadge,
  evaluationEditConfig,
  useFounderAction,
  useFounderEditor,
  type FounderEditConfig,
  type FounderField,
} from '@/components/founder/FounderEditor';
import { formatDate } from '@/components/founder/labels';
import * as writes from '@/data/founder/founderWrites';
import type { PlayerResult, Tryout } from '@/data/types';
import { getPlayerCategories } from '@/data/rubrics';
import { computeAssessorProgress, computePlayerResults } from '@/data/scoring';
import {
  useFounderEvaluationQuery,
  useFounderRemovedParticipantsQuery,
  useIsFounderQuery,
} from '@/features/founderQueries';

/**
 * One evaluation (tryout, assessment, sort-out or combine) in full, from the
 * founder console: its details, assessors and their progress, and every
 * player's results with each individual evaluation and score behind them —
 * all editable. Writes go through data/founder/founderWrites.ts.
 */
export default function FounderEvaluationPage({ params }: { params: Promise<{ id: string; tryoutId: string }> }) {
  const { id, tryoutId } = use(params);
  const founderQuery = useIsFounderQuery();
  const query = useFounderEvaluationQuery(tryoutId, founderQuery.data === true);
  const backHref = `/founder/organizations/${id}`;

  if (founderQuery.isLoading || (founderQuery.data === true && query.isLoading)) {
    return <LoadingState message="Loading evaluation..." />;
  }
  if (founderQuery.data !== true) return <FounderNotAvailable />;
  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="Evaluation" showBack backHref={backHref} />
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Could not load this evaluation.'}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  return <EvaluationDetail tryout={query.data} orgId={id} backHref={backHref} />;
}

function EvaluationDetail({ tryout, orgId, backHref }: { tryout: Tryout; orgId: string; backHref: string }) {
  const colors = useThemeColors();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const showArchived = useShowArchived();
  const { edit, modal } = useFounderEditor();
  const action = useFounderAction();
  const removed = useFounderRemovedParticipantsQuery(tryout.id, showArchived);

  const results = useMemo(() => computePlayerResults(tryout).sort((a, b) => b.overall - a.overall), [tryout]);
  const progress = useMemo(() => computeAssessorProgress(tryout), [tryout]);
  const scoredCount = results.filter((r) => r.evalCount > 0).length;

  const term = search.trim().toLowerCase();
  const shown = term
    ? results.filter((r) =>
        [r.player.first, r.player.last, r.player.jersey, r.player.pos, r.player.playerEmail, r.player.guardianName]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term)),
      )
    : results;

  return (
    <>
      <PageHeader
        title={tryout.name || 'Untitled evaluation'}
        subtitle="Founder Console"
        showBack
        backHref={tryout.teamId ? `${backHref}/teams/${tryout.teamId}` : backHref}
      />

      <Card className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <UpdatedBadge id={tryout.id} />
          <Badge label={tryout.eventType} variant="brand" />
          <ArchiveBadges archived={tryout.archived} />
          {!tryout.teamId ? <Badge label="No team" /> : null}
          <Badge label={`${tryout.roster.length} players`} />
          <Badge label={`${tryout.evals.length} evaluations`} />
          <Badge label={`${scoredCount} scored`} variant={scoredCount ? 'success' : 'default'} />
        </div>
        <FounderDetails
          rows={[
            ['Sport', tryout.sportOther || tryout.sport],
            ['Date', tryout.tryoutDate],
            ['Time', [tryout.startTime, tryout.endTime].filter(Boolean).join(' – ') || undefined],
            ['Location', tryout.rink],
            ['Head coach', tryout.headCoach],
            ['Head assessor', tryout.headAssessor],
            ['Head assessor email', tryout.headAssessorEmail],
            ['Default position', tryout.defaultPosition],
            ['Registrations', tryout.registrations?.length || undefined],
            ['Created', formatDate(tryout.createdAt)],
          ]}
        />
        <FounderActionRow>
          <Button
            label="Edit Details"
            size="sm"
            variant="secondary"
            onClick={() =>
              edit({
                title: 'Edit Evaluation',
                fields: [
                  { key: 'name', label: 'Name' },
                  { key: 'eventType', label: 'Type', type: 'select', options: EVENT_TYPE_OPTIONS },
                  { key: 'date', label: 'Date', type: 'date' },
                  { key: 'location', label: 'Location' },
                  { key: 'startTime', label: 'Start time', type: 'time' },
                  { key: 'endTime', label: 'End time', type: 'time' },
                  { key: 'headCoach', label: 'Head coach' },
                  { key: 'headAssessor', label: 'Head assessor' },
                ],
                initial: { ...tryout, date: tryout.tryoutDate, location: tryout.rink },
                successMessage: 'Evaluation updated.',
                updatedId: tryout.id,
                onSave: (v) => writes.updateTryout(orgId, tryout.id, v),
              })
            }
          />
          <TryoutStateButtons accountId={orgId} tryout={tryout} onDeleted={() => router.push(backHref)} />
        </FounderActionRow>
      </Card>

      <div className="mb-4">
        <FounderArchiveToggle />
      </div>

      <FounderSection title={`Assessors (${tryout.assessors.length})`}>
        {tryout.assessors.length === 0 ? (
          <EmptyState title="No assessors" message="Nobody was invited to assess this evaluation." />
        ) : (
          tryout.assessors.map((a, i) => {
            const done = progress.find((p) => p.name === a.name);
            return (
              <Card key={`${a.email}-${i}`} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold break-words" style={{ color: colors.ink }}>
                    {a.name || a.email || 'Unnamed assessor'}
                  </p>
                  {a.email && a.name ? (
                    <p className="text-xs break-all" style={{ color: colors.inkMuted }}>
                      {a.email}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <UpdatedBadge id={`assessor:${tryout.id}:${a.email || a.name}`} />
                  <Badge label={a.role} />
                  <Badge label={a.status} variant={a.status === 'completed' ? 'success' : 'default'} />
                  {done ? <Badge label={`Scored ${done.scored} of ${done.total}`} variant="info" /> : null}
                </div>
                <FounderActionRow>
                  <Button
                    label="Edit"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      edit({
                        title: 'Edit Assessor',
                        fields: [
                          { key: 'name', label: 'Name' },
                          { key: 'role', label: 'Role', type: 'select', options: ASSESSOR_ROLE_OPTIONS },
                          { key: 'status', label: 'Status', type: 'select', options: ASSESSOR_STATUS_OPTIONS },
                        ],
                        initial: a,
                        successMessage: 'Assessor updated.',
                        updatedId: `assessor:${tryout.id}:${a.email || a.name}`,
                        onSave: (v) => writes.updateAssessor(orgId, tryout.id, a, v),
                      })
                    }
                  />
                  <Button
                    label="Remove"
                    size="sm"
                    variant="ghost"
                    disabled={action.pending}
                    onClick={() =>
                      action.run({
                        write: () => writes.removeAssessor(orgId, tryout.id, a),
                        success: 'Assessor removed.',
                        confirmTitle: 'Remove Assessor',
                        confirmMessage: `Remove ${a.name || a.email} from this evaluation? The scores they already entered are kept.`,
                        confirmLabel: 'Remove',
                        destructive: true,
                      })
                    }
                  />
                </FounderActionRow>
              </Card>
            );
          })
        )}
      </FounderSection>

      <FounderSection title={`Player results (${results.length})`}>
        <div>
          <Button
            label="+ Add Player"
            size="sm"
            onClick={() =>
              edit({
                title: 'Add Player to Evaluation',
                fields: [...ATHLETE_FIELDS, ...PARTICIPANT_FIELDS],
                initial: {},
                saveLabel: 'Add Player',
                successMessage: 'Player added.',
                onSave: (v) => writes.addPlayerToTryout(orgId, tryout.id, v),
              })
            }
          />
        </div>
        {results.length === 0 ? (
          <EmptyState title="No players" message="Nobody has been added to this evaluation." />
        ) : (
          <>
            <Input
              containerClassName="mb-1 w-full md:max-w-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search players..."
            />
            {shown.length === 0 ? <EmptyState title="No matches" message="Try a different search." /> : null}
            {shown.map((result, index) => (
              <PlayerResultCard
                key={result.player.id}
                rank={term ? undefined : index + 1}
                result={result}
                tryout={tryout}
                edit={edit}
                orgId={orgId}
                playerHref={
                  result.player.athleteId
                    ? `/founder/organizations/${orgId}/players/${result.player.athleteId}`
                    : undefined
                }
              />
            ))}
          </>
        )}
      </FounderSection>

      {showArchived ? (
        <FounderSection title={`Removed players${removed.data ? ` (${removed.data.length})` : ''}`}>
          {removed.isLoading ? (
            <LoadingState message="Loading removed players..." />
          ) : removed.isError ? (
            <ErrorState
              message={removed.error instanceof Error ? removed.error.message : 'Could not load removed players.'}
              onRetry={() => removed.refetch()}
            />
          ) : !removed.data?.length ? (
            <EmptyState title="No removed players" message="Nobody has been taken off this evaluation's roster." />
          ) : (
            removed.data.map((p) => (
              <FounderLinkCard key={p.participantId}>
                <p className="min-w-0 flex-1 font-semibold break-words" style={{ color: colors.ink }}>
                  {p.jersey ? <span style={{ color: colors.primary }}>#{p.jersey} </span> : null}
                  {`${p.firstName} ${p.lastName}`.trim() || 'Unnamed player'}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {p.position ? <Badge label={p.position} /> : null}
                  <Badge label={`Removed ${formatDate(p.removedAt)}`} variant="danger" />
                  <Badge label={`${p.evalCount} eval${p.evalCount === 1 ? '' : 's'} kept`} />
                </div>
                <FounderActionRow>
                  <Button
                    label="Restore to Roster"
                    size="sm"
                    disabled={action.pending}
                    onClick={() =>
                      action.run({
                        write: () =>
                          writes.setParticipantRemoved(
                            orgId,
                            p.participantId,
                            false,
                            `${p.firstName} ${p.lastName}`.trim() || 'Unnamed player',
                          ),
                        success: 'Player restored to the roster.',
                        updatedId: p.participantId,
                      })
                    }
                  />
                  {p.athleteId ? (
                    <Button
                      label="Profile"
                      size="sm"
                      variant="ghost"
                      onClick={() => router.push(`/founder/organizations/${orgId}/players/${p.athleteId}`)}
                    />
                  ) : null}
                </FounderActionRow>
              </FounderLinkCard>
            ))
          )}
        </FounderSection>
      ) : null}

      {modal}
    </>
  );
}

const PARTICIPANT_FIELDS: FounderField[] = [
  { key: 'jersey', label: 'Jersey', section: 'In this evaluation' },
  { key: 'position', label: 'Position' },
  { key: 'currentTeam', label: 'Current team' },
  { key: 'currentLevel', label: 'Current level' },
];

function PlayerResultCard({
  rank,
  result,
  tryout,
  edit,
  orgId,
  playerHref,
}: {
  rank?: number;
  result: PlayerResult;
  tryout: Tryout;
  edit: (config: FounderEditConfig) => void;
  orgId: string;
  playerHref?: string;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const action = useFounderAction();
  const [open, setOpen] = useState(false);
  const { player } = result;

  const categories = getPlayerCategories(tryout.sport, player.pos, tryout.settings.customRubrics);
  const categoryLabel = new Map(categories.map((c) => [c.key, c.label]));
  const skillLabel = new Map(categories.flatMap((c) => c.subskills.map((s) => [s.key, s.label] as const)));
  const evals = tryout.evals.filter((e) => e.playerId === player.id).sort((a, b) => b.createdAt - a.createdAt);
  const name = `${player.first} ${player.last}`.trim() || 'Unnamed player';

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 font-semibold break-words" style={{ color: colors.ink }}>
          {rank ? <span style={{ color: colors.inkFaint }}>{rank}. </span> : null}
          {player.jersey ? <span style={{ color: colors.primary }}>#{player.jersey} </span> : null}
          {name}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <UpdatedBadge id={player.id} />
          {player.pos ? <Badge label={player.pos} /> : null}
          {result.latestRecommendation ? <Badge label={result.latestRecommendation} variant="info" /> : null}
          <Badge label={`Overall ${formatScore(result.overall)}`} variant="brand" />
          <Badge label={`${result.evalCount} eval${result.evalCount === 1 ? '' : 's'}`} />
        </div>
      </div>

      <ScoreChips
        scores={Object.entries(result.categoryScores).map(([key, value]) => ({
          label: categoryLabel.get(key) ?? humanizeKey(key),
          value,
        }))}
      />

      <FounderDetails
        rows={[
          ['Year of birth', player.yearOfBirth],
          ['Current team', player.currentTeam],
          ['Current level', player.currentLevel],
          ['Trying out for', player.positionTryingOutFor],
          ['Shoots', player.shoots],
          ['Assigned assessor', player.assignedAssessor],
          ['Player email', player.playerEmail],
          ['Guardian', player.guardianName],
          ['Guardian email', player.guardianEmail],
          ['Guardian phone', player.guardianPhone],
          ['Registered via', player.registrationSource],
          ['About', player.aboutChild],
        ]}
      />

      <div className="flex flex-wrap gap-2">
        {evals.length ? (
          <Button
            label={open ? 'Hide evaluations' : `Show ${evals.length} evaluation${evals.length === 1 ? '' : 's'}`}
            size="sm"
            variant="secondary"
            onClick={() => setOpen((v) => !v)}
          />
        ) : null}
        {playerHref ? (
          <Button label="Player profile" size="sm" variant="ghost" onClick={() => router.push(playerHref)} />
        ) : null}
        <Button
          label="Edit Player"
          size="sm"
          variant="ghost"
          onClick={() =>
            edit({
              title: `Edit ${name}`,
              fields: [...(player.athleteId ? ATHLETE_FIELDS : []), ...PARTICIPANT_FIELDS],
              initial: {
                firstName: player.first,
                lastName: player.last,
                yearOfBirth: player.yearOfBirth,
                defaultPosition: player.currentPosition,
                playerEmail: player.playerEmail,
                guardianName: player.guardianName,
                guardianEmail: player.guardianEmail,
                guardianPhone: player.guardianPhone,
                about: player.aboutChild,
                jersey: player.jersey,
                position: player.pos,
                currentTeam: player.currentTeam,
                currentLevel: player.currentLevel,
              },
              successMessage: 'Player updated.',
              updatedId: player.id,
              onSave: async (v) => {
                if (player.athleteId) await writes.updateAthlete(orgId, player.athleteId, v);
                await writes.updateParticipant(orgId, player.id, v, name);
              },
            })
          }
        />
        <Button
          label="Remove from Evaluation"
          size="sm"
          variant="ghost"
          disabled={action.pending}
          onClick={() =>
            action.run({
              write: () => writes.setParticipantRemoved(orgId, player.id, true, name),
              success: `${name} removed. Turn on "Show archived & deleted" to restore.`,
              confirmTitle: 'Remove Player',
              confirmMessage: `Take ${name} off this evaluation's roster? Their evaluations are kept and you can restore them.`,
              confirmLabel: 'Remove',
              destructive: true,
            })
          }
        />
      </div>

      {open ? (
        <div className="flex flex-col gap-2">
          {evals.map((e) => (
            <EvaluationEntry
              key={e.id}
              evaluation={e}
              skillLabel={skillLabel}
              badge={<UpdatedBadge id={e.id} />}
              actions={
                <>
                  <Button
                    label="Edit Scores"
                    size="sm"
                    variant="secondary"
                    onClick={() => edit(evaluationEditConfig(e, skillLabel, name, orgId))}
                  />
                  <Button
                    label="Delete"
                    size="sm"
                    variant="ghost"
                    disabled={action.pending}
                    onClick={() =>
                      action.run({
                        write: () =>
                          writes.deleteEvaluation(orgId, e.id, `${e.evaluator || 'assessor'}'s evaluation of ${name}`),
                        success: 'Evaluation deleted.',
                        confirmTitle: 'Delete Evaluation',
                        confirmMessage: `Permanently delete ${e.evaluator || 'this'}'s evaluation of ${name} and its scores? This can't be undone.`,
                        confirmLabel: 'Delete',
                        destructive: true,
                      })
                    }
                  />
                </>
              }
            />
          ))}
        </div>
      ) : null}
    </Card>
  );
}
