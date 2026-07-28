import type { Tryout, ExportFormat } from '@/data/types';
import { computePlayerResults } from '@/data/scoring';
import { formatExportCsv } from '@/data/teamBuilder';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';

function download(fileName: string, content: string, encoding: 'utf8' | 'base64', mimeType: string) {
  let blob: Blob;
  if (encoding === 'base64') {
    const byteCharacters = atob(content);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
    blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  } else {
    blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Same three export formats as the app, delivered as a browser download. */
export async function exportTryoutData(tryout: Tryout, format: ExportFormat): Promise<void> {
  const results = computePlayerResults(tryout);
  const headers = ['Rank', 'First', 'Last', 'Jersey', 'Pos', 'Overall', 'Recommendation'];
  const rows = results
    .sort((a, b) => b.overall - a.overall)
    .map((r, i) => [
      String(i + 1),
      r.player.first,
      r.player.last,
      r.player.jersey ?? '',
      r.player.pos ?? '',
      r.overall.toFixed(2),
      r.latestRecommendation,
    ]);

  const safeName = tryout.name.replace(/\s+/g, '_');
  const fileName = `${safeName}_results.${format}`;

  if (format === 'csv') {
    download(fileName, [headers.join(','), ...rows.map((r) => r.join(','))].join('\n'), 'utf8', 'text/csv');
    return;
  }

  if (format === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tryout Results');
    download(
      fileName,
      XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }),
      'base64',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    return;
  }

  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([600, 800]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  page.drawText(`Tryout Results: ${tryout.name}`, { x: 50, y: 750, size: 20, font: fontBold });

  let y = 700;
  const xOffsets = [50, 90, 180, 280, 330, 380, 440];

  headers.forEach((h, i) => {
    page.drawText(h, { x: xOffsets[i], y, size: 10, font: fontBold });
  });
  y -= 20;

  for (const row of rows) {
    if (y < 50) {
      page = pdfDoc.addPage([600, 800]);
      y = 750;
    }
    row.forEach((cell, i) => {
      page.drawText(cell, { x: xOffsets[i], y, size: 10, font });
    });
    y -= 15;
  }

  download(fileName, await pdfDoc.saveAsBase64(), 'base64', 'application/pdf');
}

/** Team-builder style CSV export (roster + assignments). */
export async function exportTryoutToCsv(tryout: Tryout): Promise<void> {
  download(
    `${tryout.name.replace(/\s+/g, '_')}_results.csv`,
    formatExportCsv(tryout),
    'utf8',
    'text/csv',
  );
}
