/** Scrolls the page (and any scrollable layout container) back to the top, e.g. after paging a list. */
export function scrollToTop() {
  if (typeof window === 'undefined') return;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.querySelectorAll<HTMLElement>('main, [data-scroll-root]').forEach((el) => {
    if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
