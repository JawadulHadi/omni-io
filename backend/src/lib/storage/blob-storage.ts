import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Env } from '../../config/env';

/**
 * Where original uploads live, if anywhere. Ingestion reads the extracted text
 * from Postgres, never the original, so the default is to keep none: one less
 * copy to erase. Swap in S3/GCS behind the same interface if you need them.
 */
export abstract class BlobStorage {
  abstract readonly enabled: boolean;
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract delete(key: string): Promise<void>;
}

/** STORAGE_DRIVER=none (default): originals are dropped after text extraction. */
export class NoBlobStorage extends BlobStorage {
  readonly enabled = false;
  async put(): Promise<void> {}
  async delete(): Promise<void> {}
}

const KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/; // `${workspaceId}/${documentId}`

/**
 * STORAGE_DRIVER=local. STORAGE_DIR must be one volume shared by every API and
 * worker process: a delete that lands on a host without the file "succeeds"
 * without removing anything, which would leave an erased document's original behind.
 */
@Injectable()
export class LocalDiskBlobStorage extends BlobStorage {
  readonly enabled = true;
  private readonly root: string;

  constructor(dir: string) {
    super();
    this.root = resolve(dir);
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
  providers: [
    {
      provide: BlobStorage,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>): BlobStorage =>
        cfg.get('STORAGE_DRIVER', { infer: true }) === 'local' ? new LocalDiskBlobStorage(cfg.get('STORAGE_DIR', { infer: true })) : new NoBlobStorage(),
    },
  ],
  exports: [BlobStorage],
})
export class StorageModule {}
