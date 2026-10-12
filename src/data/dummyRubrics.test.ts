import { describe, expect, it } from 'vitest';

import { generateDummyRubrics } from '@/data/testDataGenerator';
import { resolveWeights } from '@/data/rubrics';

describe('dummy rubrics', () => {
  it('carry explicit weights that add up to exactly 100%', () => {
    const rubrics = generateDummyRubrics();
    expect(rubrics.every((r) => r.weight != null)).toBe(true);
    expect(rubrics.reduce((sum, r) => sum + (r.weight ?? 0), 0)).toBe(100);
    expect(resolveWeights(rubrics.map((r) => r.weight)).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('read naturally for the sport the dummy team is for', () => {
    expect(generateDummyRubrics('Hockey')[0].label).toBe('Skating');
    expect(generateDummyRubrics('Baseball')[0].label).toBe('Movement');
    expect(generateDummyRubrics('Baseball').map((r) => r.label)).not.toContain('Forecheck');
  });
});
