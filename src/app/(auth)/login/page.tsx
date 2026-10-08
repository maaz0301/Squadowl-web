'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { LoginFormSchema } from '@/data/types';
import { useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { LegalLinks } from '@/components/LegalPage';
import { Button, Input, LoadingState } from '@/components/ui';

function LoginForm() {
  const colors = useThemeColors();
  const router = useRouter();
  const params = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Arrives via ?invite=assessor — the link in the assessor invitation email.
  // The invite itself is claimed by email address on the server side, so
  // nothing identifying travels in the URL; this only explains to someone who
  // has never seen the app why they were sent here and which address to use.
  const invitedAsAssessor = params.get('invite') === 'assessor';

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(LoginFormSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    setLoading(true);
    setError(null);
    try {
      await login(data.email, data.password);
      const next = params.get('next');
      router.replace(next && next.startsWith('/') ? next : '/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="mb-1 text-center">
        <h1 className="text-2xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          Sign in
        </h1>
        <p className="mt-1 text-sm" style={{ color: colors.inkMuted }}>
          Sign in to manage tryouts and evaluate players
        </p>
      </div>

      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input label="Email" type="email" autoComplete="email" {...field} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <Input label="Password" isPassword autoComplete="current-password" {...field} error={fieldState.error?.message} />
        )}
      />

      {invitedAsAssessor ? (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{ borderColor: colors.border, backgroundColor: colors.tile, color: colors.inkMuted }}
        >
          <span className="font-bold" style={{ color: colors.ink }}>
            Your assessor invitation is waiting.
          </span>{' '}
          Sign in with the email address it was sent to and you&apos;ll find it under &ldquo;Assigned to me&rdquo;. No
          account yet? Create one with that same address.
        </div>
      ) : null}

      {error ? (
        <p className="text-sm" style={{ color: colors.danger }}>
          {error}
        </p>
      ) : null}

      <Button type="submit" label="Sign In" loading={loading} fullWidth size="lg" />

      <div className="flex justify-center">
        <Link
          href="/forgot-password"
          className="inline-flex min-h-[44px] items-center px-2 text-sm font-bold"
          style={{ color: colors.primary }}
        >
          Forgot Password?
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-1.5 text-sm">
        <span style={{ color: colors.inkMuted }}>Don&apos;t have an account?</span>
        <Link
          href={invitedAsAssessor ? '/signup?invite=assessor' : '/signup'}
          className="inline-flex min-h-[44px] items-center px-2 font-bold"
          style={{ color: colors.primary }}
        >
          Create account
        </Link>
      </div>

      <LegalLinks />
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <LoginForm />
    </Suspense>
  );
}
