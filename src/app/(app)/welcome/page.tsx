'use client';

import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card } from '@/components/ui';
import { useOnboardingStore } from '@/state/uiStore';
import { APP_CONFIG } from '@/config/app';

const HIGHLIGHTS = [
  'Create teams & evaluations',
  'QR athlete registration',
  'Rinkside rubric scoring',
  'Results & leaderboard',
];

export default function WelcomePage() {
  const colors = useThemeColors();
  const router = useRouter();
  const skipWizard = useOnboardingStore((s) => s.skipWizard);

  return (
    <div className="mx-auto flex max-w-2xl flex-col justify-center gap-6 py-8">
      <div className="flex flex-col gap-2">
        <h1
          className="text-3xl font-bold sm:text-4xl"
          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
        >
          Welcome to {APP_CONFIG.appName}
        </h1>
        <p className="text-base leading-relaxed" style={{ color: colors.inkMuted }}>
          Run athlete tryouts and evaluations from any device. Score players rinkside, manage rosters, and
          share results — all in one place.
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        {HIGHLIGHTS.map((item) => (
          <div key={item} className="flex items-center gap-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold"
              style={{ backgroundColor: 'rgba(255,107,43,0.15)', color: colors.primary }}
            >
              ✓
            </span>
            <span className="text-[15px]" style={{ color: colors.ink }}>
              {item}
            </span>
          </div>
        ))}
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button
          label="Get Started"
          size="lg"
          onClick={() => {
            skipWizard();
            router.replace('/dashboard');
          }}
        />
        <Button label="Run Quick Setup" variant="secondary" size="lg" onClick={() => router.push('/wizard')} />
      </div>
    </div>
  );
}
