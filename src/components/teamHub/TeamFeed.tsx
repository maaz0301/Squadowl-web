'use client';

import { useRef, useState } from 'react';

import { Badge, Button, Chip, Input, Modal, ModalFooter, Textarea, useAlert } from '@/components/ui';
import {
  FeedUploadError,
  useAddPostCommentMutation,
  useCreateOrgInfoMutation,
  useCreateSeasonPostMutation,
  useDeleteOrgInfoFileMutation,
  useDeleteOrgInfoMutation,
  useDeletePostCommentMutation,
  useDeletePostFileMutation,
  useDeleteSeasonPostMutation,
  useOrgInfoQuery,
  usePostCommentsQuery,
  useSeasonPostsQuery,
} from '@/features/queries';
import {
  ORG_INFO_CATEGORIES,
  ORG_INFO_CATEGORY_LABELS,
  type FeedFile,
  type OrgInfoCategory,
  type OrgInfoItem,
  type SeasonEvent,
  type SeasonPost,
} from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { HubSectionLabel } from './HubSection';
import { useHubSurfaces } from './hubTheme';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const formatSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const formatWhen = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function formatTime(value?: string): string {
  const m = value ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The next few events that haven't ended yet, soonest first. */
function upcoming(events: SeasonEvent[], limit = 3): SeasonEvent[] {
  const today = todayKey();
  return events
    .filter((e) => (e.endDate || e.date) >= today)
    .sort((a, b) => `${a.date} ${a.startTime ?? ''}`.localeCompare(`${b.date} ${b.startTime ?? ''}`))
    .slice(0, limit);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Please try again.');

function FileRow({ file, onRemove }: { file: FeedFile; onRemove?: () => void }) {
  const colors = useThemeColors();
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
      style={{ borderColor: colors.border, backgroundColor: colors.tile }}
    >
      <div className="min-w-0 flex-1">
        {file.url ? (
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-semibold underline"
            style={{ color: colors.primary }}
          >
            {file.name}
          </a>
        ) : (
          <span className="block truncate text-sm font-semibold" style={{ color: colors.inkMuted }}>{file.name}</span>
        )}
        <span className="text-xs" style={{ color: colors.inkFaint }}>{formatSize(file.size)}</span>
      </div>
      {onRemove ? (
        <button type="button" className="text-sm" style={{ color: colors.danger }} onClick={onRemove}>
          Remove
        </button>
      ) : null}
    </div>
  );
}

/** Files chosen in a composer but not yet uploaded. */
function usePendingFiles() {
  const { alert } = useAlert();
  const [files, setFiles] = useState<File[]>([]);
  const add = async (picked: FileList | null) => {
    if (!picked?.length) return;
    const list = Array.from(picked);
    const tooBig = list.filter((f) => f.size > MAX_FILE_BYTES);
    if (tooBig.length) await alert('File Too Large', 'Files can be up to 20 MB.');
    setFiles((prev) => [...prev, ...list.filter((f) => f.size <= MAX_FILE_BYTES)]);
  };
  return { files, add, remove: (i: number) => setFiles((prev) => prev.filter((_, n) => n !== i)), clear: () => setFiles([]) };
}

function PendingFiles({ pending }: { pending: ReturnType<typeof usePendingFiles> }) {
  const colors = useThemeColors();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1.5">
      {pending.files.map((f, i) => (
        <div
          key={`${f.name}-${i}`}
          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
          style={{ borderColor: colors.border, backgroundColor: colors.tile }}
        >
          <span className="min-w-0 flex-1 truncate text-sm" style={{ color: colors.ink }}>
            {f.name} · {formatSize(f.size)}
          </span>
          <button type="button" className="text-sm" style={{ color: colors.danger }} onClick={() => pending.remove(i)}>
            Remove
          </button>
        </div>
      ))}
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void pending.add(e.target.files);
          e.target.value = '';
        }}
      />
      <Button label="Attach a file" variant="secondary" size="sm" onClick={() => ref.current?.click()} />
    </div>
  );
}

function PostComments({
  seasonId,
  post,
  canModerate,
  currentUserId,
}: {
  seasonId: string;
  post: SeasonPost;
  canModerate: boolean;
  currentUserId?: string;
}) {
  const colors = useThemeColors();
  const { alert, confirm } = useAlert();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const comments = usePostCommentsQuery(post.id, { enabled: open });
  const add = useAddPostCommentMutation(seasonId, post.id);
  const remove = useDeletePostCommentMutation(seasonId, post.id);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await add.mutateAsync(body);
      setDraft('');
    } catch (e) {
      await alert('Could Not Post Comment', errorText(e));
    }
  };

  const removeComment = async (id: string) => {
    if (!(await confirm({ title: 'Remove this comment?', confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await remove.mutateAsync(id);
    } catch (e) {
      await alert('Could Not Remove Comment', errorText(e));
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-sm font-semibold"
        style={{ color: colors.primary }}
      >
        {open ? 'Hide comments' : post.commentCount ? `Comments (${post.commentCount})` : 'Comment'}
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {comments.isLoading ? <p className="text-sm" style={{ color: colors.inkFaint }}>Loading…</p> : null}
          {comments.isError ? <p className="text-sm" style={{ color: colors.danger }}>Could not load comments.</p> : null}
          {comments.data?.map((c) => (
            <div key={c.id} className="rounded-md border px-3 py-2" style={{ borderColor: colors.border, backgroundColor: colors.tile }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold" style={{ color: colors.ink }}>
                  {c.authorName || 'Member'}
                  <span className="ml-2 font-normal" style={{ color: colors.inkFaint }}>{formatWhen(c.createdAt)}</span>
                </span>
                {canModerate || c.authorUserId === currentUserId ? (
                  <button type="button" className="text-xs" style={{ color: colors.danger }} onClick={() => void removeComment(c.id)}>
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
            style={{ borderColor: colors.border, backgroundColor: colors.tile, color: colors.ink }}
          />
          <Button label="Post comment" size="sm" loading={add.isPending} disabled={!draft.trim()} onClick={submit} />
        </div>
      ) : null}
    </div>
  );
}

function PostCard({
  seasonId,
  post,
  canPost,
  currentUserId,
}: {
  seasonId: string;
  post: SeasonPost;
  canPost: boolean;
  currentUserId?: string;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const { alert, confirm } = useAlert();
  const deletePost = useDeleteSeasonPostMutation(seasonId);
  const deleteFile = useDeletePostFileMutation(seasonId);

  const removePost = async () => {
    if (!(await confirm({ title: 'Delete Post', message: 'Delete this post, its comments and files?', confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await deletePost.mutateAsync(post);
    } catch (e) {
      await alert('Could Not Delete Post', errorText(e));
    }
  };

  const removeFile = async (f: FeedFile) => {
    if (!(await confirm({ title: `Remove ${f.name}?`, confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await deleteFile.mutateAsync(f);
    } catch (e) {
      await alert('Could Not Remove File', errorText(e));
    }
  };

  return (
    <div className="mb-3 rounded-xl border p-3" style={{ backgroundColor: s.panelBg, borderColor: s.panelBorder }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {post.title ? <p className="text-base font-bold" style={{ color: colors.ink }}>{post.title}</p> : null}
          <p className="text-xs" style={{ color: colors.inkFaint }}>
            {post.authorName || 'Coach'} · {formatWhen(post.createdAt)}
          </p>
        </div>
        {canPost ? (
          <button type="button" className="text-sm" style={{ color: colors.danger }} disabled={deletePost.isPending} onClick={() => void removePost()}>
            Delete
          </button>
        ) : null}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: colors.ink }}>{post.body}</p>
      {post.files.length ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {post.files.map((f) => (
            <FileRow key={f.id} file={f} onRemove={canPost ? () => void removeFile(f) : undefined} />
          ))}
        </div>
      ) : null}
      <PostComments seasonId={seasonId} post={post} canModerate={canPost} currentUserId={currentUserId} />
    </div>
  );
}

function PostComposer({ seasonId, visible, onClose }: { seasonId: string; visible: boolean; onClose: () => void }) {
  const { alert } = useAlert();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const pending = usePendingFiles();
  const create = useCreateSeasonPostMutation(seasonId);

  const close = () => {
    setTitle('');
    setBody('');
    pending.clear();
    onClose();
  };

  const submit = async () => {
    try {
      await create.mutateAsync({ title, body, files: pending.files });
      close();
    } catch (e) {
      if (e instanceof FeedUploadError) {
        close();
        await alert('Posted', e.message);
      } else {
        await alert('Could Not Post', errorText(e));
      }
    }
  };

  return (
    <Modal
      visible={visible}
      title="Post an Update"
      onClose={close}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={close} />
          <Button label="Post" loading={create.isPending} disabled={!body.trim()} onClick={submit} />
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-3">
        <Input label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <Textarea label="Message" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={5000} />
        <PendingFiles pending={pending} />
        <p className="text-xs opacity-70">Everyone on the team can see this and comment.</p>
      </div>
    </Modal>
  );
}

function OrgInfoComposer({ seasonId, visible, onClose }: { seasonId: string; visible: boolean; onClose: () => void }) {
  const { alert } = useAlert();
  const [category, setCategory] = useState<OrgInfoCategory>('announcement');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const pending = usePendingFiles();
  const create = useCreateOrgInfoMutation(seasonId);

  const close = () => {
    setCategory('announcement');
    setTitle('');
    setBody('');
    setUrl('');
    pending.clear();
    onClose();
  };

  const submit = async () => {
    try {
      await create.mutateAsync({ category, title, body, url, files: pending.files });
      close();
    } catch (e) {
      if (e instanceof FeedUploadError) {
        close();
        await alert('Saved', e.message);
      } else {
        await alert('Could Not Save', errorText(e));
      }
    }
  };

  return (
    <Modal
      visible={visible}
      title="Add Organization Info"
      onClose={close}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={close} />
          <Button label="Save" loading={create.isPending} disabled={!title.trim()} onClick={submit} />
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {ORG_INFO_CATEGORIES.map((c) => (
            <Chip key={c} label={ORG_INFO_CATEGORY_LABELS[c]} active={category === c} onClick={() => setCategory(c)} />
          ))}
        </div>
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <Textarea label="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={5000} />
        <Input label="Link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoCapitalize="none" />
        <PendingFiles pending={pending} />
        <p className="text-xs opacity-70">Shown to every team in your organization.</p>
      </div>
    </Modal>
  );
}

function OrgInfoCard({ item, canPost }: { item: OrgInfoItem; canPost: boolean }) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const { alert, confirm } = useAlert();
  const deleteItem = useDeleteOrgInfoMutation();
  const deleteFile = useDeleteOrgInfoFileMutation();

  const removeItem = async () => {
    if (!(await confirm({ title: 'Delete', message: `Delete "${item.title}" for every team?`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await deleteItem.mutateAsync(item);
    } catch (e) {
      await alert('Could Not Delete', errorText(e));
    }
  };

  const removeFile = async (f: FeedFile) => {
    if (!(await confirm({ title: `Remove ${f.name}?`, confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await deleteFile.mutateAsync(f);
    } catch (e) {
      await alert('Could Not Remove File', errorText(e));
    }
  };

  return (
    <div className="mb-3 rounded-xl border p-3" style={{ backgroundColor: s.panelBg, borderColor: s.panelBorder }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1">
            <Badge label={ORG_INFO_CATEGORY_LABELS[item.category]} variant="info" />
          </div>
          <p className="text-base font-bold" style={{ color: colors.ink }}>{item.title}</p>
          <p className="text-xs" style={{ color: colors.inkFaint }}>
            {item.authorName || 'Staff'} · {formatWhen(item.createdAt)}
          </p>
        </div>
        {canPost ? (
          <button type="button" className="text-sm" style={{ color: colors.danger }} disabled={deleteItem.isPending} onClick={() => void removeItem()}>
            Delete
          </button>
        ) : null}
      </div>
      {item.body ? <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: colors.ink }}>{item.body}</p> : null}
      {/^https?:\/\//i.test(item.url) ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block truncate text-sm font-semibold underline"
          style={{ color: colors.primary }}
        >
          {item.url}
        </a>
      ) : null}
      {item.files.length ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {item.files.map((f) => (
            <FileRow key={f.id} file={f} onRemove={canPost ? () => void removeFile(f) : undefined} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A team's news feed: the next few events, coach updates (with files) that
 * members can comment on, and the organization-wide info every team shares.
 * `canPost` is the team's staff or manager; `canPostOrg` is account staff only.
 */
export function TeamFeed({
  seasonId,
  events,
  canPost,
  canPostOrg,
  currentUserId,
  onViewSchedule,
}: {
  seasonId: string;
  events: SeasonEvent[];
  canPost: boolean;
  canPostOrg: boolean;
  currentUserId?: string;
  onViewSchedule?: () => void;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const [composing, setComposing] = useState(false);
  const [composingOrg, setComposingOrg] = useState(false);
  const posts = useSeasonPostsQuery(seasonId);
  const orgInfo = useOrgInfoQuery(seasonId);
  const next = upcoming(events);

  return (
    <div>
      <HubSectionLabel
        icon="calendar"
        label="Upcoming Events"
        actionLabel={onViewSchedule && events.length ? 'View All' : undefined}
        onAction={onViewSchedule}
      />
      {next.length === 0 ? (
        <p className="mb-6 text-sm" style={{ color: colors.inkMuted }}>No upcoming events.</p>
      ) : (
        <div className="mb-6 flex flex-col gap-2">
          {next.map((ev) => (
            <div key={ev.id} className="rounded-xl border px-3 py-2.5" style={{ backgroundColor: s.panelBg, borderColor: s.panelBorder }}>
              <p className="text-sm font-bold" style={{ color: colors.ink }}>{ev.title}</p>
              <p className="mt-0.5 text-xs" style={{ color: colors.inkMuted }}>
                {ev.date}
                {ev.startTime ? ` · ${formatTime(ev.startTime)}` : ''}
                {ev.location ? ` · ${ev.location}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      <HubSectionLabel icon="megaphone" label="Team News" />
      {canPost ? (
        <div className="mb-3">
          <Button label="+ Post an update" onClick={() => setComposing(true)} />
        </div>
      ) : null}
      {posts.isLoading ? <p className="mb-3 text-sm" style={{ color: colors.inkFaint }}>Loading…</p> : null}
      {posts.isError ? <p className="mb-3 text-sm" style={{ color: colors.danger }}>Could not load the feed.</p> : null}
      {posts.data?.length === 0 ? (
        <p className="mb-3 text-sm" style={{ color: colors.inkMuted }}>
          {canPost ? 'Nothing posted yet. Share news, reminders or files with the team.' : 'No updates yet.'}
        </p>
      ) : null}
      {posts.data?.map((p) => (
        <PostCard key={p.id} seasonId={seasonId} post={p} canPost={canPost} currentUserId={currentUserId} />
      ))}

      <div className="mt-6">
        <HubSectionLabel icon="inbox" label="Organization Info" />
      </div>
      {canPostOrg ? (
        <div className="mb-3">
          <Button label="+ Add organization info" variant="secondary" onClick={() => setComposingOrg(true)} />
        </div>
      ) : null}
      {orgInfo.isLoading ? <p className="mb-3 text-sm" style={{ color: colors.inkFaint }}>Loading…</p> : null}
      {orgInfo.isError ? <p className="mb-3 text-sm" style={{ color: colors.danger }}>Could not load organization info.</p> : null}
      {orgInfo.data?.length === 0 ? (
        <p className="mb-3 text-sm" style={{ color: colors.inkMuted }}>
          {canPostOrg
            ? 'Post testing info, competition info, links or documents once and every team sees it.'
            : 'Nothing shared by the organization yet.'}
        </p>
      ) : null}
      {orgInfo.data?.map((item) => <OrgInfoCard key={item.id} item={item} canPost={canPostOrg} />)}

      {canPost ? <PostComposer seasonId={seasonId} visible={composing} onClose={() => setComposing(false)} /> : null}
      {canPostOrg ? <OrgInfoComposer seasonId={seasonId} visible={composingOrg} onClose={() => setComposingOrg(false)} /> : null}
    </div>
  );
}
