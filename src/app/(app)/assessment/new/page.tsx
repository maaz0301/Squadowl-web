'use client';
'use no memo';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  CreateAssessmentFormSchema,
  SPORTS,
  EVENT_TYPES,
  SCORING_TYPES,
  type CreateAssessmentForm,
  type Assessor,
  type CustomRubric,
  type ScoringType,
  type RankingDirection,
} from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Button,
  Card,
  Chip,
  DateField,
  ErrorState,
  FormLock,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  SectionLabel,
  TimeField,
  useAlert,
} from '@/components/ui';
import {
  useAssessmentCountQuery,
  useCreateTryoutMutation,
  useTeamsQuery,
  useUpdateTryoutMutation,
} from '@/features/queries';
import { useSessionStore } from '@/state/sessionStore';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { MapLocationHint } from '@/components/MapLink';
import { isAtAssessmentLimit } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { getDataSource } from '@/data';
import { APP_CONFIG } from '@/config/app';
import { SCORING_TYPE_LABELS, binaryLabels, isBinaryScoringType, isMetricScoringType } from '@/data/rubrics';

function NewAssessmentForm() {
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, toast } = useAlert();
  const params = useSearchParams();
  const createTryout = useCreateTryoutMutation();
  const updateTryout = useUpdateTryoutMutation();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  const teamsQuery = useTeamsQuery();
  const assessmentCount = useAssessmentCountQuery();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rubricError, setRubricError] = useState<string | null>(null);

  // Rubrics and assessors used to only be reachable on the settings screen
  // after creation — a second step for something coaches expect to finish in
  // one go. Both are collected here instead and applied right after the
  // tryout row exists (they're keyed to a tryout id, so neither can be
  // written before that).
  const [pendingAssessors, setPendingAssessors] = useState<Assessor[]>([]);
  const [showAssessorForm, setShowAssessorForm] = useState(false);
  const [assessorName, setAssessorName] = useState('');
  const [assessorEmail, setAssessorEmail] = useState('');

  const [pendingRubrics, setPendingRubrics] = useState<CustomRubric[]>([]);
  const [showRubricForm, setShowRubricForm] = useState(false);
  const [rubricLabel, setRubricLabel] = useState('');
  const [rubricType, setRubricType] = useState<ScoringType>('skill');
  const [rubricScale, setRubricScale] = useState<'1-5' | '1-10'>('1-5');
  const [rubricUnit, setRubricUnit] = useState('');
  const [rubricMinStr, setRubricMinStr] = useState('');
  const [rubricMaxStr, setRubricMaxStr] = useState('');
  const [rubricRankingDirection, setRubricRankingDirection] = useState<RankingDirection>('higher_is_better');
  const [rubricWeightStr, setRubricWeightStr] = useState('');

  const handleRubricTypeChange = (type: ScoringType) => {
    setRubricType(type);
    setRubricRankingDirection(type === 'time' ? 'lower_is_better' : 'higher_is_better');
  };

  const addAssessorToList = async () => {
    const name = assessorName.trim();
    const email = assessorEmail.trim();
    if (!name || !email) {
      await alert('Missing Info', 'An assessor needs both a name and an email address.');
      return;
    }
    if (!z.string().email().safeParse(email).success) {
      await alert('Invalid Email', `"${email}" is not a valid email address.`);
      return;
    }
    // One row per address per tryout — the same constraint the settings screen
    // guards, caught here before the list is even submitted.
    if (pendingAssessors.some((a) => a.email?.toLowerCase() === email.toLowerCase())) {
      await alert('Already Added', `${email} is already on this evaluation's assessor list.`);
      return;
    }
    // No account-exists check: the invite is claimed by email address whenever
    // that person signs up (handle_new_user in 0002_assessor_linking.sql), so
    // an assessor who isn't registered yet is invited, not rejected.
    setPendingAssessors((prev) => [...prev, { name, email, role: 'assessor', status: 'pending' }]);
    setAssessorName('');
    setAssessorEmail('');
    setShowAssessorForm(false);
  };

  const removeAssessorFromList = (index: number) => {
    setPendingAssessors((prev) => prev.filter((_, i) => i !== index));
  };

  const rubricWeightNum = rubricWeightStr.trim() !== '' ? parseFloat(rubricWeightStr) : undefined;
  const rubricWeightValid =
    rubricWeightNum == null || (!isNaN(rubricWeightNum) && rubricWeightNum >= 1 && rubricWeightNum <= 100);

  const addRubricToList = () => {
    const label = rubricLabel.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/\s+/g, '_');
    if (pendingRubrics.some((r) => r.key === key)) {
      alert('Duplicate Rubric', 'A rubric with this name has already been added.');
      return;
    }

    let defaultUnit = rubricUnit.trim();
    if (rubricType === 'time') {
      if (!defaultUnit) defaultUnit = 'sec';
    } else if (rubricType === 'distance') {
      if (!defaultUnit) defaultUnit = 'ft';
    } else if (rubricType === 'speed') {
      if (!defaultUnit) defaultUnit = 'mph';
    }
    const minNum = rubricMinStr.trim() !== '' ? parseFloat(rubricMinStr) : undefined;
    const maxNum = rubricMaxStr.trim() !== '' ? parseFloat(rubricMaxStr) : undefined;
    const isMetric = isMetricScoringType(rubricType);

    if (!rubricWeightValid) {
      alert('Invalid Weight', 'Weight must be a number between 1 and 100 percent.');
      return;
    }

    setPendingRubrics((prev) => [
      ...prev,
      {
        key,
        label,
        scoringType: rubricType,
        scale: rubricType === 'skill' ? rubricScale : '1-5',
        unit: isMetric ? defaultUnit : undefined,
        minVal: isMetric && minNum != null && !isNaN(minNum) ? minNum : undefined,
        maxVal: isMetric && maxNum != null && !isNaN(maxNum) ? maxNum : undefined,
        rankingDirection: rubricRankingDirection,
        weight: rubricWeightNum != null && !isNaN(rubricWeightNum) ? rubricWeightNum : undefined,
      },
    ]);
    setRubricError(null);
    setRubricLabel('');
    setRubricType('skill');
    setRubricScale('1-5');
    setRubricUnit('');
    setRubricMinStr('');
    setRubricMaxStr('');
    setRubricRankingDirection('higher_is_better');
    setRubricWeightStr('');
    setShowRubricForm(false);
  };

  const removeRubricFromList = (key: string) => {
    setPendingRubrics((prev) => prev.filter((r) => r.key !== key));
  };

  const { control, handleSubmit, watch, setValue } = useForm<CreateAssessmentForm>({
    resolver: zodResolver(CreateAssessmentFormSchema),
    defaultValues: {
      name: '',
      sport: 'Hockey',
      eventType: 'Tryout',
      tryoutDate: '',
      startTime: '',
      endTime: '',
      rink: '',
      // Pre-linked when created from a team's Events section.
      teamId: params.get('teamId') ?? undefined,
    },
  });

  const sport = watch('sport');
  const eventType = watch('eventType');
  const teamId = watch('teamId');
  // An evaluation for a team someone else owns is created on that team's plan,
  // not the creator's own — the manager's account stays as it is.
  const effectiveTier = useEffectivePlanTier(teamId);

  const onSubmit = handleSubmit(async (data) => {
    if (pendingRubrics.length === 0) {
      setRubricError('Add at least one rubric before creating the evaluation.');
      return;
    }
    setSubmitting(true);
    try {
      // The form renders before this has landed, so on a cold load the check
      // waits for it here rather than reading a not-yet-loaded 0 and waving the
      // user past their plan limit.
      const count = assessmentCount.data ?? (await assessmentCount.refetch()).data ?? 0;
      if (isAtAssessmentLimit(effectiveTier, count)) {
        setLimitMsg(buildLimitReachedMessage(effectiveTier, 'assessments', 'evaluations'));
        return;
      }
      let tryout;
      try {
        tryout = await createTryout.mutateAsync(data);
      } catch (e) {
        await alert('Error', e instanceof Error ? e.message : 'Could not create the evaluation.');
        return;
      }
      setCurrentTryout(tryout.id);

      if (pendingAssessors.length || pendingRubrics.length) {
        try {
          const updated = await updateTryout.mutateAsync({
            id: tryout.id,
            updates: {
              ...(pendingAssessors.length ? { assessors: pendingAssessors } : {}),
              ...(pendingRubrics.length
                ? { settings: { ...tryout.settings, customRubrics: pendingRubrics } }
                : {}),
            },
          });
          // Best-effort in parallel: the assessment and its assessor list are already saved,
          // so failed invite emails shouldn't block the coach from moving on.
          const inviteUrl = `${
            APP_CONFIG.webUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://www.tryouthq.ca')
          }/login?invite=assessor`;
          // `role !== 'lead'` skips the creator's own seeded row — otherwise
          // every coach mailed themselves an "you've been assigned as an
          // assessor" note for the evaluation they had just made.
          const invitePromises = updated.assessors
            .filter((a) => !!a.email && a.role !== 'lead')
            .map((a) =>
              getDataSource()
                .sendEmail('tryout_invite', a.email!, {
                  role: 'assessor',
                  tryoutName: updated.name,
                  inviteUrl,
                })
                .catch((err) => console.error('Error sending assessor invite email to', a.email, err)),
            );
          await Promise.allSettled(invitePromises);
          toast('Evaluation created', 'success');
        } catch (e) {
          await alert(
            'Partial Save',
            `The evaluation was created, but saving its rubrics/assessors failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
          );
        }
      }

      router.replace(`/assessment/${tryout.id}/settings`);
    } finally {
      setSubmitting(false);
    }
  });

  // Neither query gates the form: the name, sport, date and location fields
  // don't depend on them, and making the coach watch a spinner for the team
  // list and the plan-limit count was most of the time it took to get here.
  // The team chips fill in when the list arrives, and onSubmit waits for the
  // count if it has to.
  if (teamsQuery.isError && assessmentCount.isError) {
    return (
      <>
        <PageHeader title="New Evaluation" showBack />
        <ErrorState
          message="Could not load required data."
          onRetry={() => {
            teamsQuery.refetch();
            assessmentCount.refetch();
          }}
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New Evaluation" showBack backHref="/dashboard" />

      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <FormLock busy={submitting} className="flex flex-col gap-5">
            <Controller
              control={control}
              name="name"
              render={({ field, fieldState }) => (
                <Input
                  label="Evaluation Name"
                  placeholder="Spring U14 Tryout"
                  {...field}
                  error={fieldState.error?.message}
                />
              )}
            />

            <div>
              <SectionLabel className="mb-2">Sport</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {SPORTS.map((s) => (
                  <Chip key={s} label={s} active={sport === s} onClick={() => setValue('sport', s)} />
                ))}
              </div>
            </div>

            <div>
              <SectionLabel className="mb-2">Event Type</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map((t) => (
                  <Chip key={t} label={t} active={eventType === t} onClick={() => setValue('eventType', t)} />
                ))}
              </div>
            </div>

            {teamsQuery.data && teamsQuery.data.length > 0 ? (
              <div>
                <SectionLabel className="mb-2">Team (optional)</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {teamsQuery.data.map((team) => (
                    <Chip
                      key={team.id}
                      label={team.name}
                      active={teamId === team.id}
                      onClick={() => setValue('teamId', teamId === team.id ? undefined : team.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Controller
                control={control}
                name="tryoutDate"
                render={({ field }) => <DateField label="Date" value={field.value} onChange={field.onChange} />}
              />
              <Controller
                control={control}
                name="startTime"
                render={({ field }) => (
                  <TimeField label="Start Time" value={field.value} onChange={field.onChange} />
                )}
              />
              <Controller
                control={control}
                name="endTime"
                render={({ field, fieldState }) => (
                  <TimeField label="End Time" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
                )}
              />
            </div>

            <Controller
              control={control}
              name="rink"
              render={({ field }) => (
                <div>
                  <Input
                    label="Location / Rink"
                    placeholder="Rink A, 55 Bloor St W, Toronto"
                    {...field}
                  />
                  <MapLocationHint location={field.value} />
                </div>
              )}
            />

            <div>
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>Rubrics *</SectionLabel>
                <Button label="+ Add Rubric" variant="ghost" size="sm" onClick={() => setShowRubricForm(true)} />
              </div>
              {rubricError && (
                <p className="mb-1 text-xs font-medium" style={{ color: colors.danger }}>
                  {rubricError}
                </p>
              )}
              {pendingRubrics.length === 0 ? (
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  Add at least one rubric to define how players will be scored in this evaluation.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {pendingRubrics.map((r) => (
                    <Chip
                      key={r.key}
                      label={`${r.label}${r.weight != null ? ` · ${r.weight}%` : ''} ✕`}
                      active
                      onClick={() => removeRubricFromList(r.key)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>Assessors (optional)</SectionLabel>
                <Button label="+ Add Assessor" variant="ghost" size="sm" onClick={() => setShowAssessorForm(true)} />
              </div>
              {pendingAssessors.length === 0 ? (
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  Invite whoever else is scoring — they get an email once the evaluation is created.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {pendingAssessors.map((a, i) => (
                    <div
                      key={`${a.email}-${i}`}
                      className="flex items-center gap-2 rounded-xl px-3 py-2"
                      style={{ backgroundColor: colors.tile }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold" style={{ color: colors.ink }}>{a.name}</p>
                        <p className="truncate text-xs" style={{ color: colors.inkMuted }}>{a.email}</p>
                      </div>
                      <Button label="Remove" variant="ghost" size="sm" onClick={() => removeAssessorFromList(i)} />
                    </div>
                  ))}
                </div>
              )}
            </div>

          </FormLock>

          <Button type="submit" label="Create Evaluation" loading={submitting} size="lg" />
        </form>
      </Card>

      <p className="mt-3 text-xs" style={{ color: colors.inkFaint }}>
        Registration options are available once the evaluation is created.
      </p>

      <Modal visible={showRubricForm} title="Add Custom Drill / Category" onClose={() => setShowRubricForm(false)} hideDefaultFooter>
        <div className="flex flex-col gap-4">
          <Input
            label="1. Drill / Category Name"
            value={rubricLabel}
            onChange={(e) => setRubricLabel(e.target.value)}
            placeholder="e.g. 40-Yard Dash, Long Throw, Shot Speed"
          />

          <div>
            <SectionLabel className="mb-2">2. Scoring Type</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {SCORING_TYPES.map((t) => (
                <Chip key={t} label={SCORING_TYPE_LABELS[t]} active={rubricType === t} onClick={() => handleRubricTypeChange(t)} />
              ))}
            </div>
          </div>

          {isBinaryScoringType(rubricType) ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>3. Answer Buttons</SectionLabel>
              <p className="text-xs italic" style={{ color: colors.inkMuted }}>
                Assessors tap {binaryLabels(rubricType)[0]} / {binaryLabels(rubricType)[1]} — or flip the slide switch.
                {' '}{binaryLabels(rubricType)[0]} scores 5.0, {binaryLabels(rubricType)[1]} scores 1.0.
              </p>
            </div>
          ) : rubricType === 'observation' ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>3. Ranking Rule</SectionLabel>
              <button
                type="button"
                onClick={() =>
                  setRubricRankingDirection(rubricRankingDirection === 'lower_is_better' ? 'higher_is_better' : 'lower_is_better')
                }
                className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:opacity-90"
                style={{ borderColor: colors.border, backgroundColor: colors.field }}
              >
                <div className="flex-1 pr-3">
                  <span className="text-sm font-bold" style={{ color: colors.ink }}>
                    Lowest number is highest ranked: {rubricRankingDirection === 'lower_is_better' ? 'Yes' : 'No'}
                  </span>
                  <p className="mt-0.5 text-xs" style={{ color: colors.inkMuted }}>
                    {rubricRankingDirection === 'lower_is_better'
                      ? 'Scored 1-100 · 1 = best (5.0), 100 = worst (1.0)'
                      : 'Scored 1-100 · 100 = best (5.0), 1 = worst (1.0)'}
                  </p>
                </div>
                <div
                  className="relative h-6 w-11 rounded-full transition-colors"
                  style={{ backgroundColor: rubricRankingDirection === 'lower_is_better' ? colors.primary : colors.border }}
                >
                  <div
                    className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                    style={{ transform: rubricRankingDirection === 'lower_is_better' ? 'translateX(22px)' : 'translateX(2px)' }}
                  />
                </div>
              </button>
            </div>
          ) : rubricType === 'skill' ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>3. Scale Choice</SectionLabel>
              <div className="flex flex-wrap gap-2">
                <Chip label="1-5 Scale" active={rubricScale === '1-5'} onClick={() => setRubricScale('1-5')} />
                <Chip label="1-10 Scale" active={rubricScale === '1-10'} onClick={() => setRubricScale('1-10')} />
              </div>
              <p className="text-xs italic" style={{ color: colors.inkMuted }}>
                Ranking Rule: Highest number = highest rank (Score 5)
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Input
                label="3. Unit Label (Free-form)"
                value={rubricUnit}
                onChange={(e) => setRubricUnit(e.target.value)}
                placeholder={
                  rubricType === 'time' ? 'e.g. sec, s, min' : rubricType === 'speed' ? 'e.g. mph, km/h' : 'e.g. ft, m, inches'
                }
              />

              <div>
                <SectionLabel className="mb-2">4. Ranking Rule</SectionLabel>
                <button
                  type="button"
                  onClick={() =>
                    setRubricRankingDirection(rubricRankingDirection === 'lower_is_better' ? 'higher_is_better' : 'lower_is_better')
                  }
                  className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:opacity-90"
                  style={{ borderColor: colors.border, backgroundColor: colors.field }}
                >
                  <div className="flex-1 pr-3">
                    <span className="text-sm font-bold" style={{ color: colors.ink }}>
                      {rubricRankingDirection === 'lower_is_better' ? 'Lowest / Shortest wins' : 'Highest / Farthest wins'}
                    </span>
                    <p className="mt-0.5 text-xs" style={{ color: colors.inkMuted }}>
                      {rubricRankingDirection === 'lower_is_better'
                        ? 'Best performance = lowest value (e.g. fastest sprint)'
                        : 'Best performance = highest value (e.g. longest throw)'}
                    </p>
                  </div>
                  <div
                    className="relative h-6 w-11 rounded-full transition-colors"
                    style={{ backgroundColor: rubricRankingDirection === 'lower_is_better' ? colors.primary : colors.border }}
                  >
                    <div
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                      style={{ transform: rubricRankingDirection === 'lower_is_better' ? 'translateX(22px)' : 'translateX(2px)' }}
                    />
                  </div>
                </button>
              </div>

              <SectionLabel className="mt-1">5. Score Range Benchmarks (Min &amp; Max)</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Min Value"
                  value={rubricMinStr}
                  onChange={(e) => setRubricMinStr(e.target.value)}
                  inputMode="decimal"
                  placeholder={rubricType === 'time' ? '12 (Best)' : '5 (Worst)'}
                />
                <Input
                  label="Max Value"
                  value={rubricMaxStr}
                  onChange={(e) => setRubricMaxStr(e.target.value)}
                  inputMode="decimal"
                  placeholder={rubricType === 'time' ? '25 (Worst)' : '25 (Best)'}
                />
              </div>

              <p className="text-xs font-bold italic" style={{ color: colors.primary }}>
                Score Benchmark Rule:{' '}
                {rubricRankingDirection === 'lower_is_better'
                  ? `Min value (${rubricMinStr || '10'}) = 5.0 points (Best)  ·  Max value (${rubricMaxStr || '25'}) = 1.0 points (Worst)`
                  : `Min value (${rubricMinStr || '5'}) = 1.0 points (Worst)  ·  Max value (${rubricMaxStr || '25'}) = 5.0 points (Best)`}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Input
              label="Weight (% of the overall score)"
              value={rubricWeightStr}
              onChange={(e) => setRubricWeightStr(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 25 — leave blank for an even share"
            />
            <p className="text-xs" style={{ color: rubricWeightValid ? colors.inkMuted : colors.danger }}>
              {rubricWeightValid
                ? 'Weighted rubrics take their percentage of the overall; the rest split what is left over evenly.'
                : 'Weight must be a number between 1 and 100.'}
            </p>
          </div>

          <Button
            label="Add Rubric Category"
            onClick={addRubricToList}
            disabled={!rubricLabel.trim() || !rubricWeightValid}
          />
        </div>
      </Modal>

      <Modal visible={showAssessorForm} title="Add Assessor" onClose={() => setShowAssessorForm(false)} hideDefaultFooter>
        <div className="flex flex-col gap-3">
          <Input label="Name" value={assessorName} onChange={(e) => setAssessorName(e.target.value)} />
          <Input
            label="Email"
            type="email"
            autoCapitalize="none"
            value={assessorEmail}
            onChange={(e) => setAssessorEmail(e.target.value)}
          />
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            They&apos;ll be emailed an invitation when the evaluation is created. If they don&apos;t have a TryoutHQ
            account yet, they can create one with this address and the invitation will be waiting for them.
          </p>
          <Button
            label="Add"
            onClick={addAssessorToList}
            disabled={!assessorName.trim() || !assessorEmail.trim()}
          />
        </div>
      </Modal>

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </div>
  );
}

export default function NewAssessmentPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <NewAssessmentForm />
    </Suspense>
  );
}
