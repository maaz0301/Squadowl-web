'use client';

import { useState } from 'react';

import { useLibraryQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/** Library videos tagged to this player. Hidden when there are none. */
export function TaggedVideos({ athleteId }: { athleteId: string | undefined }) {
  const colors = useThemeColors();
  const library = useLibraryQuery({ enabled: !!athleteId });
  const [openId, setOpenId] = useState<string | null>(null);

  const videos = (library.data ?? []).filter((i) => i.kind === 'video' && !!athleteId && i.athleteId === athleteId);
  if (!videos.length) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        Videos tagged to this player
      </p>
      {videos.map((item) => {
        const stored = item.video?.url;
        const external = item.url && /^https?:\/\//i.test(item.url) ? item.url : null;
        return (
          <div key={item.id} className="rounded-xl border p-2.5" style={{ borderColor: colors.border }}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: colors.ink }}>
                {item.title}
              </span>
              {stored ? (
                <button
                  type="button"
                  onClick={() => setOpenId(openId === item.id ? null : item.id)}
                  className="rounded-lg border px-3 py-1.5 text-sm font-semibold"
                  style={{ borderColor: colors.primary, color: colors.primary }}
                >
                  {openId === item.id ? 'Hide' : 'Play'}
                </button>
              ) : external ? (
                <a
                  href={external}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border px-3 py-1.5 text-sm font-semibold"
                  style={{ borderColor: colors.primary, color: colors.primary }}
                >
                  Open
                </a>
              ) : null}
            </div>
            {stored && openId === item.id ? (
              <video src={stored} controls playsInline controlsList="nodownload" className="mt-2 w-full rounded-lg bg-black" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
