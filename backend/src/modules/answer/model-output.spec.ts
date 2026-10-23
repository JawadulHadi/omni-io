import { groundingScore, parseModelAnswer } from './model-output';

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

describe('groundingScore', () => {
  const passage = 'Refunds are issued within 5 business days after we receive the returned item.';

  it('scores an answer built from its passage highly, folding plurals', () => {
    expect(groundingScore('A refund is issued within 5 business days of receiving the item.', [passage])).toBeGreaterThan(0.6);
  });

  it('scores an answer the passage never supports near zero', () => {
    expect(groundingScore('Shipping to Canada costs twelve dollars per parcel.', [passage])).toBeLessThan(0.2);
  });

  it('treats an answer with no content words as grounded', () => {
    expect(groundingScore('OK, so it is.', [passage])).toBe(1);
  });
});
