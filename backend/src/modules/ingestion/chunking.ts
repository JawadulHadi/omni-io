export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 200;
/** How far back from a hard cut we look for whitespace so words aren't split in half. */
const BOUNDARY_WINDOW = 150;

/**
 * Fixed-size character windows (1,200 chars, 200 overlap). Chunk i always gets
 * id `${documentId}:${i}`, so re-running ingestion upserts in place.
 */
export function chunkText(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(' ', end);
      const newline = text.lastIndexOf('\n', end);
      const cut = Math.max(boundary, newline);
      if (cut > end - BOUNDARY_WINDOW && cut > start) end = cut;
    }
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks;
}
