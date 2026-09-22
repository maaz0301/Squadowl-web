'use client';

import { useState } from 'react';

import { Badge, Button, Card, ErrorState, useAlert } from '@/components/ui';
import { TemplateEditor, type TemplateDraft } from '@/components/letters/TemplateEditor';
import { BUILT_IN_LETTER_TEMPLATES, LETTER_KIND_LABELS } from '@/data/letters';
import type { LetterTemplate } from '@/data/types';
import {
  useCreateLetterTemplateMutation,
  useDeleteLetterTemplateMutation,
  useLetterTemplatesQuery,
  useUpdateLetterTemplateMutation,
} from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * The account's letter templates — the Offer Letter and the Roster Decision
 * Letter, plus any custom ones — listed and edited in place.
 *
 * Templates belong to the account, not to an evaluation, so nothing here needs
 * one: the same list and the same editor appear on the evaluation's Letters
 * page. Only *sending* a letter needs an evaluation, because that is where the
 * players are.
 */
export function LetterTemplatesManager() {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const templatesQuery = useLetterTemplatesQuery();
  const createTemplate = useCreateLetterTemplateMutation();
  const updateTemplate = useUpdateLetterTemplateMutation();
  const deleteTemplate = useDeleteLetterTemplateMutation();
  const [draft, setDraft] = useState<TemplateDraft | null>(null);

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      await alert('Name required', 'Give the template a name so you can find it again.');
      return;
    }
    try {
      if (draft.id) {
        await updateTemplate.mutateAsync({
          id: draft.id,
          updates: { name: draft.name, kind: draft.kind, subject: draft.subject, body: draft.body },
        });
      } else {
        await createTemplate.mutateAsync({
          name: draft.name,
          kind: draft.kind,
          subject: draft.subject,
          body: draft.body,
        });
      }
      setDraft(null);
      // The editor closes on success, which on its own reads the same as it
      // closing because something went wrong.
      toast('Template saved', 'success');
    } catch (e) {
      await alert('Save Error', e instanceof Error ? e.message : 'Could not save the template.');
    }
  };

  const removeTemplate = async (t: LetterTemplate) => {
    const ok = await confirm({
      title: 'Delete template?',
      message: `"${t.name}" will be removed. Letters already sent from it stay on the players' cards.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTemplate.mutateAsync(t.id);
    } catch (e) {
      await alert('Delete Failed', e instanceof Error ? e.message : 'Could not delete the template.');
    }
  };

  const templates = templatesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      {templatesQuery.isLoading ? (
        <p className="text-sm" style={{ color: colors.inkMuted }}>
          Loading templates...
        </p>
      ) : templatesQuery.isError ? (
        <ErrorState message="Could not load your templates." onRetry={() => templatesQuery.refetch()} />
      ) : templates.length === 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            No templates yet. Start from one of the standard letters — you can edit every word of it before
            anything is sent.
          </p>
          <div className="flex flex-wrap gap-2">
            {BUILT_IN_LETTER_TEMPLATES.map((t) => (
              <Button
                key={t.kind}
                label={`Start from ${LETTER_KIND_LABELS[t.kind]}`}
                variant="secondary"
                size="sm"
                onClick={() => setDraft({ name: t.name, kind: t.kind, subject: t.subject, body: t.body })}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <Card key={t.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-bold" style={{ color: colors.ink }}>
                    {t.name}
                  </p>
                  <p className="mt-0.5 truncate text-sm" style={{ color: colors.inkMuted }}>
                    {t.subject || 'No subject'}
                  </p>
                </div>
                <Badge label={LETTER_KIND_LABELS[t.kind]} variant={t.kind === 'offer' ? 'success' : 'info'} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  label="Edit"
                  variant="secondary"
                  size="sm"
                  onClick={() => setDraft({ id: t.id, name: t.name, kind: t.kind, subject: t.subject, body: t.body })}
                />
                <Button label="Delete" variant="ghost" size="sm" onClick={() => removeTemplate(t)} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-1 flex flex-wrap gap-2">
        <Button
          label="+ New Template"
          size="sm"
          variant="secondary"
          onClick={() => setDraft({ name: '', kind: 'custom', subject: '', body: '' })}
        />
      </div>

      <TemplateEditor
        draft={draft}
        saving={createTemplate.isPending || updateTemplate.isPending}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={saveDraft}
      />
    </div>
  );
}
