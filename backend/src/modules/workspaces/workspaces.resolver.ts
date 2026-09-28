import { ParseUUIDPipe } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/request';
import {
  CreateWorkspaceInput,
  InviteMemberInput,
  LadderSettingsInput,
  Member,
  UpdateMemberRoleInput,
  Workspace,
  WorkspaceMembership,
} from './workspaces.models';
import { WorkspacesService } from './workspaces.service';

@Resolver()
export class WorkspacesResolver {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Query(() => Workspace, { description: 'The workspace the current access token is scoped to' })
  @Roles('viewer')
  workspace() {
    return this.workspaces.current();
  }

  @Query(() => [WorkspaceMembership])
  myWorkspaces(@CurrentUser() user: AuthUser) {
    return this.workspaces.memberships(user.userId);
  }

  @Mutation(() => WorkspaceMembership, { description: 'Creates a workspace you own. Switch to it via POST /auth/switch-workspace.' })
  createWorkspace(@CurrentUser() user: AuthUser, @Args('input') input: CreateWorkspaceInput) {
    return this.workspaces.create(user.userId, input.name);
  }

  @Mutation(() => Workspace)
  @Roles('admin')
  updateLadderSettings(@Args('input') input: LadderSettingsInput) {
    return this.workspaces.updateLadderSettings(input);
  }

  @Query(() => [Member])
  @Roles('viewer')
  members() {
    return this.workspaces.members();
  }

  @Mutation(() => Member)
  @Roles('admin')
  inviteMember(@CurrentUser() user: AuthUser, @Args('input') input: InviteMemberInput) {
    return this.workspaces.inviteMember(user, input);
  }

  @Mutation(() => Member)
  @Roles('admin')
  updateMemberRole(@CurrentUser() user: AuthUser, @Args('input') input: UpdateMemberRoleInput) {
    return this.workspaces.updateMemberRole(user, input);
  }

  @Mutation(() => Boolean)
  @Roles('admin')
  removeMember(@CurrentUser() user: AuthUser, @Args('userId', { type: () => ID }, ParseUUIDPipe) userId: string) {
    return this.workspaces.removeMember(user, userId);
  }
}
