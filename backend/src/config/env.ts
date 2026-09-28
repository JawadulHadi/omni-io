import { z } from 'zod';

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

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    CONSOLE_ORIGIN: z.string().default('http://localhost:5173'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    AI_PROVIDER: z.enum(['gemini', 'fake']).default('fake'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_CHAT_MODEL: z.string().default('gemini-3.5-flash'),
    GEMINI_EMBED_MODEL: z.string().default('gemini-embedding-2'),
    TIER1_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

    WIDGET_LIMIT_PER_IP: z.coerce.number().int().positive().default(20),
    WIDGET_LIMIT_PER_WORKSPACE: z.coerce.number().int().positive().default(300),

    STORAGE_DIR: z.string().default('./storage'),
    APP_USER_CONNECTION_KEY_SECRET: z.string().optional(),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CALLBACK_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['GEMINI_API_KEY'], message: 'required when AI_PROVIDER=gemini' });
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
