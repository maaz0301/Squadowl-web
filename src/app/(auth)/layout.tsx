'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import { GuestGate } from '@/components/AuthGate';
import { ThemeToggle } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';

export default function AuthLayout({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <GuestGate>
      <div
        className="relative flex min-h-screen items-center justify-center px-4 py-10"
        style={{
          backgroundColor: colors.bg,
          backgroundImage:
            'radial-gradient(circle at 15% 15%, rgba(255,107,43,0.16), transparent 45%), radial-gradient(circle at 85% 80%, rgba(56,189,248,0.10), transparent 45%)',
        }}
      >
        <div className="absolute right-5 top-5">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-[420px]">
          <div className="mb-7 flex flex-col items-center gap-3">
            {/* No plate or shadow behind the lockup — it sits straight on the
                page background. */}
            <div style={{ width: 'min(260px, 70vw)' }}>
              <Image
                src="/images/tryouthq_logo.png"
                alt="TryoutHQ"
                width={1024}
                height={777}
                priority
                style={{ height: 'auto', width: '100%', display: 'block' }}
              />
            </div>
          </div>

          <div
            className="rounded-2xl border p-6 sm:p-7"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              boxShadow: '0 20px 60px rgba(0,0,0,0.28)',
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </GuestGate>
  );
}
