import { IsEmail, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { INVITE_TOKEN_PATTERN } from '../workspaces/workspaces.models';

export class RegisterDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(10, 200, { message: 'password must be at least 10 characters' }) password: string;
  @IsString() @Length(1, 100) displayName: string;
  /** Required unless joining through an invite link. */
  @IsOptional() @IsString() @Length(1, 100) workspaceName?: string;
  @IsOptional() @Matches(INVITE_TOKEN_PATTERN, { message: 'Invalid invitation link' }) inviteToken?: string;
}

export class LoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(1, 200) password: string;
  @IsOptional() @IsUUID() workspaceId?: string;
  @IsOptional() @Matches(INVITE_TOKEN_PATTERN, { message: 'Invalid invitation link' }) inviteToken?: string;
}

export class SwitchWorkspaceDto {
  @IsUUID() workspaceId: string;
}
