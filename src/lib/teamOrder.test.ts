import { describe, expect, it } from 'vitest';
import { applyTeamOrder, reorderedTeamIds } from './teamOrder';

const t = (id: string) => ({ id });

describe('team order', () => {
  it('keeps the default order when nothing is saved', () => {
    expect(applyTeamOrder([t('a'), t('b')], undefined).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('follows the saved order, puts new teams last and skips deleted ones', () => {
    const out = applyTeamOrder([t('a'), t('b'), t('c'), t('new')], ['c', 'gone', 'a']);
    expect(out.map((x) => x.id)).toEqual(['c', 'a', 'b', 'new']);
  });
  it('moves a team', () => {
    expect(reorderedTeamIds([t('a'), t('b'), t('c')], 2, 0)).toEqual(['c', 'a', 'b']);
  });
});
