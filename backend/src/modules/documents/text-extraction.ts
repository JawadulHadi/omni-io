import { BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
};

/** Trust the bytes, not the client's Content-Type: extension allow-list + a magic-number check for PDF. */
export function detectMimeType(originalName: string, data: Buffer): string {
  const mime = TYPES[extname(originalName).toLowerCase()];
  if (!mime) throw new BadRequestException('Only .pdf, .txt and .md files are supported');
  if (mime === 'application/pdf' && data.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new BadRequestException('File has a .pdf extension but is not a PDF');
  }
  if (mime !== 'application/pdf' && data.includes(0)) {
    throw new BadRequestException('Text file contains binary data');
  }
  return mime;
}

export async function extractText(data: Buffer, mime: string): Promise<string> {
  if (mime !== 'application/pdf') return data.toString('utf8').replace(/^﻿/, '');

  // pdf-parse is ESM-first; a real dynamic import keeps it out of the startup path.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    // Join pages ourselves: the default output interleaves "-- 1 of N --" markers,
    // which would end up inside chunks and citations.
    return (await parser.getText()).pages.map((p) => p.text.trim()).join('\n\n');
  } catch {
    throw new BadRequestException('Could not read that PDF (it may be encrypted or corrupted)');
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
