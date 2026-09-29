'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Chip, ErrorState, LoadingState, PageHeader, useAlert } from '@/components/ui';
import { useImportScanScoresMutation, useTryoutQuery } from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { useTerms } from '@/lib/terms';
import { parseRosterFile, type ParsedSheet } from '@/lib/rosterImport';
import {
  IDENTITY_FIELDS,
  buildScoreImportRows,
  guessIdentityMapping,
  guessMeasureMapping,
  type IdentityMapping,
  type MeasureMapping,
} from '@/lib/scoreImport';

const SESSION_NAME = 'Excel Import';
const PREVIEW_ROWS = 10;
const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods';

const columnLabel = (header: string, index: number) => (header.trim() ? header.trim() : `Column ${index + 1}`);

/**
 * Import evaluation results from a spreadsheet: pick a file, map its columns to
 * the measures already built into this evaluation, review, then save.
 */
export default function ScanSheetPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const router = useRouter();
  const { alert } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  const importScores = useImportScanScoresMutation();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [identity, setIdentity] = useState<IdentityMapping>({});
  const [mapping, setMapping] = useState<MeasureMapping>({});
  const [reading, setReading] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const tryout = tryoutQuery.data;
  const terms = useTerms(tryout?.settings.customLabels);
  const measures = useMemo(() => tryout?.settings.customRubrics ?? [], [tryout]);

  const rows = useMemo(
    () => (sheet && tryout ? buildScoreImportRows(sheet, tryout.roster, identity, mapping, measures) : []),
    [sheet, tryout, identity, mapping, measures],
  );
  const ready = rows.filter((r) => r.errors.length === 0);
  const skipped = rows.filter((r) => r.errors.length > 0);
  const mappedMeasures = measures.filter((m) => mapping[m.key] != null).length;

  if (tryoutQuery.isLoading) return <LoadingState message="Loading evaluation..." />;
  if (tryoutQuery.isError || !tryout) {
    return (
      <>
        <PageHeader title="Import Scores" showBack backHref={href('roster')} />
        <ErrorState message="Could not load this evaluation." onRetry={() => tryoutQuery.refetch()} />
      </>
    );
  }

  const readFile = async (picked: File | undefined, sheetName?: string) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!picked) return;
    setReading(true);
    try {
      const parsed = await parseRosterFile(picked, sheetName);
      const ident = guessIdentityMapping(parsed.headers);
      setFile(picked);
      setSheet(parsed);
      setIdentity(ident);
      setMapping(guessMeasureMapping(parsed.headers, measures, ident));
    } catch (e) {
      await alert(
        'Could Not Read That File',
        `${e instanceof Error ? e.message : 'Unknown error'}\n\nCSV and Excel files can be read; a PDF cannot.`,
      );
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    const scores = ready.flatMap((r) =>
      Object.entries(r.scores).map(([rubricKey, value]) => ({ playerId: r.player!.id, rubricKey, value })),
    );
    try {
      await importScores.mutateAsync({ tryoutId: id!, scores, session: SESSION_NAME });
      setSavedCount(ready.length);
    } catch (e) {
      await alert('Import Failed', e instanceof Error ? e.message : 'Nothing was saved. Try again.');
    }
  };

  const select = (value: number | null | undefined, onChange: (i: number | null) => void) => (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="rounded-md border px-2 py-1.5 text-sm"
      style={{ backgroundColor: colors.tile, borderColor: colors.border, color: value == null ? colors.inkFaint : colors.primary }}
    >
      <option value="">Not in this file</option>
      {sheet?.headers.map((h, i) => (
        <option key={i} value={i}>
          {columnLabel(h, i)}
        </option>
      ))}
    </select>
  );

  const mapRow = (key: string, label: string, sub: string | undefined, value: number | null | undefined, onChange: (i: number | null) => void) => (
    <div key={key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2" style={{ backgroundColor: colors.tile, borderColor: colors.border }}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold" style={{ color: colors.ink }}>{label}</p>
        {sub ? <p className="text-xs" style={{ color: colors.inkFaint }}>{sub}</p> : null}
      </div>
      {select(value, onChange)}
    </div>
  );

  const heading = (text: string) => (
    <p className="mb-2 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>{text}</p>
  );

  return (
    <div className="max-w-3xl">
      <PageHeader title="Import Scores from Excel" showBack backHref={href('roster')} />
      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => void readFile(e.target.files?.[0])} />

      {measures.length === 0 ? (
        <Card accent className="flex flex-col items-start gap-2">
          <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>Add measures first</span>
          <span style={{ color: colors.inkMuted }}>
            Scores are imported into the measures created in this evaluation, and there are none yet.
          </span>
          <Button label="Go to Measures" onClick={() => router.push(href('rubrics'))} />
        </Card>
      ) : savedCount != null ? (
        <Card accent className="flex flex-col items-center gap-3 py-5">
          <span className="font-bold" style={{ color: colors.success, fontFamily: 'var(--font-space-grotesk)' }}>
            Scores imported for {savedCount} {(savedCount === 1 ? terms.player : terms.players).toLowerCase()}
          </span>
          <Button label="View Results" onClick={() => router.push(href('results'))} />
        </Card>
      ) : !sheet ? (
        <Card accent className="flex flex-col items-start gap-2">
          <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>Import results from a file</span>
          <span style={{ color: colors.inkMuted }}>
            Choose an Excel or CSV file with one row per {terms.player.toLowerCase()}. You will match its columns to this evaluation&apos;s{' '}
            {measures.length} {measures.length === 1 ? 'measure' : 'measures'} before anything is saved.
          </span>
          <Button label="Choose File" loading={reading} onClick={() => fileRef.current?.click()} />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <Card className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold" style={{ color: colors.ink }}>{file?.name}</p>
              <p className="text-sm" style={{ color: colors.inkMuted }}>
                {sheet.rows.length} rows below the headings on line {sheet.headerLine}
              </p>
            </div>
            <Button label="Choose a different file" variant="secondary" size="sm" loading={reading} onClick={() => fileRef.current?.click()} />
          </Card>

          {sheet.sheetNames.length > 1 ? (
            <div>
              {heading('Sheet')}
              <div className="flex flex-wrap">
                {sheet.sheetNames.map((n) => (
                  <Chip key={n} label={n} active={n === sheet.sheetName} onClick={() => void readFile(file ?? undefined, n)} />
                ))}
              </div>
            </div>
          ) : null}

          <div>
            {heading(`Which column is the ${terms.player.toLowerCase()}`)}
            <div className="flex flex-col gap-1.5">
              {IDENTITY_FIELDS.map((f) =>
                mapRow(`id-${f.key}`, f.key === 'jersey' ? terms.jersey : f.label, undefined, identity[f.key], (i) => setIdentity((m) => ({ ...m, [f.key]: i }))),
              )}
            </div>
          </div>

          <div>
            {heading(`Assign a column to each measure (${mappedMeasures}/${measures.length})`)}
            <div className="flex flex-col gap-1.5">
              {measures.map((m) =>
                mapRow(`m-${m.key}`, m.label, m.unit ? `Unit: ${m.unit}` : undefined, mapping[m.key], (i) =>
                  setMapping((prev) => ({ ...prev, [m.key]: i })),
                ),
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge label={`${ready.length} ready`} />
              {skipped.length > 0 ? <Badge label={`${skipped.length} left out`} /> : null}
            </div>
            {rows.slice(0, PREVIEW_ROWS).map((r) => {
              const bad = r.errors.length > 0;
              return (
                <Card key={r.line} className="flex flex-col gap-0.5">
                  <span className="font-bold" style={{ color: bad ? colors.danger : colors.ink }}>
                    {r.player ? `${r.player.first} ${r.player.last}`.trim() : r.label}
                    <span className="ml-2 text-xs font-normal" style={{ color: colors.inkFaint }}>row {r.line}</span>
                  </span>
                  {bad ? (
                    <span className="text-sm" style={{ color: colors.danger }}>{r.errors.join('. ')}</span>
                  ) : (
                    <span className="text-sm" style={{ color: colors.inkMuted }}>
                      {measures.filter((m) => r.scores[m.key] != null).map((m) => `${m.label}: ${r.scores[m.key]}`).join('  ·  ')}
                    </span>
                  )}
                  {r.warnings.length > 0 ? (
                    <span className="text-xs" style={{ color: colors.inkFaint }}>Skipped cells: {r.warnings.join('; ')}</span>
                  ) : null}
                </Card>
              );
            })}
            {rows.length > PREVIEW_ROWS ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>and {rows.length - PREVIEW_ROWS} more rows</p>
            ) : null}
          </div>

          <p className="text-xs" style={{ color: colors.inkFaint }}>
            Saved as the &quot;{SESSION_NAME}&quot; session. Importing again replaces that session&apos;s scores for the same {terms.players.toLowerCase()}.
          </p>
          <Button
            label={`Import ${ready.length} ${(ready.length === 1 ? terms.player : terms.players).toLowerCase()}`}
            loading={importScores.isPending}
            disabled={ready.length === 0 || mappedMeasures === 0}
            onClick={save}
          />
        </div>
      )}
    </div>
  );
}
