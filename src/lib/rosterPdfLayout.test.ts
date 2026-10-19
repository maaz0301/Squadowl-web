import { describe, expect, it } from 'vitest';
import { planRosterPdfColumns } from './rosterPdfLayout';

const measure = (t: string, size: number, bold: boolean) => t.length * size * (bold ? 0.6 : 0.5);

describe('planRosterPdfColumns', () => {
  it('gives each column room for its longest entry', () => {
    const headers = ['Position', 'Team'];
    const rows = [['STAR 5 - Provincial Development', 'Provincial Team']];
    const { widths, size, pageWidth } = planRosterPdfColumns({ headers, rows, measure });
    expect(pageWidth).toBe(842);
    expect(widths[0]).toBeGreaterThanOrEqual(measure(rows[0][0], size, false));
    expect(widths[1]).toBeGreaterThanOrEqual(measure(rows[0][1], size, false));
  });

  it('shrinks the text, then widens the page, rather than cutting a column', () => {
    const headers = Array.from({ length: 14 }, (_, i) => `Column ${i}`);
    const rows = [headers.map(() => 'a fairly long entry here')];
    const plan = planRosterPdfColumns({ headers, rows, measure });
    expect(plan.size).toBeLessThan(8);
    const sum = plan.widths.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(plan.pageWidth - 72 + 1);
    for (let i = 0; i < headers.length; i++) {
      expect(plan.widths[i]).toBeGreaterThanOrEqual(measure(rows[0][i], plan.size, false));
    }
  });
});
