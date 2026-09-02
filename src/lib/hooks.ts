'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

const subscribeNever = () => () => {};

/**
 * True only after the first client render. Auth state lives in localStorage, so
 * anything that branches on it must wait for mount to avoid hydration mismatch.
 * useSyncExternalStore rather than a mount-effect + setState: the "snapshot"
 * differs between server and client render by definition (that's the whole
 * point of the hook), so it's the value this API exists for — no cascading
 * re-render needed to reach the true state.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/** Matches a CSS media query reactively (e.g. desktop breakpoints). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const apply = () => setMatches(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [query]);
  return matches;
}

/**
 * `value`, held back until it has stopped changing for `delay` ms.
 *
 * For inputs whose value drives a *read* rather than only a local filter: the
 * team roster's search is matched server-side, so without this every keystroke
 * would be its own request (and its own cache entry) while the coach is still
 * typing the name.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
