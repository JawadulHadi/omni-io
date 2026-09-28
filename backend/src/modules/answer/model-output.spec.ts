import { parseModelAnswer } from './model-output';

describe('parseModelAnswer', () => {
  const valid = { answer: 'Five days.', citedChunkIds: ['d:0'], confidence: 0.8 };

  it('accepts valid JSON', () => {
    expect(parseModelAnswer(JSON.stringify(valid))).toEqual({ ok: true, value: valid });
  });

  it('tolerates a markdown code fence', () => {
    expect(parseModelAnswer('```json\n' + JSON.stringify(valid) + '\n```').ok).toBe(true);
  });

  it.each([
    ['prose', 'The answer is five days.'],
    ['string confidence', JSON.stringify({ ...valid, confidence: '0.8' })],
    ['confidence out of range', JSON.stringify({ ...valid, confidence: 1.4 })],
    ['missing field', JSON.stringify({ answer: 'x', confidence: 0.9 })],
    ['empty answer', JSON.stringify({ ...valid, answer: '   ' })],
  ])('rejects %s', (_label, raw) => {
    expect(parseModelAnswer(raw).ok).toBe(false);
  });
});
