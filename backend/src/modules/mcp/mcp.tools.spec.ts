import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AuthUser } from '../../common/request';
import type { DbService } from '../../db/db.service';
import type { AnswerService } from '../answer/answer.service';
import type { AskLimiter } from '../answer/ask-limiter';
import type { DocumentsService } from '../documents/documents.service';
import type { FaqService } from '../faq/faq.service';
import type { WorkspacesService } from '../workspaces/workspaces.service';
import { McpToolsService } from './mcp.tools';

const MEMBER_OF = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const USER = { userId: 'user-1' } as AuthUser;

function setup(o: { askAllowed?: boolean } = {}) {
  const db = {
    // workspace_role(): the caller is a viewer of MEMBER_OF and nothing else.
    global: jest.fn(async (_sql: string, [workspaceId]: [string, string]) => [{ role: workspaceId === MEMBER_OF ? 'viewer' : null }]),
    withWorkspace: jest.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
  };
  const workspaces = { memberships: jest.fn(async () => [{ workspaceId: MEMBER_OF, name: 'Acme', role: 'viewer' }]) };
  const documents = { list: jest.fn(async () => [{ id: 'doc-1', title: 'Refund policy', status: 'ready' }]) };
  const faqs = { list: jest.fn(async () => [{ id: 'faq-1', question: 'How do refunds work?' }]) };
  const answers = {
    askQuestion: jest.fn(async () => ({
      tier: 'ai_answer',
      answer: 'Refunds take 5 business days.',
      confidence: 0.9,
      citations: [{ documentTitle: 'Refund policy', snippet: 'Refunds are issued within 5 business days.' }],
    })),
  };
  const askLimiter = { allow: jest.fn(async () => o.askAllowed ?? true) };

  const service = new McpToolsService(
    db as unknown as DbService,
    workspaces as unknown as WorkspacesService,
    documents as unknown as DocumentsService,
    faqs as unknown as FaqService,
    answers as unknown as AnswerService,
    askLimiter as unknown as AskLimiter,
  );
  return { service, db, workspaces, documents, faqs, answers, askLimiter };
}

async function connect(service: McpToolsService) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await service.createServer(USER).connect(serverTransport);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

type CallResult = { content: { type: string; text: string }[]; isError?: boolean };
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as CallResult;
const body = (r: CallResult) => JSON.parse(r.content[0].text);

describe('McpToolsService', () => {
  it('advertises all four tools with every annotation hint set and an input schema', async () => {
    const client = await connect(setup().service);
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(['ask_question', 'list_documents', 'list_faqs', 'list_workspaces']);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object');
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
        expect(typeof tool.annotations?.[hint]).toBe('boolean');
      }
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(byName.list_workspaces?.readOnlyHint).toBe(true);
    expect(byName.list_documents?.readOnlyHint).toBe(true);
    expect(byName.list_faqs?.readOnlyHint).toBe(true);
    // Writes an audit row, spends budget and calls the model provider.
    expect(byName.ask_question).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
  });

  it('list_workspaces returns the caller\'s own memberships', async () => {
    const { service, workspaces } = setup();
    const result = await call(await connect(service), 'list_workspaces');

    expect(result.isError).toBeFalsy();
    expect(body(result)).toEqual([{ workspaceId: MEMBER_OF, name: 'Acme', role: 'viewer' }]);
    expect(workspaces.memberships).toHaveBeenCalledWith('user-1');
  });

  it.each([
    ['list_documents', 'documents'],
    ['list_faqs', 'faqs'],
  ] as const)('%s runs inside the workspace scope for a member', async (tool, dep) => {
    const ctx = setup();
    const result = await call(await connect(ctx.service), tool, { workspaceId: MEMBER_OF });

    expect(result.isError).toBeFalsy();
    expect(ctx[dep].list).toHaveBeenCalledTimes(1);
    expect(ctx.db.withWorkspace).toHaveBeenCalledWith(MEMBER_OF, expect.any(Function), { userId: 'user-1', role: 'viewer' });
  });

  it.each(['list_documents', 'list_faqs', 'ask_question'])('%s refuses a workspace the caller is not a member of', async (tool) => {
    const ctx = setup();
    const result = await call(await connect(ctx.service), tool, { workspaceId: OTHER, query: 'refunds?' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not a member/);
    expect(ctx.db.withWorkspace).not.toHaveBeenCalled();
    expect(ctx.documents.list).not.toHaveBeenCalled();
    expect(ctx.faqs.list).not.toHaveBeenCalled();
    expect(ctx.answers.askQuestion).not.toHaveBeenCalled();
  });

  it('rejects a workspaceId that is not a uuid before touching the database', async () => {
    const ctx = setup();
    const result = await call(await connect(ctx.service), 'list_documents', { workspaceId: 'not-a-uuid' });

    expect(result.isError).toBe(true);
    expect(ctx.db.global).not.toHaveBeenCalled();
  });

  it('ask_question returns the tier, answer and citations on the mcp channel', async () => {
    const { service, answers } = setup();
    const result = await call(await connect(service), 'ask_question', { workspaceId: MEMBER_OF, query: 'How do refunds work?' });

    expect(result.isError).toBeFalsy();
    expect(body(result)).toEqual({
      tier: 'ai_answer',
      answer: 'Refunds take 5 business days.',
      confidence: 0.9,
      citations: [{ document: 'Refund policy', snippet: 'Refunds are issued within 5 business days.' }],
    });
    expect(answers.askQuestion).toHaveBeenCalledWith('How do refunds work?', { channel: 'mcp' });
  });

  it('ask_question is rate-limited per user without calling the ladder', async () => {
    const { service, answers, askLimiter } = setup({ askAllowed: false });
    const result = await call(await connect(service), 'ask_question', { workspaceId: MEMBER_OF, query: 'refunds?' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Rate limited/);
    expect(askLimiter.allow).toHaveBeenCalledWith('user-1');
    expect(answers.askQuestion).not.toHaveBeenCalled();
  });

  it('ask_question rejects an empty query', async () => {
    const { service, answers } = setup();
    const result = await call(await connect(service), 'ask_question', { workspaceId: MEMBER_OF, query: '' });

    expect(result.isError).toBe(true);
    expect(answers.askQuestion).not.toHaveBeenCalled();
  });
});
