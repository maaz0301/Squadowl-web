import { Skeleton } from '@/components/ui/States';

/**
 * Instant fallback for every screen under /assessment/[id].
 *
 * `[id]` is a dynamic segment, so without this file Next skips prefetching the
 * route entirely and a click has to wait out a server round trip *before* it
 * will paint anything — the dashboard just sits there looking broken. With a
 * loading boundary the segment is partially prefetched (shell + this skeleton),
 * the transition happens on the click, and the real screen swaps in underneath
 * the assessment header the layout has already drawn.
 */
export default function AssessmentLoading() {
  return (
    <div role="status" aria-label="Loading assessment">
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton width={140} height={38} radius={12} />
        <Skeleton width={104} height={38} radius={12} />
        <Skeleton width={104} height={38} radius={12} />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} height={66} radius={16} />
        ))}
      </div>
    </div>
  );
}
