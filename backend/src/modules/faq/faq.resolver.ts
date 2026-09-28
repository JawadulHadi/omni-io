import { ParseUUIDPipe } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Roles } from '../../common/decorators/auth.decorators';
import { Faq, FaqInput } from './faq.models';
import { FaqService } from './faq.service';

@Resolver(() => Faq)
@Roles('viewer')
export class FaqResolver {
  constructor(private readonly service: FaqService) {}

  @Query(() => [Faq])
  faqs() {
    return this.service.list();
  }

  @Mutation(() => Faq)
  @Roles('editor')
  createFaq(@Args('input') input: FaqInput) {
    return this.service.create(input);
  }

  @Mutation(() => Faq)
  @Roles('editor')
  updateFaq(@Args('id', { type: () => ID }, ParseUUIDPipe) id: string, @Args('input') input: FaqInput) {
    return this.service.update(id, input);
  }

  @Mutation(() => Boolean)
  @Roles('editor')
  deleteFaq(@Args('id', { type: () => ID }, ParseUUIDPipe) id: string) {
    return this.service.delete(id);
  }
}
