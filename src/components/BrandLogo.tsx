'use client';

import Image from 'next/image';

import { useTheme } from '@/theme/ThemeProvider';

const TAGLINE_COLOR = { light: '#0745A4', dark: '#8DB8FF' };
const SUBTAGLINE_COLOR = { light: '#F45C10', dark: '#FF8A3D' };

/**
 * The full SquadOwl logo for the sign in pages. Light and dark share one layout
 * (owl, wordmark, tagline as live text) and only the colors change, so both
 * themes match and the tagline stays clean and readable. Mirrors the app's BrandLogo.
 */
export function BrandLogo({ width = 360 }: { width?: number }) {
  const { isDark } = useTheme();
  const mode = isDark ? 'dark' : 'light';
  return (
    <div className="flex w-full flex-col items-center" style={{ maxWidth: width, gap: 8 }} aria-label="SquadOwl" role="img">
      <Image src="/images/squadowl_mark.png" alt="" width={339} height={343} priority style={{ width: '44%', height: 'auto' }} />
      <Image
        src={isDark ? '/images/squadowl_wordmark_ondark.png' : '/images/squadowl_wordmark_onlight.png'}
        alt=""
        width={413}
        height={86}
        priority
        style={{ width: '78%', height: 'auto' }}
      />
      <p className="mt-1 text-center text-[14px] font-bold leading-5 whitespace-nowrap" style={{ color: TAGLINE_COLOR[mode] }}>
        Smarter Assessments. Scheduling. Team Sorting.
        <br />
        Clearer communication.
      </p>
      <p className="text-center text-[14px] font-bold leading-5 whitespace-nowrap" style={{ color: SUBTAGLINE_COLOR[mode] }}>
        Your All In One Team
        <br />
        Management App
      </p>
    </div>
  );
}
