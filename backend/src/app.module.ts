import { Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { BullModule } from "@nestjs/bullmq";
import { Pool } from "pg";

import { AiService } from "./lib/ai.service";
import { ConnectionsService } from "./lib/connections.service";

import { AuthService } from "./modules/auth/auth.service";
import { WorkspacesService } from "./modules/workspaces/workspaces.service";
import { DocumentsService } from "./modules/documents/documents.service";
import { ChunksRepository } from "./modules/ingestion/chunks.repository";
import { IngestionProcessor } from "./modules/ingestion/ingestion.processor";
import { AnswerService } from "./modules/answer/answer.service";
import { FaqService } from "./modules/faq/faq.service";
import { AuditService } from "./modules/audit/audit.service";
import { WidgetController } from "./modules/widget/widget.controller";
import { McpTools } from "./modules/mcp/mcp.tools";

const pgPoolProvider = {
  provide: Pool,
  useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }),
};

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({ driver: ApolloDriver, autoSchemaFile: true }),
    JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: "15m" } }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
    BullModule.registerQueue({ name: "ingestion" }),
  ],
  controllers: [WidgetController],
  providers: [
    pgPoolProvider,
    AiService,
    ConnectionsService,
    AuthService,
    WorkspacesService,
    DocumentsService,
    ChunksRepository,
    IngestionProcessor,
    AnswerService,
    FaqService,
    AuditService,
    McpTools,
  ],
})
export class AppModule {}
