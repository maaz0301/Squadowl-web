'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
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
import type { PlayerProfile, PlayerProfileAssessment } from '@/data/types';
import { formatDate } from '@/components/founder/labels';
import {
  ATHLETE_FIELDS,
  FounderActionRow,
  TryoutStateButtons,
  UpdatedBadge,
  evaluationEditConfig,
  useFounderAction,
  useFounderEditor,
  type FounderEditConfig,
} from '@/components/founder/FounderEditor';
import * as writes from '@/data/founder/founderWrites';
import { getPlayerCategories } from '@/data/rubrics';
import {
  useFounderHiddenPlayerEvaluationsQuery,
  useFounderPlayerQuery,
  useIsFounderQuery,
} from '@/features/founderQueries';

/**
 * One player's whole record from the founder console: their details, the
 * teams and seasons they're on, and every evaluation they've been through with
 * each assessor's scores and notes. Works the same whether or not the player is
 * on a team.
 */
export default function FounderPlayerPage({ params }: { params: Promise<{ id: string; athleteId: string }> }) {
  const { id, athleteId } = use(params);
  const founderQuery = useIsFounderQuery();
  const query = useFounderPlayerQuery(athleteId, founderQuery.data === true);
  const backHref = `/founder/organizations/${id}`;

  if (founderQuery.isLoading || (founderQuery.data === true && query.isLoading)) {
    return <LoadingState message="Loading player..." />;
  }
  if (founderQuery.data !== true) return <FounderNotAvailable />;
  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="Player" showBack backHref={backHref} />
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Could not load this player.'}
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  return <PlayerDetail profile={query.data} orgId={id} backHref={backHref} />;
}

function PlayerDetail({ profile, orgId, backHref }: { profile: PlayerProfile; orgId: string; backHref: string }) {
  const colors = useThemeColors();
  const router = useRouter();
  const showArchived = useShowArchived();
  const hidden = useFounderHiddenPlayerEvaluationsQuery(profile.athleteId, showArchived);
  const { edit, modal } = useFounderEditor();
  const action = useFounderAction();
  const name = `${profile.first} ${profile.last}`.trim() || 'Unnamed player';
  const scored = profile.assessments.filter((a) => a.evalCount > 0);
  const average = scored.length ? scored.reduce((sum, a) => sum + a.overall, 0) / scored.length : 0;

  return (
    <>
      <PageHeader title={name} subtitle="Founder Console" showBack backHref={backHref} />

      <Card className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <UpdatedBadge id={profile.athleteId} />
          {profile.jersey ? <Badge label={`#${profile.jersey}`} variant="brand" /> : null}
          {profile.currentPosition ? <Badge label={profile.currentPosition} /> : null}
          {profile.teams.length === 0 ? <Badge label="No team" /> : null}
          <Badge label={`${profile.assessments.length} evaluations`} />
          {scored.length ? <Badge label={`Average ${formatScore(average)}`} variant="brand" /> : null}
        </div>
        <FounderDetails
          rows={[
            ['Year of birth', profile.yearOfBirth],
            ['Current team', profile.currentTeam],
            ['Current level', profile.currentLevel],
            ['Player email', profile.playerEmail],
            ['Guardian', profile.guardianName],
            ['Guardian email', profile.guardianEmail],
            ['Guardian phone', profile.guardianPhone],
            ['About', profile.aboutChild],
          ]}
        />
        <FounderActionRow>
          <Button
            label="Edit Player"
            size="sm"
            variant="secondary"
            onClick={() =>
              edit({
                title: `Edit ${name}`,
                // Usual position is left out: the profile only knows the latest
                // evaluation's position, and saving that would overwrite it.
                fields: ATHLETE_FIELDS.filter((f) => f.key !== 'defaultPosition'),
                initial: {
                  firstName: profile.first,
                  lastName: profile.last,
                  yearOfBirth: profile.yearOfBirth,
                  playerEmail: profile.playerEmail,
                  guardianName: profile.guardianName,
                  guardianEmail: profile.guardianEmail,
                  guardianPhone: profile.guardianPhone,
                  about: profile.aboutChild,
                },
                successMessage: 'Player updated.',
                updatedId: profile.athleteId,
                onSave: (v) => writes.updateAthlete(profile.athleteId, v),
              })
            }
          />
        </FounderActionRow>
      </Card>

      <div className="mb-4">
        <FounderArchiveToggle />
      </div>

      <FounderSection title={`Teams (${profile.teams.length})`}>
        {profile.teams.length === 0 ? (
          <EmptyState title="Not on a team" message="This player isn't on any team's roster." />
        ) : (
          profile.teams.map((t) => (
            <FounderLinkCard key={t.teamId} href={`/founder/organizations/${orgId}/teams/${t.teamId}`}>
              <p className="min-w-0 flex-1 font-semibold break-words" style={{ color: colors.ink }}>
                {t.teamName || 'Untitled team'}
              </p>
            </FounderLinkCard>
          ))
        )}
      </FounderSection>

      <FounderSection title={`Seasons (${profile.pastSeasons.length})`}>
        {profile.pastSeasons.length === 0 ? (
          <EmptyState title="No seasons" message="This player isn't on any season roster." />
        ) : (
          profile.pastSeasons.map((s) => (
            <Card key={s.seasonId} className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold break-words" style={{ color: colors.ink }}>
                {s.seasonName}
              </p>
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                {s.teamName}
              </span>
            </Card>
          ))
        )}
      </FounderSection>

      <FounderSection title={`Evaluations (${profile.assessments.length})`}>
        {profile.assessments.length === 0 ? (
          <EmptyState title="No evaluations" message="This player hasn't been through an evaluation." />
        ) : (
          profile.assessments.map((a) => (
            <AssessmentCard key={a.participantId} assessment={a} orgId={orgId} playerName={name} edit={edit} />
          ))
        )}
      </FounderSection>

      {showArchived ? (
        <FounderSection title={`Removed or deleted evaluations${hidden.data ? ` (${hidden.data.length})` : ''}`}>
          {hidden.isLoading ? (
            <LoadingState message="Loading..." />
          ) : hidden.isError ? (
            <ErrorState
              message={hidden.error instanceof Error ? hidden.error.message : 'Could not load these evaluations.'}
              onRetry={() => hidden.refetch()}
            />
          ) : !hidden.data?.length ? (
            <EmptyState
              title="Nothing removed or deleted"
              message="This player hasn't been taken off an evaluation, and none of theirs were deleted."
            />
          ) : (
            hidden.data.map((h) => (
              <FounderLinkCard key={h.participantId}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-words" style={{ color: colors.ink }}>
                    {h.tryoutName}
                  </p>
                  <p className="text-xs break-words" style={{ color: colors.inkMuted }}>
                    {[h.teamName ?? 'No team', h.date].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {h.eventType ? <Badge label={h.eventType} variant="brand" /> : null}
                  {h.removedAt ? <Badge label={`Removed ${formatDate(h.removedAt)}`} variant="danger" /> : null}
                  <ArchiveBadges deletedAt={h.deletedAt} />
                  <Badge label={`${h.evalCount} eval${h.evalCount === 1 ? '' : 's'}`} />
                </div>
                <FounderActionRow>
                  {h.removedAt ? (
                    <Button
                      label="Restore to Roster"
                      size="sm"
                      disabled={action.pending}
                      onClick={() =>
                        action.run({
                          write: () => writes.setParticipantRemoved(h.participantId, false),
                          success: 'Player restored to the evaluation.',
                          updatedId: h.participantId,
                        })
                      }
                    />
                  ) : null}
                  {h.deletedAt ? (
                    <TryoutStateButtons tryout={{ id: h.tryoutId, name: h.tryoutName, deletedAt: h.deletedAt }} />
                  ) : (
                    // Removed from the roster only: the evaluation itself still opens.
                    <Button
                      label="Open Evaluation"
                      size="sm"
                      variant="ghost"
                      onClick={() => router.push(`/founder/organizations/${orgId}/evaluations/${h.tryoutId}`)}
                    />
                  )}
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

function AssessmentCard({
  assessment: a,
  orgId,
  playerName,
  edit,
}: {
  assessment: PlayerProfileAssessment;
  orgId: string;
  playerName: string;
  edit: (config: FounderEditConfig) => void;
}) {
  const colors = useThemeColors();
  const action = useFounderAction();
  const [open, setOpen] = useState(false);

  const categories = getPlayerCategories(a.sport, a.position);
  const categoryLabel = new Map(categories.map((c) => [c.key, c.label]));
  const skillLabel = new Map(categories.flatMap((c) => c.subskills.map((s) => [s.key, s.label] as const)));
  const evaluations = a.evaluations ?? [];

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 font-semibold break-words" style={{ color: colors.ink }}>
          {a.tryoutName || 'Untitled evaluation'}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge label={a.eventType} variant="brand" />
          {a.latestRecommendation ? <Badge label={a.latestRecommendation} variant="info" /> : null}
          <Badge label={`Overall ${formatScore(a.overall)}`} variant="brand" />
          <Badge label={`${a.evalCount} eval${a.evalCount === 1 ? '' : 's'}`} />
        </div>
      </div>

      <FounderDetails
        rows={[
          ['Date', a.date],
          ['Team', a.teamName ?? 'No team'],
          ['Season', a.seasonName],
          ['Position', a.position],
        ]}
      />

      <ScoreChips
        scores={Object.entries(a.categoryScores).map(([key, value]) => ({
          label: categoryLabel.get(key) ?? humanizeKey(key),
          value,
        }))}
      />

      <div className="flex flex-wrap gap-2">
        {evaluations.length ? (
          <Button
            label={
              open ? 'Hide evaluations' : `Show ${evaluations.length} evaluation${evaluations.length === 1 ? '' : 's'}`
            }
            size="sm"
            variant="secondary"
            onClick={() => setOpen((v) => !v)}
          />
        ) : null}
        <FounderLinkButton href={`/founder/organizations/${orgId}/evaluations/${a.tryoutId}`} label="Open evaluation" />
      </div>

      {open ? (
        <div className="flex flex-col gap-2">
          {evaluations.map((e) => (
            <EvaluationEntry
              key={e.id}
              evaluation={e}
              skillLabel={skillLabel}
              badge={<UpdatedBadge id={e.id} />}
              overall={e.overall}
              actions={
                <>
                  <Button
                    label="Edit Scores"
                    size="sm"
                    variant="secondary"
                    onClick={() => edit(evaluationEditConfig(e, skillLabel, playerName))}
                  />
                  <Button
                    label="Delete"
                    size="sm"
                    variant="ghost"
                    disabled={action.pending}
                    onClick={() =>
                      action.run({
                        write: () => writes.deleteEvaluation(e.id),
                        success: 'Evaluation deleted.',
                        confirmTitle: 'Delete Evaluation',
                        confirmMessage: `Permanently delete ${e.evaluator || 'this'}'s evaluation of ${playerName} and its scores? This can't be undone.`,
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

function FounderLinkButton({ href, label }: { href: string; label: string }) {
  const colors = useThemeColors();
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center rounded-xl px-3 text-sm font-semibold transition hover:brightness-125"
      style={{ color: colors.primary }}
    >
      {label} ›
    </Link>
  );
}
