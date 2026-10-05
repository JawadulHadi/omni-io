import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { extname, join, resolve } from 'node:path';
import { AppModule } from './app.module';
import type { Env } from './config/env';
import { TenantContext } from './db/tenant-context';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const cfg = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

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

  const staticDir = cfg.get('STATIC_DIR', { infer: true });
  if (staticDir) serveConsole(app, resolve(staticDir));

  app.enableShutdownHooks();
  const port = cfg.get('PORT', { infer: true });
  await app.listen(port);
  logger.log(`Omni.io API on :${port} — GraphQL at /graphql, widget at /w/:key, MCP at /mcp${staticDir ? ', console at /' : ''}`);

  // Single-container hosting: the ingestion worker shares this process instead of running as its own.
  if (cfg.get('RUN_WORKER_IN_PROCESS', { infer: true })) {
    const worker = await NestFactory.createApplicationContext(WorkerModule);
    worker.enableShutdownHooks();
    logger.log('Ingestion worker running in this process');
  }
}

/**
 * Serves the built console (frontend/dist) from the API's own origin, for hosts
 * that run one container: the refresh cookie and CORS need no cross-site setup.
 * API routes are registered by Nest and pass straight through.
 */
function serveConsole(app: NestExpressApplication, dir: string) {
  const API = /^\/(graphql|auth\/|documents\/upload|mcp|health)/;
  const WIDGET_API = /^\/w\/[0-9a-f]{32}\/(ask|config)$/;
  const WIDGET_PAGE = /^\/w\/[0-9a-f]{32}\/?$/;

  app.useStaticAssets(dir, {
    index: false,
    // Vite fingerprints everything under /assets/, so it never changes in place.
    setHeaders: (res, path) =>
      res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'public, max-age=300'),
  });
  // Client-side routes: any other page load gets the app shell.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const page = (req.method === 'GET' || req.method === 'HEAD') && !API.test(req.path) && !WIDGET_API.test(req.path) && !extname(req.path);
    if (!page) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(dir, WIDGET_PAGE.test(req.path) ? 'widget.html' : 'index.html'));
  });
}

void bootstrap();
