'use client';

import { useMemo, useState } from 'react';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, CardGridSkeleton, EmptyState, ErrorState, Input, PageHeader, useAlert } from '@/components/ui';
import { RubricLibraryFormModal } from '@/components/RubricLibraryFormModal';
import { duplicateRubricName, matchesRubricSearch } from '@/data/rubricLibrary';
import { SCORING_TYPE_LABELS } from '@/data/rubrics';
import type { RubricLibraryInput, RubricLibraryItem } from '@/data/types';
import {
  useCreateRubricLibraryItemMutation,
  useDeleteRubricLibraryItemMutation,
  useRubricLibraryQuery,
  useUpdateRubricLibraryItemMutation,
} from '@/features/queries';

/**
 * The Rubrics Library: rubrics a coach builds once and reuses across teams and
 * evaluations. Build one here, then add it to any evaluation with "Add from Library".
 */
export default function RubricLibraryPage() {
  const colors = useThemeColors();
  const { alert, confirm } = useAlert();
  const libraryQuery = useRubricLibraryQuery();
  const create = useCreateRubricLibraryItemMutation();
  const update = useUpdateRubricLibraryItemMutation();
  const remove = useDeleteRubricLibraryItemMutation();
  const [term, setTerm] = useState('');
  const [form, setForm] = useState<{ item: RubricLibraryItem | null } | null>(null);

  const items = useMemo(() => (libraryQuery.data ?? []).filter((r) => matchesRubricSearch(r, term)), [libraryQuery.data, term]);

  const save = async (input: RubricLibraryInput) => {
    try {
      if (form?.item) await update.mutateAsync({ id: form.item.id, input });
      else await create.mutateAsync(input);
      setForm(null);
    } catch (e) {
      await alert('Could not save', e instanceof Error ? e.message : 'Could not save this rubric.');
    }
  };

  const duplicate = async (item: RubricLibraryItem) => {
    const { createdAt: _c, updatedAt: _u, id: _id, ...rest } = item;
    try {
      await create.mutateAsync({
        ...rest,
        name: duplicateRubricName(item.name, (libraryQuery.data ?? []).map((r) => r.name)),
      });
    } catch (e) {
      await alert('Could not duplicate', e instanceof Error ? e.message : 'Could not duplicate this rubric.');
    }
  };

  const confirmDelete = async (item: RubricLibraryItem) => {
    const ok = await confirm({
      title: 'Delete rubric',
      message: `Delete "${item.name}" from your library? Evaluations that already use it keep their copy.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(item.id);
    } catch (e) {
      await alert('Could not delete', e instanceof Error ? e.message : 'Could not delete this rubric.');
    }
  };

  return (
    <>
      <PageHeader title="Rubrics Library" right={<Button label="+ New Rubric" size="sm" onClick={() => setForm({ item: null })} />} />
      <div className="mb-3">
        <Input
          placeholder="Search by name, sport or measure type"
          aria-label="Search the Rubrics Library"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      {libraryQuery.isLoading ? (
        <CardGridSkeleton count={6} lines={2} />
      ) : libraryQuery.isError ? (
        <ErrorState message="Could not load the Rubrics Library." onRetry={() => libraryQuery.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={term ? 'No matches' : 'No saved rubrics yet'}
          message={
            term
              ? 'Try a different name, sport or measure type.'
              : 'Build rubrics here once, then add them to any evaluation with Add from Library.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <Card key={item.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold" style={{ color: colors.ink }}>
                  {item.name}
                </span>
                <Badge label={SCORING_TYPE_LABELS[item.scoringType]} variant="brand" />
                {item.sport ? <Badge label={item.sport} /> : null}
                {item.definition.category ? <Badge label={item.definition.category} /> : null}
              </div>
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                {[
                  item.definition.unit ? `Unit: ${item.definition.unit}` : item.definition.scale ? `${item.definition.scale} scale` : '',
                  item.definition.rankingDirection === 'lower_is_better' ? 'Lowest ranks best' : '',
                  item.definition.weight != null ? `Weight ${item.definition.weight}%` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="flex gap-2">
                <Button label="Edit" size="sm" variant="secondary" onClick={() => setForm({ item })} />
                <Button label="Duplicate" size="sm" variant="secondary" onClick={() => void duplicate(item)} />
                <Button label="Delete" size="sm" variant="ghost" onClick={() => void confirmDelete(item)} />
              </div>
            </Card>
          ))}
        </div>
      )}
      {form ? (
        <RubricLibraryFormModal
          key={form.item?.id ?? 'new'}
          visible
          item={form.item}
          saving={create.isPending || update.isPending}
          onClose={() => setForm(null)}
          onSave={(input) => void save(input)}
        />
      ) : null}
    </>
  );
}
