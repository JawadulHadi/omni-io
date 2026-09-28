import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import type { Env } from './config/env';
import { TenantContext } from './db/tenant-context';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const cfg = app.get(ConfigService<Env, true>);

  app.set('trust proxy', cfg.get('TRUST_PROXY', { infer: true }));
  // Must run first: opens the per-request tenant context that AuthGuard fills.
  app.use(app.get(TenantContext).middleware);
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // The widget is embedded on customers' sites: any origin, never credentials.
  // Everything else (console, auth cookies) is restricted to the console origin(s).
  const consoleOrigins = cfg.get('CONSOLE_ORIGIN', { infer: true }).split(',').map((o) => o.trim());
  app.enableCors((req: { url?: string }, callback: (err: Error | null, options: object) => void) => {
    const isWidget = req.url?.startsWith('/w/') ?? false;
    callback(
      null,
      isWidget
        ? { origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }
        : { origin: consoleOrigins, credentials: true },
    );
  });

  app.enableShutdownHooks();
  const port = cfg.get('PORT', { infer: true });
  await app.listen(port);
  new Logger('Bootstrap').log(`Omni.io API on :${port} — GraphQL at /graphql, widget at /w/:key, MCP at /mcp`);
}

void bootstrap();
