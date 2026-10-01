import { Field, Float, ID, InputType, ObjectType } from '@nestjs/graphql';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { RoleEnum } from '../../common/graphql-enums';
import type { Role } from '../../db/tenant-context';

const ROLES = Object.values(RoleEnum);

@ObjectType()
export class Workspace {
  @Field(() => ID) id: string;
  @Field() name: string;
  @Field() plan: string;
  @Field() widgetKey: string;
  @Field(() => Float) confidenceThreshold: number;
  @Field(() => Float) similarityFloor: number;
  @Field() createdAt: Date;
}

@ObjectType()
export class WorkspaceMembership {
  @Field(() => ID) workspaceId: string;
  @Field() name: string;
  @Field(() => RoleEnum) role: Role;
}

@ObjectType()
export class Member {
  @Field(() => ID) userId: string;
  @Field() email: string;
  @Field(() => String, { nullable: true }) displayName: string | null;
  @Field(() => RoleEnum) role: Role;
  @Field() createdAt: Date;
}

@InputType()
export class CreateWorkspaceInput {
  @Field() @IsString() @Length(1, 100) name: string;
}

@ObjectType()
export class Invitation {
  @Field(() => ID) id: string;
  @Field(() => String, { nullable: true, description: 'Who it is meant for — informational only' }) label: string | null;
  @Field(() => RoleEnum) role: Role;
  @Field() createdAt: Date;
  @Field() expiresAt: Date;
}

@ObjectType()
export class CreatedInvitation {
  @Field({ description: 'Shown once. Send the invite link containing it to the person you are inviting.' }) token: string;
  @Field(() => Invitation) invitation: Invitation;
}

@InputType()
export class CreateInvitationInput {
  @Field(() => String, { nullable: true }) @IsOptional() @IsString() @MaxLength(200) label?: string;
  @Field(() => RoleEnum) @IsIn(ROLES) role: Role;
}

/** Shape check only; whether the invitation exists is decided by the database. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

@InputType()
export class AcceptInvitationInput {
  @Field() @Matches(INVITE_TOKEN_PATTERN, { message: 'Invalid invitation link' }) token: string;
}

@InputType()
export class UpdateMemberRoleInput {
  @Field(() => ID) @IsUUID() userId: string;
  @Field(() => RoleEnum) @IsIn(ROLES) role: Role;
}

@InputType()
export class LadderSettingsInput {
  @Field(() => Float, { description: 'Tier 1 answers below this model confidence fall to Tier 2' })
  @Min(0)
  @Max(1)
  confidenceThreshold: number;

  @Field(() => Float, { description: 'Retrieval below this cosine similarity skips straight to Tier 3' })
  @Min(0)
  @Max(1)
  similarityFloor: number;
}
