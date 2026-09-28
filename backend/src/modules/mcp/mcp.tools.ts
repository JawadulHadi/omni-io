import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthUser } from '../../common/request';
import { DbService } from '../../db/db.service';
import type { Role } from '../../db/tenant-context';
import { MAX_QUERY_CHARS } from '../answer/answer.models';
import { AnswerService } from '../answer/answer.service';
import { DocumentsService } from '../documents/documents.service';
import { FaqService } from '../faq/faq.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const json = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const failure = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

/**
 * Tools for external AI assistants. Each call runs as the CALLING USER: the
 * workspace argument is checked against their membership, then the work runs
 * under that workspace's RLS scope — the same enforcement as the console API,
 * with no elevated access through this door.
 */
@Injectable()
export class McpToolsService {
  constructor(
    private readonly db: DbService,
    private readonly workspaces: WorkspacesService,
    private readonly documents: DocumentsService,
    private readonly faqs: FaqService,
    private readonly answers: AnswerService,
  ) {}

  createServer(user: AuthUser): McpServer {
    const server = new McpServer({ name: 'omniio', version: '0.2.0' });
    const workspaceId = z.string().uuid().describe('Workspace id from list_workspaces');

    server.registerTool(
      'list_workspaces',
      { description: 'List the Omni.io workspaces you are a member of, with your role in each.' },
      async () => json(await this.workspaces.memberships(user.userId)),
    );

    server.registerTool(
      'list_documents',
      { description: 'List knowledge-base documents in a workspace, with ingestion status.', inputSchema: { workspaceId } },
      async (args) => this.inWorkspace(user, args.workspaceId, async () => json(await this.documents.list())),
    );

    server.registerTool(
      'list_faqs',
      { description: 'List the deterministic FAQ entries (Tier 3 floor) of a workspace.', inputSchema: { workspaceId } },
      async (args) => this.inWorkspace(user, args.workspaceId, async () => json(await this.faqs.list())),
    );

    server.registerTool(
      'ask_question',
      {
        description: "Ask a question against a workspace's knowledge base. Returns the answer, which ladder tier produced it, and citations.",
        inputSchema: { workspaceId, query: z.string().min(1).max(MAX_QUERY_CHARS) },
      },
      async (args) =>
        this.inWorkspace(user, args.workspaceId, async () => {
          const r = await this.answers.askQuestion(args.query, { channel: 'mcp' });
          return json({
            tier: r.tier,
            answer: r.answer,
            confidence: r.confidence,
            citations: r.citations.map((c) => ({ document: c.documentTitle, snippet: c.snippet })),
          });
        }),
    );

    return server;
  }

  private async inWorkspace(user: AuthUser, workspaceId: string, fn: () => Promise<ToolResult>): Promise<ToolResult> {
    const [row] = await this.db.global<{ role: Role | null }>('select workspace_role($1, $2) as role', [workspaceId, user.userId]);
    if (!row?.role) return failure('You are not a member of that workspace.');
    return this.db.withWorkspace(workspaceId, fn, { userId: user.userId, role: row.role });
  }
}
