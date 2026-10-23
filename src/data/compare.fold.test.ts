import { describe, expect, it } from 'vitest';
import {
  buildComparison,
  foldCompareCandidates,
  mergeAssessments,
  sharedEvaluations,
  type CompareAssessment,
  type CompareCandidate,
} from './compare';

const team = { teamId: 't1', teamName: 'Provincial Team' };

function person(id: string, first: string, last: string, extra: Partial<CompareCandidate> = {}): CompareCandidate {
  return { id, first, last, teams: [], ...extra };
}

function evaluation(tryoutId: string, name: string, date: string, overall: number, evalCount = 1): CompareAssessment {
  return {
    tryoutId,
    tryoutName: name,
    date,
    overall,
    evalCount,
    scores: { [name.toLowerCase()]: overall },
    columns: { [name.toLowerCase()]: { label: name } },
  };
}

describe('foldCompareCandidates', () => {
  it('shows one row for a child filed under several records, keeping the one on a team as the lead', () => {
    const rows = [
      person('a', 'Kayla', 'Ren'),
      person('b', 'Kayla', 'Ren', { teams: [team], yearOfBirth: '2016' }),
      person('c', 'Kayla', 'Ren'),
      person('d', 'Kayla', 'Ren'),
    ];
    const folded = foldCompareCandidates(rows);
    expect(folded).toHaveLength(1);
    expect(folded[0].id).toBe('b');
    expect(folded[0].teams).toEqual([team]);
    expect([...folded[0].alsoIds].sort()).toEqual(['a', 'c', 'd']);
  });

  it('keeps two children apart when both have a birth year and the years differ', () => {
    const rows = [person('a', 'Sam', 'Lee', { yearOfBirth: '2015' }), person('b', 'Sam', 'Lee', { yearOfBirth: '2017' })];
    expect(foldCompareCandidates(rows)).toHaveLength(2);
  });

  it('matches the name in either order and ignores case', () => {
    expect(foldCompareCandidates([person('a', 'Ren', 'kayla'), person('b', 'Kayla', 'REN')])).toHaveLength(1);
  });

  it('keeps different players as different rows', () => {
    expect(foldCompareCandidates([person('a', 'Kayla', 'Ren'), person('b', 'Elena', 'Sanaei')])).toHaveLength(2);
  });

  it('keeps the teams of every record', () => {
    const other = { teamId: 't2', teamName: 'Star 1 - 4' };
    const folded = foldCompareCandidates([person('a', 'Ana', 'Cruz', { teams: [team] }), person('b', 'Ana', 'Cruz', { teams: [other] })]);
    expect(folded[0].teams.map((t) => t.teamId).sort()).toEqual(['t1', 't2']);
  });
});

describe('mergeAssessments', () => {
  it('lists each evaluation once, newest first, keeping the one with scores', () => {
    const merged = mergeAssessments([
      [evaluation('lj', 'Long Jump', '2026-09-13', 150), evaluation('vj', 'Vertical Jump', '2026-09-13', 0, 0)],
      [evaluation('vj', 'Vertical Jump', '2026-09-13', 28.8), evaluation('fx', 'Flexibility', '2026-09-20', 3)],
    ]);
    expect(merged.map((a) => a.tryoutId)).toEqual(['fx', 'lj', 'vj']);
    expect(merged.find((a) => a.tryoutId === 'vj')?.evalCount).toBe(1);
  });
});

describe('the evaluation shown for everyone', () => {
  const people = [person('a', 'Athena', 'Remus'), person('b', 'Yuna', 'Zhu'), person('c', 'Cristianna', 'Soultanis')];
  const assessments = {
    a: [evaluation('lj', 'Long Jump', '2026-09-13', 162.1)],
    b: [evaluation('vj', 'Vertical Jump', '2026-09-14', 19.4), evaluation('lj', 'Long Jump', '2026-09-13', 157.3)],
    // Cristianna: newest is Vertical Jump, as in the report, but she also did Long Jump.
    c: [evaluation('vj', 'Vertical Jump', '2026-09-14', 28.8), evaluation('lj', 'Long Jump', '2026-09-13', 155.6)],
  };

  it('lists the evaluations at least two players were scored in, most shared first', () => {
    const options = sharedEvaluations(['a', 'b', 'c'], assessments);
    expect(options.map((o) => [o.tryoutId, o.players])).toEqual([
      ['lj', 3],
      ['vj', 2],
    ]);
  });

  it('shows the same evaluation for every player by default, not each player\'s newest', () => {
    const table = buildComparison({ candidates: people, assessments, selectedIds: ['a', 'b', 'c'] });
    expect(table.rows.map((r) => r.assessment?.tryoutId)).toEqual(['lj', 'lj', 'lj']);
  });

  it('follows the evaluation the coach picks for everyone, leaving players without it on their own', () => {
    const table = buildComparison({ candidates: people, assessments, selectedIds: ['a', 'b', 'c'], evaluationForAll: 'vj' });
    const byId = Object.fromEntries(table.rows.map((r) => [r.athleteId, r.assessment?.tryoutId]));
    expect(byId).toEqual({ a: 'lj', b: 'vj', c: 'vj' });
  });

  it('lets a per-player choice win', () => {
    const table = buildComparison({ candidates: people, assessments, selectedIds: ['a', 'b', 'c'], choices: { b: 'vj' } });
    expect(table.rows.find((r) => r.athleteId === 'b')?.assessment?.tryoutId).toBe('vj');
  });

  it('falls back to each player\'s own newest scored evaluation when nothing is shared', () => {
    const solo = { a: [evaluation('lj', 'Long Jump', '2026-09-13', 1)], b: [evaluation('vj', 'Vertical Jump', '2026-09-14', 2)] };
    const table = buildComparison({ candidates: people.slice(0, 2), assessments: solo, selectedIds: ['a', 'b'] });
    expect(table.rows.map((r) => r.assessment?.tryoutId).sort()).toEqual(['lj', 'vj']);
  });
});

describe('sharedEvaluations with a missing evaluation name', () => {
  it('does not fail and labels it plainly', () => {
    const nameless = { ...evaluation('x', 'Long Jump', '2026-09-13', 1), tryoutName: undefined as unknown as string };
    const options = sharedEvaluations(['a', 'b'], { a: [nameless], b: [nameless] });
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe('Evaluation');
  });
});
