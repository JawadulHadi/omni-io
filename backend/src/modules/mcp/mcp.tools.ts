import { Injectable } from "@nestjs/common";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { DocumentsService } from "../documents/documents.service";
import { FaqService } from "../faq/faq.service";
import { AnswerService } from "../answer/answer.service";

/**
 * Tool handlers for external AI assistants (connected via MCP over SSE).
 * Every call runs under the CALLING USERs own workspace/role — same RLS
 * enforcement as the REST/GraphQL API, no elevated access via this door.
 * TODO: wire the actual SSE transport bootstrap (e.g. @modelcontextprotocol/sdk).
 */
@Injectable()
export class McpTools {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly documents: DocumentsService,
    private readonly faq: FaqService,
    private readonly answers: AnswerService,
  ) {}

  async list_workspaces(workspaceId: string) {
    return this.workspaces.getWorkspace(workspaceId);
  }

  async list_documents(workspaceId: string) {
    return this.documents.listDocuments(workspaceId);
  }

  async ask_question(workspaceId: string, query: string) {
    return this.answers.askQuestion(workspaceId, query);
  }
}
