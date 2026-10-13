'use client';

import { useRef, useState } from 'react';

import { Icon, type IconName } from '@/components/Icons';
import { Button, useAlert } from '@/components/ui';
import {
  useAddEventCommentMutation,
  useDeleteEventCommentMutation,
  useDeleteEventFileMutation,
  useEventCommentsQuery,
  useEventFilesQuery,
  useUploadEventFileMutation,
} from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i;
const kindOf = (f: { name: string; contentType: string }): 'video' | 'image' | 'info' =>
  f.contentType.startsWith('video/') || VIDEO_EXT.test(f.name)
    ? 'video'
    : f.contentType.startsWith('image/') || IMAGE_EXT.test(f.name)
      ? 'image'
      : 'info';

const formatSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Comments and files for one event. Everyone who can see the event can read
 * and post comments (a guardian speaks for their athlete); only `canManage`
 * users (coaches) attach or remove files, and can remove any comment.
 * Shown under the selected event only, so it reads its counts straight away: four
 * indicators (video, info, picture, comments) show what has been added.
 */
export function EventDiscussion({
  seasonId,
  eventId,
  canManage = false,
  hideVideo = false,
  currentUserId,
}: {
  seasonId: string;
  eventId: string;
  canManage?: boolean;
  /** Guardians do not get video options; those live on the subscriber's hub screens. */
  hideVideo?: boolean;
  /** Lets a user remove their own comment. */
  currentUserId?: string;
}) {
  const colors = useThemeColors();
  const { alert, confirm } = useAlert();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const comments = useEventCommentsQuery(eventId, { enabled: true });
  const files = useEventFilesQuery(eventId, { enabled: true });
  const addComment = useAddEventCommentMutation(eventId);
  const deleteComment = useDeleteEventCommentMutation(eventId);
  const upload = useUploadEventFileMutation(seasonId, eventId);
  const deleteFile = useDeleteEventFileMutation(eventId);

  const fail = (title: string, e: unknown) => alert(title, e instanceof Error ? e.message : 'Please try again.');

  const post = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await addComment.mutateAsync(body);
      setDraft('');
    } catch (e) {
      await fail('Could Not Post Comment', e);
    }
  };

  const attach = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      await alert('File Too Large', 'Files can be up to 20 MB.');
      return;
    }
    try {
      await upload.mutateAsync(file);
    } catch (e) {
      await fail('Could Not Upload File', e);
    }
  };

  const remove = async (title: string, run: () => Promise<unknown>, failTitle: string) => {
    if (!(await confirm({ title, confirmLabel: 'Remove', destructive: true, requireText: 'DELETE' }))) return;
    try {
      await run();
    } catch (e) {
      await fail(failTitle, e);
    }
  };

  const visibleFiles = hideVideo ? files.data?.filter((f) => kindOf(f) !== 'video') : files.data;
  const counts = { video: 0, info: 0, image: 0 };
  for (const f of visibleFiles ?? []) counts[kindOf(f)] += 1;
  const indicators: { key: string; icon: IconName; label: string; count: number | undefined }[] = [
    ...(hideVideo ? [] : [{ key: 'video', icon: 'video' as const, label: 'Video', count: files.data ? counts.video : undefined }]),
    { key: 'info', icon: 'info', label: 'Info', count: files.data ? counts.info : undefined },
    { key: 'image', icon: 'image', label: 'Photo', count: files.data ? counts.image : undefined },
    { key: 'comments', icon: 'chat', label: 'Comments', count: comments.data?.length },
  ];

  const box = { borderColor: colors.border, backgroundColor: colors.tile };

  return (
    <div className="mt-2">
      <p className="mb-2 text-xs font-bold" style={{ color: colors.primary }}>
        Comments &amp; files
      </p>
      <div className="flex gap-2">
        {indicators.map((i) => {
          const has = (i.count ?? 0) > 0;
          return (
            <button
              key={i.key}
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              title={`${i.label}${i.count == null ? '' : `: ${i.count}`}`}
              className="flex h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 transition-[filter] hover:brightness-110"
              style={{
                backgroundColor: has ? 'rgba(255,107,43,0.12)' : colors.tile,
                borderColor: has ? colors.primary : colors.border,
                color: has ? colors.primary : colors.inkMuted,
              }}
            >
              <span className="flex items-center gap-1 text-xs font-bold">
                <Icon name={i.icon} size={14} color="currentColor" />
                {i.count ?? '–'}
              </span>
              <span className="max-w-full truncate text-[10px] font-medium">{i.label}</span>
            </button>
          );
        })}
      </div>

      {open ? (
        <div className="mt-2 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>Files</p>
            {files.isLoading ? <p className="text-sm" style={{ color: colors.inkFaint }}>Loading…</p> : null}
            {visibleFiles?.length === 0 ? (
              <p className="text-sm" style={{ color: colors.inkFaint }}>No files attached.</p>
            ) : null}
            {visibleFiles?.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2" style={box}>
                <div className="min-w-0 flex-1">
                  {f.url ? (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm font-semibold underline"
                      style={{ color: colors.primary }}
                    >
                      {f.name}
                    </a>
                  ) : (
                    <span className="block truncate text-sm font-semibold" style={{ color: colors.inkMuted }}>{f.name}</span>
                  )}
                  <span className="text-xs" style={{ color: colors.inkFaint }}>{formatSize(f.size)}</span>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    className="text-sm"
                    style={{ color: colors.danger }}
                    onClick={() => remove(`Remove ${f.name}?`, () => deleteFile.mutateAsync(f), 'Could Not Remove File')}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
            {canManage ? (
              <>
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => void attach(e.target.files?.[0])} />
                <Button label="Attach a file" variant="secondary" size="sm" loading={upload.isPending} onClick={() => fileRef.current?.click()} />
              </>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>Comments</p>
            {comments.isLoading ? <p className="text-sm" style={{ color: colors.inkFaint }}>Loading…</p> : null}
            {comments.isError ? <p className="text-sm" style={{ color: colors.danger }}>Could not load comments.</p> : null}
            {comments.data?.length === 0 ? (
              <p className="text-sm" style={{ color: colors.inkFaint }}>No comments yet.</p>
            ) : null}
            {comments.data?.map((c) => (
              <div key={c.id} className="rounded-md border px-3 py-2" style={box}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold" style={{ color: colors.ink }}>
                    {c.authorName || 'Member'}
                    <span className="ml-2 font-normal" style={{ color: colors.inkFaint }}>
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </span>
                  {canManage || c.authorUserId === currentUserId ? (
                    <button
                      type="button"
                      className="text-xs"
                      style={{ color: colors.danger }}
                      onClick={() => remove('Remove this comment?', () => deleteComment.mutateAsync(c.id), 'Could Not Remove Comment')}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm" style={{ color: colors.ink }}>{c.body}</p>
              </div>
            ))}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a comment"
              maxLength={2000}
              rows={2}
              className="rounded-md border px-3 py-2 text-sm"
              style={{ ...box, color: colors.ink }}
            />
            <Button label="Post comment" size="sm" loading={addComment.isPending} disabled={!draft.trim()} onClick={post} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
