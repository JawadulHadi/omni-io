import { randomBytes } from 'node:crypto';
import { openSecret, parseKey, sealSecret } from './connections.service';

describe('connector secret encryption (AES-256-GCM)', () => {
  const key = randomBytes(32);

  it('round-trips', () => {
    const sealed = sealSecret(key, 'user-a:drive', 'sk-live-123');
    expect(sealed).not.toContain('sk-live-123');
    expect(openSecret(key, 'user-a:drive', sealed)).toBe('sk-live-123');
  });

  it('uses a fresh IV every time', () => {
    expect(sealSecret(key, 'a', 'same')).not.toEqual(sealSecret(key, 'a', 'same'));
  });

  it("refuses a ciphertext copied onto another user's row (AAD binding)", () => {
    const sealed = sealSecret(key, 'user-a:drive', 'sk-live-123');
    expect(() => openSecret(key, 'user-b:drive', sealed)).toThrow();
  });

  it('detects tampering', () => {
    const [v, iv, tag, ct] = sealSecret(key, 'a', 'secret').split('.');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 1;
    expect(() => openSecret(key, 'a', [v, iv, tag, flipped.toString('base64')].join('.'))).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => parseKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => parseKey(undefined)).toThrow(/not set/);
  });
});
