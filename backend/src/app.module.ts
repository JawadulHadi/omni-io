import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { GraphQLModule } from '@nestjs/graphql';
import { ThrottlerModule } from '@nestjs/throttler';
import { join } from 'node:path';
import './common/graphql-enums';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { Env, validateEnv } from './config/env';
import { DbModule } from './db/db.module';
import { AiModule } from './lib/ai/ai.module';
import { RateLimiter } from './lib/redis/rate-limiter';
import { RedisModule } from './lib/redis/redis.module';
import { StorageModule } from './lib/storage/blob-storage';
import { AnswerModule } from './modules/answer/answer.module';
import { ApiTokensModule } from './modules/api-tokens/api-tokens.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { FaqModule } from './modules/faq/faq.module';
import { HealthModule } from './modules/health/health.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { McpModule } from './modules/mcp/mcp.module';
import { WidgetModule } from './modules/widget/widget.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    EventEmitterModule.forRoot(),
    DbModule,
    RedisModule,
    AiModule,
    StorageModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) => ({ connection: { url: cfg.get('REDIS_URL', { infer: true }) } }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, RateLimiter],
      useFactory: (cfg: ConfigService<Env, true>, limiter: RateLimiter) => ({
        throttlers: [
          { name: 'ip', ttl: 60_000, limit: cfg.get('WIDGET_LIMIT_PER_IP', { infer: true }) },
          {
            name: 'workspace',
            ttl: 60_000,
            limit: cfg.get('WIDGET_LIMIT_PER_WORKSPACE', { infer: true }),
            getTracker: (req: Record<string, any>) => `widget:${req.params?.key ?? 'none'}`,
          },
        ],
        // Shared through Redis; falls back to per-process counters if Redis is down, never blocks a request on it.
        storage: limiter,
      }),
    }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>): ApolloDriverConfig => {
        const production = cfg.get('NODE_ENV', { infer: true }) === 'production';
        return {
          autoSchemaFile: production ? true : join(process.cwd(), 'schema.gql'),
          sortSchema: true,
          playground: !production,
          introspection: !production,
          includeStacktraceInErrorResponses: false,
          subscriptions: {
            'graphql-ws': {
              path: '/graphql',
              // Browsers can't set headers on a WebSocket, so the token arrives in connectionParams.
              onConnect: (ctx) => {
                (ctx.extra as Record<string, unknown>).authorization = ctx.connectionParams?.authorization;
              },
            },
          },
          // Same `req` shape for HTTP and WebSocket, so AuthGuard works unchanged for subscriptions.
          context: ({ req, res, extra }: { req?: unknown; res?: unknown; extra?: Record<string, unknown> }) =>
            extra ? { req: { headers: { authorization: extra.authorization } } } : { req, res },
        };
      },
    }),
    AuthModule,
    ApiTokensModule,
    WorkspacesModule,
    DocumentsModule,
    IngestionModule,
    FaqModule,
    AnswerModule,
    AuditModule,
    WidgetModule,
    McpModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: authenticate first, then check the live role.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
