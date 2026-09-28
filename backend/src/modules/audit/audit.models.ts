import { Field, Float, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AnswerChannelEnum, AnswerTierEnum } from '../../common/graphql-enums';
import { TraceStepModel } from '../answer/answer.models';
import type { AnswerChannel, AnswerTier } from '../answer/answer.types';

@ObjectType()
export class AnswerLog {
  @Field(() => ID) id: string;
  @Field() query: string;
  @Field(() => AnswerTierEnum) tier: AnswerTier;
  @Field(() => AnswerChannelEnum) channel: AnswerChannel;
  @Field(() => String, { nullable: true }) model: string | null;
  @Field(() => Int, { nullable: true }) tokensIn: number | null;
  @Field(() => Int, { nullable: true }) tokensOut: number | null;
  @Field(() => [String]) retrievedChunkIds: string[];
  @Field(() => [String]) citedChunkIds: string[];
  @Field(() => ID, { nullable: true }) faqMatchId: string | null;
  @Field(() => Float, { nullable: true }) confidence: number | null;
  @Field(() => Float, { nullable: true }) topSimilarity: number | null;
  @Field(() => String, { nullable: true }) decisionNote: string | null;
  @Field(() => [TraceStepModel]) decisionTrace: TraceStepModel[];
  @Field(() => Int, { nullable: true }) latencyMs: number | null;
  @Field() createdAt: Date;
}

@ObjectType()
export class TierCount {
  @Field(() => AnswerTierEnum) tier: AnswerTier;
  @Field(() => Int) count: number;
}

@ObjectType()
export class AnswerLogPage {
  @Field(() => [AnswerLog]) items: AnswerLog[];
  @Field(() => Int) total: number;
  @Field(() => [TierCount], { description: 'Tier distribution for the same filter, ignoring the tier filter itself' })
  tierCounts: TierCount[];
  @Field(() => Int, { description: 'Total tokens (in + out) for the same filter' }) totalTokens: number;
}

@InputType()
export class AnswersFilterInput {
  @Field(() => AnswerTierEnum, { nullable: true }) @IsOptional() @IsIn(Object.values(AnswerTierEnum)) tier?: AnswerTier;
  @Field(() => AnswerChannelEnum, { nullable: true })
  @IsOptional()
  @IsIn(Object.values(AnswerChannelEnum))
  channel?: AnswerChannel;
  @Field(() => String, { nullable: true }) @IsOptional() @IsString() @MaxLength(200) search?: string;
  @Field(() => Int, { defaultValue: 25 }) @IsInt() @Min(1) @Max(100) limit: number;
  @Field(() => Int, { defaultValue: 0 }) @IsInt() @Min(0) offset: number;
}
