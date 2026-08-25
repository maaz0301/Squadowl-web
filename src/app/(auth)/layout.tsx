'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import { GuestGate } from '@/components/AuthGate';
import { ThemeToggle } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { colors, isDark } = useTheme();
  return (
    <GuestGate>
      <div
        className="relative flex min-h-dvh items-center justify-center px-4"
        style={{
          backgroundColor: colors.bg,
          backgroundImage:
            'radial-gradient(circle at 15% 15%, rgba(255,107,43,0.16), transparent 45%), radial-gradient(circle at 85% 80%, rgba(56,189,248,0.10), transparent 45%)',
          paddingTop: 'calc(2.5rem + env(safe-area-inset-top, 0px))',
          paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div
          className="absolute"
          style={{
            top: 'calc(1.25rem + env(safe-area-inset-top, 0px))',
            right: 'calc(1.25rem + env(safe-area-inset-right, 0px))',
          }}
        >
          <ThemeToggle />
        </div>

        <div className="w-full max-w-[420px]">
          <div className="mb-7 flex flex-col items-center gap-3">
            {/* The lockup PNG bakes in white type, which all but disappears on
                the light theme's near-white background. Dark keeps the original
                treatment — straight on the page, no plate; light gets a dark
                plate behind it purely so the wordmark stays legible. */}
            <div
              style={{
                width: 'min(260px, 70vw)',
                ...(isDark
                  ? null
                  : {
                      backgroundColor: '#080c16',
                      padding: '18px 22px',
                      borderRadius: 24,
                      boxShadow: '0 14px 40px rgba(8,12,24,0.18)',
                    }),
              }}
            >
              <Image
                src="/images/tryouthq_logo_v2.png"
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
