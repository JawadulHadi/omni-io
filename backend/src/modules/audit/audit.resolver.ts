import { Args, Query, Resolver } from '@nestjs/graphql';
import { Roles } from '../../common/decorators/auth.decorators';
import { AnswerLogPage, AnswersFilterInput } from './audit.models';
import { AuditService } from './audit.service';

@Resolver()
export class AuditResolver {
  constructor(private readonly audit: AuditService) {}

  @Query(() => AnswerLogPage)
  @Roles('viewer')
  answers(@Args('filter', { type: () => AnswersFilterInput, nullable: true }) filter?: AnswersFilterInput) {
    return this.audit.list(filter ?? Object.assign(new AnswersFilterInput(), { limit: 25, offset: 0 }));
  }
}
