import { Module } from '@nestjs/common';
import { FaqResolver } from './faq.resolver';
import { FaqService } from './faq.service';

@Module({
  providers: [FaqService, FaqResolver],
  exports: [FaqService],
})
export class FaqModule {}
