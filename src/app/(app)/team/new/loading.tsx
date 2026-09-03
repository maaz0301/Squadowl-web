import { Skeleton } from '@/components/ui/States';

/** Instant fallback for /team/new — see the /assessment/new boundary. */
export default function NewTeamLoading() {
  return (
    <div role="status" aria-label="Loading new team form">
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton width="34%" height={26} />
        <Skeleton width="22%" height={14} />
      </div>
      <Skeleton height={360} radius={16} />
    </div>
  );
}
