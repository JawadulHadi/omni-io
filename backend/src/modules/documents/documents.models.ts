import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { DocumentStatus, DocumentStatusEnum, Visibility, VisibilityEnum } from '../../common/graphql-enums';

const VISIBILITIES = Object.values(VisibilityEnum);
export const MAX_PASTE_CHARS = 1_000_000;

@ObjectType('Document')
export class DocumentModel {
  @Field(() => ID) id: string;
  @Field() title: string;
  @Field() sourceType: string;
  @Field(() => DocumentStatusEnum) status: DocumentStatus;
  @Field(() => VisibilityEnum) visibility: Visibility;
  @Field(() => Int) chunkCount: number;
  @Field(() => String, { nullable: true }) error: string | null;
  @Field(() => String, { nullable: true }) mimeType: string | null;
  @Field(() => Int, { nullable: true }) byteSize: number | null;
  @Field() createdAt: Date;
  @Field() updatedAt: Date;
}

@InputType()
export class CreateDocumentFromTextInput {
  @Field() @IsString() @Length(1, 200) title: string;
  @Field() @IsString() @Length(1, MAX_PASTE_CHARS) content: string;
  @Field(() => VisibilityEnum, { defaultValue: 'internal' }) @IsIn(VISIBILITIES) visibility: Visibility;
}

/** Multipart form fields accompanying POST /documents/upload. */
export class UploadDocumentDto {
  @IsOptional() @IsString() @Length(1, 200) title?: string;
  @IsOptional() @IsIn(VISIBILITIES) visibility?: Visibility;
}
