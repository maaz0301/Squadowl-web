import { describe, expect, it } from 'vitest';
import { duplicateRubricName, libraryInputFromRubric, matchesRubricSearch, rubricFromLibrary } from './rubricLibrary';
import type { CustomRubric, RubricLibraryItem } from './types';

const sprint: CustomRubric = {
  key: '30m_sprint',
  label: '30m Sprint',
  scoringType: 'time',
  scale: '1-5',
  unit: 'sec',
  minVal: 4,
  maxVal: 7,
  rankingDirection: 'lower_is_better',
  weight: 20,
};

describe('rubric library', () => {
  it('round-trips a rubric through the library', () => {
    const input = libraryInputFromRubric(sprint, 'Hockey');
    expect(input).toMatchObject({ name: '30m Sprint', sport: 'Hockey', scoringType: 'time' });
    const item: RubricLibraryItem = { id: 'l1', ...input, createdAt: 0, updatedAt: 0 };
    expect(rubricFromLibrary(item)).toEqual({ ...sprint, key: '30m_sprint' });
  });

  it('searches by name, sport and measure type', () => {
    const item: RubricLibraryItem = { id: 'l1', ...libraryInputFromRubric(sprint, 'Hockey'), createdAt: 0, updatedAt: 0 };
    expect(matchesRubricSearch(item, 'sprint')).toBe(true);
    expect(matchesRubricSearch(item, 'hockey')).toBe(true);
    expect(matchesRubricSearch(item, 'time')).toBe(true);
    expect(matchesRubricSearch(item, 'hockey time')).toBe(true);
    expect(matchesRubricSearch(item, 'figure')).toBe(false);
    expect(matchesRubricSearch(item, '')).toBe(true);
  });

  it('names a duplicate without colliding', () => {
    expect(duplicateRubricName('Jump', ['Jump'])).toBe('Jump (copy)');
    expect(duplicateRubricName('Jump', ['Jump', 'jump (copy)'])).toBe('Jump (copy 2)');
  });
});
