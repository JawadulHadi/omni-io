import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Env } from '../config/env';
import { DbService, PG_POOL } from './db.service';
import { TenantContext } from './tenant-context';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) => {
        // A server-side statement timeout, so a query abandoned by a request timeout can't pin a connection.
        const pool = new Pool({
          connectionString: cfg.get('DATABASE_URL', { infer: true }),
          max: cfg.get('DB_POOL_MAX', { infer: true }),
          connectionTimeoutMillis: 5_000,
          statement_timeout: cfg.get('DB_STATEMENT_TIMEOUT_MS', { infer: true }),
        });
        const logger = new Logger('PgPool');
        pool.on('error', (err) => logger.error(`Idle client error: ${err.message}`));
        return pool;
      },
    },
    TenantContext,
    DbService,
  ],
  exports: [TenantContext, DbService],
})
export class DbModule {}
