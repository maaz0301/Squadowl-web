'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Chip, Input, Modal, ModalFooter, Switch } from '@/components/ui';
import {
  DUMMY_LIMITS,
  clampOption,
  type DummyDataOptions,
  type DummyTarget,
  type DummyTeamOptions,
} from '@/data/testDataGenerator';

/**
 * The one "Dummy Data" dialog, shared by the in-assessment testing tools and the
 * New Team screen. Both variants ask the same four things — what to create, how
 * many, whether to score it, and how many scoring sessions per player.
 */

const ASSESSMENT_TARGETS: { key: DummyTarget; label: string; hint: string }[] = [
  {
    key: 'registrations',
    label: 'Registrations',
    hint: 'Pending registrations with guardian details — land in the Pending tab so you can test approve/dismiss.',
  },
  {
    key: 'roster',
    label: 'Roster players',
    hint: 'Players added straight to the roster, skipping registration.',
  },
  {
    key: 'both',
    label: 'Both',
    hint: 'A pending queue plus a separate cohort already on the roster.',
  },
];

interface AssessmentProps {
  variant: 'assessment';
  visible: boolean;
  loading?: boolean;
  /** How many of the requested records have been created so far — counted
   * across generation and insertion, whatever the target. */
  progress?: { done: number; total: number };
  /**
   * How many more players this evaluation's plan lets its roster take. The
   * dialog will not offer to create more than this — registrations count too,
   * since each becomes a player once approved. Infinity when unlimited.
   */
  maxPlayers: number;
  /** Blocks the scoring options and explains why — no rubrics defined yet. */
  hasRubrics: boolean;
  onAddRubrics: () => void;
  onClose: () => void;
  onSubmit: (options: DummyDataOptions) => void;
}

interface TeamProps {
  variant: 'team';
  visible: boolean;
  loading?: boolean;
  progress?: { done: number; total: number };
  /**
   * How many more teams can be created — the smaller of the team allowance and
   * the evaluation allowance, since every dummy team gets a linked evaluation.
   * Infinity when unlimited.
   */
  maxTeams: number;
  /** Which allowance is the one at zero, so the dialog can say so instead of guessing. */
  teamsBlockedBy?: 'teams' | 'evaluations' | 'loading';
  /** How many players one team's roster can hold on this plan. Infinity when unlimited. */
  maxPlayersPerTeam: number;
  onClose: () => void;
  onSubmit: (options: DummyTeamOptions) => void;
}

export type DummyDataModalProps = AssessmentProps | TeamProps;

export function DummyDataModal(props: DummyDataModalProps) {
  const colors = useThemeColors();
  const isTeam = props.variant === 'team';

  const [target, setTarget] = useState<DummyTarget>('registrations');
  const [count, setCount] = useState('25');
  const [teams, setTeams] = useState('2');
  const [withScores, setWithScores] = useState(true);
  const [sessions, setSessions] = useState('1');

  // Registrations have nowhere to hang a score, so the scoring options only
  // apply once the batch puts someone on a roster.
  const producesRoster = isTeam || target === 'roster' || target === 'both';
  const hasRubrics = isTeam || props.hasRubrics;
  const canScore = producesRoster && hasRubrics;
  const scoring = canScore && withScores;

  // Never more than the plan allows. "Both" makes two records per player asked
  // for, so its ceiling is half the room.
  const playerRoom =
    props.variant === 'team' ? props.maxPlayersPerTeam : target === 'both' ? Math.floor(props.maxPlayers / 2) : props.maxPlayers;
  const teamRoom = props.variant === 'team' ? props.maxTeams : Number.POSITIVE_INFINITY;
  const countMax = Math.min(isTeam ? DUMMY_LIMITS.playersPerTeam.max : DUMMY_LIMITS.count.max, playerRoom);
  const teamsMax = Math.min(DUMMY_LIMITS.teams.max, teamRoom);
  const noRoom = countMax < 1 || (isTeam && teamsMax < 1);
  const countN = clampOption(count, { min: 1, max: Math.max(1, countMax) }, 25);
  const teamsN = clampOption(teams, { min: 1, max: Math.max(1, teamsMax) }, 2);
  const sessionsN = clampOption(sessions, DUMMY_LIMITS.sessionsPerPlayer, 1);

  // `props.loading` only turns true once the mutation's pending state has
  // propagated back down through React Query — for a heavy submit (e.g. 1000
  // records) there can be a beat before that happens. This bridges the gap so
  // the button reacts the instant it's clicked, instead of sitting inert.
  const [justClicked, setJustClicked] = useState(false);
  // React's documented "storing information from previous renders" pattern,
  // adjusting state during render rather than in an effect.
  const [prevPropsLoading, setPrevPropsLoading] = useState(props.loading);
  if (props.loading !== prevPropsLoading) {
    setPrevPropsLoading(props.loading);
    if (!props.loading) setJustClicked(false);
  }
  const loading = props.loading || justClicked;

  const submit = () => {
    if (noRoom) return;
    setJustClicked(true);
    if (props.variant === 'team') {
      props.onSubmit({
        teams: teamsN,
        playersPerTeam: countN,
        withScores: scoring,
        sessionsPerPlayer: sessionsN,
      });
    } else {
      props.onSubmit({
        target,
        count: countN,
        withScores: scoring,
        sessionsPerPlayer: sessionsN,
      });
    }
  };

  const submitLabel = isTeam
    ? `Create ${teamsN} ${teamsN === 1 ? 'Team' : 'Teams'} · ${countN * teamsN} Players`
    : `Create ${target === 'both' ? countN * 2 : countN} Records`;

  const rubricNotice = !isTeam && !props.hasRubrics && producesRoster;

  return (
    <Modal
      visible={props.visible}
      title={isTeam ? 'Dummy Teams' : 'Dummy Data'}
      onClose={props.onClose}
      footer={
        <ModalFooter>
          {props.loading && props.progress && props.progress.total > 0 ? (
            <div className="flex w-full flex-col gap-1">
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: colors.tile }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(4, Math.round((props.progress.done / props.progress.total) * 100)))}%`,
                    backgroundColor: colors.primary,
                  }}
                />
              </div>
              <p className="text-center text-xs" style={{ color: colors.inkMuted }}>
                {isTeam
                  ? `Generated ${props.progress.done} of ${props.progress.total} players...`
                  : `Created ${props.progress.done} of ${props.progress.total} records...`}
              </p>
            </div>
          ) : null}
          <Button label={submitLabel} loading={loading} disabled={noRoom} onClick={submit} />
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-5 py-1">
        {isTeam ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            Teams hold no roster of their own, so each dummy team is created with a linked evaluation —
            seeded with rubrics covering skill, time, distance, and speed — and the players are added there.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold" style={{ color: colors.ink }}>
              What do you want to create?
            </p>
            <div className="flex flex-wrap gap-2">
              {ASSESSMENT_TARGETS.map((t) => (
                <Chip key={t.key} label={t.label} active={target === t.key} onClick={() => setTarget(t.key)} />
              ))}
            </div>
            <p className="text-xs" style={{ color: colors.inkMuted }}>
              {ASSESSMENT_TARGETS.find((t) => t.key === target)?.hint}
            </p>
          </div>
        )}

        {isTeam ? (
          <Input
            label={
              teamsMax >= 1
                ? `How many teams (1–${teamsMax})`
                : props.variant === 'team' && props.teamsBlockedBy === 'evaluations'
                  ? 'How many teams (no free evaluation slot)'
                  : props.variant === 'team' && props.teamsBlockedBy === 'teams'
                    ? 'How many teams (team limit reached)'
                    : 'How many teams (checking your plan…)'
            }
            value={teams}
            onChange={(e) => setTeams(e.target.value)}
            inputMode="numeric"
            placeholder="2"
          />
        ) : null}

        <Input
          label={
            isTeam
              ? countMax < 1
                ? 'Players per team (none available)'
                : `Players per team (1–${countMax})`
              : countMax < 1
                ? 'How many players (none available)'
                : `How many players (1–${countMax})`
          }
          value={count}
          onChange={(e) => setCount(e.target.value)}
          inputMode="numeric"
          placeholder="25"
        />

        {noRoom ? (
          <p className="text-sm" style={{ color: colors.danger }}>
            {isTeam && teamsMax < 1
              ? props.variant === 'team' && props.teamsBlockedBy === 'loading'
                ? 'Checking how much of your plan is already used…'
                : props.variant === 'team' && props.teamsBlockedBy === 'evaluations'
                  ? "Every dummy team comes with its own new evaluation, and your plan's evaluation limit is already used up — an evaluation you created yourself counts. Archive or delete one to make room."
                  : "Your plan's team limit is already used up, so no more dummy teams can be created."
              : !isTeam && target === 'both' && props.variant === 'assessment' && props.maxPlayers >= 1
                ? '"Both" needs room for at least 2 players (one pending, one on the roster). Pick Registrations or Roster players instead.'
                : "This roster is already at your plan's player limit, so no more dummy players can be created."}
          </p>
        ) : Number.isFinite(playerRoom) || teamsMax < DUMMY_LIMITS.teams.max ? (
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            Dummy data stays within your plan: up to {isTeam ? `${teamsMax} team${teamsMax === 1 ? '' : 's'} and ` : ''}
            {countMax} player{countMax === 1 ? '' : 's'}
            {isTeam ? ' per team' : ''} can be created here.
          </p>
        ) : null}

        {rubricNotice && props.variant === 'assessment' ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm" style={{ color: colors.ink }}>
              Players are scored against this evaluation&apos;s rubrics, but none are defined yet. Add at
              least one rubric to generate scoring data — or continue to create unscored players.
            </p>
            <Button label="Add Rubrics" variant="secondary" size="sm" onClick={props.onAddRubrics} />
          </div>
        ) : null}

        {producesRoster ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: colors.ink }}>
                  Scoring data
                </p>
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  {canScore
                    ? 'Score every player across every rubric so rankings and reports have data.'
                    : 'Unavailable until this evaluation has at least one rubric.'}
                </p>
              </div>
              <Switch checked={scoring} disabled={!canScore} onChange={setWithScores} />
            </div>

            {scoring ? (
              <Input
                label={`Scoring evaluations per player (${DUMMY_LIMITS.sessionsPerPlayer.min}–${DUMMY_LIMITS.sessionsPerPlayer.max})`}
                value={sessions}
                onChange={(e) => setSessions(e.target.value)}
                inputMode="numeric"
                placeholder="1"
              />
            ) : null}
          </div>
        ) : null}

        <p className="text-xs" style={{ color: colors.inkMuted }}>
          Everything generated is tagged so it can be removed again with Clear Dummy Data. Guardian emails
          use yopmail.com, a public disposable inbox: not a real person, but anyone can read what is sent
          there, so don&apos;t send anything sensitive to them.
        </p>
      </div>
    </Modal>
  );
}
