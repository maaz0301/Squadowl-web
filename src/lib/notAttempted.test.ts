import { describe, expect, it } from 'vitest';

import { allNotAttempted, isNotAttempted, notAttemptedKey, withAllNotAttempted, withNotAttempted, withScore, withoutAnyNotAttempted, withoutScore } from './notAttempted';

describe('did not attempt', () => {
  it('marks a test with no result and keeps the other scores', () => {
    const next = withNotAttempted({ jump: 30, sit: 273 }, 'sit');
    expect(next).toEqual({ jump: 30, [notAttemptedKey('sit')]: 0 });
    expect(isNotAttempted(next, 'sit')).toBe(true);
    expect(isNotAttempted(next, 'jump')).toBe(false);
  });

  it('entering a result takes the marker off', () => {
    const next = withScore(withNotAttempted({}, 'sit'), 'sit', 90);
    expect(next).toEqual({ sit: 90 });
    expect(isNotAttempted(next, 'sit')).toBe(false);
  });

  it('clearing removes both the result and the marker', () => {
    expect(withoutScore(withNotAttempted({ jump: 1 }, 'sit'), 'sit')).toEqual({ jump: 1 });
    expect(withoutScore({ sit: 5 }, 'sit')).toEqual({});
  });

  it('marks and unmarks a whole list of tests at once', () => {
    const all = withAllNotAttempted({ jump: 30, sit: 273, extra: 5 }, ['jump', 'sit']);
    expect(all).toEqual({ extra: 5, [notAttemptedKey('jump')]: 0, [notAttemptedKey('sit')]: 0 });
    expect(allNotAttempted(all, ['jump', 'sit'])).toBe(true);
    expect(allNotAttempted(all, ['jump', 'sit', 'other'])).toBe(false);
    expect(allNotAttempted(all, [])).toBe(false);
    expect(withoutAnyNotAttempted(all, ['jump', 'sit'])).toEqual({ extra: 5 });
  });

  it('never looks like a score to a "has a score" check', () => {
    const marker = Object.values(withNotAttempted({}, 'sit'));
    expect(marker.some((v) => v > 0)).toBe(false);
  });
});
