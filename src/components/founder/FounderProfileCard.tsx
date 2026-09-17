'use client';

import Link from 'next/link';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, SectionLabel } from '@/components/ui';

const LINKS = [
  { href: '/founder', label: 'Organizations', hint: 'List, search, suspend or reactivate, plan and access' },
  { href: '/founder', label: 'New Organization', hint: 'Set up a pilot or manually onboarded organization' },
  { href: '/founder', label: 'Audit Log', hint: 'Every suspension, plan change and new organization' },
];

/**
 * Takes the place of the profile page's plan limits and coach quick links for
 * founder@tryout.ca: the founder account has no plan of its own to manage, and
 * the coach screens those links open aren't part of its console.
 */
export function FounderProfileCard() {
  const colors = useThemeColors();
  return (
    <Card className="flex flex-col gap-1">
      <SectionLabel>Founder Console</SectionLabel>
      {LINKS.map((l) => (
        <Link
          key={l.label}
          href={l.href}
          className="rounded-lg px-2 py-2 transition-colors hover:brightness-125"
          style={{ color: colors.ink }}
        >
          <span className="block text-[15px] font-semibold">{l.label}</span>
          <span className="block text-xs" style={{ color: colors.inkMuted }}>
            {l.hint}
          </span>
        </Link>
      ))}
    </Card>
  );
}
