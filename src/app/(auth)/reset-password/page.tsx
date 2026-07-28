'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { PasswordSchema } from '@/data/types';
import { useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Input, LoadingState } from '@/components/ui';

const ResetPasswordSchema = z.object({
  token: z.string().min(6, 'Please enter the 6-digit code'),
  password: PasswordSchema,
});

function ResetPasswordForm() {
  const colors = useThemeColors();
  const router = useRouter();
  const email = useSearchParams().get('email') ?? '';
  const resetPasswordWithOtp = useAuthStore((s) => s.resetPasswordWithOtp);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(ResetPasswordSchema),
    defaultValues: { token: '', password: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    if (!email) {
      setError('Missing email address. Please go back and try again.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await resetPasswordWithOtp(email, data.token, data.password);
      // Resetting signs the user in, so land them in the app.
      router.replace('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="mb-1">
        <h1 className="text-2xl font-bold" style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}>
          Enter Reset Code
        </h1>
        <p className="mt-1 text-sm" style={{ color: colors.inkMuted }}>
          Enter the 6-digit code sent to {email || 'your email'} and your new password.
        </p>
      </div>

      <Controller
        control={control}
        name="token"
        render={({ field, fieldState }) => (
          <Input label="Reset Code" inputMode="numeric" {...field} error={fieldState.error?.message} />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <Input label="New Password" isPassword autoComplete="new-password" {...field} error={fieldState.error?.message} />
        )}
      />

      {error ? (
        <p className="text-sm" style={{ color: colors.danger }}>
          {error}
        </p>
      ) : null}

      <Button type="submit" label="Reset Password" loading={loading} fullWidth size="lg" />
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
