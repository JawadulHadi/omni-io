/**
 * Dev seed: one user, one workspace, a few FAQs. Runs as the APP role inside a
 * tenant transaction — the same path the API uses — so it doubles as a smoke
 * test that the RLS grants and policies allow legitimate writes.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';
import { hashPassword } from '../src/modules/auth/password';

const EMAIL = 'demo@omniio.dev';
const PASSWORD = 'demo-password-123';

const FAQS = [
  {
    question: 'How do I reset my password?',
    answer: 'Use "Forgot password" on the sign-in page — we email a reset link that is valid for 30 minutes.',
    keywords: ['reset password', 'forgot password', 'password'],
  },
  {
    question: 'What are your support hours?',
    answer: 'Our team is online Monday to Friday, 9:00–18:00 PKT. Outside those hours we reply the next business day.',
    keywords: ['hours', 'support hours', 'open', 'available'],
  },
  {
    question: 'How do I cancel my subscription?',
    answer: 'Go to Settings → Billing → Cancel plan. You keep access until the end of the current billing period.',
    keywords: ['cancel', 'subscription', 'refund', 'billing'],
  },
];

async function main() {
  try {
    process.loadEnvFile(join(__dirname, '..', '.env'));
  } catch {
    // rely on process env
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const existing = await client.query('select id from auth_find_user($1)', [EMAIL]);
    if (existing.rows.length > 0) {
      console.log(`Already seeded — sign in as ${EMAIL} / ${PASSWORD}`);
      return;
    }

    // The fake provider's bag-of-words vectors score far lower than real
    // embeddings, so it gets a lower similarity floor to exercise Tier 1/2.
    const similarityFloor = (process.env.AI_PROVIDER ?? 'fake') === 'fake' ? 0.1 : 0.6;
    const workspaceId = randomUUID();

    await client.query('begin');
    const { rows } = await client.query(
      'insert into users (email, password_hash, display_name) values ($1, $2, $3) returning id',
      [EMAIL, await hashPassword(PASSWORD), 'Demo Owner'],
    );
    const userId = rows[0].id;

    await client.query(`select set_config('app.workspace_id', $1, true)`, [workspaceId]);
    await client.query('insert into workspaces (id, name, similarity_floor) values ($1, $2, $3)', [
      workspaceId,
      'Acme Support',
      similarityFloor,
    ]);
    await client.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [
      workspaceId,
      userId,
    ]);
    await client.query('insert into widget_configs (workspace_id, theme) values ($1, $2)', [
      workspaceId,
      { title: 'Acme Support', greeting: 'Hi! Ask me anything about Acme.', primaryColor: '#0f172a', position: 'right' },
    ]);
    for (const faq of FAQS) {
      await client.query('insert into faqs (workspace_id, question, answer, keywords) values ($1, $2, $3, $4)', [
        workspaceId,
        faq.question,
        faq.answer,
        faq.keywords,
      ]);
    }
    const key = await client.query('select widget_key from workspaces where id = $1', [workspaceId]);
    await client.query('commit');

    console.log(`Seeded workspace "Acme Support" (${workspaceId})`);
    console.log(`  sign in:    ${EMAIL} / ${PASSWORD}`);
    console.log(`  widget key: ${key.rows[0].widget_key}`);
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
