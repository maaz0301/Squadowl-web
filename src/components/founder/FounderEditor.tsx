'use client';

import { useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { Badge, Button, Chip, Input, Modal, ModalFooter, Select, Textarea, useAlert } from '@/components/ui';
import { TeamColorPicker } from '@/components/TeamColorPicker';
import { EVENT_TYPES, RECOMMENDATIONS, type Evaluation } from '@/data/types';
import * as writes from '@/data/founder/founderWrites';
import { useFounderSave } from '@/features/founderQueries';

/**
 * One form, many edits. A founder page describes the fields and the save, and
 * this renders the modal, runs the save through useFounderSave() (which
 * refreshes every founder read) and reports failures — so each page only
 * decides *what* is edited, not how.
 */

export interface FounderField {
  key: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'date' | 'time' | 'textarea' | 'select' | 'choice' | 'color';
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** Shown before the fields, e.g. a group heading. */
  section?: string;
  /** Help text under the field. */
  hint?: string;
  /** Only shown (and only saved) while this returns true for the current values. */
  showWhen?: (values: Record<string, string>) => boolean;
}

// ─── "Updated just now" ──────────────────────────────────────────────────────

/** How long an edited row keeps its "Updated just now" badge. */
const RECENT_MS = 60_000;

/**
 * Which rows the founder just changed, by id. In memory only: it exists to
 * point at the thing that moved after a save, not to be a history. Each mark
 * clears itself after RECENT_MS; saving the same row again restarts its clock.
 */
const useRecentUpdates = create<{ ids: Record<string, number> }>(() => ({ ids: {} }));
let markSeq = 0;

function markUpdated(id: string | string[] | undefined) {
  const ids = (Array.isArray(id) ? id : [id]).filter((x): x is string => !!x);
  if (!ids.length) return;
  const seq = ++markSeq;
  useRecentUpdates.setState((s) => ({ ids: { ...s.ids, ...Object.fromEntries(ids.map((x) => [x, seq])) } }));
  setTimeout(() => {
    useRecentUpdates.setState((s) => {
      const next = { ...s.ids };
      for (const x of ids) if (next[x] === seq) delete next[x];
      return { ids: next };
    });
  }, RECENT_MS);
}

/** Shown on a row for a minute after the founder saves a change to it. */
export function UpdatedBadge({ id }: { id: string | undefined }) {
  const recent = useRecentUpdates((s) => !!id && id in s.ids);
  return recent ? <Badge label="Updated just now" variant="success" /> : null;
}

export interface FounderEditConfig {
  title: string;
  fields: FounderField[];
  /** Pre-filled values by field key; anything without a matching field is ignored. */
  initial: object;
  saveLabel?: string;
  successMessage?: string;
  onSave: (values: Record<string, string>) => Promise<unknown>;
  /** Row id(s) that get the "Updated just now" badge once the save lands. */
  updatedId?: string | string[];
}

export function useFounderEditor(): { edit: (config: FounderEditConfig) => void; modal: ReactNode } {
  const [config, setConfig] = useState<FounderEditConfig | null>(null);
  const modal = config ? <FounderEditModal key={config.title} config={config} onClose={() => setConfig(null)} /> : null;
  return { edit: setConfig, modal };
}

function FounderEditModal({ config, onClose }: { config: FounderEditConfig; onClose: () => void }) {
  const { alert, toast } = useAlert();
  const save = useFounderSave();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      config.fields.map((f) => {
        const value = (config.initial as Record<string, unknown>)[f.key];
        return [f.key, value == null ? '' : String(value)];
      }),
    ),
  );
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const submit = async () => {
    try {
      // A hidden field keeps its typed value in state, but it isn't part of the save.
      const visible = Object.fromEntries(
        config.fields.filter((f) => !f.showWhen || f.showWhen(values)).map((f) => [f.key, values[f.key] ?? '']),
      );
      const result = await save.mutateAsync(() => config.onSave(visible));
      // An add returns its new row's id, so the new row gets the badge too.
      markUpdated(config.updatedId ?? (typeof result === 'string' ? result : undefined));
      toast(config.successMessage ?? 'Saved.', 'success');
      onClose();
    } catch (e) {
      await alert('Could Not Save', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  return (
    <Modal
      visible
      title={config.title}
      size="md"
      onClose={onClose}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={onClose} />
          <Button label={config.saveLabel ?? 'Save'} loading={save.isPending} onClick={submit} />
        </ModalFooter>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {config.fields.map((f) => {
          if (f.showWhen && !f.showWhen(values)) return null;
          const wide = f.type === 'textarea' || f.type === 'color' || f.type === 'choice' || !!f.section;
          const common = { label: f.label, value: values[f.key] ?? '', placeholder: f.placeholder };
          return (
            <div key={f.key} className={wide ? 'sm:col-span-2' : undefined}>
              {f.section ? (
                <p className="mt-2 mb-2 text-xs font-bold uppercase tracking-[0.08em] opacity-60">{f.section}</p>
              ) : null}
              {f.type === 'color' ? (
                <TeamColorPicker
                  label={f.label}
                  value={values[f.key] || null}
                  onChange={(color) => set(f.key, color ?? '')}
                />
              ) : f.type === 'choice' ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold">{f.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {(f.options ?? []).map((o) => (
                      <Chip
                        key={o.value}
                        label={o.label}
                        active={values[f.key] === o.value}
                        onClick={() => set(f.key, o.value)}
                      />
                    ))}
                  </div>
                </div>
              ) : f.type === 'textarea' ? (
                <Textarea {...common} rows={3} onChange={(e) => set(f.key, e.target.value)} />
              ) : f.type === 'select' ? (
                <Select {...common} options={f.options} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <Input {...common} type={f.type ?? 'text'} onChange={(e) => set(f.key, e.target.value)} />
              )}
              {f.hint ? <p className="mt-1 text-xs opacity-70">{f.hint}</p> : null}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** Confirm, run one founder write, and report the outcome — for buttons that aren't a form. */
export function useFounderAction() {
  const { alert, confirm, toast } = useAlert();
  const save = useFounderSave();
  return {
    pending: save.isPending,
    run: async (opts: {
      write: () => Promise<unknown>;
      success: string;
      confirmTitle?: string;
      confirmMessage?: string;
      confirmLabel?: string;
      destructive?: boolean;
      /** Row id(s) that get the "Updated just now" badge once the write lands. */
      updatedId?: string | string[];
    }): Promise<boolean> => {
      if (opts.confirmTitle) {
        const ok = await confirm({
          title: opts.confirmTitle,
          message: opts.confirmMessage ?? '',
          confirmLabel: opts.confirmLabel,
          destructive: opts.destructive,
          // Deleting or removing always makes the founder type DELETE, like the rest of the app.
          requireText: opts.destructive ? 'DELETE' : undefined,
        });
        if (!ok) return false;
      }
      try {
        await save.mutateAsync(opts.write);
        markUpdated(opts.updatedId);
        toast(opts.success, 'success');
        return true;
      } catch (e) {
        await alert('Could Not Save', e instanceof Error ? e.message : 'Something went wrong.');
        return false;
      }
    },
  };
}

// ─── Field sets shared by several pages ──────────────────────────────────────

export const ATHLETE_FIELDS: FounderField[] = [
  { key: 'firstName', label: 'First name', section: 'Player' },
  { key: 'lastName', label: 'Last name' },
  { key: 'yearOfBirth', label: 'Year of birth', type: 'number' },
  { key: 'defaultPosition', label: 'Usual position' },
  { key: 'playerEmail', label: 'Player email', type: 'email' },
  { key: 'guardianName', label: 'Guardian name', section: 'Guardian' },
  { key: 'guardianEmail', label: 'Guardian email', type: 'email' },
  { key: 'guardianPhone', label: 'Guardian phone' },
  { key: 'about', label: 'About', type: 'textarea' },
];

export const EVENT_TYPE_OPTIONS = EVENT_TYPES.map((t) => ({ value: t, label: t }));

export const RECOMMENDATION_OPTIONS = RECOMMENDATIONS.map((r) => ({ value: r, label: r || 'None' }));

export const SEASON_EVENT_KIND_OPTIONS = [
  { value: 'game', label: 'Game' },
  { value: 'practice', label: 'Practice' },
  { value: 'event', label: 'Event' },
];

export const ASSESSOR_ROLE_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'assistant', label: 'Assistant' },
  { value: 'assessor', label: 'Assessor' },
];

export const ASSESSOR_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'completed', label: 'Completed' },
];

// ─── Shared action buttons ───────────────────────────────────────────────────

export function FounderActionRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 pt-1">{children}</div>;
}

/** Archive / unarchive and delete / restore for one evaluation, wherever it is listed. */
export function TryoutStateButtons({
  accountId,
  tryout,
  onDeleted,
}: {
  accountId: string;
  tryout: { id: string; name: string; archived?: boolean; deletedAt?: number };
  /** Called after a delete succeeds, e.g. to leave a page that can no longer load. */
  onDeleted?: () => void;
}) {
  const action = useFounderAction();
  const name = tryout.name || 'this evaluation';
  if (tryout.deletedAt) {
    return (
      <Button
        label="Restore"
        size="sm"
        disabled={action.pending}
        onClick={() =>
          action.run({
            write: () => writes.setTryoutDeleted(accountId, tryout.id, false, name),
            success: 'Evaluation restored.',
            updatedId: tryout.id,
            confirmTitle: 'Restore Evaluation',
            confirmMessage: `Bring ${name} back for the organization?`,
            confirmLabel: 'Restore',
          })
        }
      />
    );
  }
  return (
    <>
      <Button
        label={tryout.archived ? 'Unarchive' : 'Archive'}
        size="sm"
        variant="ghost"
        disabled={action.pending}
        onClick={() =>
          action.run({
            write: () => writes.setTryoutArchived(accountId, tryout.id, !tryout.archived, name),
            success: tryout.archived ? 'Evaluation unarchived.' : 'Evaluation archived.',
            updatedId: tryout.id,
          })
        }
      />
      <Button
        label="Delete"
        size="sm"
        variant="ghost"
        disabled={action.pending}
        onClick={async () => {
          const done = await action.run({
            write: () => writes.setTryoutDeleted(accountId, tryout.id, true, name),
            success: 'Evaluation deleted. Turn on "Show archived & deleted" to restore it.',
            confirmTitle: 'Delete Evaluation',
            confirmMessage: `Delete ${name}? It disappears for the organization, but you can restore it from the founder console.`,
            confirmLabel: 'Delete',
            destructive: true,
          });
          if (done) onDeleted?.();
        }}
      />
    </>
  );
}

/**
 * Edit one assessor's evaluation of one player: notes, recommendation, and a
 * score for every skill on the player's rubric (plus any score already saved
 * under a key the rubric no longer lists). A blank score removes it.
 */
export function evaluationEditConfig(
  e: Evaluation,
  skillLabel: Map<string, string>,
  playerName: string,
  accountId: string,
): FounderEditConfig {
  const keys = [...new Set([...skillLabel.keys(), ...Object.keys(e.scores)])];
  const scoreField = (key: string) => `score:${key}`;
  return {
    title: `Edit ${e.evaluator || 'evaluation'} — ${playerName}`,
    fields: [
      { key: 'session', label: 'Session' },
      { key: 'recommendation', label: 'Recommendation', type: 'select', options: RECOMMENDATION_OPTIONS },
      { key: 'strengths', label: 'Strengths', type: 'textarea' },
      { key: 'improve', label: 'To improve', type: 'textarea' },
      ...keys.map((key, i) => ({
        key: scoreField(key),
        label: skillLabel.get(key) ?? key,
        type: 'number' as const,
        section: i === 0 ? 'Scores (leave blank to remove)' : undefined,
      })),
    ],
    initial: {
      session: e.session,
      recommendation: e.recommendation,
      strengths: e.strengths,
      improve: e.improve,
      ...Object.fromEntries(keys.map((key) => [scoreField(key), e.scores[key]])),
    },
    successMessage: 'Evaluation updated.',
    updatedId: e.id,
    onSave: (v) =>
      writes.updateEvaluation(
        accountId,
        e.id,
        {
          session: v.session,
          recommendation: v.recommendation,
          strengths: v.strengths,
          improve: v.improve,
          scores: Object.fromEntries(keys.map((key) => [key, v[scoreField(key)] ?? ''])),
        },
        `${e.evaluator || 'assessor'}'s evaluation of ${playerName}`,
      ),
  };
}
