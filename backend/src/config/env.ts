import { z } from 'zod';

const bool = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

/**
 * Every environment variable the API and worker read, validated once at boot.
 * A missing or malformed value fails startup with a readable list instead of
 * surfacing later as `undefined` deep inside a request.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),

    // The app role: NOT the table owner, NOT superuser, NOBYPASSRLS — so RLS applies.
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    DB_POOL_MAX: z.coerce.number().int().positive().default(20), // connections per process

    // Single-container hosting (e.g. Render's free plan): one process serves the API, the
    // built console from STATIC_DIR on the same origin, and runs the ingestion worker.
    STATIC_DIR: z.string().optional(),
    RUN_WORKER_IN_PROCESS: bool('false'),
    // PDF parsing limits (see text-extraction.ts); lower them on small instances.
    PDF_MAX_HEAP_MB: z.coerce.number().int().min(64).default(512),
    PDF_MAX_PARALLEL: z.coerce.number().int().positive().default(2),
    PDF_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    COOKIE_SECURE: bool('false'),
    CONSOLE_ORIGIN: z.string().default('http://localhost:5173'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    // Open self-service sign-up (password and first-time Google). Invitations still work when off.
    ALLOW_SIGNUP: bool('true'),
    MAX_WORKSPACES_PER_USER: z.coerce.number().int().positive().default(5),

    AI_PROVIDER: z.enum(['gemini', 'fake']).default('fake'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_CHAT_MODEL: z.string().default('gemini-3.5-flash'),
    GEMINI_EMBED_MODEL: z.string().default('gemini-embedding-2'),
    TIER1_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    RETRIEVAL_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
    // Share of the answer's content words that must appear in the cited passages (0 disables the check).
    TIER1_MIN_GROUNDING: z.coerce.number().min(0).max(1).default(0.2),

    // Cost ceilings. Over the daily model-call budget, the ladder answers from Tier 2 instead.
    TIER1_DAILY_LIMIT_PER_WORKSPACE: z.coerce.number().int().positive().default(1000),
    ASK_LIMIT_PER_USER: z.coerce.number().int().positive().default(30), // per minute, console + MCP
    INGEST_LIMIT_PER_WORKSPACE: z.coerce.number().int().positive().default(60), // documents per hour
    WIDGET_LIMIT_PER_IP: z.coerce.number().int().positive().default(20),
    WIDGET_LIMIT_PER_WORKSPACE: z.coerce.number().int().positive().default(300),

    // none: originals are not kept (the extracted text is). local: STORAGE_DIR, which must be
    // one volume shared by every API and worker process, or erasure can miss files.
    STORAGE_DRIVER: z.enum(['none', 'local']).default('none'),
    STORAGE_DIR: z.string().default('./storage'),
    // Days to keep the answer audit (customer-typed questions). 0 keeps it forever.
    ANSWER_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CALLBACK_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const issue = (path: keyof Env, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) issue('GEMINI_API_KEY', 'required when AI_PROVIDER=gemini');
    if (env.NODE_ENV === 'production') {
      if (!env.COOKIE_SECURE) issue('COOKIE_SECURE', 'must be true in production (serve the API over HTTPS)');
      if (env.JWT_SECRET.startsWith('change-me')) issue('JWT_SECRET', 'still the example value — generate one with `openssl rand -base64 48`');
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const googleOAuthEnabled = (env: Env) =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL);
