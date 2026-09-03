import { Skeleton } from '@/components/ui/States';

/**
 * Instant fallback for /assessment/new. The form itself is a client component,
 * so a cold navigation would otherwise sit on the previous screen while its
 * chunk loads — the same "nothing happened" pause the assessment and team
 * detail boundaries exist to remove.
 */
export default function NewAssessmentLoading() {
  return (
    <div role="status" aria-label="Loading new evaluation form">
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton width="42%" height={26} />
        <Skeleton width="26%" height={14} />
      </div>
      <Skeleton height={420} radius={16} />
    </div>
  );
}
