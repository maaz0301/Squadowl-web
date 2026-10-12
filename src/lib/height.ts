/**
 * An athlete's height is stored in centimetres and typed either way: "168",
 * "168 cm", 5'6", "5 ft 6" or "66 in" all work, so a coach can use whatever
 * the family quotes. Kept identical in both repos (src/lib/height.ts).
 */

const CM_PER_INCH = 2.54;
export const MIN_HEIGHT_CM = 30;
export const MAX_HEIGHT_CM = 260;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Reads typed text into centimetres; null when it is empty or cannot be read. */
export function parseHeightCm(text: string | undefined | null): number | null {
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return null;
  // 5'6", 5' 6, 5 ft 6 in, 5ft, 5-6
  const feet = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot|-)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (feet) {
    const cm = (parseFloat(feet[1]) * 12 + (feet[2] ? parseFloat(feet[2]) : 0)) * CM_PER_INCH;
    return round1(cm);
  }
  const num = t.match(/^(\d+(?:\.\d+)?)\s*(cm|in|inch|inches|")?$/);
  if (!num) return null;
  const n = parseFloat(num[1]);
  if (num[2] && num[2] !== 'cm') return round1(n * CM_PER_INCH);
  // A bare number under 100 can only be inches; 100 and over is centimetres.
  if (!num[2] && n < 100) return round1(n * CM_PER_INCH);
  return round1(n);
}

/** True when the text is empty or reads as a believable height. */
export function isValidHeightText(text: string | undefined | null): boolean {
  if (!(text ?? '').trim()) return true;
  const cm = parseHeightCm(text);
  return cm != null && cm >= MIN_HEIGHT_CM && cm <= MAX_HEIGHT_CM;
}

/** "168 cm (5'6")" for display; empty when unknown. */
export function formatHeight(cm: number | null | undefined): string {
  if (cm == null || !isFinite(cm) || cm <= 0) return '';
  const totalIn = Math.round(cm / CM_PER_INCH);
  const shown = Number.isInteger(cm) ? String(cm) : cm.toFixed(1);
  return `${shown} cm (${Math.floor(totalIn / 12)}'${totalIn % 12}")`;
}

/** What to put back in the text box when editing a stored height. */
export function heightToText(cm: number | null | undefined): string {
  if (cm == null || !isFinite(cm) || cm <= 0) return '';
  return Number.isInteger(cm) ? String(cm) : cm.toFixed(1);
}
