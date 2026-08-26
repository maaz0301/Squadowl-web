'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  CreateAssessmentFormSchema,
  SPORTS,
  EVENT_TYPES,
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
import { useUser } from '@/state/authStore';
import { isAtAssessmentLimit } from '@/data/plans';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { getDataSource } from '@/data';

const SCORING_TYPE_LABEL: Record<ScoringType, string> = {
  skill: 'Skill / Technique',
  time: 'Time-based',
  distance: 'Distance-based',
  speed: 'Speed-based',
};

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
  const user = useUser();
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Rubrics and assessors used to only be reachable on the settings screen
  // after creation — a second step for something coaches expect to finish in
  // one go. Both are collected here instead and applied right after the
  // tryout row exists (they're keyed to a tryout id, so neither can be
  // written before that).
  const [pendingAssessors, setPendingAssessors] = useState<Assessor[]>([]);
  const [showAssessorForm, setShowAssessorForm] = useState(false);
  const [assessorName, setAssessorName] = useState('');
  const [assessorEmail, setAssessorEmail] = useState('');
  const [checkingAssessor, setCheckingAssessor] = useState(false);

  const [pendingRubrics, setPendingRubrics] = useState<CustomRubric[]>([]);
  const [showRubricForm, setShowRubricForm] = useState(false);
  const [rubricLabel, setRubricLabel] = useState('');
  const [rubricType, setRubricType] = useState<ScoringType>('skill');
  const [rubricScale, setRubricScale] = useState<'1-5' | '1-10'>('1-5');
  const [rubricUnit, setRubricUnit] = useState('');
  const [rubricMinStr, setRubricMinStr] = useState('');
  const [rubricMaxStr, setRubricMaxStr] = useState('');
  const [rubricRankingDirection, setRubricRankingDirection] = useState<RankingDirection>('higher_is_better');

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
    setCheckingAssessor(true);
    try {
      const exists = await getDataSource().checkUserExistsByEmail(email);
      if (!exists) {
        await alert(
          'Email Not Registered',
          'This email is not registered in the system. Assessors must create an account before they can be invited.',
        );
        return;
      }
      setPendingAssessors((prev) => [...prev, { name, email, role: 'assessor', status: 'pending' }]);
      setAssessorName('');
      setAssessorEmail('');
      setShowAssessorForm(false);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not verify this assessor.');
    } finally {
      setCheckingAssessor(false);
    }
  };

  const removeAssessorFromList = (index: number) => {
    setPendingAssessors((prev) => prev.filter((_, i) => i !== index));
  };

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

    setPendingRubrics((prev) => [
      ...prev,
      {
        key,
        label,
        scoringType: rubricType,
        scale: rubricType === 'skill' ? rubricScale : '1-5',
        unit: rubricType !== 'skill' ? defaultUnit : undefined,
        minVal: minNum != null && !isNaN(minNum) ? minNum : undefined,
        maxVal: maxNum != null && !isNaN(maxNum) ? maxNum : undefined,
        rankingDirection: rubricRankingDirection,
      },
    ]);
    setRubricLabel('');
    setRubricType('skill');
    setRubricScale('1-5');
    setRubricUnit('');
    setRubricMinStr('');
    setRubricMaxStr('');
    setRubricRankingDirection('higher_is_better');
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

  const onSubmit = handleSubmit(async (data) => {
    setSubmitting(true);
    try {
      // The form renders before this has landed, so on a cold load the check
      // waits for it here rather than reading a not-yet-loaded 0 and waving the
      // user past their plan limit.
      const count = assessmentCount.data ?? (await assessmentCount.refetch()).data ?? 0;
      if (isAtAssessmentLimit(user?.planTier ?? 'free', count)) {
        setLimitMsg(buildLimitReachedMessage(user?.planTier ?? 'free', 'assessments', 'assessments'));
        return;
      }
      let tryout;
      try {
        tryout = await createTryout.mutateAsync(data);
      } catch (e) {
        await alert('Error', e instanceof Error ? e.message : 'Could not create the assessment.');
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
          const invitePromises = updated.assessors
            .filter((a) => !!a.email)
            .map((a) =>
              getDataSource()
                .sendEmail('tryout_invite', a.email!, { role: 'assessor' })
                .catch((err) => console.error('Error sending assessor invite email to', a.email, err)),
            );
          await Promise.allSettled(invitePromises);
          toast('Assessment created', 'success');
        } catch (e) {
          await alert(
            'Partial Save',
            `The assessment was created, but saving its rubrics/assessors failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
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
        <PageHeader title="New Assessment" showBack />
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
      <PageHeader title="New Assessment" showBack backHref="/dashboard" />

      <Card>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <FormLock busy={submitting} className="flex flex-col gap-5">
            <Controller
              control={control}
              name="name"
              render={({ field, fieldState }) => (
                <Input
                  label="Assessment Name"
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
                render={({ field }) => (
                  <TimeField label="End Time" value={field.value} onChange={field.onChange} />
                )}
              />
            </div>

            <Controller
              control={control}
              name="rink"
              render={({ field }) => <Input label="Location / Rink" placeholder="Rink A" {...field} />}
            />

            <div>
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>Custom Rubrics (optional)</SectionLabel>
                <Button label="+ Add Rubric" variant="ghost" size="sm" onClick={() => setShowRubricForm(true)} />
              </div>
              {pendingRubrics.length === 0 ? (
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  Every sport already scores on a default set of skills — add one here only if this
                  assessment needs something extra.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {pendingRubrics.map((r) => (
                    <Chip key={r.key} label={`${r.label} ✕`} active onClick={() => removeRubricFromList(r.key)} />
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
                  Invite whoever else is scoring — they get an email once the assessment is created.
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

          <Button type="submit" label="Create Assessment" loading={submitting} size="lg" />
        </form>
      </Card>

      <p className="mt-3 text-xs" style={{ color: colors.inkFaint }}>
        Registration options are available once the assessment is created.
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
              {(Object.keys(SCORING_TYPE_LABEL) as ScoringType[]).map((t) => (
                <Chip key={t} label={SCORING_TYPE_LABEL[t]} active={rubricType === t} onClick={() => handleRubricTypeChange(t)} />
              ))}
            </div>
          </div>

          {rubricType === 'skill' ? (
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

          <Button label="Add Rubric Category" onClick={addRubricToList} disabled={!rubricLabel.trim()} />
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
            They must already have a TryoutHQ account — this checks their email before adding them.
          </p>
          <Button
            label="Add"
            onClick={addAssessorToList}
            loading={checkingAssessor}
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
