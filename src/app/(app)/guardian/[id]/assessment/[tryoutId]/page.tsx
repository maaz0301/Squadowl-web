'use client';

import { useParams } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { useGuardianRostersQuery } from '@/features/queries';
import type { ThemeColors } from '@/theme/tokens';

function DetailRow({ label, value, colors }: { label: string; value?: string; colors: ThemeColors }) {
  return (
    <div className="flex justify-between gap-3 border-b py-2 last:border-0" style={{ borderColor: colors.border }}>
      <span className="text-sm" style={{ color: colors.inkMuted }}>{label}</span>
      <span className="flex-1 text-right text-sm font-medium" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '—'}
      </span>
    </div>
  );
}

/** "5:30 PM – 7:00 PM", or just the start when no end time was set. */
function formatTimeRange(start?: string, end?: string): string | undefined {
  const clock = (t?: string) => (t ? t.slice(0, 5) : undefined);
  const from = clock(start);
  const to = clock(end);
  if (!from) return undefined;
  return to ? `${from} – ${to}` : from;
}

/**
 * What a guardian is shown about an assessment their athlete is in: where and
 * when to turn up, and nothing else. Scores, session results and the coach's
 * make/release recommendation stay with the coach who ran it — the guardian
 * payload doesn't carry them at all (see mapGuardianRosterRow), so there is
 * nothing here to leak.
 */
export default function GuardianAssessmentDetailPage() {
  const routeParams = useParams();
  const playerId = Array.isArray(routeParams?.id) ? routeParams.id[0] : (routeParams?.id as string);
  const tryoutId = Array.isArray(routeParams?.tryoutId) ? routeParams.tryoutId[0] : (routeParams?.tryoutId as string);
  const colors = useThemeColors();
  const guardianQuery = useGuardianRostersQuery();

  if (guardianQuery.isLoading) {
    return <LoadingState message="Loading event details..." />;
  }

  if (guardianQuery.isError) {
    return <ErrorState message="Failed to load event details." onRetry={() => guardianQuery.refetch()} />;
  }

  const athlete = guardianQuery.data?.find((a) => a.id === playerId);
  const tryout = athlete?.tryouts.find((t) => t.id === tryoutId);

  if (!athlete || !tryout) {
    return (
      <>
        <PageHeader title="Event Details" showBack backHref={`/guardian/${playerId}`} />
        <EmptyState title="Not found" message="We couldn't find the details for this event." />
      </>
    );
  }

  return (
    <>
      <PageHeader title={tryout.name} showBack backHref={`/guardian/${playerId}`} />
      <p className="mb-4 text-sm font-medium" style={{ color: colors.inkMuted }}>
        Event Details · {tryout.sport}
      </p>

      <Card className="mb-4 flex flex-col gap-1">
        <DetailRow label="Athlete" value={`${athlete.firstName} ${athlete.lastName}`} colors={colors} />
        <DetailRow label="Event" value={tryout.name} colors={colors} />
        <DetailRow label="Sport" value={tryout.sport} colors={colors} />
        <DetailRow label="Date" value={tryout.date} colors={colors} />
        <DetailRow label="Time" value={formatTimeRange(tryout.startTime, tryout.endTime)} colors={colors} />
        <DetailRow label="Location" value={tryout.location} colors={colors} />
      </Card>

      <Card>
        <p className="text-sm" style={{ color: colors.inkMuted }}>
          Evaluation scores and results are shared by the coach running this event. Reach out to them directly with
          any questions about your athlete&apos;s assessment.
        </p>
      </Card>
    </>
  );
}
