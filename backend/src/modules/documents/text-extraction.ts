import { BadRequestException } from '@nestjs/common';
import { extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const PDF_TIMEOUT_MS = 30_000;
const PDF_HEAP_MB = 512;
const MAX_PARALLEL_PDFS = 2;
const UNREADABLE = 'Could not read that PDF (it may be encrypted or corrupted)';

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
  if (mime !== 'application/pdf') return data.toString('utf8').replace(/^\uFEFF/, '');
  return withSlot(() => extractPdf(data));
}

/**
 * PDF parsing is CPU-heavy and runs on untrusted input, so it gets its own
 * thread with a time limit and a heap cap, and at most two run at once per
 * process. Any failure — corrupt file, timeout, out of memory — is a 400.
 */
function extractPdf(data: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'pdf-extract.worker.js'), {
      workerData: new Uint8Array(data), // a copy: the upload buffer may share a pooled ArrayBuffer
      resourceLimits: { maxOldGenerationSizeMb: PDF_HEAP_MB },
    });
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => settle(() => reject(new BadRequestException(`That PDF took longer than ${PDF_TIMEOUT_MS / 1000}s to read`))),
      PDF_TIMEOUT_MS,
    );
    worker.once('message', (m: { ok: boolean; text?: string }) =>
      settle(() => (m.ok ? resolve(m.text ?? '') : reject(new BadRequestException(UNREADABLE)))),
    );
    worker.once('error', () => settle(() => reject(new BadRequestException(UNREADABLE))));
    worker.once('exit', () => settle(() => reject(new BadRequestException(UNREADABLE))));
  });
}

let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL_PDFS) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
