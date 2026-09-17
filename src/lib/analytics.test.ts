import { describe, expect, it } from 'vitest';

import { featureForPath, featureLabel } from './analytics';

describe('featureForPath', () => {
  it('maps evaluation sub-screens to their feature', () => {
    expect(featureForPath('/assessment/abc/letters')).toBe('selection_letters');
    expect(featureForPath('/assessment/abc/score/p1')).toBe('scoring');
    expect(featureForPath('/assessment/abc/team-builder')).toBe('team_builder');
    expect(featureForPath('/assessment/new')).toBe('new_evaluation');
  });

  it('counts team and season chat as one feature', () => {
    expect(featureForPath('/team/t1/chat')).toBe('team_chat');
    expect(featureForPath('/season/s1/chat')).toBe('team_chat');
  });

  it('ignores screens that are not a feature', () => {
    expect(featureForPath('/dashboard')).toBeNull();
    expect(featureForPath('/assessment/abc/roster')).toBeNull();
    expect(featureForPath('/feedback/reports')).toBeNull();
    expect(featureForPath('/founder')).toBeNull();
  });
});

describe('featureLabel', () => {
  it('falls back to a readable key for features no longer in the catalog', () => {
    expect(featureLabel('selection_letters')).toBe('Selection Letters');
    expect(featureLabel('practice_plan_builder')).toBe('Practice plan builder');
  });
});
