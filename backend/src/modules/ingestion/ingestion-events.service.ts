import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueEvents } from 'bullmq';
import type { PubSub } from 'graphql-subscriptions';
import type { Env } from '../../config/env';
import { INGESTION_QUEUE, IngestionProgressEvent, progressChannel } from './ingestion.constants';

export const PUB_SUB = Symbol('PUB_SUB');

/**
 * Bridges worker progress (published to Redis by BullMQ) into GraphQL
 * subscriptions. Every API instance runs its own QueueEvents listener, so an
 * in-memory PubSub per instance is enough — Redis is already the cross-process bus.
 */
@Injectable()
export class IngestionEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionEventsService.name);
  private events?: QueueEvents;

  constructor(
    @Inject(PUB_SUB) private readonly pubsub: PubSub,
    private readonly cfg: ConfigService<Env, true>,
  ) {}

  onModuleInit() {
    this.events = new QueueEvents(INGESTION_QUEUE, { connection: { url: this.cfg.get('REDIS_URL', { infer: true }) } });
    this.events.on('progress', ({ data }) => {
      const event = data as unknown as IngestionProgressEvent;
      if (!event || typeof event !== 'object' || !event.workspaceId) return;
      void this.pubsub.publish(progressChannel(event.workspaceId), event);
    });
    this.events.on('error', (err) => this.logger.warn(`QueueEvents error: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.events?.close();
  }
}
