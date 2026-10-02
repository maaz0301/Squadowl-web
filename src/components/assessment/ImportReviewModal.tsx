'use client';

import { useState } from 'react';

import { Badge, Button, Modal } from '@/components/ui';
import type { CustomRubric, Player } from '@/data/types';
import {
  SUGGEST_PRESELECT,
  headingMatches,
  type MeasureMapping,
  type RowResolutions,
  type ScoreImportRow,
} from '@/lib/scoreImport';
import { useThemeColors } from '@/theme/ThemeProvider';

const columnLabel = (header: string, index: number) => (header.trim() ? header.trim() : `Column ${index + 1}`);
const fullName = (p: Player) => `${p.first} ${p.last}`.trim();
const percent = (score: number) => `${Math.round(score * 100)}% match`;

/** The choice for a conflict row: a player id, 'skip', or '' for not decided yet. */
type Choice = string;

/** Start from the best suggestion where it is a close match; anything less is left for the coach to pick. */
function initialChoices(rows: ScoreImportRow[]): Record<number, Choice> {
  const out: Record<number, Choice> = {};
  for (const r of rows) {
    if (!r.conflict) continue;
    const best = r.suggestions[0];
    out[r.line] = best && best.score >= SUGGEST_PRESELECT ? best.player.id : '';
  }
  return out;
}

/**
 * The window between "Import" and the scores being saved. It shows what was
 * guessed so the coach can correct it: which column feeds each measure, which
 * roster player each unrecognised or misspelled name is, and which cells could
 * not be read. Nothing is saved from here until Import is pressed in it.
 */
export function ImportReviewModal({
  visible,
  headers,
  measures,
  mapping,
  onMappingChange,
  rows,
  roster,
  importing,
  playerLabel,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  headers: string[];
  measures: CustomRubric[];
  mapping: MeasureMapping;
  onMappingChange: (key: string, column: number | null) => void;
  /** Rows as matched so far, before any choice made in this window. */
  rows: ScoreImportRow[];
  roster: Player[];
  importing: boolean;
  /** "player" / "athlete" and so on, in the evaluation's own words. */
  playerLabel: string;
  onClose: () => void;
  /** Called with the decisions made here; the page rebuilds the rows from them and saves. */
  onConfirm: (resolutions: RowResolutions) => void;
}) {
  const colors = useThemeColors();
  const conflicts = rows.filter((r) => r.conflict && !r.skipped);
  const [choices, setChoices] = useState<Record<number, Choice>>(() => initialChoices(rows));
  const matches = headingMatches(headers, measures, mapping);
  const withSkippedCells = rows.filter((r) => !r.conflict && r.errors.length === 0 && r.warnings.length > 0);

  const resolutions: RowResolutions = {};
  for (const r of conflicts) {
    const c = choices[r.line];
    if (c === 'skip') resolutions[r.line] = 'skip';
    else if (c) resolutions[r.line] = { playerId: c };
  }
  const undecided = conflicts.filter((r) => !choices[r.line]).length;
  const skipping = conflicts.filter((r) => choices[r.line] === 'skip').length;
  // Two rows pointed at one player would import the second over the first.
  const chosenIds = conflicts.map((r) => choices[r.line]).filter((c) => c && c !== 'skip');
  const duplicates = new Set(chosenIds.filter((id, i) => chosenIds.indexOf(id) !== i));

  const selectStyle = { backgroundColor: colors.tile, borderColor: colors.border, color: colors.ink };
  const heading = (text: string) => (
    <p className="mb-2 mt-1 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
      {text}
    </p>
  );

  return (
    <Modal visible={visible} title="Review before importing" size="lg" onClose={onClose} hideDefaultFooter>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <div>
          {heading('Headings: which column feeds each measure')}
          <div className="flex flex-col gap-1.5">
            {matches.map(({ measure, kind }) => (
              <div
                key={measure.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                style={{ backgroundColor: colors.tile, borderColor: colors.border }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: colors.ink }}>{measure.label}</span>
                  <Badge
                    label={kind === 'exact' ? 'Matches' : kind === 'close' ? 'Close match' : 'Not in file'}
                    variant={kind === 'exact' ? 'success' : kind === 'close' ? 'warning' : 'default'}
                  />
                </div>
                <select
                  value={mapping[measure.key] ?? ''}
                  onChange={(e) => onMappingChange(measure.key, e.target.value === '' ? null : Number(e.target.value))}
                  className="rounded-md border px-2 py-1.5 text-sm"
                  style={selectStyle}
                >
                  <option value="">Not in this file</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {columnLabel(h, i)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div>
          {heading(`Names: ${conflicts.length === 0 ? 'every row matched a ' + playerLabel.toLowerCase() : `${conflicts.length} to confirm`}`)}
          {conflicts.length === 0 ? (
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              Every name in the file matched a {playerLabel.toLowerCase()} on the roster.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {conflicts.map((r) => {
                const chosen = choices[r.line] ?? '';
                const suggestedIds = new Set(r.suggestions.map((s) => s.player.id));
                const others = roster
                  .filter((p) => !suggestedIds.has(p.id))
                  .sort((a, b) => fullName(a).localeCompare(fullName(b)));
                const clash = chosen && chosen !== 'skip' && duplicates.has(chosen);
                return (
                  <div
                    key={r.line}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                    style={{ backgroundColor: colors.tile, borderColor: clash ? colors.danger : colors.border }}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold" style={{ color: colors.ink }}>
                        &quot;{r.label}&quot;
                        <span className="ml-2 text-xs font-normal" style={{ color: colors.inkFaint }}>row {r.line}</span>
                      </p>
                      <p className="text-xs" style={{ color: clash ? colors.danger : colors.inkFaint }}>
                        {clash
                          ? 'Another row is already set to this player.'
                          : r.conflict === 'ambiguous'
                            ? 'More than one player has this name.'
                            : r.suggestions.length > 0
                              ? 'Not on the roster as written. Closest names are listed first.'
                              : 'Not on the roster, and no close name was found.'}
                      </p>
                    </div>
                    <select
                      value={chosen}
                      onChange={(e) => setChoices((c) => ({ ...c, [r.line]: e.target.value }))}
                      className="max-w-full rounded-md border px-2 py-1.5 text-sm"
                      style={{ ...selectStyle, color: chosen ? colors.primary : colors.inkFaint }}
                    >
                      <option value="">Choose a {playerLabel.toLowerCase()}…</option>
                      {r.suggestions.length > 0 ? (
                        <optgroup label="Closest matches">
                          {r.suggestions.map((s) => (
                            <option key={s.player.id} value={s.player.id}>
                              {fullName(s.player)} ({percent(s.score)})
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      <optgroup label={`All ${playerLabel.toLowerCase()}s`}>
                        {others.map((p) => (
                          <option key={p.id} value={p.id}>
                            {fullName(p)}
                            {p.jersey ? ` #${p.jersey}` : ''}
                          </option>
                        ))}
                      </optgroup>
                      <option value="skip">Leave this row out</option>
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {withSkippedCells.length > 0 ? (
          <div>
            {heading('Scores that could not be read')}
            <div className="flex flex-col gap-1">
              {withSkippedCells.map((r) => (
                <p key={r.line} className="text-sm" style={{ color: colors.inkMuted }}>
                  <span className="font-semibold" style={{ color: colors.ink }}>
                    {r.player ? fullName(r.player) : r.label}
                  </span>{' '}
                  (row {r.line}): {r.warnings.join('; ')}
                </p>
              ))}
              <p className="text-xs" style={{ color: colors.inkFaint }}>
                These cells are skipped; the rest of each row is still imported.
              </p>
            </div>
          </div>
        ) : null}

        {undecided > 0 || skipping > 0 ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            {undecided + skipping} {undecided + skipping === 1 ? 'row' : 'rows'} will be left out
            {undecided > 0 ? ` (${undecided} with no ${playerLabel.toLowerCase()} chosen)` : ''}.
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t pt-3" style={{ borderColor: colors.border }}>
          <Button label="Back" variant="secondary" onClick={onClose} disabled={importing} />
          <Button
            label="Import"
            loading={importing}
            disabled={duplicates.size > 0}
            onClick={() => onConfirm(resolutions)}
          />
        </div>
      </div>
    </Modal>
  );
}
