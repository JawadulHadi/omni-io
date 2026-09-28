import { IsEmail, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(10, 200, { message: 'password must be at least 10 characters' }) password: string;
  @IsString() @Length(1, 100) displayName: string;
  @IsString() @Length(1, 100) workspaceName: string;
}

export class LoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(1, 200) password: string;
  @IsOptional() @IsUUID() workspaceId?: string;
}

export class SwitchWorkspaceDto {
  @IsUUID() workspaceId: string;
}
