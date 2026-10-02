import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { pdfPagesToSheet, readPdfPages, type PdfTextItem } from '@/lib/pdfTable';

const item = (str: string, x: number, y: number, width = str.length * 5): PdfTextItem => ({ str, x, y, width });

/** One table line: each [text, x] becomes a run on that height. */
const line = (y: number, ...cells: [string, number][]) => cells.map(([t, x]) => item(t, x, y));

describe('pdfPagesToSheet', () => {
  it('reads the heading and rows, skipping titles and footers', () => {
    const page = [
      ...line(780, ['Spring Assessment Results', 50]),
      ...line(740, ['Name', 50], ['Skating', 200], ['Shooting', 300]),
      ...line(720, ['Catherine Crow', 50], ['4', 200], ['3', 300]),
      ...line(700, ['Delphine Lavoie', 50], ['5', 200], ['2', 300]),
      ...line(40, ['Page 1', 280]),
    ];
    const sheet = pdfPagesToSheet([page]);
    expect(sheet.headers).toEqual(['Name', 'Skating', 'Shooting']);
    expect(sheet.rows.map((r) => r.cells)).toEqual([
      ['Catherine Crow', '4', '3'],
      ['Delphine Lavoie', '5', '2'],
    ]);
    expect(sheet.headerLine).toBe(2);
  });

  it('keeps a first and last name together and puts a short row under the right headings', () => {
    const page = [
      ...line(740, ['First Name', 50], ['Last Name', 130], ['Score', 230]),
      ...line(720, ['Ana', 50], ['Lopez', 130], ['4.5', 230]),
      ...line(700, ['Bo', 50], ['Chen', 130]), // no score
    ];
    const sheet = pdfPagesToSheet([page]);
    expect(sheet.rows.map((r) => r.cells)).toEqual([
      ['Ana', 'Lopez', '4.5'],
      ['Bo', 'Chen', ''],
    ]);
  });

  it('continues across pages and ignores a repeated heading', () => {
    const head = line(740, ['Name', 50], ['Score', 200]);
    const sheet = pdfPagesToSheet([
      [...head, ...line(720, ['Ana Lopez', 50], ['4', 200])],
      [...head, ...line(720, ['Bo Chen', 50], ['3', 200])],
    ]);
    expect(sheet.rows.map((r) => r.cells)).toEqual([
      ['Ana Lopez', '4'],
      ['Bo Chen', '3'],
    ]);
  });

  it('says so when there is no table', () => {
    expect(() => pdfPagesToSheet([line(740, ['Just a title', 50])])).toThrow(/No table/);
  });
});

describe('readPdfPages', () => {
  it('reads a real PDF back into a sheet', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    const draw = (text: string, x: number, y: number) => page.drawText(text, { x, y, size: 11, font });
    draw('Name', 50, 740); draw('Skating', 250, 740); draw('Shooting', 400, 740);
    draw('Catherine Crow', 50, 720); draw('4', 250, 720); draw('3', 400, 720);
    draw('Delphine Lavoie', 50, 700); draw('5', 250, 700); draw('2', 400, 700);
    const bytes = await doc.save();
    const sheet = pdfPagesToSheet(await readPdfPages(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
    expect(sheet.headers).toEqual(['Name', 'Skating', 'Shooting']);
    expect(sheet.rows.map((r) => r.cells)).toEqual([
      ['Catherine Crow', '4', '3'],
      ['Delphine Lavoie', '5', '2'],
    ]);
  });
});
