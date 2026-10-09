'use client';

import Link from 'next/link';

import { Card } from '@/components/ui';
import { useVideoStorageQuery } from '@/features/queries';
import {
  storageFraction,
  storageLevel,
  storageMeterLabel,
  type StorageLevel,
  type VideoStorageInfo,
} from '@/data/videoStorage';
import { useThemeColors } from '@/theme/ThemeProvider';

/** Green while there is room, orange from 80% used, red when full. */
export const STORAGE_LEVEL_COLOR: Record<StorageLevel, string> = {
  ok: '#22c55e',
  warn: '#f97316',
  full: '#ef4444',
};

/** The bar and its "2.3 GB / 5 GB used" label. */
export function StorageMeterBar({ info }: { info: Pick<VideoStorageInfo, 'usedBytes' | 'quotaBytes'> }) {
  const colors = useThemeColors();
  const level = storageLevel(info.usedBytes, info.quotaBytes);
  const color = STORAGE_LEVEL_COLOR[level];
  const fraction = storageFraction(info.usedBytes, info.quotaBytes);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold" style={{ color: colors.inkMuted }}>
          Video storage
        </span>
        <span className="text-sm font-bold" style={{ color: level === 'ok' ? colors.ink : color }}>
          {storageMeterLabel(info.usedBytes, info.quotaBytes)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Video storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        className="h-2.5 overflow-hidden rounded-full"
        style={{ backgroundColor: colors.border }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.max(fraction * 100, fraction > 0 ? 2 : 0)}%`, backgroundColor: color }}
        />
      </div>
      {level === 'full' ? (
        <p className="text-xs" style={{ color }}>
          Storage is full. Delete videos or choose a larger size to upload more.
        </p>
      ) : level === 'warn' ? (
        <p className="text-xs" style={{ color }}>
          Storage is almost full.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The meter for the signed-in coach's account, linking to Account Settings ->
 * Storage. Renders nothing when the account has no video storage, so the hub and
 * the Library stay clean for everyone else.
 */
export function StorageMeterCard({ accountId, className }: { accountId?: string; className?: string }) {
  const info = useVideoStorageQuery(accountId).data;
  if (!info || !info.entitled || !info.canManage) return null;
  return (
    <Link href="/storage" className={className ?? 'mb-4 block'} aria-label="Open video storage settings">
      <Card>
        <StorageMeterBar info={info} />
      </Card>
    </Link>
  );
}
