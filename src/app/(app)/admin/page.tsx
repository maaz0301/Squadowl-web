'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, Tabs } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useAdminStatsQuery, useAdminUsersQuery, useOverridePlanMutation } from '@/features/queries';

const ADMIN_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'billing', label: 'Billing' },
  { key: 'support', label: 'Support' },
] as const;

type AdminTab = (typeof ADMIN_TABS)[number]['key'];

export default function AdminPage() {
  const colors = useThemeColors();
  const [tab, setTab] = useState<AdminTab>('overview');
  const statsQuery = useAdminStatsQuery();
  const usersQuery = useAdminUsersQuery();
  const overridePlan = useOverridePlanMutation();
  const [overridingId, setOverridingId] = useState<string | null>(null);

  const stats = statsQuery.data;

  const handleUpgrade = (userId: string) => {
    setOverridingId(userId);
    overridePlan.mutate({ userId, planTier: 'club' }, { onSettled: () => setOverridingId(null) });
  };

  return (
    <>
      <PageHeader
        title="Admin Portal"
        subtitle={stats ? 'Super Admin (Demo)' : undefined}
        showBack
        backHref="/dashboard"
      />

      {statsQuery.isLoading ? (
        <LoadingState message="Loading admin..." />
      ) : statsQuery.isError || !stats ? (
        <ErrorState message="Could not load admin data." onRetry={() => statsQuery.refetch()} />
      ) : (
        <PlanGate feature="enterprise" title="Admin Portal">
          <Tabs tabs={[...ADMIN_TABS]} activeKey={tab} onChange={(k) => setTab(k as AdminTab)} className="mb-6" />

          {tab === 'overview' ? (
            <div className="space-y-4">
              <Card accent className="flex flex-col gap-2">
                <h3 className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                  Platform Overview
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge label={`${stats.totalUsers} users`} variant="brand" />
                  <Badge label={`${stats.activeUsers} active`} variant="success" />
                  <Badge label={`${stats.totalAssessments} evaluations`} />
                  <Badge label={`$${stats.revenueMtd} MTD`} variant="info" />
                </div>
              </Card>
              <Card className="flex flex-col gap-2">
                <h3 className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                  Recent Activity (Mock)
                </h3>
                <p className="text-sm" style={{ color: colors.inkMuted }}>12 new registrations today</p>
                <p className="text-sm" style={{ color: colors.inkMuted }}>3 evaluations exported</p>
                <p className="text-sm" style={{ color: colors.inkMuted }}>1 enterprise org onboarded</p>
              </Card>
            </div>
          ) : null}

          {tab === 'users' ? (
            <div className="space-y-2">
              {(usersQuery.data ?? []).map((u) => (
                <Card key={u.id} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold" style={{ color: colors.ink }}>{u.displayName}</span>
                    <Badge label={u.planTier} />
                  </div>
                  <p className="text-sm" style={{ color: colors.inkMuted }}>{u.email}</p>
                  <p className="text-xs" style={{ color: colors.inkFaint }}>
                    {u.teamCount} teams · {u.assessmentCount} evaluations
                  </p>
                  {u.planTier !== 'club' ? (
                    <Button
                      label="Upgrade to Club"
                      size="sm"
                      variant="secondary"
                      loading={overridingId === u.id && overridePlan.isPending}
                      onClick={() => handleUpgrade(u.id)}
                    />
                  ) : null}
                </Card>
              ))}
            </div>
          ) : null}

          {tab === 'billing' ? (
            <Card accent className="flex flex-col gap-2">
              <h3 className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                Billing (Mock)
              </h3>
              <p className="text-sm" style={{ color: colors.inkMuted }}>MTD revenue: ${stats.revenueMtd}</p>
              <p className="text-sm" style={{ color: colors.inkMuted }}>Active subscriptions: {stats.activeUsers}</p>
              <p className="text-sm" style={{ color: colors.inkMuted }}>Failed payments: 2 (demo)</p>
            </Card>
          ) : null}

          {tab === 'support' ? (
            <Card className="flex flex-col gap-2">
              <h3 className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
                Support Queue (Mock)
              </h3>
              <div className="divide-y" style={{ borderColor: colors.border }}>
                {['Password reset — coach@example.com', 'Export issue — club tier', 'QR code not loading'].map(
                  (ticket) => (
                    <div key={ticket} className="py-2">
                      <span style={{ color: colors.ink }}>{ticket}</span>
                    </div>
                  ),
                )}
              </div>
            </Card>
          ) : null}
        </PlanGate>
      )}
    </>
  );
}
