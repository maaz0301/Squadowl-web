'use client';

import { useMemo, useRef, useState } from 'react';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  RefreshButton,
  Switch,
  Textarea,
  useAlert,
} from '@/components/ui';
import { Icon, type IconName } from '@/components/Icons';
import {
  useCreateLibraryItemMutation,
  useDeleteLibraryItemMutation,
  useInvalidateVideoStorage,
  useLibraryQuery,
  useUpdateLibraryItemMutation,
  useVideoStorageQuery,
} from '@/features/queries';
import Link from 'next/link';
import { getDataSource } from '@/data';
import { StorageMeterCard } from '@/components/video/StorageMeter';
import { compressVideo, readVideoDuration, VideoCompressError } from '@/lib/videoCompress';
import {
  VIDEO_PHASE_LABEL,
  formatBytes,
  friendlyVideoError,
  type VideoUploadProgress,
} from '@/data/videoStorage';
import {
  DEFAULT_LIBRARY_AUDIENCE,
  LIBRARY_AUDIENCES,
  LIBRARY_AUDIENCE_LABELS,
  LIBRARY_KINDS,
  type LibraryAudienceFlags,
  type LibraryItem,
  type LibraryKind,
} from '@/data/types';
import { usePermissions } from '@/state/authStore';
import { formatFileSize, isUploadedVideo, safeExternalUrl, videoEmbedUrl } from '@/lib/libraryMedia';

const KIND_LABEL: Record<LibraryKind, string> = { note: 'Note', file: 'File', video: 'Video', link: 'Link' };
const KIND_ICON: Record<LibraryKind, IconName> = { note: 'edit', file: 'export', video: 'video', link: 'share' };
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface FormState {
  kind: LibraryKind;
  title: string;
  body: string;
  url: string;
  audience: LibraryAudienceFlags;
  file: File | null;
  /** A video chosen from the computer, compressed and uploaded to account storage on save. */
  video: File | null;
}

const emptyForm = (): FormState => ({
  kind: 'note',
  title: '',
  body: '',
  url: '',
  audience: { ...DEFAULT_LIBRARY_AUDIENCE },
  file: null,
  video: null,
});

export default function LibraryPage() {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const { canManageOrganization } = usePermissions();
  const libraryQuery = useLibraryQuery();
  const createItem = useCreateLibraryItemMutation();
  const updateItem = useUpdateLibraryItemMutation();
  const deleteItem = useDeleteLibraryItemMutation();

  const [filter, setFilter] = useState<LibraryKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<LibraryItem | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [viewing, setViewing] = useState<LibraryItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const storage = useVideoStorageQuery();
  const videoInfo = storage.data;
  const invalidateVideos = useInvalidateVideoStorage();
  const [uploadProgress, setUploadProgress] = useState<VideoUploadProgress | null>(null);

  const items = useMemo(() => libraryQuery.data ?? [], [libraryQuery.data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (i) =>
        (filter === 'all' || i.kind === filter) &&
        (!q || `${i.title} ${i.body} ${i.fileName ?? ''}`.toLowerCase().includes(q)),
    );
  }, [items, filter, search]);

  if (libraryQuery.isLoading) return <LoadingState message="Loading library..." />;
  if (libraryQuery.isError) {
    return (
      <>
        <PageHeader title="Library" />
        <ErrorState message="Could not load the library." onRetry={() => libraryQuery.refetch()} />
      </>
    );
  }

  const openNew = () => {
    setForm(emptyForm());
    setEditing('new');
  };
  const openEdit = (item: LibraryItem) => {
    setForm({
      kind: item.kind,
      title: item.title,
      body: item.body,
      url: item.url ?? '',
      audience: { ...item.audience },
      file: null,
      video: null,
    });
    setEditing(item);
  };
  const closeForm = () => setEditing(null);

  /** Compress and upload the chosen video, create the item, then attach the video to it. */
  const saveWithVideo = async () => {
    if (!form.video) return;
    if (!form.title.trim()) {
      await alert('Could not save', 'Give the item a title.');
      return;
    }
    let videoId: string | null = null;
    try {
      setUploadProgress({ phase: 'compressing', fraction: 0 });
      const durationSeconds = await readVideoDuration(form.video);
      const compressed = await compressVideo(form.video, (fraction) => setUploadProgress({ phase: 'compressing', fraction }));
      setUploadProgress({ phase: 'uploading', fraction: 0 });
      const uploaded = await getDataSource().uploadAccountVideo({
        file: compressed,
        context: 'library',
        title: form.title.trim(),
        durationSeconds,
        onProgress: (fraction) => setUploadProgress({ phase: 'uploading', fraction }),
      });
      videoId = uploaded.id;
      const item = await createItem.mutateAsync({
        input: { kind: 'video', title: form.title, body: form.body, url: form.url, audience: form.audience, uploadedVideo: true },
      });
      await getDataSource().attachAccountVideo(uploaded.id, 'library', item.id);
      invalidateVideos();
      toast('Added to the library', 'success');
      closeForm();
    } catch (e) {
      // Nothing may be left holding quota that no item shows.
      if (videoId) await getDataSource().deleteAccountVideo(videoId).catch(() => undefined);
      await alert(
        'Could not save',
        e instanceof VideoCompressError ? e.message : friendlyVideoError(e instanceof Error ? e.message : undefined),
      );
    } finally {
      setUploadProgress(null);
    }
  };

  const save = async () => {
    if (editing === 'new' && form.kind === 'video' && form.video) {
      await saveWithVideo();
      return;
    }
    try {
      if (editing === 'new') {
        if (form.file && form.file.size > MAX_UPLOAD_BYTES) {
          await alert('File too large', 'Uploads can be up to 50 MB. For a longer video, paste a link instead.');
          return;
        }
        await createItem.mutateAsync({
          input: { kind: form.kind, title: form.title, body: form.body, url: form.url, audience: form.audience },
          file: form.kind === 'file' || form.kind === 'video' ? (form.file ?? undefined) : undefined,
        });
        toast('Added to the library', 'success');
      } else if (editing) {
        await updateItem.mutateAsync({
          id: editing.id,
          updates: { title: form.title, body: form.body, url: form.url, audience: form.audience },
        });
        toast('Saved', 'success');
      }
      closeForm();
    } catch (e) {
      await alert('Could not save', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const remove = async (item: LibraryItem) => {
    const ok = await confirm({
      title: 'Delete from library',
      message: `Delete "${item.title}"? Everyone who could see it loses access.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteItem.mutateAsync(item);
      toast('Deleted', 'success');
    } catch (e) {
      await alert('Could not delete', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  // Read opens everything in the app: a note's text, a file's preview, a video
  // or a link, each with its description and a way to open or download it.
  const open = (item: LibraryItem) => setViewing(item);

  const saving = createItem.isPending || updateItem.isPending || uploadProgress !== null;
  const isNew = editing === 'new';
  const showUrl = form.kind === 'link' || form.kind === 'video';
  // Uploaded videos go through account storage (compressed, counted against the quota),
  // so the plain file picker is for documents only.
  const showFile = isNew && form.kind === 'file';
  const showVideoUpload = isNew && form.kind === 'video';
  const multipleClubs = new Set(items.map((i) => i.accountId)).size > 1;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Library"
        right={
          <div className="flex items-center gap-2">
            <RefreshButton onRefresh={() => libraryQuery.refetch()} />
            {canManageOrganization ? <Button label="Add to Library" onClick={openNew} /> : null}
          </div>
        }
      />

      <p className="mb-3 text-sm" style={{ color: colors.inkMuted }}>
        {canManageOrganization
          ? 'Store files, notes, videos and links, then choose who can see each one.'
          : 'Files, notes, videos and links shared with you.'}
      </p>

      <StorageMeterCard />
      <Input
        label="Search the library"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Title or description"
        autoComplete="off"
      />
      <div className="mt-3 flex flex-wrap">
        <Chip label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        {LIBRARY_KINDS.map((k) => (
          <Chip key={k} label={`${KIND_LABEL[k]}s`} active={filter === k} onClick={() => setFilter(k)} />
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? 'The library is empty' : 'Nothing matches'}
          message={
            items.length === 0
              ? canManageOrganization
                ? 'Add a file, note, video or link and choose who can see it.'
                : 'When your coach shares something here, it will show up.'
              : 'Try a different search or filter.'
          }
        />
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {shown.map((item) => (
            <Card key={item.id} className="flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: 'rgba(255,107,43,0.12)' }}
                >
                  <Icon name={KIND_ICON[item.kind]} size={20} color={colors.primary} />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-base font-bold"
                    style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
                  >
                    {item.title}
                  </p>
                  <p className="text-xs" style={{ color: colors.inkMuted }}>
                    {KIND_LABEL[item.kind]}
                    {item.fileName ? ` · ${item.fileName} (${formatFileSize(item.fileSize)})` : ''}
                    {multipleClubs && item.accountName ? ` · ${item.accountName}` : ''}
                  </p>
                  {item.body && item.kind !== 'note' ? (
                    <p className="mt-1 text-sm" style={{ color: colors.inkMuted }}>
                      {item.body}
                    </p>
                  ) : null}
                  {item.kind === 'note' ? (
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm" style={{ color: colors.inkMuted }}>
                      {item.body}
                    </p>
                  ) : null}
                </div>
              </div>
              {canManageOrganization ? (
                <div className="flex flex-wrap gap-1.5">
                  {LIBRARY_AUDIENCES.filter((a) => item.audience[a]).map((a) => (
                    <Badge key={a} label={LIBRARY_AUDIENCE_LABELS[a]} variant="info" />
                  ))}
                  {LIBRARY_AUDIENCES.every((a) => !item.audience[a]) ? (
                    <Badge label="Only you" variant="default" />
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  label="Read"
                  variant="secondary"
                  onClick={() => open(item)}
                />
                {canManageOrganization ? (
                  <>
                    <Button size="sm" label="Edit" variant="secondary" onClick={() => openEdit(item)} />
                    <Button size="sm" label="Delete" variant="danger" onClick={() => remove(item)} />
                  </>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        visible={editing !== null}
        title={isNew ? 'Add to Library' : 'Edit item'}
        onClose={closeForm}
        hideDefaultFooter
      >
        <div className="flex flex-col gap-3">
          {isNew ? (
            <div className="flex flex-wrap">
              {LIBRARY_KINDS.map((k) => (
                <Chip
                  key={k}
                  label={KIND_LABEL[k]}
                  active={form.kind === k}
                  onClick={() => setForm((f) => ({ ...f, kind: k, file: null }))}
                />
              ))}
            </div>
          ) : null}
          <Input label="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <Textarea
            label={form.kind === 'note' ? 'Note' : 'Description (optional)'}
            rows={form.kind === 'note' ? 8 : 3}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          />
          {showUrl ? (
            <Input
              label={form.kind === 'video' ? 'Video link (YouTube, Vimeo or any address)' : 'Link'}
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://"
              inputMode="url"
              autoCapitalize="none"
            />
          ) : null}
          {showFile ? (
            <div>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                accept={form.kind === 'video' ? 'video/*' : undefined}
                onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] ?? null }))}
              />
              <Button
                label={form.file ? 'Choose a different file' : form.kind === 'video' ? 'Or upload a video' : 'Choose a file'}
                variant="secondary"
                onClick={() => fileInput.current?.click()}
              />
              {form.file ? (
                <p className="mt-1 text-xs" style={{ color: colors.inkMuted }}>
                  {form.file.name} ({formatFileSize(form.file.size)})
                </p>
              ) : null}
              <p className="mt-1 text-xs" style={{ color: colors.inkMuted }}>
                Up to 50 MB. For longer videos, paste a link instead.
              </p>
            </div>
          ) : null}

          {showVideoUpload ? (
            <div className="flex flex-col gap-1">
              {videoInfo?.canUpload ? (
                <>
                  <input
                    ref={videoInput}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => setForm((f) => ({ ...f, video: e.target.files?.[0] ?? null }))}
                  />
                  <div>
                    <Button
                      label={form.video ? 'Choose a different video' : 'Or upload a video'}
                      variant="secondary"
                      onClick={() => videoInput.current?.click()}
                      disabled={uploadProgress !== null}
                    />
                  </div>
                  {form.video ? (
                    <p className="text-xs" style={{ color: colors.inkMuted }}>
                      {form.video.name} ({formatBytes(form.video.size)} before compression)
                    </p>
                  ) : null}
                  {uploadProgress ? (
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-bold" style={{ color: colors.ink }}>
                        {uploadProgress.phase === 'compressing' && uploadProgress.fraction === 0 ? 'Preparing the compressor... (first time only)' : `${VIDEO_PHASE_LABEL[uploadProgress.phase]}... ${Math.round(uploadProgress.fraction * 100)}%`}
                      </p>
                      <div className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: colors.border }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.round(uploadProgress.fraction * 100)}%`, backgroundColor: colors.primary }}
                        />
                      </div>
                    </div>
                  ) : null}
                  <p className="text-xs" style={{ color: colors.inkMuted }}>
                    Compressed to 720p before it uploads, and counted against your video storage.
                  </p>
                </>
              ) : videoInfo?.canManage && videoInfo.planEligible ? (
                <Link
                  href="/storage"
                  className="inline-block rounded-lg border px-3 py-2 text-center text-sm font-semibold"
                  style={{ borderColor: colors.primary, color: colors.primary }}
                >
                  Add video storage to upload a video
                </Link>
              ) : (
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  Uploading videos needs video storage on a Coach+ or Club plan. You can still paste a link.
                </p>
              )}
            </div>
          ) : null}

          <div className="rounded-xl border p-3" style={{ borderColor: colors.border }}>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
              Who can view this
            </p>
            <p className="mb-2 text-xs" style={{ color: colors.inkMuted }}>
              Owners and admins always can.
            </p>
            <div className="flex flex-col gap-2">
              {LIBRARY_AUDIENCES.map((a) => (
                <Switch
                  key={a}
                  label={LIBRARY_AUDIENCE_LABELS[a]}
                  checked={form.audience[a]}
                  onChange={(v) => setForm((f) => ({ ...f, audience: { ...f.audience, [a]: v } }))}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button label="Cancel" variant="secondary" onClick={closeForm} />
            <Button label={isNew ? 'Add' : 'Save'} onClick={save} loading={saving} />
          </div>
        </div>
      </Modal>

      <Modal visible={viewing !== null} title={viewing?.title ?? ''} onClose={() => setViewing(null)} size="lg">
        {viewing ? <Viewer item={viewing} /> : null}
      </Modal>
    </div>
  );
}

function Viewer({ item }: { item: LibraryItem }) {
  const colors = useThemeColors();
  const embed = videoEmbedUrl(item.url);
  const external = safeExternalUrl(item.url);
  const type = item.contentType ?? '';
  const isImage = type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(item.fileName ?? '');
  const isPdf = type === 'application/pdf' || /\.pdf$/i.test(item.fileName ?? '');
  const linkClass = 'inline-block rounded-lg px-3 py-2 text-sm font-semibold';
  return (
    <div className="flex flex-col gap-3">
      {item.video?.url ? (
        <video
          src={item.video.url}
          controls
          playsInline
          className="max-h-[60vh] w-full rounded-lg bg-black"
          // View only unless the coach has allowed downloads for viewers.
          controlsList={item.video.viewersCanDownload ? undefined : 'nodownload'}
          disablePictureInPicture={!item.video.viewersCanDownload}
          onContextMenu={item.video.viewersCanDownload ? undefined : (e) => e.preventDefault()}
        />
      ) : null}
      {isUploadedVideo(item) && item.fileUrl ? (
        <video src={item.fileUrl} controls className="max-h-[60vh] w-full rounded-lg bg-black" />
      ) : embed ? (
        <iframe
          src={embed}
          title={item.title}
          className="aspect-video w-full rounded-lg"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      ) : null}
      {item.kind === 'file' && item.fileUrl && isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.fileUrl} alt={item.title} className="max-h-[60vh] w-full rounded-lg object-contain" />
      ) : null}
      {item.kind === 'file' && item.fileUrl && isPdf ? (
        <iframe src={item.fileUrl} title={item.title} className="h-[60vh] w-full rounded-lg bg-white" />
      ) : null}
      {item.body ? (
        <p
          className="whitespace-pre-line text-sm leading-relaxed"
          style={{ color: item.kind === 'note' ? colors.ink : colors.inkMuted }}
        >
          {item.body}
        </p>
      ) : null}
      {item.fileName ? (
        <p className="text-xs" style={{ color: colors.inkMuted }}>
          {item.fileName}
          {item.fileSize ? ` · ${formatFileSize(item.fileSize)}` : ''}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {item.fileUrl && !isUploadedVideo(item) ? (
          <a
            href={item.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            download={item.fileName}
            className={linkClass}
            style={{ background: colors.primary, color: '#fff' }}
          >
            {item.kind === 'file' ? 'Open or download file' : 'Open attachment'}
          </a>
        ) : null}
        {external ? (
          <a
            href={external}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            style={{ border: `1px solid ${colors.primary}`, color: colors.primary }}
          >
            Open link in a new tab
          </a>
        ) : null}
      </div>
    </div>
  );
}
