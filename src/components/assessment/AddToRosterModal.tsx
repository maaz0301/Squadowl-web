'use client';

import { useTerms } from '@/lib/terms';
import { useState } from 'react';

import { Button, Chip, Modal, Spinner } from '@/components/ui';
import { useTeamsQuery, useTryoutsQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

export type RosterDestination =
  | { kind: 'assessment'; id: string; name: string }
  | { kind: 'team'; id: string; name: string };

interface AddToRosterModalProps {
  visible: boolean;
  /** How many registrations this will place — drives the confirm label. */
  count: number;
  /** The assessment the registrations came from, so it can be marked as current. */
  currentTryoutId?: string;
  loading?: boolean;
  /** How many of the selected registrations have been placed so far — only
   * meaningful once `loading` is true and there's more than one to add. */
  progress?: { done: number; total: number };
  onClose: () => void;
  onConfirm: (destination: RosterDestination) => void;
  /** The evaluation's own names. */
  labels?: import('@/data/types').CustomLabels;
}

type Kind = 'assessment' | 'team';

/**
 * Destination picker for pending registrations. The list of targets stays hidden
 * until a kind is picked — choosing "Assessment" or "Team" is what reveals the
 * assessments or teams available to receive the players.
 */
export function AddToRosterModal({
  visible,
  count,
  currentTryoutId,
  loading: loadingProp,
  progress,
  onClose,
  onConfirm,
  labels,
}: AddToRosterModalProps) {
  const terms = useTerms(labels);
  const colors = useThemeColors();
  const [kind, setKind] = useState<Kind | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);

  // `loadingProp` only turns true once the mutation's pending state has
  // propagated back down through React Query — for a heavy confirm (e.g. 1000
  // registrations) there can be a beat before that happens. This bridges the
  // gap so the button reacts the instant it's clicked, instead of sitting inert.
  const [justClicked, setJustClicked] = useState(false);
  // Adjusted during render on the true->false transition (same "storing
  // information from previous renders" pattern as `wasVisible` below).
  const [prevLoadingProp, setPrevLoadingProp] = useState(loadingProp);
  if (loadingProp !== prevLoadingProp) {
    setPrevLoadingProp(loadingProp);
    if (!loadingProp) setJustClicked(false);
  }
  const loading = loadingProp || justClicked;

  const tryoutsQuery = useTryoutsQuery();
  const teamsQuery = useTeamsQuery();

  // Reopening always starts at the kind choice rather than resurfacing whatever
  // was picked last time, so nothing can be confirmed without being re-seen.
  // Adjusted during render on the false->true transition (React's documented
  // "storing information from previous renders" pattern) rather than in an
  // effect, which would render once with the stale choice still visible.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setKind(null);
      setTargetId(null);
    }
  }

  const options =
    kind === 'assessment'
      ? (tryoutsQuery.data ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          hint: t.id === currentTryoutId ? 'Current' : terms.t(`${t.roster.length} players`),
        }))
      : kind === 'team'
        ? (teamsQuery.data ?? []).map((t) => ({ id: t.id, name: t.name, hint: t.season ?? '' }))
        : [];

  const listLoading = kind === 'assessment' ? tryoutsQuery.isLoading : teamsQuery.isLoading;
  const selected = options.find((o) => o.id === targetId);

  return (
    <Modal
      visible={visible}
      title={terms.t(count > 1 ? `Add ${count} Players` : 'Add Player')}
      onClose={onClose}
      hideDefaultFooter
      footer={
        <div className="mt-4 flex flex-col gap-2">
          {loading && progress && progress.total > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: colors.tile }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(4, Math.round((progress.done / progress.total) * 100)))}%`,
                    backgroundColor: colors.primary,
                  }}
                />
              </div>
              <p className="text-center text-xs" style={{ color: colors.inkMuted }}>
                Added {progress.done} of {progress.total} players...
              </p>
            </div>
          ) : null}
          <Button
            label={selected ? `Add to ${selected.name}` : 'Add'}
            disabled={!selected}
            loading={loading}
            onClick={() => {
              if (kind && selected) {
                setJustClicked(true);
                onConfirm({ kind, id: selected.id, name: selected.name });
              }
            }}
          />
          <Button label="Cancel" variant="secondary" onClick={onClose} />
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Add To
          </p>
          <div className="flex flex-wrap gap-2">
            <Chip
              label="Evaluation"
              active={kind === 'assessment'}
              onClick={() => {
                setKind('assessment');
                setTargetId(null);
              }}
            />
            <Chip
              label="Team"
              active={kind === 'team'}
              onClick={() => {
                setKind('team');
                setTargetId(null);
              }}
            />
          </div>
        </div>

        {kind === null ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            Choose whether these players join an evaluation roster or a team roster.
          </p>
        ) : listLoading ? (
          <div className="flex items-center justify-center py-6">
            <Spinner color={colors.primary} />
          </div>
        ) : options.length === 0 ? (
          <div className="flex flex-col gap-1 py-4">
            <p className="text-base font-bold" style={{ color: colors.ink }}>
              {kind === 'assessment' ? 'No evaluations' : 'No teams'}
            </p>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              {kind === 'assessment'
                ? terms.t('Create an evaluation before adding players to one.')
                : terms.t('Create a team before adding players to one.')}
            </p>
          </div>
        ) : (
          <div>
            <p className="mb-2 text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
              {kind === 'assessment' ? 'Available Evaluations' : 'Available Teams'}
            </p>
            <div className="flex flex-col gap-2">
              {options.map((o) => {
                const active = o.id === targetId;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setTargetId(o.id)}
                    className="flex items-center justify-between rounded-xl border px-4 py-3 text-left"
                    style={{
                      backgroundColor: active ? 'rgba(255,107,43,0.12)' : colors.tile,
                      borderColor: active ? colors.primary : colors.border,
                    }}
                  >
                    <span className="flex-1 text-base font-semibold" style={{ color: active ? colors.primary : colors.ink }}>
                      {o.name}
                    </span>
                    {o.hint ? (
                      <span className="ml-2 text-xs" style={{ color: colors.inkMuted }}>{o.hint}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
