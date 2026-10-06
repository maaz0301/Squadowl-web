import { describe, expect, it } from 'vitest';
import type { PDFImage, PDFPage } from 'pdf-lib';

import { drawLogoStrip, type EmbeddedLogo } from './reportPdf';

const logo = (width: number): EmbeddedLogo => ({ image: {} as PDFImage, width, height: 30 });

function draw(logos: EmbeddedLogo[], left = 50) {
  const calls: { x: number; y: number; width: number }[] = [];
  const page = { drawImage: (_i: unknown, o: { x: number; y: number; width: number }) => calls.push(o) } as unknown as PDFPage;
  drawLogoStrip(page, logos, left);
  return calls;
}

describe('drawLogoStrip', () => {
  it('puts the organization and team logos on the left and the app logo on the right, on one line', () => {
    const [org, team, app] = draw([logo(70), logo(40), logo(43)]);
    expect(org.x).toBe(50);
    expect(team.x).toBe(50 + 70 + 12);
    expect(app.x + app.width).toBe(612 - 50);
    expect(new Set([org.y, team.y, app.y]).size).toBe(1);
  });

  it('keeps a lone logo on the left', () => {
    const [only] = draw([logo(43)]);
    expect(only.x).toBe(50);
  });
});
