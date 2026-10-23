import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/request';
import {
  AcceptInvitationInput,
  CreatedInvitation,
  CreateInvitationInput,
  CreateWorkspaceInput,
  Invitation,
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
    return this.workspaces.createOwned(user.userId, input.name);
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

  @Query(() => [Invitation], { description: 'Pending invitations to the current workspace' })
  @Roles('admin')
  invitations() {
    return this.workspaces.invitations();
  }

  @Mutation(() => CreatedInvitation, { description: "A single-use invite link (7 days). Can't grant above your own role." })
  @Roles('admin')
  createInvitation(@CurrentUser() user: AuthUser, @Args('input') input: CreateInvitationInput) {
    return this.workspaces.createInvitation(user, input);
  }

  @Mutation(() => Boolean)
  @Roles('admin')
  revokeInvitation(@Args('id', { type: () => ID }, ParseUUIDPipe) id: string) {
    return this.workspaces.revokeInvitation(id);
  }

  @Mutation(() => WorkspaceMembership, { description: 'Joins the workspace an invite link is for. Switch to it via POST /auth/switch-workspace.' })
  async acceptInvitation(@CurrentUser() user: AuthUser, @Args('input') input: AcceptInvitationInput) {
    const membership = await this.workspaces.acceptInvitation(user.userId, input.token);
    if (!membership) throw new BadRequestException('This invitation link is invalid, already used or expired');
    return membership;
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
