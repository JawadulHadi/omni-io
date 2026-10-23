-- 0002: identity, document storage + visibility, a real decision trace on the
-- audit log, and an index that actually works for filtered vector search.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text,                 -- null for Google-only accounts
  google_sub text unique,
  display_name text,
  created_at timestamptz not null default now()
);

alter table workspace_members
  add constraint workspace_members_user_id_fkey foreign key (user_id) references users(id) on delete cascade;
create index workspace_members_user_idx on workspace_members (user_id);

-- Opaque refresh tokens, stored hashed and rotated on every use. A token presented
-- a second time means it was stolen, so the whole family is revoked.
create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  family_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index refresh_tokens_family_idx on refresh_tokens (family_id);

-- The widget key lives here and only here (widget_configs holds theme + rotated_at).
alter table workspaces
  add column similarity_floor real not null default 0.6,
  add constraint workspaces_similarity_floor_check check (similarity_floor between 0 and 1),
  add constraint workspaces_confidence_threshold_check check (confidence_threshold between 0 and 1),
  add constraint workspaces_widget_key_key unique (widget_key);

-- `content` is the extracted text the worker chunks; `storage_key` points at the
-- original upload. Ingestion jobs carry ids only, so erasing a document leaves
-- nothing behind in Redis. `visibility` gates what the anonymous widget may
-- retrieve: documents are internal until someone marks them public.
alter table documents
  add column content text,
  add column storage_key text,
  add column mime_type text,
  add column byte_size int,
  add column visibility text not null default 'internal' check (visibility in ('internal', 'public')),
  add column chunk_count int not null default 0,
  add column error text,
  add column updated_at timestamptz not null default now();
create index documents_workspace_created_idx on documents (workspace_id, created_at desc);

-- Recorded per chunk so a provider/model change can be detected and re-embedded.
alter table chunks add column embedding_model text;
create index chunks_document_idx on chunks (document_id);
create index chunks_workspace_idx on chunks (workspace_id);

-- IVFFlat built on an empty table has meaningless centroids, and with the tenant
-- filter applied after the index scan a small tenant gets fewer than k rows (or
-- none). HNSW plus pgvector's iterative scan (see match_chunks in 0003) keeps
-- scanning until enough rows pass the filter.
drop index if exists chunks_embedding_idx;
create index chunks_embedding_hnsw_idx on chunks using hnsw (embedding vector_cosine_ops);

create index faqs_workspace_idx on faqs (workspace_id);

alter table answers
  add column channel text not null default 'console' check (channel in ('console', 'widget', 'mcp')),
  add column top_similarity real,
  add column latency_ms int,
  add column decision_trace jsonb not null default '[]';
alter table answers drop constraint answers_faq_match_id_fkey;
alter table answers
  add constraint answers_faq_match_id_fkey foreign key (faq_match_id) references faqs(id) on delete set null;
create index answers_workspace_created_idx on answers (workspace_id, created_at desc);
