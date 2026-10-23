import { registerEnumType } from '@nestjs/graphql';

export const RoleEnum = { owner: 'owner', admin: 'admin', editor: 'editor', viewer: 'viewer' } as const;
export const AnswerTierEnum = { ai_answer: 'ai_answer', rag_snippets: 'rag_snippets', faq_floor: 'faq_floor' } as const;
export const AnswerChannelEnum = { console: 'console', widget: 'widget', mcp: 'mcp' } as const;
export const DocumentStatusEnum = { pending: 'pending', processing: 'processing', ready: 'ready', failed: 'failed' } as const;
export const VisibilityEnum = { internal: 'internal', public: 'public' } as const;
export const TraceOutcomeEnum = { ok: 'ok', skipped: 'skipped', rejected: 'rejected', failed: 'failed' } as const;
export const IngestionStatusEnum = { processing: 'processing', retrying: 'retrying', ready: 'ready', failed: 'failed' } as const;

export type Visibility = keyof typeof VisibilityEnum;
export type DocumentStatus = keyof typeof DocumentStatusEnum;

registerEnumType(RoleEnum, { name: 'Role' });
registerEnumType(AnswerTierEnum, { name: 'AnswerTier', description: 'Which rung of the resilience ladder produced the answer' });
registerEnumType(AnswerChannelEnum, { name: 'AnswerChannel' });
registerEnumType(DocumentStatusEnum, { name: 'DocumentStatus' });
registerEnumType(VisibilityEnum, { name: 'Visibility', description: 'public documents are the only ones the anonymous widget can retrieve' });
registerEnumType(TraceOutcomeEnum, { name: 'TraceOutcome' });
registerEnumType(IngestionStatusEnum, { name: 'IngestionStatus' });
