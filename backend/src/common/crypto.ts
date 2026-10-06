import { pbkdf2Sync, randomBytes } from 'node:crypto';

const TOKEN_HASH_ITERATIONS = 210_000;
const TOKEN_HASH_KEYLEN = 32;
const TOKEN_HASH_DIGEST = 'sha256';
const TOKEN_HASH_PEPPER = process.env.TOKEN_HASH_PEPPER ?? '';

export const sha256 = (s: string) =>
  pbkdf2Sync(s, TOKEN_HASH_PEPPER, TOKEN_HASH_ITERATIONS, TOKEN_HASH_KEYLEN, TOKEN_HASH_DIGEST).toString('hex');

/** An opaque secret for a link or bearer token; only its sha256 is ever stored. */
export const randomToken = (prefix = '') => `${prefix}${randomBytes(32).toString('base64url')}`;
