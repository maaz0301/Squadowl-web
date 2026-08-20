'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Card, PageHeader } from '@/components/ui';
import {
  useCreateTeamMutation,
  useCreateTryoutMutation,
  useTeamsQuery,
  useTryoutsQuery,
  useUpdateProfileMutation,
} from '@/features/queries';
import { useUser } from '@/state/authStore';
import { useSessionStore } from '@/state/sessionStore';
import { useOnboardingStore } from '@/state/uiStore';
import { useThemeColors } from '@/theme/ThemeProvider';

const STEPS = [
  {
    title: 'Create your first team',
    description: 'Teams help organize your assessments and rosters.',
    action: 'Create Team',
  },
  {
    title: 'Set up an assessment',
    description: 'Create a tryout or assessment event for your athletes.',
    action: 'Create Assessment',
  },
  {
    title: 'Add players',
    description: 'Use QR registration or add players manually to your roster.',
    action: 'Continue',
  },
  {
    title: 'Start scoring',
    description: 'Use rinkside scoring to evaluate players against rubrics.',
    action: 'Go to Dashboard',
  },
];

export default function WizardPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const user = useUser();
  const [createdTeamId, setCreatedTeamId] = useState<string | null>(null);

  const initialData = useMemo(() => {
    const s = user?.onboardingSteps;
    const completed: number[] = [];
    if (s?.createTeam) completed.push(0);
    if (s?.createAssessment) completed.push(1);
    if (s?.addPlayers) completed.push(2);
    if (s?.scorePlayers) completed.push(3);

    let startStep = 0;
    if (!completed.includes(0)) startStep = 0;
    else if (!completed.includes(1)) startStep = 1;
    else if (!completed.includes(2)) startStep = 2;
    else startStep = 3;

    return { startStep, completed };
  }, [user?.onboardingSteps]);

  const [step, setStep] = useState(initialData.startStep);
  const [completedSteps, setCompletedSteps] = useState<number[]>(initialData.completed);

  const completeWizard = useOnboardingStore((s) => s.completeWizard);
  const updateProfileMutation = useUpdateProfileMutation();
  const updateProfile = updateProfileMutation.mutateAsync;
  const [skipping, setSkipping] = useState(false);
  const createTeam = useCreateTeamMutation();
  const createTryout = useCreateTryoutMutation();
  const tryoutsQuery = useTryoutsQuery(false);
  const teamsQuery = useTeamsQuery();
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);

  const current = STEPS[step];

  const handleAction = async () => {
    if (step === 0) {
      const team = await createTeam.mutateAsync({ name: 'My Team', season: '2025-26' });
      setCreatedTeamId(team.id);
      setCompletedSteps((prev) => [...prev, 0]);
      await updateProfile({
        onboardingSteps: {
          createTeam: true,
          createAssessment: user?.onboardingSteps?.createAssessment ?? false,
          inviteAssessors: user?.onboardingSteps?.inviteAssessors ?? false,
          addPlayers: user?.onboardingSteps?.addPlayers ?? false,
          scorePlayers: user?.onboardingSteps?.scorePlayers ?? false,
        },
      });
      setStep(1);
      return;
    }

    if (step === 1) {
      let tId = createdTeamId ?? teamsQuery.data?.[0]?.id;
      let createdNewTeam = false;
      if (!tId) {
        const team = await createTeam.mutateAsync({ name: 'My Team', season: '2025-26' });
        tId = team.id;
        setCreatedTeamId(team.id);
        createdNewTeam = true;
      }

      const tryout = await createTryout.mutateAsync({
        name: 'First Assessment',
        sport: 'Hockey',
        eventType: 'Tryout',
        teamId: tId,
      });
      setCurrentTryout(tryout.id);
      setCompletedSteps((prev) => [...prev, ...(createdNewTeam ? [0] : []), 1]);
      await updateProfile({
        onboardingSteps: {
          createTeam: createdNewTeam ? true : (user?.onboardingSteps?.createTeam ?? false),
          createAssessment: true,
          inviteAssessors: user?.onboardingSteps?.inviteAssessors ?? false,
          addPlayers: user?.onboardingSteps?.addPlayers ?? false,
          scorePlayers: user?.onboardingSteps?.scorePlayers ?? false,
        },
      });
      setStep(2);
      return;
    }

    // Steps 2 and 3 both need an assessment to jump into; create the missing
    // pieces on the fly exactly like the app does.
    let tryoutId = useSessionStore.getState().currentTryoutId ?? tryoutsQuery.data?.[0]?.id;
    let createdNewTeam = false;
    let createdNewAssessment = false;

    if (!tryoutId) {
      let tId = createdTeamId ?? teamsQuery.data?.[0]?.id;
      if (!tId) {
        const team = await createTeam.mutateAsync({ name: 'My Team', season: '2025-26' });
        tId = team.id;
        setCreatedTeamId(team.id);
        createdNewTeam = true;
      }
      const tryout = await createTryout.mutateAsync({
        name: 'First Assessment',
        sport: 'Hockey',
        eventType: 'Tryout',
        teamId: tId,
      });
      tryoutId = tryout.id;
      setCurrentTryout(tryoutId);
      createdNewAssessment = true;
    }

    if (step === 2) {
      setCompletedSteps((prev) => [
        ...prev,
        ...(createdNewTeam ? [0] : []),
        ...(createdNewAssessment ? [1] : []),
        2,
      ]);
      await updateProfile({
        onboardingSteps: {
          createTeam: createdNewTeam ? true : (user?.onboardingSteps?.createTeam ?? false),
          createAssessment: createdNewAssessment ? true : (user?.onboardingSteps?.createAssessment ?? false),
          inviteAssessors: user?.onboardingSteps?.inviteAssessors ?? false,
          addPlayers: true,
          scorePlayers: user?.onboardingSteps?.scorePlayers ?? false,
        },
      });
      router.replace(`/assessment/${tryoutId}/roster`);
      return;
    }

    setCompletedSteps((prev) => [
      ...prev,
      ...(createdNewTeam ? [0] : []),
      ...(createdNewAssessment ? [1] : []),
      3,
    ]);
    await updateProfile({
      onboardingCompleted: true,
      onboardingSteps: {
        createTeam: createdNewTeam ? true : (user?.onboardingSteps?.createTeam ?? false),
        createAssessment: createdNewAssessment ? true : (user?.onboardingSteps?.createAssessment ?? false),
        inviteAssessors: user?.onboardingSteps?.inviteAssessors ?? false,
        addPlayers: user?.onboardingSteps?.addPlayers ?? false,
        scorePlayers: true,
      },
    });
    completeWizard();
    router.replace(`/assessment/${tryoutId}/rinkside`);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Quick Setup" subtitle={`Step ${step + 1} of ${STEPS.length}`} showBack />

      <Card accent className="flex flex-col gap-3">
        <h2 className="text-xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          {current.title}
        </h2>
        <p className="text-[15px]" style={{ color: colors.inkMuted }}>
          {current.description}
        </p>
        <div className="mt-2 flex gap-2">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className="h-1 flex-1 rounded-full"
              style={{
                backgroundColor: completedSteps.includes(i) || i === step ? colors.primary : colors.tile,
              }}
            />
          ))}
        </div>
      </Card>

      <div className="mt-6 flex flex-col gap-3">
        <Button
          label={current.action}
          size="lg"
          fullWidth
          onClick={handleAction}
          loading={createTeam.isPending || createTryout.isPending || updateProfileMutation.isPending}
          disabled={skipping}
        />
        <Button
          label="Skip"
          variant="ghost"
          fullWidth
          loading={skipping}
          disabled={createTeam.isPending || createTryout.isPending || updateProfileMutation.isPending}
          onClick={async () => {
            if (step >= STEPS.length - 1) {
              setSkipping(true);
              try {
                completeWizard();
                await updateProfile({ onboardingCompleted: true });
                router.replace('/dashboard');
              } finally {
                setSkipping(false);
              }
            } else {
              setStep((s) => s + 1);
            }
          }}
        />
      </div>
    </div>
  );
}
