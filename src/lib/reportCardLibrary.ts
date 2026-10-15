import type { LibraryItem, ReportCardAttachment } from '@/data/types';

/**
 * A Library video as a report card attachment.
 *
 * A video hosted elsewhere keeps its permanent address, so the PDF can link to
 * it. A video stored in the account is attached by reference only: its signed
 * addresses last an hour, so no address is saved and the PDF lists the title.
 * Returns null for an item that is not a playable video.
 */
export function libraryVideoAttachment(item: LibraryItem): ReportCardAttachment | null {
  if (item.kind !== 'video') return null;
  const name = item.title.trim() || item.fileName || 'Video';
  const external = item.url && /^https?:\/\//i.test(item.url.trim()) ? item.url.trim() : undefined;
  if (external) return { kind: 'video', name, url: external, libraryItemId: item.id };
  if (item.video) return { kind: 'video', name, libraryItemId: item.id };
  return null;
}

/** Adds the chosen Library videos to a card's attachments, skipping any already on it. */
export function addLibraryVideos(
  current: ReportCardAttachment[],
  items: LibraryItem[],
): { next: ReportCardAttachment[]; added: number; unplayable: number } {
  const have = new Set(current.map((a) => a.libraryItemId).filter((x): x is string => !!x));
  const next = [...current];
  let added = 0;
  let unplayable = 0;
  for (const item of items) {
    if (have.has(item.id)) continue;
    const a = libraryVideoAttachment(item);
    if (!a) {
      unplayable += 1;
      continue;
    }
    have.add(item.id);
    next.push(a);
    added += 1;
  }
  return { next, added, unplayable };
}
