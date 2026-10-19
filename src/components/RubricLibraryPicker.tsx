'use client';

import { useState } from 'react';

import { Badge, Button, Input, Modal } from '@/components/ui';
import { matchesRubricSearch } from '@/data/rubricLibrary';
import { SCORING_TYPE_LABELS } from '@/data/rubrics';
import type { RubricLibraryItem } from '@/data/types';
import { useRubricLibraryQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * A searchable list of the rubrics saved in the Rubrics Library. Pick one or
 * more and they are added to the evaluation, no rewriting needed.
 */
export function RubricLibraryPicker({
  visible,
  onClose,
  onPick,
  disabledNames = [],
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (items: RubricLibraryItem[]) => void;
  /** Names already on the evaluation, shown as added and not selectable. */
  disabledNames?: string[];
}) {
  const colors = useThemeColors();
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const libraryQuery = useRubricLibraryQuery({ enabled: visible });

  // Start fresh each time it opens: reset while rendering, the supported way to adjust state when a prop changes.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) {
      setTerm('');
      setSelected(new Set());
    }
  }

  const taken = new Set(disabledNames.map((n) => n.trim().toLowerCase()));
  const items = (libraryQuery.data ?? []).filter((r) => matchesRubricSearch(r, term));

  return (
    <Modal
      visible={visible}
      title="Add from Library"
      onClose={onClose}
      hideDefaultFooter
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button label="Cancel" variant="secondary" onClick={onClose} />
          <Button
            label={selected.size > 0 ? `Add ${selected.size} rubric${selected.size === 1 ? '' : 's'}` : 'Select rubrics to add'}
            disabled={selected.size === 0}
            onClick={() => onPick((libraryQuery.data ?? []).filter((r) => selected.has(r.id)))}
          />
        </div>
      }
    >
      <Input
        placeholder="Search by name, sport or measure type"
        aria-label="Search the Rubrics Library"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <div className="mt-2 max-h-[50vh] overflow-y-auto">
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm" style={{ color: colors.inkMuted }}>
            {libraryQuery.isLoading
              ? 'Loading your library…'
              : libraryQuery.isError
                ? 'Could not load the library.'
                : (libraryQuery.data ?? []).length === 0
                  ? 'Your library is empty. Save rubrics to it from the Rubrics Library or any evaluation.'
                  : 'No rubrics match that search.'}
          </p>
        ) : (
          items.map((item) => {
            const added = taken.has(item.name.trim().toLowerCase());
            const on = selected.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={added}
                onClick={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
                className="flex w-full items-center gap-3 border-b py-2 text-left"
                style={{ borderColor: colors.border, opacity: added ? 0.5 : 1 }}
              >
                <span
                  aria-hidden
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-xs font-bold text-white"
                  style={{
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary : 'transparent',
                  }}
                >
                  {on ? '✓' : ''}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold" style={{ color: colors.ink }}>
                    {item.name}
                  </span>
                  <span className="block truncate text-xs" style={{ color: colors.inkMuted }}>
                    {[SCORING_TYPE_LABELS[item.scoringType], item.sport, item.definition.unit].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {added ? <Badge label="Added" /> : null}
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}
