'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorState,
  Input,
  LoadingState,
  SectionLabel,
  Spinner,
  Switch,
  useAlert,
} from '@/components/ui';
import { canHaveBenchmark, formatBenchmarkValue } from '@/data/benchmarks';
import { PlanGate } from '@/components/PlanGate';
import { UsageNudgeBanner } from '@/components/UsageNudgeBanner';
import { CoachOnlyState } from '@/components/assessment/CoachOnlyState';
import { useTryoutQuery, useUpdateTryoutMutation } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { getPlanDefinition } from '@/data/plans';
import {
  SCORING_TYPE_LABELS,
  binaryLabels,
  isBinaryScoringType,
  isMetricScoringType,
  resolveWeights,
} from '@/data/rubrics';
import { SCORING_TYPES, type ScoringType, type RankingDirection } from '@/data/types';

export default function RubricsPage() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const { alert } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  const updateTryout = useUpdateTryoutMutation();
  // Hook, so it runs before the loading/error guards below — skipping it on
  // the loading render would change hook order. A delegated team's tryout
  // gates against the owning club's tier, not the viewer's own.
  const tier = useEffectivePlanTier(tryoutQuery.data?.teamId);

  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('');
  const [scoringType, setScoringType] = useState<ScoringType>('skill');
  const [scale, setScale] = useState<'1-5' | '1-10'>('1-5');
  const [unit, setUnit] = useState('');
  const [minValStr, setMinValStr] = useState('');
  const [maxValStr, setMaxValStr] = useState('');
  const [rankingDirection, setRankingDirection] = useState<RankingDirection>('higher_is_better');
  const [weightStr, setWeightStr] = useState('');
  // An optional target shown beside players' results, with a short explanation.
  const [benchmarkOn, setBenchmarkOn] = useState(false);
  const [benchmarkStr, setBenchmarkStr] = useState('');
  const [benchmarkNote, setBenchmarkNote] = useState('');
  // Key of the rubric being edited. Its key never changes, so saved scores and
  // weights stay attached to it; the type and scale are fixed for the same reason.
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const handleScoringTypeChange = (type: ScoringType) => {
    if (editingKey) return;
    setScoringType(type);
    if (type === 'time') {
      setRankingDirection('lower_is_better');
    } else {
      setRankingDirection('higher_is_better');
    }
  };

  const weightNum = weightStr.trim() !== '' ? parseFloat(weightStr) : undefined;
  const weightValid = weightNum == null || (!isNaN(weightNum) && weightNum >= 1 && weightNum <= 100);
  const benchmarkNum = benchmarkStr.trim() !== '' ? parseFloat(benchmarkStr) : undefined;
  const benchmarkActive = benchmarkOn && canHaveBenchmark(scoringType);
  const benchmarkValid = !benchmarkActive || (benchmarkNum != null && !isNaN(benchmarkNum));

  if (tryoutQuery.isLoading || !id) return <LoadingState message="Loading rubrics..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load rubrics." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  if (!tryout.viewerIsOwner) return <CoachOnlyState what="change this evaluation’s rubrics" />;
  const custom = tryout.settings.customRubrics ?? [];
  const existingCategories = Array.from(new Set(custom.map((r) => r.category).filter((c): c is string => !!c)));
  const plan = getPlanDefinition(tier);
  const customLimit = plan.limits.customRubrics;
  const atCustomLimit = customLimit !== 'unlimited' && custom.length >= (customLimit as number);

  const resetForm = () => {
    setEditingKey(null);
    setLabel('');
    setUnit('');
    setMinValStr('');
    setMaxValStr('');
    setWeightStr('');
    setBenchmarkOn(false);
    setBenchmarkStr('');
    setBenchmarkNote('');
  };

  const startEdit = (r: (typeof custom)[number]) => {
    setEditingKey(r.key);
    setLabel(r.label);
    setCategory(r.category ?? '');
    setScoringType(r.scoringType ?? 'skill');
    setScale(r.scale === '1-10' ? '1-10' : '1-5');
    setUnit(r.unit ?? '');
    setMinValStr(r.minVal != null ? String(r.minVal) : '');
    setMaxValStr(r.maxVal != null ? String(r.maxVal) : '');
    setRankingDirection(r.rankingDirection ?? 'higher_is_better');
    setWeightStr(r.weight != null ? String(r.weight) : '');
    setBenchmarkOn(r.benchmark != null);
    setBenchmarkStr(r.benchmark != null ? String(r.benchmark) : '');
    setBenchmarkNote(r.benchmarkNote ?? '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addCustom = async () => {
    if (!label.trim() || (atCustomLimit && !editingKey) || !weightValid || !benchmarkValid) return;
    const key = editingKey ?? label.trim().toLowerCase().replace(/\s+/g, '_');

    let defaultUnit = unit.trim();

    if (scoringType === 'time') {
      if (!defaultUnit) defaultUnit = 'sec';
    } else if (scoringType === 'distance') {
      if (!defaultUnit) defaultUnit = 'ft';
    } else if (scoringType === 'speed') {
      if (!defaultUnit) defaultUnit = 'mph';
    }

    const minNum = minValStr.trim() !== '' ? parseFloat(minValStr) : undefined;
    const maxNum = maxValStr.trim() !== '' ? parseFloat(maxValStr) : undefined;

    const isMetric = isMetricScoringType(scoringType);

    const entry = {
      key,
      label: label.trim(),
      category: category.trim() || undefined,
      scoringType,
      scale: scoringType === 'skill' ? scale : ('1-5' as const),
      unit: isMetric ? defaultUnit : undefined,
      minVal: isMetric && minNum != null && !isNaN(minNum) ? minNum : undefined,
      maxVal: isMetric && maxNum != null && !isNaN(maxNum) ? maxNum : undefined,
      rankingDirection,
      weight: weightNum != null && !isNaN(weightNum) ? weightNum : undefined,
      benchmark: benchmarkActive ? benchmarkNum : undefined,
      benchmarkNote: benchmarkActive ? benchmarkNote.trim() || undefined : undefined,
    };
    const next = editingKey ? custom.map((r) => (r.key === editingKey ? { ...r, ...entry } : r)) : [...custom, entry];

    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: { settings: { ...tryout.settings, customRubrics: next } },
    });

    // Category is deliberately not cleared — a coach usually adds several
    // drills to the same category back to back (e.g. five Skating drills),
    // so keeping it selected saves re-picking it each time.
    resetForm();
  };

  const removeCustom = async (keyToRemove: string) => {
    const next = custom.filter((r) => r.key !== keyToRemove);
    const nextSkaterWeights = { ...tryout.settings.skaterWeights };
    const nextGoalieWeights = { ...tryout.settings.goalieWeights };
    delete nextSkaterWeights[keyToRemove];
    delete nextGoalieWeights[keyToRemove];

    setRemovingKey(keyToRemove);
    try {
      await updateTryout.mutateAsync({
        id: tryout.id,
        updates: {
          settings: {
            ...tryout.settings,
            customRubrics: next,
            skaterWeights: nextSkaterWeights,
            goalieWeights: nextGoalieWeights,
          },
        },
      });
      await alert('Success', 'Custom rubric removed successfully.');
    } catch (err) {
      await alert('Error', err instanceof Error ? err.message : 'Failed to remove custom rubric.');
    } finally {
      setRemovingKey(null);
    }
  };

  // What each rubric actually contributes: its own weight, or an even share of
  // whatever the weighted rubrics leave over.
  const effectiveWeights = resolveWeights(custom.map((r) => r.weight));
  const weightedCount = custom.filter((r) => r.weight != null).length;
  const unweightedCount = custom.length - weightedCount;
  const explicitTotal = custom.reduce((sum, r) => sum + (r.weight ?? 0), 0);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="flex flex-col gap-5">
        <Card accent className="flex flex-col gap-2">
          <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Custom Rubric Builder
          </span>
          <span style={{ color: colors.inkMuted }}>
            All rubrics are fully custom. Define drill categories, metric units, and min/max score benchmarks.
          </span>
        </Card>

        <UsageNudgeBanner tier={tier} metric="customRubrics" count={custom.length} label="custom rubrics" />

        <Card className="flex flex-col gap-3">
          <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Created Rubrics ({custom.length}
            {customLimit !== 'unlimited' ? ` / ${customLimit}` : ''})
          </span>

          {custom.length > 0 ? (
            <p className="text-xs" style={{ color: explicitTotal > 100 ? colors.danger : colors.inkMuted }}>
              Weights: {formatPct(explicitTotal)} assigned across {weightedCount}{' '}
              {weightedCount === 1 ? 'rubric' : 'rubrics'}
              {unweightedCount > 0
                ? ` · the remaining ${unweightedCount} split ${formatPct(Math.max(0, 100 - explicitTotal))} evenly`
                : ''}
              {explicitTotal > 100 ? ' · over 100% — weights are scaled to their share of the total.' : ''}
            </p>
          ) : null}

          {custom.map((r, i) => {
            const type = r.scoringType ?? 'skill';
            const ruleText = r.rankingDirection === 'lower_is_better' ? 'Lowest wins' : 'Highest wins';
            let details: string;
            if (isBinaryScoringType(type)) {
              const [positive, negative] = binaryLabels(type);
              details = `${positive} / ${negative} · ${positive} scores 5.0`;
            } else if (type === 'observation') {
              details = `1-100 observation (${ruleText})`;
            } else if (type === 'skill') {
              details = `${r.scale ?? '1-5'} scale`;
            } else {
              details = `${r.unit ?? ''} (${ruleText})`;
            }
            if (r.minVal != null && r.maxVal != null) details += ` · Range: ${r.minVal} to ${r.maxVal}`;
            details += ` · Weight: ${formatPct(effectiveWeights[i])}${r.weight == null ? ' (auto)' : ''}`;
            if (r.benchmark != null) {
              details += ` · Benchmark: ${formatBenchmarkValue({ scoringType: r.scoringType, scale: r.scale, unit: r.unit }, r.benchmark)}`;
            }

            return (
              <div
                key={r.key}
                className="flex items-center justify-between gap-2 border-b py-2"
                style={{ borderColor: colors.border }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold" style={{ color: colors.ink }}>
                      {r.label}
                    </span>
                    <Badge label={SCORING_TYPE_LABELS[type]} variant="brand" />
                    {r.category ? <Badge label={r.category} /> : null}
                    <Badge label={`${formatPct(effectiveWeights[i])}`} />
                  </div>
                  <p className="text-xs" style={{ color: colors.inkMuted }}>
                    {details}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(r)}
                  disabled={removingKey !== null}
                  aria-label={`Edit ${r.label}`}
                  className="px-2 text-sm font-bold disabled:opacity-50"
                  style={{ color: colors.primary }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => removeCustom(r.key)}
                  disabled={removingKey !== null}
                  aria-label={`Remove ${r.label}`}
                  className="px-2 text-xl font-bold disabled:opacity-50"
                  style={{ color: colors.danger }}
                >
                  {removingKey === r.key ? <Spinner size={16} /> : '✕'}
                </button>
              </div>
            );
          })}

          {custom.length === 0 ? (
            <p style={{ color: colors.inkMuted }}>
              No custom rubrics added yet. Use the builder to add drills &amp; categories.
            </p>
          ) : null}
        </Card>
      </div>

      <PlanGate feature="customRubrics" title="Custom Rubrics (Coach+)" tierOverride={tier}>
        <Card accent className="flex flex-col gap-4">
          <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            {editingKey ? 'Edit Drill / Category' : 'Add Custom Drill / Category'}
          </span>

          <Input
            label="1. Drill Name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. 40-Yard Dash, Long Throw, Shot Speed"
          />

          <div>
            <Input
              label="2. Category (optional)"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Skating — groups several drills under one heading"
            />
            {existingCategories.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {existingCategories.map((c) => (
                  <Chip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <SectionLabel className="mb-2">3. Scoring Type</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {SCORING_TYPES.map((t) => (
                <Chip
                  key={t}
                  label={SCORING_TYPE_LABELS[t]}
                  active={scoringType === t}
                  onClick={() => handleScoringTypeChange(t)}
                />
              ))}
            </div>
          </div>

          {isBinaryScoringType(scoringType) ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>4. Answer Buttons</SectionLabel>
              <div className="flex flex-wrap gap-2">
                <Badge label={binaryLabels(scoringType)[0]} variant="brand" />
                <Badge label={binaryLabels(scoringType)[1]} />
              </div>
              <p className="text-xs italic" style={{ color: colors.inkMuted }}>
                Assessors tap {binaryLabels(scoringType)[0]} / {binaryLabels(scoringType)[1]} — or flip the slide switch.
                {' '}{binaryLabels(scoringType)[0]} scores 5.0, {binaryLabels(scoringType)[1]} scores 1.0.
              </p>
            </div>
          ) : scoringType === 'observation' ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>4. Ranking Rule</SectionLabel>
              <button
                type="button"
                onClick={() => setRankingDirection(rankingDirection === 'lower_is_better' ? 'higher_is_better' : 'lower_is_better')}
                className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:opacity-90"
                style={{ borderColor: colors.border, backgroundColor: colors.field }}
              >
                <div className="flex-1 pr-3">
                  <span className="text-sm font-bold" style={{ color: colors.ink }}>
                    Lowest number is highest ranked: {rankingDirection === 'lower_is_better' ? 'Yes' : 'No'}
                  </span>
                  <p className="mt-0.5 text-xs" style={{ color: colors.inkMuted }}>
                    {rankingDirection === 'lower_is_better'
                      ? 'Scored 1-100 · 1 = best (5.0), 100 = worst (1.0)'
                      : 'Scored 1-100 · 100 = best (5.0), 1 = worst (1.0)'}
                  </p>
                </div>
                <div
                  className="relative h-6 w-11 rounded-full transition-colors"
                  style={{ backgroundColor: rankingDirection === 'lower_is_better' ? colors.primary : colors.border }}
                >
                  <div
                    className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                    style={{ transform: rankingDirection === 'lower_is_better' ? 'translateX(22px)' : 'translateX(2px)' }}
                  />
                </div>
              </button>
            </div>
          ) : scoringType === 'skill' ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>4. Scale Choice</SectionLabel>
              <div className="flex flex-wrap gap-2">
                <Chip label="1-5 Scale" active={scale === '1-5'} onClick={() => setScale('1-5')} />
                <Chip label="1-10 Scale" active={scale === '1-10'} onClick={() => setScale('1-10')} />
              </div>
              <p className="text-xs italic" style={{ color: colors.inkMuted }}>
                Ranking Rule: Highest number = highest rank (Score 5)
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Input
                label="4. Unit Label (Free-form)"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder={
                  scoringType === 'time' ? 'e.g. sec, s, min' : scoringType === 'speed' ? 'e.g. mph, km/h' : 'e.g. ft, m, inches'
                }
              />

              <div>
                <SectionLabel className="mb-2">5. Ranking Rule</SectionLabel>
                <button
                  type="button"
                  onClick={() => setRankingDirection(rankingDirection === 'lower_is_better' ? 'higher_is_better' : 'lower_is_better')}
                  className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:opacity-90"
                  style={{ borderColor: colors.border, backgroundColor: colors.field }}
                >
                  <div className="flex-1 pr-3">
                    <span className="text-sm font-bold" style={{ color: colors.ink }}>
                      {rankingDirection === 'lower_is_better' ? 'Lowest / Shortest wins' : 'Highest / Farthest wins'}
                    </span>
                    <p className="mt-0.5 text-xs" style={{ color: colors.inkMuted }}>
                      {rankingDirection === 'lower_is_better'
                        ? 'Best performance = lowest value (e.g. fastest sprint)'
                        : 'Best performance = highest value (e.g. longest throw)'}
                    </p>
                  </div>
                  <div
                    className="relative h-6 w-11 rounded-full transition-colors"
                    style={{ backgroundColor: rankingDirection === 'lower_is_better' ? colors.primary : colors.border }}
                  >
                    <div
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                      style={{ transform: rankingDirection === 'lower_is_better' ? 'translateX(22px)' : 'translateX(2px)' }}
                    />
                  </div>
                </button>
              </div>

              <SectionLabel className="mt-1">6. Score Range Benchmarks (Min &amp; Max)</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Min Value"
                  value={minValStr}
                  onChange={(e) => setMinValStr(e.target.value)}
                  inputMode="decimal"
                  placeholder={rankingDirection === 'lower_is_better' ? '1 (Best)' : '1 (Worst)'}
                />
                <Input
                  label="Max Value"
                  value={maxValStr}
                  onChange={(e) => setMaxValStr(e.target.value)}
                  inputMode="decimal"
                  placeholder={rankingDirection === 'lower_is_better' ? '10 (Worst)' : '10 (Best)'}
                />
              </div>

              <p className="text-xs font-bold italic" style={{ color: colors.primary }}>
                Score Benchmark Rule:{' '}
                {rankingDirection === 'lower_is_better'
                  ? `Min value (${minValStr || '1'}) = 5.0 points (Best)  ·  Max value (${maxValStr || '10'}) = 1.0 points (Worst)`
                  : `Min value (${minValStr || '1'}) = 1.0 points (Worst)  ·  Max value (${maxValStr || '10'}) = 5.0 points (Best)`}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Input
              label="Weight (% of the overall score)"
              value={weightStr}
              onChange={(e) => setWeightStr(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 25 — leave blank for an even share"
            />
            {!weightValid ? (
              <p className="text-xs font-bold" style={{ color: colors.danger }}>
                Weight must be a number between 1 and 100.
              </p>
            ) : (
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                {weightNum != null
                  ? `This rubric carries ${weightNum}% of the overall score.`
                  : 'Left blank, this rubric shares whatever percentage the weighted rubrics leave over.'}
              </p>
            )}
          </div>

          {canHaveBenchmark(scoringType) ? (
            <div className="flex flex-col gap-2">
              <Switch
                checked={benchmarkOn}
                onChange={setBenchmarkOn}
                label="Add a benchmark (a target to show next to results)"
              />
              {benchmarkOn ? (
                <>
                  <Input
                    label={
                      isMetricScoringType(scoringType)
                        ? `Benchmark${unit.trim() ? ` (${unit.trim()})` : ''}`
                        : scoringType === 'observation'
                          ? 'Benchmark (1-100)'
                          : `Benchmark (out of ${scale === '1-10' ? 10 : 5})`
                    }
                    value={benchmarkStr}
                    onChange={(e) => setBenchmarkStr(e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 30"
                  />
                  <Input
                    label="What this benchmark means (optional)"
                    value={benchmarkNote}
                    onChange={(e) => setBenchmarkNote(e.target.value.slice(0, 300))}
                    placeholder="e.g. What a player aiming for the top team usually reaches"
                  />
                  {!benchmarkValid ? (
                    <p className="text-xs font-bold" style={{ color: colors.danger }}>
                      Enter the benchmark as a number.
                    </p>
                  ) : (
                    <p className="text-xs" style={{ color: colors.inkMuted }}>
                      Shown on the scoring screen and on each player&apos;s report card, beside their own result.
                    </p>
                  )}
                </>
              ) : null}
            </div>
          ) : null}

          <Button
            label={editingKey ? 'Save Changes' : 'Add Rubric Category'}
            onClick={addCustom}
            loading={updateTryout.isPending}
            disabled={(atCustomLimit && !editingKey) || !label.trim() || !weightValid || !benchmarkValid}
          />
          {editingKey ? <Button label="Cancel" variant="secondary" onClick={resetForm} /> : null}
        </Card>
      </PlanGate>
    </div>
  );
}

/** Weights print as whole percentages where they are whole, e.g. "25%" / "16.7%". */
function formatPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}
