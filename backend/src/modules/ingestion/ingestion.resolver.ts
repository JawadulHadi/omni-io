import { Inject } from '@nestjs/common';
import { Field, ID, Int, ObjectType, Resolver, Subscription } from '@nestjs/graphql';
import type { PubSub } from 'graphql-subscriptions';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators';
import { IngestionStatusEnum } from '../../common/graphql-enums';
import type { AuthUser } from '../../common/request';
import { DbService } from '../../db/db.service';
import { IngestionStatus, progressChannel } from './ingestion.constants';
import { PUB_SUB } from './ingestion-events.service';

const MEMBERSHIP_TTL_MS = 30_000;

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
  private readonly memberships = new Map<string, { ok: boolean; checkedAt: number }>();

  constructor(
    @Inject(PUB_SUB) private readonly pubsub: PubSub,
    private readonly db: DbService,
  ) {}

  /**
   * Scoped by channel name to the caller's workspace. The role is checked when
   * the subscription starts, and membership again (at most every 30 s) as events
   * arrive, so someone removed mid-session stops receiving them while their
   * socket stays open.
   */
  @Subscription(() => IngestionProgress, {
    resolve: (payload: IngestionProgress) => payload,
    filter(this: IngestionResolver, _payload: unknown, _variables: unknown, context: { req?: { user?: AuthUser } }) {
      return this.stillMember(context.req?.user);
    },
  })
  @Roles('viewer')
  ingestionProgress(@CurrentUser() user: AuthUser) {
    return this.pubsub.asyncIterator(progressChannel(user.workspaceId));
  }

  private async stillMember(user: AuthUser | undefined): Promise<boolean> {
    if (!user) return false;
    const key = `${user.workspaceId}:${user.userId}`;
    const cached = this.memberships.get(key);
    if (cached && Date.now() - cached.checkedAt < MEMBERSHIP_TTL_MS) return cached.ok;

    let ok: boolean;
    try {
      const [row] = await this.db.global<{ role: string | null }>('select workspace_role($1, $2) as role', [user.workspaceId, user.userId]);
      ok = Boolean(row?.role);
    } catch {
      ok = cached?.ok ?? false; // a DB blip mustn't grant access, but needn't revoke a confirmed member either
    }
    if (this.memberships.size > 10_000) this.memberships.clear();
    this.memberships.set(key, { ok, checkedAt: Date.now() });
    return ok;
  }
}
