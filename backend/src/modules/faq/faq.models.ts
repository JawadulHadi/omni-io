import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import { ArrayMaxSize, IsArray, IsString, Length } from 'class-validator';

@ObjectType()
export class Faq {
  @Field(() => ID) id: string;
  @Field() question: string;
  @Field() answer: string;
  @Field(() => [String]) keywords: string[];
  @Field() createdAt: Date;
}

@InputType()
export class FaqInput {
  @Field() @IsString() @Length(1, 500) question: string;
  @Field() @IsString() @Length(1, 4000) answer: string;

  @Field(() => [String], { description: 'Words or phrases; matched as whole words against the question' })
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  keywords: string[];
}
