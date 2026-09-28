import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Roles } from '../../common/decorators/auth.decorators';
import { AnswerResultModel, AskQuestionArgs } from './answer.models';
import { AnswerService } from './answer.service';

@Resolver()
export class AnswerResolver {
  constructor(private readonly answers: AnswerService) {}

  /** A mutation, not a query: it spends model tokens and writes an audit row. */
  @Mutation(() => AnswerResultModel)
  @Roles('viewer')
  askQuestion(@Args() { query }: AskQuestionArgs) {
    return this.answers.askQuestion(query, { channel: 'console' });
  }
}
