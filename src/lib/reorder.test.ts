import { describe, expect, it } from 'vitest';
import { moveItem } from './reorder';

describe('moveItem', () => {
  it('moves an item down and up without touching the original', () => {
    const list = ['right', '2ft', '1ft'];
    expect(moveItem(list, 2, 0)).toEqual(['1ft', 'right', '2ft']);
    expect(moveItem(list, 0, 1)).toEqual(['2ft', 'right', '1ft']);
    expect(list).toEqual(['right', '2ft', '1ft']);
  });

  it('leaves the list alone for a move that goes nowhere', () => {
    expect(moveItem(['a', 'b'], 0, 0)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
  });
});
