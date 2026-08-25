'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { useAuthStore } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Input } from '@/components/ui';

const ForgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

export default function ForgotPasswordPage() {
  const colors = useThemeColors();
  const router = useRouter();
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit } = useForm({
    resolver: zodResolver(ForgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    setLoading(true);
    setError(null);
    try {
      await requestPasswordReset(data.email);
      router.push(`/reset-password?email=${encodeURIComponent(data.email)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to request password reset');
    } finally {
      setLoading(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="mb-1">
        <h1 className="text-2xl font-bold" style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}>
          Forgot Password?
        </h1>
        <p className="mt-1 text-sm" style={{ color: colors.inkMuted }}>
          Enter your email to receive a password reset code.
        </p>
      </div>

      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input label="Email" type="email" autoComplete="email" {...field} error={fieldState.error?.message} />
        )}
      />

      {error ? (
        <p className="text-sm" style={{ color: colors.danger }}>
          {error}
        </p>
      ) : null}

      <Button type="submit" label="Send Reset Code" loading={loading} fullWidth size="lg" />

      <div className="flex justify-center">
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center px-2 text-sm font-bold"
          style={{ color: colors.primary }}
        >
          Back to Login
        </Link>
      </div>
    </form>
  );
}
