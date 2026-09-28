import { Inject } from '@nestjs/common';
import { Field, ID, Int, ObjectType, Resolver, Subscription } from '@nestjs/graphql';
import type { PubSub } from 'graphql-subscriptions';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import { IngestionStatusEnum } from '../../common/graphql-enums';
import type { AuthUser } from '../../common/request';
import { IngestionStatus, progressChannel } from './ingestion.constants';
import { PUB_SUB } from './ingestion-events.service';

@ObjectType()
export class IngestionProgress {
  @Field(() => ID) documentId: string;
  @Field(() => IngestionStatusEnum) status: IngestionStatus;
  @Field(() => Int) percent: number;
  @Field(() => Int, { nullable: true }) chunkCount?: number;
  @Field(() => String, { nullable: true }) error?: string | null;
}

@Resolver()
export class IngestionResolver {
  constructor(@Inject(PUB_SUB) private readonly pubsub: PubSub) {}

  /** Scoped by channel name to the caller's workspace — no cross-tenant filtering needed. */
  @Subscription(() => IngestionProgress, { resolve: (payload: IngestionProgress) => payload })
  ingestionProgress(@CurrentUser() user: AuthUser) {
    return this.pubsub.asyncIterator(progressChannel(user.workspaceId));
  }
}
