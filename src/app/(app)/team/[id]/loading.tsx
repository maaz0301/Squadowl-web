import { Skeleton } from '@/components/ui/States';

/**
 * Instant fallback for /team/[id] and its sub-screens. Same reason as the
 * assessment one: a dynamic segment with no loading boundary can't be
 * prefetched, so the tap on a team card would otherwise do nothing visible
 * until the server answered.
 */
export default function TeamLoading() {
  return (
    <div role="status" aria-label="Loading team">
      <div className="mb-6 flex items-center gap-3">
        <Skeleton width={56} height={56} radius={28} />
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton width="44%" height={26} />
          <Skeleton width="28%" height={14} />
        </span>
      </div>
      <div className="mb-6 flex gap-2">
        <Skeleton width={110} height={38} radius={12} />
        <Skeleton width={110} height={38} radius={12} />
        <Skeleton width={110} height={38} radius={12} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={92} radius={16} />
        ))}
      </div>
    </div>
  );
}
