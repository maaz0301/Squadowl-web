'use client';

import { useEffect } from 'react';
import { APP_CONFIG } from '@/config/app';

/**
 * Sets the browser tab title to "<title> | SquadOwl" while the component is
 * mounted, then restores whatever it was. Pass undefined while the name is still
 * loading and the existing title is left alone.
 */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} | ${APP_CONFIG.appName}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
