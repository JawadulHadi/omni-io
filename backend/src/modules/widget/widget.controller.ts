import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../common/decorators/auth.decorators';
import { DbService } from '../../db/db.service';
import { AnswerService } from '../answer/answer.service';
import { WidgetConfigService } from './widget-config.service';
import { WidgetAskDto } from './widget.models';

/**
 * The only unauthenticated surface. Scoped entirely by the rotating opaque key
 * in the URL, rate-limited per IP and per workspace (Redis-backed), and answers
 * only from documents marked public. The response omits the decision trace and
 * confidence — internal detail stays in the console.
 */
@Public()
@Controller('w')
@UseGuards(ThrottlerGuard)
export class WidgetController {
  constructor(
    private readonly db: DbService,
    private readonly widget: WidgetConfigService,
    private readonly answers: AnswerService,
  ) {}

  @Get(':key/config')
  @SkipThrottle({ workspace: true })
  async config(@Param('key') key: string) {
    const workspaceId = await this.widget.resolveKey(key);
    return this.db.withWorkspace(workspaceId, () => this.widget.publicTheme());
  }

  @Post(':key/ask')
  @HttpCode(200)
  async ask(@Param('key') key: string, @Body() body: WidgetAskDto) {
    const workspaceId = await this.widget.resolveKey(key);
    const result = await this.db.withWorkspace(workspaceId, () => this.answers.askQuestion(body.query, { channel: 'widget' }));
    return {
      tier: result.tier,
      answer: result.answer,
      citations: result.citations.map((c) => ({ documentTitle: c.documentTitle, snippet: c.snippet })),
    };
  }
}
