import { beforeEach, describe, expect, it } from 'vitest';
import { lockBodyScroll } from './scrollLock';

/**
 * Overlays stack: the Tools sheet opens the dummy-data modal, that modal raises
 * an alert when the generated players land. Each one used to restore the
 * overflow value it had read on open, so whichever closed last wrote back the
 * `hidden` an overlay above it had set, and the roster behind them could not be
 * scrolled again until the page was reloaded.
 */
describe('lockBodyScroll', () => {
  // The tests run in the node environment; the lock only ever reads and writes
  // document.body.style.overflow, so that is all the stub needs to carry.
  const body = { style: { overflow: '' } };
  const overflow = () => body.style.overflow;

  beforeEach(() => {
    body.style.overflow = '';
    (globalThis as { document?: unknown }).document = { body };
  });

  it('restores the page when overlays close in the order they opened', () => {
    const first = lockBodyScroll();
    const second = lockBodyScroll();
    expect(overflow()).toBe('hidden');

    first();
    second();
    expect(overflow()).toBe('');
  });

  it('restores the page when an overlay outlives the one opened over it', () => {
    const sheet = lockBodyScroll();
    const modal = lockBodyScroll();

    // The alert over the modal closes first, then the modal that opened it.
    modal();
    expect(overflow()).toBe('hidden');
    sheet();
    expect(overflow()).toBe('');
  });

  it('keeps the page locked while any overlay is still open', () => {
    const sheet = lockBodyScroll();
    const modal = lockBodyScroll();

    sheet();
    expect(overflow()).toBe('hidden');

    modal();
    expect(overflow()).toBe('');
  });

  it('ignores a release that runs twice', () => {
    const sheet = lockBodyScroll();
    const modal = lockBodyScroll();

    sheet();
    sheet();
    expect(overflow()).toBe('hidden');

    modal();
    expect(overflow()).toBe('');
  });

  it('preserves an overflow the page had set for itself', () => {
    body.style.overflow = 'clip';

    const release = lockBodyScroll();
    expect(overflow()).toBe('hidden');

    release();
    expect(overflow()).toBe('clip');
  });
});
