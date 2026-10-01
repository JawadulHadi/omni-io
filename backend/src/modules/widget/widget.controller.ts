import { Body, Controller, Get, HttpCode, Logger, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../common/decorators/auth.decorators';
import { DbService } from '../../db/db.service';
import { AnswerService, HANDOFF_MESSAGE } from '../answer/answer.service';
import { WidgetConfigService } from './widget-config.service';
import { DEFAULT_WIDGET_THEME } from './widget-theme';
import { WidgetAskDto } from './widget.models';

/**
 * The only unauthenticated surface. Scoped entirely by the rotating opaque key
 * in the URL, rate-limited per IP and per workspace (Redis-backed), and answers
 * only from documents and FAQs marked public. The response omits the decision
 * trace and confidence — internal detail stays in the console.
 *
 * The key lookup needs Postgres. If Postgres itself is down, a visitor still
 * gets the hand-off message rather than an error — the ladder's promise holds
 * at the edge too. An unknown or rotated key is still a 404.
 */
@Public()
@Controller('w')
@UseGuards(ThrottlerGuard)
export class WidgetController {
  private readonly logger = new Logger(WidgetController.name);

  constructor(
    private readonly db: DbService,
    private readonly widget: WidgetConfigService,
    private readonly answers: AnswerService,
  ) {}

  @Get(':key/config')
  @SkipThrottle({ workspace: true })
  async config(@Param('key') key: string) {
    try {
      const workspaceId = await this.widget.resolveKey(key);
      return await this.db.withWorkspace(workspaceId, () => this.widget.publicTheme());
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`Widget config degraded to defaults: ${(err as Error).message}`);
      return DEFAULT_WIDGET_THEME;
    }
  }

  @Post(':key/ask')
  @HttpCode(200)
  async ask(@Param('key') key: string, @Body() body: WidgetAskDto) {
    let workspaceId: string;
    try {
      workspaceId = await this.widget.resolveKey(key);
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`Widget key lookup failed; answering with the hand-off message: ${(err as Error).message}`);
      return { tier: 'faq_floor', answer: HANDOFF_MESSAGE, citations: [] };
    }
    const result = await this.db.withWorkspace(workspaceId, () => this.answers.askQuestion(body.query, { channel: 'widget' }));
    return {
      tier: result.tier,
      answer: result.answer,
      citations: result.citations.map((c) => ({ documentTitle: c.documentTitle, snippet: c.snippet })),
    };
  }
}
