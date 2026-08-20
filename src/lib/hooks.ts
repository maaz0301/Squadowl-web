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
