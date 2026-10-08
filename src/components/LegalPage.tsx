'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ThemeToggle } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/**
 * A public document page (privacy policy, terms). Lives outside the signed-in
 * app so a store reviewer, a parent or a search engine can read it without an
 * account, and it follows the same light/dark theme as the rest of the site.
 */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  const { colors, isDark } = useTheme();
  return (
    <div className="min-h-dvh px-4 py-8" style={{ backgroundColor: colors.bg }}>
      <div className="mx-auto w-full max-w-[760px]">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/login" aria-label="SquadOwl home">
            <Image
              src={isDark ? '/images/squadowl_logo_dark.png' : '/images/squadowl_logo_light.png'}
              alt="SquadOwl"
              width={520}
              height={124}
              sizes="180px"
              className="h-auto w-[180px]"
            />
          </Link>
          <ThemeToggle />
        </div>

        <h1
          className="text-3xl font-bold"
          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
        >
          {title}
        </h1>
        <p className="mt-1 text-sm" style={{ color: colors.inkMuted }}>
          Last updated {updated}
        </p>

        <div className="mt-6 text-base leading-relaxed" style={{ color: colors.ink }}>
          {intro}
        </div>

        <nav
          aria-label="Contents"
          className="mt-6 rounded-xl border p-4 text-sm"
          style={{ borderColor: colors.border, backgroundColor: colors.tile }}
        >
          <ol className="list-decimal space-y-1 pl-5">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} style={{ color: colors.primary }}>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="mt-8 scroll-mt-6">
            <h2
              className="text-xl font-bold"
              style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
            >
              {i + 1}. {s.title}
            </h2>
            <div
              className="mt-2 space-y-3 text-base leading-relaxed [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1"
              style={{ color: colors.inkMuted }}
            >
              {s.body}
            </div>
          </section>
        ))}

        <footer
          className="mt-12 flex flex-wrap gap-x-5 gap-y-2 border-t pt-4 text-sm"
          style={{ borderColor: colors.border }}
        >
          <Link href="/privacy" style={{ color: colors.primary }}>
            Privacy Policy
          </Link>
          <Link href="/terms" style={{ color: colors.primary }}>
            Terms of Service
          </Link>
          <a href="mailto:support@tryouthq.ca" style={{ color: colors.primary }}>
            support@tryouthq.ca
          </a>
        </footer>
      </div>
    </div>
  );
}

/** The links shown under sign in and sign up, and on Profile. */
export function LegalLinks({ className = '' }: { className?: string }) {
  const { colors } = useTheme();
  return (
    <p className={`text-center text-xs ${className}`} style={{ color: colors.inkMuted }}>
      By continuing you agree to the{' '}
      <Link href="/terms" className="font-bold underline" style={{ color: colors.primary }}>
        Terms of Service
      </Link>{' '}
      and{' '}
      <Link href="/privacy" className="font-bold underline" style={{ color: colors.primary }}>
        Privacy Policy
      </Link>
      .
    </p>
  );
}
