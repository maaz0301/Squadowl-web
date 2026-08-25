/**
 * Body scroll lock shared by every overlay.
 *
 * Each overlay used to save and restore `document.body.style.overflow` itself,
 * which only works while one is open at a time. Open a second overlay over the
 * first — the dummy-data modal launched from the Tools sheet, an alert raised
 * over that modal — and the newcomer saved the `hidden` its predecessor had
 * already set. Whichever one closed last then wrote that `hidden` back and the
 * page could not be scrolled again until a reload.
 *
 * Counting instead: the first lock records the page's real overflow, the last
 * release puts it back, and the ones in between only move the count.
 */
let locks = 0;
let savedOverflow = '';

/** Locks body scroll; call the returned function once to release it. */
export function lockBodyScroll(): () => void {
  if (locks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  locks += 1;

  // Guarded so a cleanup that somehow runs twice can't drop the count below the
  // overlays still on screen and unlock the page under them.
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) document.body.style.overflow = savedOverflow;
  };
}
