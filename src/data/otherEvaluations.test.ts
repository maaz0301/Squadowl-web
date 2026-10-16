import { describe, expect, it } from 'vitest';

import { extraMarker, matchPlayerAcrossEvaluations, splitSavedEvalIds, type EvaluationCandidate } from './otherEvaluations';

const cand = (o: Partial<EvaluationCandidate> & Pick<EvaluationCandidate, 'id' | 'tryoutId'>): EvaluationCandidate => ({
  first: 'Alfred',
  last: 'Stone',
  tryoutName: o.tryoutId,
  ...o,
});

describe('matchPlayerAcrossEvaluations', () => {
  const who = { athleteIds: ['a1'], first: 'Alfred', last: 'Stone' };

  it('treats the same athlete record as certain', () => {
    const [m] = matchPlayerAcrossEvaluations(who, [cand({ id: 'r1', tryoutId: 'Skating Speed', athleteId: 'a1' })]);
    expect(m.uncertain).toBe(false);
    expect(m.playerId).toBe('r1');
  });

  it('matches an identical name on another record as certain', () => {
    const [m] = matchPlayerAcrossEvaluations(who, [cand({ id: 'r2', tryoutId: 'T', athleteId: 'a2' })]);
    expect(m.uncertain).toBe(false);
  });

  it('flags a near spelling as uncertain', () => {
    const [m] = matchPlayerAcrossEvaluations(who, [cand({ id: 'r3', tryoutId: 'T', athleteId: 'a3', first: 'Alfrid' })]);
    expect(m.uncertain).toBe(true);
  });

  it('skips a same name with a different birth year', () => {
    const r = matchPlayerAcrossEvaluations({ ...who, yearOfBirth: '2010' }, [cand({ id: 'r4', tryoutId: 'T', athleteId: 'a4', yob: 2012 })]);
    expect(r).toEqual([]);
  });

  it('keeps one match per evaluation, the strongest', () => {
    const r = matchPlayerAcrossEvaluations(who, [
      cand({ id: 'r5', tryoutId: 'T', athleteId: 'a5', first: 'Alfrid' }),
      cand({ id: 'r6', tryoutId: 'T', athleteId: 'a1' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].playerId).toBe('r6');
  });
});

describe('saved evaluation ids', () => {
  it('round trips markers apart from plain ids', () => {
    const saved = ['e1', extraMarker('t2', 'p9'), 'e2'];
    expect(splitSavedEvalIds(saved)).toEqual({ evalIds: ['e1', 'e2'], extras: [{ tryoutId: 't2', playerId: 'p9' }] });
  });
});
