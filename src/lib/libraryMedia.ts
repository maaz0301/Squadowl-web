import type { LibraryItem } from '@/data/types';

/**
 * An embeddable player address for the video hosts coaches most often paste
 * (YouTube, Vimeo). Anything else returns null and is opened as a plain link
 * instead, because most other hosts refuse to be framed.
 */
export function videoEmbedUrl(url: string | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1);
    return /^[\w-]{6,20}$/.test(id) ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : u.searchParams.get('v');
    return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (host === 'vimeo.com') {
    const id = u.pathname.split('/').filter(Boolean)[0];
    return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
  }
  return null;
}

/** Only http(s) addresses are ever opened or framed; anything else a coach typed is ignored. */
export function safeExternalUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function isUploadedVideo(item: Pick<LibraryItem, 'kind' | 'contentType' | 'fileName'>): boolean {
  return (
    item.kind === 'video' &&
    (!!item.contentType?.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(item.fileName ?? ''))
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
