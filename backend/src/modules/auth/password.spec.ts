import { hashPassword, verifyPassword } from './password';

describe('password hashing (scrypt)', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPassword('Correct horse battery staple', hash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same-password')).not.toEqual(await hashPassword('same-password'));
  });

  it('returns false (not throw) for missing or foreign hashes', async () => {
    await expect(verifyPassword('x', null)).resolves.toBe(false);
    await expect(verifyPassword('x', '$2b$10$bcrypthash')).resolves.toBe(false);
  });
});
