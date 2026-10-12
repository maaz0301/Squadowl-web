'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { BrandLogo } from '@/components/BrandLogo';
import { GuestGate } from '@/components/AuthGate';
import { ThemeToggle } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { trackVisit } from '@/lib/analytics';

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <GuestGate>
      <VisitTracker />
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
            <BrandLogo />
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

/**
 * Top of the founder's sign-up funnel ("/" redirects here for anyone signed
 * out). Inside GuestGate, so a signed-in user bounced to the dashboard isn't
 * counted as a visitor.
 */
function VisitTracker() {
  const pathname = usePathname();
  useEffect(() => {
    trackVisit(pathname);
  }, [pathname]);
  return null;
}
