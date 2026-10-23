import { parentPort, workerData } from 'node:worker_threads';

/**
 * Runs in a worker thread (see text-extraction.ts), so a slow or hostile PDF can
 * only use up this thread's time and heap budget — never the API's event loop.
 */
async function main() {
  // pdf-parse is ESM-first; a real dynamic import keeps it out of the startup path.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: workerData as Uint8Array });
  try {
    // Join pages ourselves: the default output interleaves "-- 1 of N --" markers,
    // which would end up inside chunks and citations.
    const { pages } = await parser.getText();
    parentPort!.postMessage({ ok: true, text: pages.map((p) => p.text.trim()).join('\n\n') });
  } catch {
    parentPort!.postMessage({ ok: false });
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

void main();
