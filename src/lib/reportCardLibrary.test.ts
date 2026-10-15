import { describe, expect, it } from 'vitest';

import { addLibraryVideos, libraryVideoAttachment } from '@/lib/reportCardLibrary';
import type { LibraryItem, ReportCardAttachment } from '@/data/types';

const item = (o: Partial<LibraryItem>): LibraryItem =>
  ({ id: 'i1', accountId: 'a', kind: 'video', title: 'Crossovers', body: '', fileSize: 0, ...o }) as LibraryItem;
const stored = { id: 'v1', url: 'https://x.supabase.co/signed?token=1h' } as NonNullable<LibraryItem['video']>;

describe('libraryVideoAttachment', () => {
  it('keeps the permanent address of an externally hosted video', () => {
    expect(libraryVideoAttachment(item({ url: ' https://youtu.be/abc ' }))).toEqual({
      kind: 'video',
      name: 'Crossovers',
      url: 'https://youtu.be/abc',
      libraryItemId: 'i1',
    });
  });

  it('attaches a stored video by reference and never saves its short-lived address', () => {
    const a = libraryVideoAttachment(item({ video: stored }));
    expect(a).toEqual({ kind: 'video', name: 'Crossovers', libraryItemId: 'i1' });
    expect(JSON.stringify(a)).not.toContain('signed');
  });

  it('prefers the external address when both exist', () => {
    expect(libraryVideoAttachment(item({ url: 'https://vimeo.com/1', video: stored }))?.url).toBe('https://vimeo.com/1');
  });

  it('ignores non-videos, non-web addresses and empty items', () => {
    expect(libraryVideoAttachment(item({ kind: 'link' as LibraryItem['kind'], url: 'https://a.com' }))).toBeNull();
    expect(libraryVideoAttachment(item({ url: 'javascript:alert(1)' }))).toBeNull();
    expect(libraryVideoAttachment(item({}))).toBeNull();
  });

  it('falls back to the file name when the title is blank', () => {
    expect(libraryVideoAttachment(item({ title: ' ', fileName: 'drill.mp4', video: stored }))?.name).toBe('drill.mp4');
  });
});

describe('addLibraryVideos', () => {
  const existing: ReportCardAttachment[] = [{ kind: 'link', name: 'Sheet', url: 'https://a.com' }];

  it('appends new videos after what is already attached', () => {
    const r = addLibraryVideos(existing, [item({ url: 'https://youtu.be/abc' }), item({ id: 'i2', title: 'Edges', video: stored })]);
    expect(r.added).toBe(2);
    expect(r.next.map((a) => a.name)).toEqual(['Sheet', 'Crossovers', 'Edges']);
    expect(existing).toHaveLength(1);
  });

  it('skips a video that is already on the card, and repeats within the pick', () => {
    const first = addLibraryVideos(existing, [item({ url: 'https://youtu.be/abc' })]).next;
    const r = addLibraryVideos(first, [item({ url: 'https://youtu.be/abc' }), item({ id: 'i2', video: stored }), item({ id: 'i2', video: stored })]);
    expect(r.added).toBe(1);
    expect(r.next).toHaveLength(3);
  });

  it('counts videos with nothing to play', () => {
    const r = addLibraryVideos([], [item({}), item({ id: 'i2', url: 'https://a.com/v' })]);
    expect(r).toMatchObject({ added: 1, unplayable: 1 });
  });
});
