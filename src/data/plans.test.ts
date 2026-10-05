import { describe, expect, it } from 'vitest';

import {
  assessmentRoom,
  canUseDummyData,
  canUseFeature,
  playerRoom,
  teamRoom,
} from './plans';

describe('dummy-data plan helpers', () => {
  it('is on for every plan unless the founder has switched it off', () => {
    for (const tier of ['free', 'coach', 'coach_plus', 'club'] as const) {
      expect(canUseDummyData(tier)).toBe(true);
      expect(canUseDummyData(tier, [])).toBe(true);
    }
  });

  it('can be switched off for one plan without touching the others', () => {
    expect(canUseDummyData('free', ['free'])).toBe(false);
    expect(canUseDummyData('coach', ['free'])).toBe(true);
    expect(canUseDummyData('club', ['free', 'coach'])).toBe(true);
  });

  it('can be switched off for every plan at once', () => {
    const all = ['free', 'coach', 'coach_plus', 'club'] as const;
    for (const tier of all) expect(canUseDummyData(tier, all)).toBe(false);
  });

  it('leaves only what the plan still allows for players', () => {
    expect(playerRoom('free', 0)).toBe(15);
    expect(playerRoom('free', 10)).toBe(5);
    expect(playerRoom('free', 15)).toBe(0);
    expect(playerRoom('free', 40)).toBe(0);
    expect(playerRoom('coach', 12)).toBe(18);
    expect(playerRoom('club', 5000)).toBe(Number.POSITIVE_INFINITY);
  });

  it('leaves only what the plan still allows for evaluations', () => {
    expect(assessmentRoom('free', 0)).toBe(1);
    expect(assessmentRoom('free', 1)).toBe(0);
    expect(assessmentRoom('coach', 50)).toBe(Number.POSITIVE_INFINITY);
  });

  it('counts purchased team licenses only on tiers that sell them', () => {
    expect(teamRoom('free', 0)).toBe(1);
    expect(teamRoom('free', 1)).toBe(0);
    // A stale license count on a tier that does not sell add-ons changes nothing.
    expect(teamRoom('free', 1, 5)).toBe(0);
    expect(teamRoom('club', 6)).toBe(0);
    expect(teamRoom('club', 6, 3)).toBe(3);
  });
});

describe('AI report card comments', () => {
  it('are on for the Club plan only', () => {
    expect(canUseFeature('club', 'aiReportComments')).toBe(true);
    expect(canUseFeature('coach_plus', 'aiReportComments')).toBe(false);
    expect(canUseFeature('coach', 'aiReportComments')).toBe(false);
    expect(canUseFeature('free', 'aiReportComments')).toBe(false);
  });
});
