'use client';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, PageHeader } from '@/components/ui';

const PACKAGES = [
  {
    id: 'starter',
    name: 'Starter Gift',
    price: 'CAD$29.99',
    description: '1 year Coach plan for a fellow coach',
    seats: 1,
  },
  {
    id: 'club',
    name: 'Club Bundle',
    price: 'CAD$149.99',
    description: '3 Club plan seats — great for assistant coaches',
    seats: 3,
    highlight: true,
  },
  {
    id: 'team',
    name: 'Team Pack',
    price: 'CAD$399.99',
    description: 'Full season for an entire coaching staff (5 seats)',
    seats: 5,
  },
];

export default function FriendPackagesPage() {
  const colors = useThemeColors();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Gift a Coach" subtitle="Friend packages" showBack />

      <Card accent className="mb-4 flex flex-col gap-2">
        <p className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          Share TryoutHQ
        </p>
        <p style={{ color: colors.inkMuted }}>
          Purchase plan gifts for assistant coaches, board members, or parent volunteers. Checkout is mocked
          for Phase 1 — no payment is processed.
        </p>
      </Card>

      {PACKAGES.map((pkg) => (
        <Card key={pkg.id} accent={pkg.highlight} className="mb-3 flex flex-col gap-2">
          <div className="flex items-start justify-between">
            <p className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
              {pkg.name}
            </p>
            <Badge label={`${pkg.seats} seat${pkg.seats > 1 ? 's' : ''}`} variant="brand" />
          </div>
          <p style={{ color: colors.inkMuted }}>{pkg.description}</p>
          <p className="text-xl font-bold" style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}>
            {pkg.price}
          </p>
          <Button label="Purchase (Demo)" variant={pkg.highlight ? 'primary' : 'secondary'} />
        </Card>
      ))}
    </div>
  );
}
