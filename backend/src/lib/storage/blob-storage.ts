import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Env } from '../../config/env';

/** Where original uploads live. Local disk for dev; swap for S3/GCS behind the same interface. */
export abstract class BlobStorage {
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/; // `${workspaceId}/${documentId}`

@Injectable()
export class LocalDiskBlobStorage extends BlobStorage {
  private readonly root: string;

  constructor(cfg: ConfigService<Env, true>) {
    super();
    this.root = resolve(cfg.get('STORAGE_DIR', { infer: true }));
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  private path(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error(`Refusing unexpected storage key: ${key}`);
    return join(this.root, ...key.split('/'));
  }
}

@Global()
@Module({
  providers: [{ provide: BlobStorage, useClass: LocalDiskBlobStorage }],
  exports: [BlobStorage],
})
export class StorageModule {}
