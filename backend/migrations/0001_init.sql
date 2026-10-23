-- Omni.io initial schema. Every tenant-owned table carries workspace_id
-- and an RLS policy filtering on it, so isolation holds even if a service
-- method forgets a WHERE clause.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',
  widget_key text not null default encode(gen_random_bytes(16), 'hex'),
  confidence_threshold real not null default 0.75,
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_type text not null check (source_type in ('upload', 'paste', 'drive')),
  title text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create table chunks (
  id text primary key, -- `${documentId}:${chunkIndex}`
  workspace_id uuid not null references workspaces(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);
create index chunks_embedding_idx on chunks using ivfflat (embedding vector_cosine_ops);

create table faqs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  question text not null,
  answer text not null,
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table answers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  query text not null,
  tier text not null check (tier in ('ai_answer', 'rag_snippets', 'faq_floor')),
  model text,
  tokens_in int,
  tokens_out int,
  retrieved_chunk_ids text[] not null default '{}',
  cited_chunk_ids text[] not null default '{}',
  faq_match_id uuid references faqs(id),
  confidence real,
  decision_note text,
  created_at timestamptz not null default now()
);

create table widget_configs (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  theme jsonb not null default '{}',
  rotated_at timestamptz not null default now()
);

create table app_user_connections (
  user_id uuid not null,
  connector_id text not null,
  connection_key_ciphertext text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, connector_id)
);

-- Vector search scoped by workspace inside the SQL itself, never left to
-- application code to filter after the fact.
create function match_chunks(p_workspace_id uuid, p_query_embedding vector(768), p_top_k int default 5)
returns table (id text, content text, similarity real) as $$
  select id, content, 1 - (embedding <=> p_query_embedding) as similarity
  from chunks
  where workspace_id = p_workspace_id
  order by embedding <=> p_query_embedding
  limit p_top_k;
$$ language sql stable;

-- Row-level security: every tenant table only ever returns rows for the
-- workspace set on the current session by TenantInterceptor.
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table documents enable row level security;
alter table chunks enable row level security;
alter table faqs enable row level security;
alter table answers enable row level security;
alter table widget_configs enable row level security;

create policy tenant_isolation on workspaces using (id = current_setting('app.workspace_id', true)::uuid);
create policy tenant_isolation on workspace_members using (workspace_id = current_setting('app.workspace_id', true)::uuid);
create policy tenant_isolation on documents using (workspace_id = current_setting('app.workspace_id', true)::uuid);
create policy tenant_isolation on chunks using (workspace_id = current_setting('app.workspace_id', true)::uuid);
create policy tenant_isolation on faqs using (workspace_id = current_setting('app.workspace_id', true)::uuid);
create policy tenant_isolation on answers using (workspace_id = current_setting('app.workspace_id', true)::uuid);
create policy tenant_isolation on widget_configs using (workspace_id = current_setting('app.workspace_id', true)::uuid);
