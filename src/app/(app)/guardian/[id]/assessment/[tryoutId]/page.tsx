'use client';

import { useParams } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { useGuardianRostersQuery } from '@/features/queries';

export default function GuardianAssessmentDetailPage() {
  const routeParams = useParams();
  const playerId = Array.isArray(routeParams?.id) ? routeParams.id[0] : (routeParams?.id as string);
  const tryoutId = Array.isArray(routeParams?.tryoutId) ? routeParams.tryoutId[0] : (routeParams?.tryoutId as string);
  const colors = useThemeColors();
  const guardianQuery = useGuardianRostersQuery();

  if (guardianQuery.isLoading) {
    return <LoadingState message="Loading assessment details..." />;
  }

  if (guardianQuery.isError) {
    return <ErrorState message="Failed to load assessment details." onRetry={() => guardianQuery.refetch()} />;
  }

  const athlete = guardianQuery.data?.find((a) => a.id === playerId);
  const tryout = athlete?.tryouts.find((t) => t.id === tryoutId);

  if (!athlete || !tryout) {
    return (
      <>
        <PageHeader title="Assessment Details" showBack backHref={`/guardian/${playerId}`} />
        <EmptyState title="Not found" message="We couldn't find the details for this assessment." />
      </>
    );
  }

  return (
    <>
      <PageHeader title={tryout.name} showBack backHref={`/guardian/${playerId}`} />
      <p className="mb-4 text-sm font-medium" style={{ color: colors.inkMuted }}>
        Assessment Results · {tryout.sport}
      </p>

      {tryout.sessions.length === 0 ? (
        <EmptyState
          title="No sessions recorded"
          message="There are no assessment results available yet for this tryout."
        />
      ) : (
        <div>
          {tryout.sessions.map((session, i) => (
            <Card key={session.name || i} className="mb-4">
              <div className="mb-3 flex items-center justify-between border-b pb-3" style={{ borderColor: colors.border }}>
                <p className="text-lg font-bold" style={{ color: colors.ink }}>
                  {session.name}
                </p>
                <Badge
                  label={session.result || 'Pending'}
                  variant={session.result === 'Make' ? 'success' : session.result === 'Release' ? 'danger' : 'warning'}
                />
              </div>

              {session.scores && Object.keys(session.scores).length > 0 ? (
                <div className="rounded-md p-3" style={{ backgroundColor: colors.tile }}>
                  <p className="mb-2 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
                    Detailed Marks
                  </p>
                  {Object.entries(session.scores).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between border-b py-2 last:border-0"
                      style={{ borderColor: colors.border }}
                    >
                      <span className="text-sm font-medium" style={{ color: colors.ink }}>{key}</span>
                      <span className="text-sm font-bold" style={{ color: colors.ink }}>{value}/5</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm italic" style={{ color: colors.inkMuted }}>
                  No detailed marks recorded for this session.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
