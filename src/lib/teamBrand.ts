/**
 * Colour maths for team branding. A team's brand colour is an arbitrary
 * "#RRGGBB" a club picked to match its jersey, so nothing about it can be
 * assumed — not its lightness, not its contrast against the app theme.
 */

function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

/**
 * Black or white ink, whichever reads better on `hex`. The 0.4 threshold sits
 * above the usual 0.179 midpoint on purpose: these surfaces carry small
 * secondary text as well as headings, and mid-tone brand colours (the mid
 * blues and greens clubs pick most often) are more legible with dark ink.
 */
export function readableInkOn(hex: string): string {
  return luminance(hex) > 0.4 ? '#0d1629' : '#ffffff';
}
