import { ParseUUIDPipe } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Roles } from '../../common/decorators/auth.decorators';
import { Visibility, VisibilityEnum } from '../../common/graphql-enums';
import { CreateDocumentFromTextInput, DocumentModel } from './documents.models';
import { DocumentsService } from './documents.service';

@Resolver(() => DocumentModel)
@Roles('viewer')
export class DocumentsResolver {
  constructor(private readonly service: DocumentsService) {}

  @Query(() => [DocumentModel])
  documents() {
    return this.service.list();
  }

  @Mutation(() => DocumentModel)
  @Roles('editor')
  createDocumentFromText(@Args('input') input: CreateDocumentFromTextInput) {
    return this.service.createFromText(input);
  }

  @Mutation(() => DocumentModel)
  @Roles('editor')
  setDocumentVisibility(
    @Args('id', { type: () => ID }, ParseUUIDPipe) id: string,
    @Args('visibility', { type: () => VisibilityEnum }) visibility: Visibility,
  ) {
    return this.service.setVisibility(id, visibility);
  }

  @Mutation(() => DocumentModel)
  @Roles('editor')
  retryIngestion(@Args('id', { type: () => ID }, ParseUUIDPipe) id: string) {
    return this.service.retry(id);
  }

  @Mutation(() => Boolean, { description: 'GDPR erasure: deletes the document, its vectors, its original file and audit references' })
  @Roles('admin')
  deleteDocument(@Args('id', { type: () => ID }, ParseUUIDPipe) id: string) {
    return this.service.erase(id);
  }
}
