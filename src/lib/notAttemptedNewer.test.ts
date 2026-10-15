import { describe, expect, it } from 'vitest';

import { applyNewerNotAttempted } from './notAttempted';

const ev = (id: string, scores: Record<string, number>, createdAt: number, updatedAt?: number, playerId = 'p1') => ({ id, playerId, scores, createdAt, updatedAt });

describe('applyNewerNotAttempted', () => {
  it('drops an older result once a newer evaluation marks the same test as not attempted', () => {
    const imported = ev('import', { ovr_left: 15.7, vj: 36 }, 100);
    const marked = ev('s1', { 'ovr_left~na': 0 }, 10, 200);
    const [a, b] = applyNewerNotAttempted([imported, marked]);
    expect(a.scores).toEqual({ vj: 36 });
    expect(b.scores).toEqual({ 'ovr_left~na': 0 });
  });

  it('keeps a result that is newer than the not-attempted mark', () => {
    const marked = ev('s1', { 'ovr_left~na': 0 }, 10, 50);
    const later = ev('s2', { ovr_left: 12 }, 100);
    expect(applyNewerNotAttempted([marked, later])[1].scores).toEqual({ ovr_left: 12 });
  });

  it('only affects the same player and the same test', () => {
    const other = ev('o', { ovr_left: 9 }, 100, undefined, 'p2');
    const same = ev('i', { ovr_left: 15, vj: 30 }, 100);
    const marked = ev('m', { 'ovr_left~na': 0 }, 10, 200);
    const out = applyNewerNotAttempted([other, same, marked]);
    expect(out[0].scores).toEqual({ ovr_left: 9 });
    expect(out[1].scores).toEqual({ vj: 30 });
  });

  it('returns the same array when nothing is marked', () => {
    const list = [ev('a', { x: 1 }, 1), ev('b', { x: 2 }, 2)];
    expect(applyNewerNotAttempted(list)).toBe(list);
  });
});
