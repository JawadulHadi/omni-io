import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ANSWER_COMPLETED, AnswerCompletedEvent } from '../answer/answer.types';
import { AuditService } from './audit.service';

/** Internal listener — AuditModule has no write API. A failed write is logged, never surfaced to the customer. */
@Injectable()
export class AuditListener {
  private readonly logger = new Logger(AuditListener.name);

  constructor(private readonly audit: AuditService) {}

  @OnEvent(ANSWER_COMPLETED, { async: true })
  async onAnswerCompleted(event: AnswerCompletedEvent): Promise<void> {
    try {
      await this.audit.record(event);
    } catch (err) {
      this.logger.error(`Audit write failed for answer ${event.answerId}: ${(err as Error).message}`);
    }
  }
}
