import { CHUNK_OVERLAP, CHUNK_SIZE, chunkText } from './chunking';

// Varied word lengths, so cut points don't happen to align with word boundaries.
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}${'x'.repeat(i % 7)}`).join(' ');

describe('chunkText', () => {
  it('returns nothing for blank input', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('keeps short text as one chunk', () => {
    expect(chunkText('Refunds take five days.')).toEqual(['Refunds take five days.']);
  });

  it('never exceeds the chunk size and overlaps consecutive chunks', () => {
    const text = words(1000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_SIZE);
    for (let i = 1; i < chunks.length; i++) {
      const tail = chunks[i - 1].slice(-CHUNK_OVERLAP / 2);
      expect(chunks[i]).toContain(tail.trim().split(' ').pop()!);
    }
  });

  it('does not split words at either end when whitespace is available', () => {
    const text = words(1000);
    const vocabulary = new Set(text.split(' '));
    for (const c of chunkText(text)) {
      for (const token of c.split(/\s+/)) expect(vocabulary.has(token)).toBe(true);
    }
  });

  it('covers the whole document', () => {
    const text = words(1000);
    const chunks = chunkText(text);
    expect(chunks[0].startsWith('word0 ')).toBe(true);
    expect(chunks.at(-1)!.endsWith(text.split(' ').at(-1)!)).toBe(true);
  });

  it('is deterministic, so chunk ids stay stable across re-ingestion', () => {
    const text = words(700);
    expect(chunkText(text)).toEqual(chunkText(text));
  });

  it('still terminates on text with no whitespace at all', () => {
    const chunks = chunkText('x'.repeat(5000));
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_SIZE);
  });
});
