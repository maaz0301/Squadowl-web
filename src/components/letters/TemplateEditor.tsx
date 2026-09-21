'use client';

import { Badge, Button, Chip, Input, Modal, ModalFooter, SectionLabel, Select, Textarea } from '@/components/ui';
import {
  BUILT_IN_LETTER_TEMPLATES,
  LETTER_KINDS,
  LETTER_KIND_DESCRIPTIONS,
  LETTER_KIND_LABELS,
  LETTER_PLACEHOLDERS,
  type LetterKind,
} from '@/data/letters';
import { useThemeColors } from '@/theme/ThemeProvider';

/** The template editor's working copy — a new template until it has an id. */
export interface TemplateDraft {
  id?: string;
  name: string;
  kind: LetterKind;
  subject: string;
  body: string;
}

/**
 * The letter template editor. Shared by the evaluation's Letters page and the
 * team's Options tab, so a template reads and edits the same wherever it is
 * opened from.
 */
export function TemplateEditor({
  draft,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  draft: TemplateDraft | null;
  saving: boolean;
  onChange: (d: TemplateDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Modal
      visible={!!draft}
      title={draft?.id ? 'Edit Template' : 'New Template'}
      size="lg"
      onClose={onClose}
      footer={
        <ModalFooter>
          <Button label="Save Template" loading={saving} onClick={onSave} />
        </ModalFooter>
      }
    >
      {draft ? (
        <div className="flex flex-col gap-3">
          <Input
            label="Template name"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="e.g. U15 AAA Offer Letter"
          />
          <Select
            label="Type"
            value={draft.kind}
            hint={LETTER_KIND_DESCRIPTIONS[draft.kind]}
            onChange={(e) => onChange({ ...draft, kind: e.target.value as LetterKind })}
            options={LETTER_KINDS.map((k) => ({ value: k, label: LETTER_KIND_LABELS[k] }))}
          />
          <Input
            label="Subject"
            value={draft.subject}
            onChange={(e) => onChange({ ...draft, subject: e.target.value })}
          />
          <Textarea
            label="Letter"
            rows={16}
            value={draft.body}
            onChange={(e) => onChange({ ...draft, body: e.target.value })}
            hint="Click a placeholder below to add it where the cursor last was, or type it yourself."
          />

          {/* Only the standard letters carry pre-written wording, so offering
              them here is what makes "start from the template" reachable when a
              coach is already halfway through writing their own. */}
          {!draft.id ? (
            <div>
              <SectionLabel className="mb-1.5">Start from a standard letter</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {BUILT_IN_LETTER_TEMPLATES.map((t) => (
                  <Chip
                    key={t.kind}
                    label={LETTER_KIND_LABELS[t.kind]}
                    onClick={() =>
                      onChange({
                        ...draft,
                        name: draft.name || t.name,
                        kind: t.kind,
                        subject: t.subject,
                        body: t.body,
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <SectionLabel className="mb-1.5">Placeholders</SectionLabel>
            <div className="flex flex-col gap-1">
              {LETTER_PLACEHOLDERS.map((p) => (
                <button
                  key={p.token}
                  type="button"
                  onClick={() => onChange({ ...draft, body: `${draft.body}{{${p.token}}}` })}
                  className="flex flex-wrap items-baseline gap-2 rounded-lg px-2 py-1 text-left hover:brightness-125"
                  style={{ backgroundColor: colors.tile }}
                >
                  <code className="text-xs font-bold" style={{ color: colors.primary }}>
                    {`{{${p.token}}}`}
                  </code>
                  <span className="text-xs" style={{ color: colors.inkMuted }}>
                    {p.auto ? p.hint : `${p.hint}`}
                  </span>
                  {!p.auto ? <Badge label="you write this" variant="warning" /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
