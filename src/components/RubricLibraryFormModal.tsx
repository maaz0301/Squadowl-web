'use client';

import { useState } from 'react';

import { Button, Chip, Input, Modal } from '@/components/ui';
import { isMetricScoringType, SCORING_TYPE_LABELS } from '@/data/rubrics';
import { SCORING_TYPES, SPORTS, type RubricLibraryInput, type RubricLibraryItem, type ScoringType } from '@/data/types';
import { parseTimeText } from '@/lib/timeEntry';
import { useThemeColors } from '@/theme/ThemeProvider';

const DEFAULT_UNIT: Partial<Record<ScoringType, string>> = { time: 'sec', distance: 'ft', speed: 'mph', quantity: 'reps' };

/** Create or edit one rubric in the library. Mount it only while open (with a key per rubric) so it starts from that rubric. */
export function RubricLibraryFormModal({
  visible,
  item,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  /** The rubric being edited; unset to create a new one. */
  item?: RubricLibraryItem | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: RubricLibraryInput) => void;
}) {
  const colors = useThemeColors();
  const d = item?.definition;
  const [name, setName] = useState(item?.name ?? '');
  const [sport, setSport] = useState(item?.sport ?? '');
  const [category, setCategory] = useState(d?.category ?? '');
  const [scoringType, setScoringType] = useState<ScoringType>(item?.scoringType ?? 'skill');
  const [scale, setScale] = useState<'1-5' | '1-10'>(d?.scale === '1-10' ? '1-10' : '1-5');
  const [unit, setUnit] = useState(d?.unit ?? '');
  const [minStr, setMinStr] = useState(d?.minVal != null ? String(d.minVal) : '');
  const [maxStr, setMaxStr] = useState(d?.maxVal != null ? String(d.maxVal) : '');
  const [lowerWins, setLowerWins] = useState(d?.rankingDirection === 'lower_is_better');
  const [weightStr, setWeightStr] = useState(d?.weight != null ? String(d.weight) : '');

  const isMetric = isMetricScoringType(scoringType);
  const read = (t: string) => (scoringType === 'time' ? parseTimeText(t, unit.trim() || 'sec') : parseFloat(t));
  const weight = weightStr.trim() !== '' ? parseFloat(weightStr) : undefined;
  const weightValid = weight == null || (!isNaN(weight) && weight >= 1 && weight <= 100);

  const save = () => {
    if (!name.trim() || !weightValid) return;
    const min = minStr.trim() !== '' ? read(minStr) : undefined;
    const max = maxStr.trim() !== '' ? read(maxStr) : undefined;
    onSave({
      name: name.trim(),
      sport: sport.trim() || undefined,
      scoringType,
      definition: {
        // Keep anything the form does not edit (a benchmark saved from an evaluation).
        ...(item?.definition ?? {}),
        category: category.trim() || undefined,
        scale: scoringType === 'skill' ? scale : '1-5',
        unit: isMetric ? unit.trim() || DEFAULT_UNIT[scoringType] : undefined,
        minVal: isMetric && min != null && !isNaN(min) ? min : undefined,
        maxVal: isMetric && max != null && !isNaN(max) ? max : undefined,
        rankingDirection: lowerWins ? 'lower_is_better' : 'higher_is_better',
        weight: weight != null && !isNaN(weight) ? weight : undefined,
      },
    });
  };

  const label = (text: string) => (
    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
      {text}
    </p>
  );

  return (
    <Modal
      visible={visible}
      title={item ? 'Edit Rubric' : 'New Rubric'}
      onClose={onClose}
      hideDefaultFooter
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button label="Cancel" variant="secondary" onClick={onClose} />
          <Button label={item ? 'Save changes' : 'Save to Library'} loading={saving} disabled={!name.trim() || !weightValid} onClick={save} />
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Input label="Rubric name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 30m Sprint, Edge Control" />
        {label('Sport (optional)')}
        <div className="flex flex-wrap gap-2">
          {SPORTS.map((s) => (
            <Chip key={s} label={s} active={sport === s} onClick={() => setSport(sport === s ? '' : s)} />
          ))}
        </div>
        <Input label="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Skating" />
        {label('Measure type')}
        <div className="flex flex-wrap gap-2">
          {SCORING_TYPES.map((t) => (
            <Chip key={t} label={SCORING_TYPE_LABELS[t]} active={scoringType === t} onClick={() => setScoringType(t)} />
          ))}
        </div>
        {scoringType === 'skill' ? (
          <div className="flex gap-2">
            <Chip label="1-5 Scale" active={scale === '1-5'} onClick={() => setScale('1-5')} />
            <Chip label="1-10 Scale" active={scale === '1-10'} onClick={() => setScale('1-10')} />
          </div>
        ) : null}
        {isMetric ? (
          <>
            <Input label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={DEFAULT_UNIT[scoringType] ?? 'unit'} />
            <div className="flex gap-2">
              <Input containerClassName="flex-1" label="Min value" value={minStr} onChange={(e) => setMinStr(e.target.value)} />
              <Input containerClassName="flex-1" label="Max value" value={maxStr} onChange={(e) => setMaxStr(e.target.value)} />
            </div>
          </>
        ) : null}
        {scoringType !== 'skill' && scoringType !== 'yes_no' && scoringType !== 'effectiveness' ? (
          <label className="flex items-center gap-3 text-base" style={{ color: colors.ink }}>
            <input type="checkbox" checked={lowerWins} onChange={(e) => setLowerWins(e.target.checked)} />
            Lowest value ranks best (e.g. fastest sprint)
          </label>
        ) : null}
        <Input
          label="Weight (% of the overall score, optional)"
          inputMode="decimal"
          value={weightStr}
          onChange={(e) => setWeightStr(e.target.value)}
          placeholder="e.g. 25"
          error={weightValid ? undefined : 'Weight must be a number between 1 and 100.'}
        />
      </div>
    </Modal>
  );
}
