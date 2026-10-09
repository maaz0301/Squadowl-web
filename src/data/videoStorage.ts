/**
 * Video Storage Add-On: what the plans cost, how full the meter is, and the
 * shapes the data layer returns. Kept free of platform code so the app and the
 * web build share one definition (this file is identical in both repos).
 *
 * Prices are CAD per year, the same on web (Stripe), iOS and Android. They are
 * repeated in supabase/functions/create-checkout-session and manage-video-storage,
 * which is where the charge is actually made.
 */

export const BYTES_PER_GB = 1073741824;

export type VideoStorageGb = 1 | 5 | 20;

export interface VideoStoragePlan {
  gb: VideoStorageGb;
  label: string;
  priceCents: number;
}

export const VIDEO_STORAGE_PLANS: VideoStoragePlan[] = [
  { gb: 1, label: '1 GB', priceCents: 1500 },
  { gb: 5, label: '5 GB', priceCents: 2500 },
  { gb: 20, label: '20 GB', priceCents: 4000 },
];

/** Plan tiers that may buy video storage. */
export const VIDEO_STORAGE_TIERS = ['coach_plus', 'club'] as const;

export function isVideoStorageTier(tier: string | null | undefined): boolean {
  return tier === 'coach_plus' || tier === 'club';
}

/** Where a video can be attached. Every one counts against the same quota. */
export type VideoContext = 'library' | 'report_card' | 'evaluation' | 'team_post';

/** One account's storage state, from get_video_storage(). */
export interface VideoStorageInfo {
  accountId: string;
  planTier: string;
  /** The plan is Coach+ or Club, so the add-on can be bought. */
  planEligible: boolean;
  /** Purchased size, 0 when there is no add-on. */
  gb: number;
  /** Plan and add-on both active: uploads are allowed. */
  entitled: boolean;
  source: 'stripe' | 'apple' | 'google' | null;
  quotaBytes: number;
  usedBytes: number;
  videoCount: number;
  /** The signed-in person may upload (coach always; a manager when the coach allows it). */
  canUpload: boolean;
  /** The signed-in person is staff who can change settings and remove any video. */
  canManage: boolean;
  managersCanUpload: boolean;
  viewersCanDownload: boolean;
  /** When a cancelled add-on's paid period ends. */
  cancelAt: number | null;
  endedAt: number | null;
  /** When the stored videos will be (or were due to be) deleted, if anything is scheduled. */
  deletionAt: number | null;
}

export interface AccountVideo {
  id: string;
  accountId: string;
  storagePath: string;
  fileName: string;
  title: string;
  sizeBytes: number;
  durationSeconds?: number;
  context: VideoContext;
  contextId?: string;
  status: 'pending' | 'ready';
  createdBy: string;
  createdAt: number;
  /** Players and guardians may download this video (the coach's switch, copied onto each video). */
  viewersCanDownload: boolean;
  /** Short-lived signed address, present on the reads that ask for one. */
  url?: string;
}

/** A video on the device, ready to compress or upload. */
export interface LocalVideoFile {
  uri: string;
  name: string;
  type: string;
  size: number;
  durationSeconds?: number;
}

export type VideoUploadPhase = 'compressing' | 'uploading' | 'done';

export interface VideoUploadProgress {
  phase: VideoUploadPhase;
  /** 0 to 1 within the current phase. */
  fraction: number;
}

export const VIDEO_PHASE_LABEL: Record<VideoUploadPhase, string> = {
  compressing: 'Compressing',
  uploading: 'Uploading',
  done: 'Done',
};

export type StorageLevel = 'ok' | 'warn' | 'full';

/** The meter turns orange from 80% used and red when full. */
export function storageLevel(usedBytes: number, quotaBytes: number): StorageLevel {
  if (quotaBytes <= 0) return 'full';
  if (usedBytes >= quotaBytes) return 'full';
  if (usedBytes / quotaBytes >= 0.8) return 'warn';
  return 'ok';
}

export function storageFraction(usedBytes: number, quotaBytes: number): number {
  if (quotaBytes <= 0) return 0;
  return Math.min(1, Math.max(0, usedBytes / quotaBytes));
}

/** "2.3 GB", "480 MB", "12 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= BYTES_PER_GB / 10) return `${(bytes / BYTES_PER_GB).toFixed(bytes >= BYTES_PER_GB ? 1 : 2)} GB`;
  if (bytes >= 1048576) return `${Math.round(bytes / 1048576)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "46%": whole percent used, never "0%" while something is stored, never above 100%. */
export function storagePercent(usedBytes: number, quotaBytes: number): string {
  const fraction = storageFraction(usedBytes, quotaBytes);
  const pct = fraction > 0 && fraction < 0.01 ? 1 : Math.round(fraction * 100);
  return `${pct}%`;
}

/** "2.3 GB / 5 GB used (46%)". */
export function storageMeterLabel(usedBytes: number, quotaBytes: number): string {
  return `${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)} used (${storagePercent(usedBytes, quotaBytes)})`;
}

export function formatPlanPrice(plan: VideoStoragePlan): string {
  return `$${plan.priceCents / 100}/year`;
}

/** The server marks a refused upload with this prefix (errcode 53100). */
export function isStorageFullMessage(message: string | undefined | null): boolean {
  return !!message && /storage_full|storage is full/i.test(message);
}

/** Turns a database error into something a coach can act on. */
export function friendlyVideoError(message: string | undefined | null): string {
  if (!message) return 'Something went wrong with the video. Try again.';
  if (isStorageFullMessage(message)) {
    return 'Your video storage is full. Delete some videos or move to a larger size.';
  }
  return message.replace(/^storage_full:\s*/i, '');
}
