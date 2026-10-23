import { ParseUUIDPipe } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/request';
import { ApiToken, CreatedApiToken, CreateApiTokenInput } from './api-tokens.models';
import { ApiTokensService } from './api-tokens.service';

/** Your own tokens, whichever workspace you're in — they belong to the user, not the workspace. */
@Resolver()
export class ApiTokensResolver {
  constructor(private readonly tokens: ApiTokensService) {}

  @Query(() => [ApiToken])
  apiTokens(@CurrentUser() user: AuthUser) {
    return this.tokens.list(user.userId);
  }

  @Mutation(() => CreatedApiToken)
  createApiToken(@CurrentUser() user: AuthUser, @Args('input') input: CreateApiTokenInput) {
    return this.tokens.create(user.userId, input);
  }

  @Mutation(() => Boolean)
  revokeApiToken(@CurrentUser() user: AuthUser, @Args('id', { type: () => ID }, ParseUUIDPipe) id: string) {
    return this.tokens.revoke(user.userId, id);
  }
}
