import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** An opaque secret for a link or bearer token; only its sha256 is ever stored. */
export const randomToken = (prefix = '') => `${prefix}${randomBytes(32).toString('base64url')}`;
