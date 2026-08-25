'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { SignupFormSchema } from '@/data/types';
import { useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Input } from '@/components/ui';

export default function SignupPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const signup = useAuthStore((s) => s.signup);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(SignupFormSchema),
    defaultValues: {
      displayName: '',
      email: '',
      password: '',
      confirmPassword: '',
      accountType: 'coach' as const,
    },
  });

  const onSubmit = handleSubmit(async (data) => {
    setLoading(true);
    setError(null);
    try {
      await signup(data.displayName, data.email, data.password, data.accountType);
      router.replace('/welcome');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="mb-1 text-center">
        <h1 className="text-2xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          Create Account
        </h1>
      </div>

      <Controller
        control={control}
        name="displayName"
        render={({ field, fieldState }) => (
          <Input label="Your Name" autoComplete="name" {...field} error={fieldState.error?.message} />
        )}
      />
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
          <Input label="Password" isPassword autoComplete="new-password" {...field} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="confirmPassword"
        render={({ field, fieldState }) => (
          <Input
            label="Confirm Password"
            isPassword
            autoComplete="new-password"
            {...field}
            error={fieldState.error?.message}
          />
        )}
      />

      {error ? (
        <p className="text-sm" style={{ color: colors.danger }}>
          {error}
        </p>
      ) : null}

      <Button type="submit" label="Create Account" loading={loading} fullWidth size="lg" />

      <div className="flex flex-wrap items-center justify-center gap-x-1.5 text-sm">
        <span style={{ color: colors.inkMuted }}>Already have an account?</span>
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center px-2 font-bold"
          style={{ color: colors.primary }}
        >
          Sign in
        </Link>
      </div>
    </form>
  );
}
