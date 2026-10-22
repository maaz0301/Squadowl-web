import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';
import { buildComparison, columnId, type CompareAssessment, type CompareCandidate } from '@/data/compare';
import { buildCompareExportTable, buildCompareFile } from './compareExport';

const skating = columnId('Skating');
const people: CompareCandidate[] = Array.from({ length: 100 }, (_, i) => ({
  id: `p${i}`,
  first: `Player${i}`,
  last: i === 0 ? 'Łukasz Émile' : 'Test',
  dateOfBirth: '2014-05-02',
  teams: [{ teamId: 't', teamName: 'Hawks' }],
}));
const assessments: Record<string, CompareAssessment[]> = {};
people.forEach((p, i) => {
  assessments[p.id] = [
    {
      tryoutId: 't1',
      tryoutName: 'Fall Eval',
      date: '2026-10-01',
      overall: 1 + (i % 5),
      evalCount: 1,
      scores: { [skating]: 1 + (i % 5) },
      columns: { [skating]: { label: 'Skating', benchmark: '4/5' } },
    },
  ];
});
const table = buildComparison({ candidates: people, assessments, selectedIds: people.map((p) => p.id) });

describe('compare export', () => {
  it('builds one row per player with benchmarks in the headers and the best cell flagged', () => {
    const t = buildCompareExportTable(table);
    expect(t.rows).toHaveLength(100);
    expect(t.headers[t.headers.length - 1]).toBe('Skating (benchmark 4/5)');
    expect(t.rows[0][0]).toBe(1);
    expect(t.top[0][t.headers.length - 1]).toBe(true);
  });
  it('writes a sortable Excel sheet with numeric scores', async () => {
    const f = await buildCompareFile({ title: 'U10 All Teams Oct 2026', table, format: 'xlsx' });
    expect(f.fileName).toBe('u10-all-teams-oct-2026.xlsx');
    const wb = XLSX.read(f.content, { type: 'base64' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Comparison);
    expect(rows).toHaveLength(100);
    expect(typeof rows[0]['Overall']).toBe('number');
  });
  it('paginates 100 players across several PDF pages without choking on accented names', async () => {
    const f = await buildCompareFile({ title: 'U10 All Teams Oct 2026', table, format: 'pdf', comparedOn: '2026-10-22' });
    const pdf = await PDFDocument.load(Buffer.from(f.content, 'base64'));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
});
