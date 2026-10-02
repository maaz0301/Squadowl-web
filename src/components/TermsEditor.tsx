'use client';

import { useState } from 'react';

import { Button, Card, Input, useAlert } from '@/components/ui';
import type { CustomLabels } from '@/data/types';
import { DEFAULT_TERMS, LABEL_MAX_LENGTH, pluralize } from '@/lib/terms';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Rename a few terms for one evaluation, e.g. Player -> Skater, Jersey # ->
 * Skate Ontario #, Hockey -> Skating. Blank keeps the standard name.
 */
export function TermsEditor({
  value,
  sport: evalSport,
  saving,
  onSave,
}: {
  value?: CustomLabels;
  /** The evaluation's sport. The sport-name rename only applies to Hockey, so other sports don't show it. */
  sport?: string;
  saving: boolean;
  onSave: (labels: CustomLabels) => Promise<void>;
}) {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const [player, setPlayer] = useState(value?.player ?? '');
  const [jersey, setJersey] = useState(value?.jersey ?? '');
  const [sport, setSport] = useState(value?.sport ?? '');

  const dirty =
    player.trim() !== (value?.player ?? '') || jersey.trim() !== (value?.jersey ?? '') || sport.trim() !== (value?.sport ?? '');

  const save = async (next: { player: string; jersey: string; sport: string }) => {
    const labels = Object.fromEntries(
      Object.entries(next)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v),
    ) as CustomLabels;
    try {
      await onSave(labels);
    } catch (e) {
      await alert('Could Not Save', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const reset = () => {
    setPlayer('');
    setJersey('');
    setSport('');
    void save({ player: '', jersey: '', sport: '' });
  };

  return (
    <Card className="flex flex-col gap-3">
      <p className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>Custom field names</p>
      <p className="text-sm" style={{ color: colors.inkMuted }}>
        Rename terms for this evaluation only. Leave a field blank to keep the standard name.
      </p>
      <Input
        label={`Player (default: ${DEFAULT_TERMS.player})`}
        value={player}
        onChange={(e) => setPlayer(e.target.value)}
        placeholder="e.g. Skater"
        maxLength={LABEL_MAX_LENGTH}
        hint={player.trim() ? `Plural shown as "${pluralize(player.trim())}".` : undefined}
      />
      <Input
        label={`Jersey # (default: ${DEFAULT_TERMS.jersey})`}
        value={jersey}
        onChange={(e) => setJersey(e.target.value)}
        placeholder="e.g. Skate Ontario #"
        maxLength={LABEL_MAX_LENGTH}
      />
      {!evalSport || evalSport === DEFAULT_TERMS.sport ? (
        <Input
          label={`Sport name (default: ${DEFAULT_TERMS.sport})`}
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          placeholder="e.g. Skating"
          maxLength={LABEL_MAX_LENGTH}
        />
      ) : null}
      <div className="flex gap-2">
        <Button label="Save" loading={saving} disabled={!dirty} onClick={() => save({ player, jersey, sport })} />
        <Button label="Reset to defaults" variant="ghost" onClick={reset} />
      </div>
    </Card>
  );
}
