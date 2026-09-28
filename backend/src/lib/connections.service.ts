import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../config/env';
import { DbService } from '../db/db.service';

const VERSION = 'v1';

/**
 * AES-256-GCM at rest for third-party connector keys (Google Drive, an LLM key a
 * tenant brings, ...). The row's identity (`userId:connectorId`) is bound in as
 * additional authenticated data, so a ciphertext copied onto another user's row
 * fails to decrypt instead of handing them someone else's key.
 * Stored as `v1.<iv>.<tag>.<ciphertext>` (base64) so the key can be rotated later.
 */
export function sealSecret(key: Buffer, aad: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function openSecret(key: Buffer, aad: string, stored: string): string {
  const [version, iv, tag, ct] = stored.split('.');
  if (version !== VERSION || !iv || !tag || !ct) throw new Error('Unrecognised ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

export function parseKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error('APP_USER_CONNECTION_KEY_SECRET is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('APP_USER_CONNECTION_KEY_SECRET must be 32 bytes, base64-encoded');
  return key;
}

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly db: DbService,
    private readonly cfg: ConfigService<Env, true>,
  ) {}

  private key(): Buffer {
    return parseKey(this.cfg.get('APP_USER_CONNECTION_KEY_SECRET', { infer: true }));
  }

  async save(userId: string, connectorId: string, apiKey: string): Promise<void> {
    await this.db.global(
      `insert into app_user_connections (user_id, connector_id, connection_key_ciphertext, updated_at)
       values ($1, $2, $3, now())
       on conflict (user_id, connector_id)
       do update set connection_key_ciphertext = excluded.connection_key_ciphertext, updated_at = now()`,
      [userId, connectorId, sealSecret(this.key(), `${userId}:${connectorId}`, apiKey)],
    );
  }

  async get(userId: string, connectorId: string): Promise<string | null> {
    const [row] = await this.db.global<{ connection_key_ciphertext: string }>(
      'select connection_key_ciphertext from app_user_connections where user_id = $1 and connector_id = $2',
      [userId, connectorId],
    );
    return row ? openSecret(this.key(), `${userId}:${connectorId}`, row.connection_key_ciphertext) : null;
  }
}
