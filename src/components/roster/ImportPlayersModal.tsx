'use client';

import { useTerms } from '@/lib/terms';
import { useMemo, useRef, useState } from 'react';

import { Badge, Button, Modal, Select, Spinner, useAlert } from '@/components/ui';
import {
  IMPORT_FIELDS,
  buildImportRows,
  guessMapping,
  parseRosterFile,
  type ColumnMapping,
  type ImportRow,
  type ParsedSheet,
} from '@/lib/rosterImport';
import type { AddPlayerForm, PlayerImportResult } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls,.xlsm,.ods';

/**
 * Safety ceiling on how many rows the preview table renders. The table itself
 * scrolls so a normal roster (tens to a few hundred rows) is reviewable in
 * full — this only guards against a pathological spreadsheet with tens of
 * thousands of rows turning into that many table rows in the DOM at once.
 */
const MAX_PREVIEW_ROWS = 500;

type Colors = ReturnType<typeof useThemeColors>;

function UploadIcon({ color }: { color: string }) {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8}>
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Import a roster from a spreadsheet: drop a file, confirm which column is
 * which, see what comes out, then write it.
 *
 * The mapping step is the point of the whole thing — no two clubs head their
 * columns the same way, so the file is read, guessed at, and shown back rather
 * than assumed to be in some documented shape. Nothing is created until the
 * coach has seen the rows that are about to be.
 */
export function ImportPlayersModal({
  labels,
  visible,
  onClose,
  target,
  onImport,
  atLimit = false,
  onLimitReached,
}: {
  /** The evaluation's own names, when opened from one. */
  labels?: import('@/data/types').CustomLabels;
  visible: boolean;
  onClose: () => void;
  /** Names what the players are being added to, for the copy. */
  target: string;
  /**
   * The roster is at the plan's player cap. "Import more" then closes the dialog
   * and hands over to `onLimitReached` (the limit message) instead of reopening
   * the file picker — same rule as the screen's own import button.
   */
  atLimit?: boolean;
  onLimitReached?: () => void;
  onImport: (
    rows: { line: number; form: AddPlayerForm }[],
    onProgress: (done: number) => void,
  ) => Promise<PlayerImportResult>;
}) {
  const colors = useThemeColors();
  const terms = useTerms(labels);
  const { alert } = useAlert();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<PlayerImportResult | null>(null);
  /**
   * File lines the coach has struck off the import, by line number.
   *
   * Dropped from the sheet *before* the rows are built rather than filtered out
   * of the result: the duplicate check inside buildImportRows keeps the first
   * occurrence and flags the rest, so removing the row a duplicate points at
   * has to let the survivor be rebuilt as the first one. Filtering afterwards
   * would leave it reading "Same player as row 4" against a row that is gone.
   */
  const [removed, setRemoved] = useState<ReadonlySet<number>>(() => new Set());

  const kept = useMemo(
    () => (sheet ? { ...sheet, rows: sheet.rows.filter((r) => !removed.has(r.line)) } : null),
    [sheet, removed],
  );
  const rows = useMemo(() => (kept ? buildImportRows(kept, mapping) : []), [kept, mapping]);
  const ready = rows.filter((r) => r.errors.length === 0);
  const skipped = rows.filter((r) => r.errors.length > 0);
  const importing = progress !== null;

  const removeLines = (lines: number[]) =>
    setRemoved((prev) => {
      const next = new Set(prev);
      for (const line of lines) next.add(line);
      return next;
    });

  const reset = () => {
    setFile(null);
    setSheet(null);
    setMapping({});
    setProgress(null);
    setResult(null);
    setRemoved(new Set());
  };

  const close = () => {
    if (importing) return;
    reset();
    onClose();
  };

  const readFile = async (picked: File | undefined, sheetName?: string) => {
    if (!picked) return;
    setReading(true);
    try {
      const parsed = await parseRosterFile(picked, sheetName);
      setFile(picked);
      setSheet(parsed);
      setMapping(guessMapping(parsed.headers));
      setResult(null);
      // Line numbers mean nothing across a different file or a different tab of
      // the same workbook, so removals can't carry over. Re-mapping columns
      // deliberately *does* keep them — that is the same rows, read differently.
      setRemoved(new Set());
    } catch (e) {
      await alert(
        'Could Not Read That File',
        `${e instanceof Error ? e.message : 'Unknown error'}\n\nCSV and Excel files can be read; a PDF cannot.`,
      );
    } finally {
      setReading(false);
    }
  };

  const runImport = async () => {
    setProgress({ done: 0, total: ready.length });
    try {
      setResult(
        await onImport(
          ready.map(({ line, form }) => ({ line, form })),
          (done) => setProgress({ done, total: ready.length }),
        ),
      );
    } catch (e) {
      await alert('Import Failed', e instanceof Error ? e.message : 'Could not import these players.');
    } finally {
      setProgress(null);
    }
  };

  const columnOptions = (parsed: ParsedSheet) => [
    { value: '', label: '— not in this file —' },
    ...parsed.headers.map((header, i) => ({
      value: String(i),
      // A blank heading still has to be pickable, and a column letter is how
      // the coach sees it in Excel anyway.
      label: header || `Column ${String.fromCharCode(65 + i)}`,
    })),
  ];

  return (
    <Modal visible={visible} title={terms.t(`Import Players into ${target}`)} size="lg" onClose={close} hideDefaultFooter>
      {result ? (
        <ImportSummary result={result} terms={terms} onDone={close}
          onAgain={() => {
            if (atLimit) {
              close();
              onLimitReached?.();
            } else {
              reset();
            }
          }} colors={colors} />
      ) : !sheet ? (
        <div className="flex flex-col gap-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void readFile(e.dataTransfer.files?.[0]);
            }}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors"
            style={{
              borderColor: dragging ? colors.primary : colors.border,
              backgroundColor: dragging ? `${colors.primary}14` : colors.tile,
            }}
          >
            {reading ? (
              <Spinner size={24} color={colors.primary} />
            ) : (
              <UploadIcon color={dragging ? colors.primary : colors.inkMuted} />
            )}
            <span className="font-bold" style={{ color: colors.ink }}>
              {reading ? 'Reading the file…' : 'Drag a roster file here'}
            </span>
            <span className="text-sm" style={{ color: colors.inkMuted }}>
              or click to choose one — Excel (.xlsx, .xls) or CSV
            </span>
          </div>
          <p className="text-xs" style={{ color: colors.inkFaint }}>
            {terms.t('One player per row, with a heading row above them.')} Whatever your columns are called, you&apos;ll match
            them up on the next step. PDFs can&apos;t be read — export the roster as CSV or Excel first.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold" style={{ color: colors.ink }}>{file?.name}</p>
              <p className="text-sm" style={{ color: colors.inkMuted }}>
                {removed.size > 0
                  ? `${rows.length} of ${sheet.rows.length} rows kept — ${removed.size} removed`
                  : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'} below the headings on line ${sheet.headerLine}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {sheet.sheetNames.length > 1 ? (
                <Select
                  aria-label="Sheet"
                  value={sheet.sheetName}
                  disabled={importing}
                  onChange={(e) => void readFile(file ?? undefined, e.target.value)}
                  options={sheet.sheetNames.map((n) => ({ value: n, label: n }))}
                  containerClassName="min-w-[160px]"
                />
              ) : null}
              <Button label="Choose another file" variant="ghost" size="sm" disabled={importing} onClick={reset} />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
              Which column is which
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <Select
                  key={field.key}
                  label={terms.t(field.label)}
                  disabled={importing}
                  value={mapping[field.key] == null ? '' : String(mapping[field.key])}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [field.key]: e.target.value === '' ? null : Number(e.target.value) }))
                  }
                  options={columnOptions(sheet)}
                />
              ))}
            </div>
          </div>

          <RowPreview
            rows={rows}
            colors={colors}
            disabled={importing}
            removedCount={removed.size}
            onRemove={(lines) => removeLines(lines)}
            onRestore={() => setRemoved(new Set())}
            t={terms.t}
          />

          {importing ? (
            <div className="flex items-center gap-3">
              <Spinner size={18} color={colors.primary} />
              <span className="text-sm font-semibold" style={{ color: colors.ink }}>
                Adding {progress.done} of {progress.total}…
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                label={
                  ready.length === 0
                    ? 'Nothing to import'
                    : `Import ${ready.length} ${(ready.length === 1 ? terms.player : terms.players).toLowerCase()}`
                }
                disabled={ready.length === 0}
                onClick={runImport}
              />
              {skipped.length > 0 ? (
                <span className="text-sm" style={{ color: colors.inkMuted }}>
                  {skipped.length} {skipped.length === 1 ? 'row is' : 'rows are'} being left out — see below.
                </span>
              ) : null}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function RowPreview({
  rows,
  colors,
  disabled,
  removedCount,
  onRemove,
  onRestore,
  t,
}: {
  t: (text: string) => string;
  rows: ImportRow[];
  colors: Colors;
  disabled: boolean;
  removedCount: number;
  /** Strike these file lines off the import. */
  onRemove: (lines: number[]) => void;
  /** Put every removed line back. */
  onRestore: () => void;
}) {
  // Bad rows first: they are the ones the coach has to decide about, and a
  // wrong column mapping shows up in them before anywhere else.
  const ordered = [...rows].sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0));
  const shown = ordered.slice(0, MAX_PREVIEW_ROWS);
  const incomplete = rows.filter((r) => r.errors.length > 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          What will be added
        </p>
        <div className="flex items-center gap-2">
          {/* Clearing the unusable rows in one go is the common case: they are
              sorted to the top, so on a sheet with a few bad lines they are all
              the coach can see of the preview until they go. */}
          {incomplete.length > 0 ? (
            <Button
              label={`Remove ${incomplete.length} incomplete`}
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onRemove(incomplete.map((r) => r.line))}
            />
          ) : null}
          {removedCount > 0 ? (
            <Button
              label={`Restore ${removedCount} removed`}
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={onRestore}
            />
          ) : null}
        </div>
      </div>
      {/* max-h + overflow-y-auto (alongside the x-scroll already needed for
          narrow modals) is what makes every row reachable instead of only the
          first handful — a 400-row sheet used to hard-stop at 8 with no way
          to see or remove the rest. The header stays `sticky` so the column
          labels don't scroll out of view on a long list. */}
      <div className="max-h-[26rem] overflow-auto rounded-xl border" style={{ borderColor: colors.border }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr style={{ backgroundColor: colors.tile }}>
              {['Row', 'Name', 'Email', t('Jersey'), 'Pos', 'Born', '', ''].map((h, i) => (
                <th
                  key={h || `blank-${i}`}
                  className="whitespace-nowrap px-3 py-2 text-left text-xs font-bold uppercase tracking-wider"
                  style={{ color: colors.inkMuted }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr className="border-t" style={{ borderColor: colors.border }}>
                <td colSpan={8} className="px-3 py-6 text-center text-sm" style={{ color: colors.inkMuted }}>
                  Every row has been removed. Restore them, or choose another file.
                </td>
              </tr>
            ) : null}
            {shown.map((row) => (
              <tr key={row.line} className="border-t" style={{ borderColor: colors.border }}>
                <td className="px-3 py-2" style={{ color: colors.inkMuted }}>{row.line}</td>
                <td className="px-3 py-2 font-semibold" style={{ color: colors.ink }}>{row.display.name}</td>
                <td className="px-3 py-2" style={{ color: colors.inkMuted }}>{row.display.email || '—'}</td>
                <td className="px-3 py-2" style={{ color: colors.inkMuted }}>{row.form.jersey || '—'}</td>
                <td className="px-3 py-2" style={{ color: colors.inkMuted }}>{row.form.pos || '—'}</td>
                <td className="px-3 py-2" style={{ color: colors.inkMuted }}>{row.form.yearOfBirth || '—'}</td>
                <td className="px-3 py-2">
                  {row.errors.length > 0 ? (
                    <span className="text-xs font-semibold" style={{ color: colors.danger }}>
                      {row.errors.join('; ')}
                    </span>
                  ) : (
                    <Badge label="Ready" variant="success" />
                  )}
                </td>
                <td className="px-3 py-2">
                  {/* Per row, so a Ready player the coach doesn't want can go
                      too — until now the only way to leave one out was to edit
                      the spreadsheet and start over. */}
                  <button
                    type="button"
                    aria-label={`Remove row ${row.line}, ${row.display.name}`}
                    title="Leave this row out of the import"
                    disabled={disabled}
                    onClick={() => onRemove([row.line])}
                    className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:brightness-125 disabled:opacity-40"
                    style={{ backgroundColor: colors.tile }}
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                      <path d="M6 6l12 12M18 6L6 18" stroke={colors.inkMuted} strokeWidth={2} strokeLinecap="round" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length ? (
        <p className="mt-1.5 text-xs" style={{ color: colors.inkFaint }}>
          Showing the first {shown.length} of {rows.length} rows. Remove some below, or split the file, to
          review the rest.
        </p>
      ) : rows.length > 0 ? (
        <p className="mt-1.5 text-xs" style={{ color: colors.inkFaint }}>
          All {rows.length} {rows.length === 1 ? 'row is' : 'rows are'} listed above — scroll to see the rest.
        </p>
      ) : null}
    </div>
  );
}

function ImportSummary({
  result,
  terms,
  onDone,
  onAgain,
  colors,
}: {
  result: PlayerImportResult;
  terms: { player: string; players: string };
  onDone: () => void;
  onAgain: () => void;
  colors: Colors;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg font-bold" style={{ color: colors.ink }}>
        {result.added} {(result.added === 1 ? terms.player : terms.players).toLowerCase()} added
      </p>
      {result.failed.length > 0 ? (
        <div>
          <p className="mb-2 text-sm font-bold" style={{ color: colors.danger }}>
            {result.failed.length} {result.failed.length === 1 ? 'row' : 'rows'} could not be added
          </p>
          <div className="flex flex-col gap-1.5">
            {result.failed.map((f) => (
              <p key={`${f.line}-${f.name}`} className="text-sm" style={{ color: colors.inkMuted }}>
                <span className="font-semibold" style={{ color: colors.ink }}>
                  Row {f.line} · {f.name}
                </span>{' '}
                — {f.message}
              </p>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button label="Done" onClick={onDone} />
        <Button label="Import another file" variant="secondary" onClick={onAgain} />
      </div>
    </div>
  );
}
