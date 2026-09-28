import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Pool } from 'pg';

/** AES-256-GCM at rest for third-party connector keys (Google Drive, etc.). */
@Injectable()
export class ConnectionsService {
  constructor(private readonly pool: Pool) {}

  private key(): Buffer {
    const raw = process.env.APP_USER_CONNECTION_KEY_SECRET;
    if (!raw) throw new Error('APP_USER_CONNECTION_KEY_SECRET is not set');
    return Buffer.from(raw, 'base64');
  }

  private encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
  }

  private decrypt(stored: string): string {
    const buf = Buffer.from(stored, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }

  async save(userId: string, connectorId: string, apiKey: string): Promise<void> {
    await this.pool.query(
      `insert into app_user_connections (user_id, connector_id, connection_key_ciphertext, updated_at)
       values ($1, $2, $3, now())
       on conflict (user_id, connector_id) do update set connection_key_ciphertext = excluded.connection_key_ciphertext, updated_at = now()`,
      [userId, connectorId, this.encrypt(apiKey)],
    );
  }

  async get(userId: string, connectorId: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      'select connection_key_ciphertext from app_user_connections where user_id = $1 and connector_id = $2',
      [userId, connectorId],
    );
    return rows[0] ? this.decrypt(rows[0].connection_key_ciphertext) : null;
  }
}
