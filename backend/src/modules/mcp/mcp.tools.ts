import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AuthUser } from '../../common/request';
import { DbService } from '../../db/db.service';
import type { Role } from '../../db/tenant-context';
import { MAX_QUERY_CHARS } from '../answer/answer.models';
import { AnswerService } from '../answer/answer.service';
import { AskLimiter } from '../answer/ask-limiter';
import { DocumentsService } from '../documents/documents.service';
import { FaqService } from '../faq/faq.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const json = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const failure = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

/** Reads within the caller's own scope: no side effects, same result on repeat, no outside services. */
const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/**
 * ask_question changes nothing the caller owns, but it is not read-only: it writes an
 * audit row, spends the workspace's model-call budget and calls the model provider.
 */
const ASK: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

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
    private readonly askLimiter: AskLimiter,
  ) {}

  createServer(user: AuthUser): McpServer {
    const server = new McpServer({ name: 'omniio', version: '1.1.0' });
    const workspaceId = z.string().uuid().describe('Workspace id from list_workspaces');

    server.registerTool(
      'list_workspaces',
      {
        title: 'List workspaces',
        description: 'List the Omni.io workspaces you are a member of, with your role in each.',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      async () => json(await this.workspaces.memberships(user.userId)),
    );

    server.registerTool(
      'list_documents',
      {
        title: 'List documents',
        description: 'List knowledge-base documents in a workspace, with ingestion status.',
        inputSchema: { workspaceId },
        annotations: READ_ONLY,
      },
      async (args) => this.inWorkspace(user, args.workspaceId, async () => json(await this.documents.list())),
    );

    server.registerTool(
      'list_faqs',
      {
        title: 'List FAQs',
        description: 'List the deterministic FAQ entries (Tier 3 floor) of a workspace.',
        inputSchema: { workspaceId },
        annotations: READ_ONLY,
      },
      async (args) => this.inWorkspace(user, args.workspaceId, async () => json(await this.faqs.list())),
    );

    server.registerTool(
      'ask_question',
      {
        title: 'Ask a question',
        description: "Ask a question against a workspace's knowledge base. Returns the answer, which ladder tier produced it, and citations.",
        inputSchema: { workspaceId, query: z.string().min(1).max(MAX_QUERY_CHARS) },
        annotations: ASK,
      },
      async (args) =>
        this.inWorkspace(user, args.workspaceId, async () => {
          if (!(await this.askLimiter.allow(user.userId))) return failure('Rate limited: too many questions this minute. Try again shortly.');
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
