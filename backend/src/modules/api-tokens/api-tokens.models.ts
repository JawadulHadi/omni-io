import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

@ObjectType()
export class ApiToken {
  @Field(() => ID) id: string;
  @Field() name: string;
  @Field() createdAt: Date;
  @Field(() => Date, { nullable: true }) lastUsedAt: Date | null;
  @Field(() => Date, { nullable: true }) expiresAt: Date | null;
}

@ObjectType()
export class CreatedApiToken {
  @Field({ description: 'Shown once. Use it as `Authorization: Bearer <token>` against /mcp.' }) token: string;
  @Field(() => ApiToken) apiToken: ApiToken;
}

@InputType()
export class CreateApiTokenInput {
  @Field() @IsString() @Length(1, 100) name: string;

  @Field(() => Int, { nullable: true, description: 'Omit for a token that never expires' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}
