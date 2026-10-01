import { HttpException, HttpStatus } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/request';
import { AnswerResultModel, AskQuestionArgs } from './answer.models';
import { AnswerService } from './answer.service';
import { AskLimiter } from './ask-limiter';

@Resolver()
export class AnswerResolver {
  constructor(
    private readonly answers: AnswerService,
    private readonly limits: AskLimiter,
  ) {}

  /** A mutation, not a query: it spends model tokens and writes an audit row. */
  @Mutation(() => AnswerResultModel)
  @Roles('viewer')
  async askQuestion(@CurrentUser() user: AuthUser, @Args() { query }: AskQuestionArgs) {
    if (!(await this.limits.allow(user.userId))) {
      throw new HttpException('You are asking questions too quickly — wait a minute and try again', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.answers.askQuestion(query, { channel: 'console' });
  }
}
