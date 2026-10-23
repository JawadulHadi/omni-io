export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 200;
/** How far we'll move a cut to land on whitespace, so words aren't split in half. */
const BOUNDARY_WINDOW = 150;

/**
 * Fixed-size character windows (1,200 chars, 200 overlap), with both ends nudged
 * to the nearest whitespace. Deterministic, so chunk i always gets id
 * `${documentId}:${i}` and re-running ingestion upserts in place.
 */
export function chunkText(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const cut = lastWhitespace(text, end);
      if (cut > end - BOUNDARY_WINDOW && cut > start) end = cut;
    }
    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;

    let next = Math.max(end - CHUNK_OVERLAP, start + 1);
    // Start the overlap at a word boundary too (skip forward past a partial word).
    const ws = nextWhitespace(text, next);
    if (ws !== -1 && ws < next + BOUNDARY_WINDOW && ws < end) next = ws + 1;
    start = next;
  }
  return chunks;
}

function lastWhitespace(text: string, from: number): number {
  return Math.max(text.lastIndexOf(' ', from), text.lastIndexOf('\n', from));
}

function nextWhitespace(text: string, from: number): number {
  if (from > 0 && /\s/.test(text[from - 1])) return from - 1; // already at a word start
  const match = /\s/.exec(text.slice(from, from + BOUNDARY_WINDOW));
  return match ? from + match.index : -1;
}
