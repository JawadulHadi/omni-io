import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Separate process from the API so a burst of slow embedding calls can't eat the
 * API's CPU, memory or DB pool — and so each side scales independently.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  new Logger('Worker').log('Ingestion worker started');
}

void bootstrap();
