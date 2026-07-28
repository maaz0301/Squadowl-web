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

  const countN = clampOption(count, isTeam ? DUMMY_LIMITS.playersPerTeam : DUMMY_LIMITS.count, 25);
  const teamsN = clampOption(teams, DUMMY_LIMITS.teams, 2);
  const sessionsN = clampOption(sessions, DUMMY_LIMITS.sessionsPerPlayer, 1);

  const submit = () => {
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
          <Button label={submitLabel} loading={props.loading} onClick={submit} />
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-5 py-1">
        {isTeam ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            Teams hold no roster of their own, so each dummy team is created with a linked assessment —
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
            label={`How many teams (${DUMMY_LIMITS.teams.min}–${DUMMY_LIMITS.teams.max})`}
            value={teams}
            onChange={(e) => setTeams(e.target.value)}
            inputMode="numeric"
            placeholder="2"
          />
        ) : null}

        <Input
          label={
            isTeam
              ? `Players per team (${DUMMY_LIMITS.playersPerTeam.min}–${DUMMY_LIMITS.playersPerTeam.max})`
              : `How many players (${DUMMY_LIMITS.count.min}–${DUMMY_LIMITS.count.max})`
          }
          value={count}
          onChange={(e) => setCount(e.target.value)}
          inputMode="numeric"
          placeholder="25"
        />

        {rubricNotice && props.variant === 'assessment' ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm" style={{ color: colors.ink }}>
              Players are scored against this assessment&apos;s rubrics, but none are defined yet. Add at
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
                    : 'Unavailable until this assessment has at least one rubric.'}
                </p>
              </div>
              <Switch checked={scoring} disabled={!canScore} onChange={setWithScores} />
            </div>

            {scoring ? (
              <Input
                label={`Scoring assessments per player (${DUMMY_LIMITS.sessionsPerPlayer.min}–${DUMMY_LIMITS.sessionsPerPlayer.max})`}
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
          use a reserved test domain and can never reach a real inbox.
        </p>
      </div>
    </Modal>
  );
}
