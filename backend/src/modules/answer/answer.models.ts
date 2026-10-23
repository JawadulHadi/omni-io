import { ArgsType, Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import { IsString, Length } from 'class-validator';
import { AnswerTierEnum, TraceOutcomeEnum } from '../../common/graphql-enums';
import type { AnswerTier, TraceOutcome } from './answer.types';

export const MAX_QUERY_CHARS = 1000;

@ObjectType()
export class TraceStepModel {
  @Field() step: string;
  @Field(() => TraceOutcomeEnum) outcome: TraceOutcome;
  @Field(() => String, { nullable: true }) detail?: string;
  @Field(() => Int) ms: number;
}

@ObjectType()
export class CitationModel {
  @Field(() => ID) chunkId: string;
  @Field(() => ID) documentId: string;
  @Field() documentTitle: string;
  @Field() snippet: string;
  @Field(() => Float) similarity: number;
}

@ObjectType('AnswerResult')
export class AnswerResultModel {
  @Field(() => ID) answerId: string;
  @Field(() => AnswerTierEnum) tier: AnswerTier;
  @Field() answer: string;
  @Field(() => [CitationModel]) citations: CitationModel[];
  @Field(() => Float, { nullable: true }) confidence: number | null;
  @Field(() => Float, { nullable: true }) topSimilarity: number | null;
  @Field(() => ID, { nullable: true }) faqMatchId: string | null;
  @Field(() => [TraceStepModel]) trace: TraceStepModel[];
  @Field(() => Int) latencyMs: number;
}

@ArgsType()
export class AskQuestionArgs {
  @Field() @IsString() @Length(1, MAX_QUERY_CHARS) query: string;
}
