import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';
import { IsIn, IsString, Length, Matches } from 'class-validator';
import { MAX_QUERY_CHARS } from '../answer/answer.models';

@ObjectType()
export class WidgetTheme {
  @Field() title: string;
  @Field() greeting: string;
  @Field() primaryColor: string;
  @Field() position: 'left' | 'right';
}

@ObjectType()
export class WidgetConfig {
  @Field({ description: 'Public, rotatable key embedded in customer pages' }) widgetKey: string;
  @Field(() => WidgetTheme) theme: WidgetTheme;
  @Field() rotatedAt: Date;
  @Field(() => Int, { description: 'Documents the widget can draw on (visibility = public)' }) publicDocumentCount: number;
}

@InputType()
export class WidgetThemeInput {
  @Field() @IsString() @Length(1, 60) title: string;
  @Field() @IsString() @Length(1, 200) greeting: string;
  @Field() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'primaryColor must be a #rrggbb hex colour' }) primaryColor: string;
  @Field() @IsIn(['left', 'right']) position: 'left' | 'right';
}

/** Body of POST /w/:key/ask — bounded, because every character is paid for in model tokens. */
export class WidgetAskDto {
  @IsString() @Length(1, MAX_QUERY_CHARS) query: string;
}
