'use client';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, SectionLabel, Spinner } from '@/components/ui';
import { useImpersonationStore } from '@/state/impersonationStore';
import { useFounderTeamQuery, useIsFounderQuery } from '@/features/founderQueries';

/**
 * Founder-only strip on the real team page, shown only while View As is
 * active. Real coaches never see this — `useImpersonationStore` is only ever
 * set once founder_log_impersonation() has confirmed the caller is the
 * founder (see ViewAsButton.tsx).
 *
 * Reads team managers and this team's evaluations' assessors through
 * getFounderTeam() — the founder console's own direct-table read, entirely
 * separate from whatever the real TeamManagersCard / Assessors card compute
 * on this same screen. That independence is the point: it's a
 * founder-trustworthy confirmation of who's actually delegated to this team,
 * regardless of any gap in the ordinary coach-facing permission checks.
 */
export function ImpersonationTeamPanel({ teamId }: { teamId: string }) {
  const colors = useThemeColors();
  const impersonating = useImpersonationStore((s) => !!s.target);
  const founderQuery = useIsFounderQuery(impersonating);
  const active = impersonating && founderQuery.data === true;
  const query = useFounderTeamQuery(teamId, active);

  if (!active) return null;

  if (query.isLoading) {
    return (
      <Card className="flex items-center gap-2 lg:col-span-2">
        <Spinner size={16} />
        <span className="text-sm" style={{ color: colors.inkMuted }}>
          Loading founder view of delegated access…
        </span>
      </Card>
    );
  }
  // A load failure here shouldn't take the real page down with it — it just
  // means this extra strip stays off.
  if (query.isError || !query.data) return null;

  const { staff, evaluations } = query.data;
  const assigned = evaluations.flatMap((e) => e.assessors.map((a) => ({ ...a, evaluationName: e.name })));
  if (!staff.length && !assigned.length) return null;

  const row = (key: string, primary: string, secondary?: string, badge?: string) => (
    <div key={key} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5" style={{ backgroundColor: colors.tile }}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold" style={{ color: colors.ink }}>
          {primary}
        </p>
        {secondary ? (
          <p className="truncate text-xs" style={{ color: colors.inkMuted }}>
            {secondary}
          </p>
        ) : null}
      </div>
      {badge ? <Badge label={badge} variant="info" /> : null}
    </div>
  );

  return (
    <Card className="flex flex-col gap-3 lg:col-span-2" style={{ borderColor: colors.primary }}>
      <div>
        <SectionLabel>Founder View — Delegated Access</SectionLabel>
        <p className="mt-1 text-xs" style={{ color: colors.inkMuted }}>
          Visible only to you, only while viewing as this organization.
        </p>
      </div>
      {staff.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-bold tracking-wide uppercase" style={{ color: colors.inkFaint }}>
            Team Managers ({staff.length})
          </p>
          {staff.map((m) => row(m.id, m.name || m.email || 'Unnamed manager', undefined, m.role))}
        </div>
      ) : null}
      {assigned.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-bold tracking-wide uppercase" style={{ color: colors.inkFaint }}>
            Assigned Assessors ({assigned.length})
          </p>
          {assigned.map((a, i) =>
            row(`${a.email ?? a.name ?? i}-${i}`, a.name || a.email || 'Unnamed assessor', a.evaluationName, a.status),
          )}
        </div>
      ) : null}
    </Card>
  );
}
