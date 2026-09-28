import { Module } from '@nestjs/common';
import { AnswerModule } from '../answer/answer.module';
import { WidgetConfigResolver } from './widget-config.resolver';
import { WidgetConfigService } from './widget-config.service';
import { WidgetController } from './widget.controller';

@Module({
  imports: [AnswerModule],
  controllers: [WidgetController],
  providers: [WidgetConfigService, WidgetConfigResolver],
})
export class WidgetModule {}
