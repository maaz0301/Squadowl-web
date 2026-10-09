'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import { Button, useAlert } from '@/components/ui';
import {
  useDeleteAccountVideoMutation,
  useInvalidateVideoStorage,
  useVideoContextAccountQuery,
  useVideoStorageQuery,
  useVideosForContextQuery,
} from '@/features/queries';
import { getDataSource } from '@/data';
import {
  VIDEO_PHASE_LABEL,
  formatBytes,
  friendlyVideoError,
  type AccountVideo,
  type VideoContext,
  type VideoUploadProgress,
} from '@/data/videoStorage';
import { compressVideo, readVideoDuration, VideoCompressError } from '@/lib/videoCompress';
import { useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';

interface ContextVideosProps {
  context: VideoContext;
  /** The saved Library item, report card, evaluation or post the videos belong to. */
  contextId: string | undefined;
  accountId?: string;
  title?: string;
  /** Show playback only (no upload or delete). */
  readOnly?: boolean;
}

/**
 * The videos attached to one thing, with an "Add video" button for people who may
 * upload. Every upload is compressed in the browser first and counts against the
 * account's shared storage quota, which the server enforces.
 */
export function ContextVideos({ context, contextId, accountId: accountIdProp, title = 'Videos', readOnly }: ContextVideosProps) {
  const colors = useThemeColors();
  const { alert, confirm } = useAlert();
  const user = useUser();
  // The account comes from the thing the video belongs to, so a delegated team
  // manager uses the club's storage rather than their own account's.
  const resolved = useVideoContextAccountQuery(context, contextId, { enabled: !readOnly && !accountIdProp });
  const accountId = accountIdProp ?? resolved.data ?? undefined;
  const storage = useVideoStorageQuery(accountId, { enabled: !!contextId && !readOnly && (!!accountIdProp || resolved.isSuccess) });
  const videosQuery = useVideosForContextQuery(context, contextId ? [contextId] : []);
  const deleteVideo = useDeleteAccountVideoMutation();
  const invalidate = useInvalidateVideoStorage();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<VideoUploadProgress | null>(null);

  const info = storage.data;
  const videos = videosQuery.data ?? [];
  const full = !!info && info.quotaBytes - info.usedBytes <= 0;
  const canAdd = !readOnly && !!contextId && !!info?.canUpload;
  const busy = progress !== null && progress.phase !== 'done';

  if (!contextId) return null;
  if (!videos.length && !canAdd && !(info?.canManage && info.planEligible && !info.entitled && !readOnly)) return null;

  const onPick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      await alert('Choose a video', 'That file is not a video.');
      return;
    }
    try {
      setProgress({ phase: 'compressing', fraction: 0 });
      const durationSeconds = await readVideoDuration(file);
      const compressed = await compressVideo(file, (fraction) => setProgress({ phase: 'compressing', fraction }));
      setProgress({ phase: 'uploading', fraction: 0 });
      const uploaded = await getDataSource().uploadAccountVideo({
        file: compressed,
        context,
        title: file.name,
        accountId,
        durationSeconds,
        onProgress: (fraction) => setProgress({ phase: 'uploading', fraction }),
      });
      try {
        await getDataSource().attachAccountVideo(uploaded.id, context, contextId);
      } catch (e) {
        await getDataSource().deleteAccountVideo(uploaded.id).catch(() => undefined);
        throw e;
      }
      setProgress({ phase: 'done', fraction: 1 });
      invalidate();
    } catch (e) {
      await alert(
        'Could not add the video',
        e instanceof VideoCompressError ? e.message : friendlyVideoError(e instanceof Error ? e.message : undefined),
      );
    } finally {
      setProgress(null);
    }
  };

  const remove = async (video: AccountVideo) => {
    const ok = await confirm({
      title: 'Delete video',
      message: `Delete "${video.title || video.fileName}"? This frees ${formatBytes(video.sizeBytes)} of storage.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    deleteVideo.mutate(video.id, {
      onError: (e) => alert('Could not delete', e instanceof Error ? e.message : 'Try again.'),
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        {title}
      </p>

      {videos.map((video) => {
        // Staff may always download; players and guardians only when the coach allows it.
        const canDownload = !!info?.canManage || video.viewersCanDownload;
        return (
          <div key={video.id} className="flex flex-col gap-2 rounded-xl border p-2.5" style={{ borderColor: colors.border }}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold" style={{ color: colors.ink }}>
                  {video.title || video.fileName}
                </p>
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  {formatBytes(video.sizeBytes)}
                </p>
              </div>
              {!readOnly && (info?.canManage || video.createdBy === user?.id) ? (
                <Button size="sm" variant="danger" label="Delete" onClick={() => remove(video)} />
              ) : null}
            </div>
            {video.url ? (
              <video
                src={video.url}
                controls
                preload="metadata"
                playsInline
                className="max-h-[50vh] w-full rounded-lg bg-black"
                // View only unless the coach has allowed downloads.
                controlsList={canDownload ? undefined : 'nodownload'}
                disablePictureInPicture={!canDownload}
                onContextMenu={canDownload ? undefined : (e) => e.preventDefault()}
              />
            ) : null}
          </div>
        );
      })}

      {busy && progress ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-bold" style={{ color: colors.ink }}>
            {VIDEO_PHASE_LABEL[progress.phase]}... {Math.round(progress.fraction * 100)}%
          </p>
          <div className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: colors.border }}>
            <div className="h-full rounded-full" style={{ width: `${Math.round(progress.fraction * 100)}%`, backgroundColor: colors.primary }} />
          </div>
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            Compressing, then uploading. Keep this tab open.
          </p>
        </div>
      ) : null}

      {canAdd ? (
        <>
          <input ref={input} type="file" accept="video/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
          <Button
            variant="secondary"
            label={full ? 'Storage full' : 'Add video'}
            onClick={() => input.current?.click()}
            disabled={busy || full}
            loading={busy}
          />
          {full ? (
            <p className="text-xs" style={{ color: '#ef4444' }}>
              Your video storage is full. Delete videos or choose a larger size.
            </p>
          ) : null}
        </>
      ) : null}

      {!readOnly && info?.canManage && info.planEligible && !info.entitled ? (
        <Link href="/storage" className="inline-block rounded-lg border px-3 py-2 text-center text-sm font-semibold" style={{ borderColor: colors.primary, color: colors.primary }}>
          Add video storage
        </Link>
      ) : null}
    </div>
  );
}
