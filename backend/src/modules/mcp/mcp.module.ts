import { Module } from '@nestjs/common';
import { AnswerModule } from '../answer/answer.module';
import { DocumentsModule } from '../documents/documents.module';
import { FaqModule } from '../faq/faq.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { McpController } from './mcp.controller';
import { McpToolsService } from './mcp.tools';

@Module({
  imports: [AnswerModule, DocumentsModule, FaqModule, WorkspacesModule],
  controllers: [McpController],
  providers: [McpToolsService],
})
export class McpModule {}
