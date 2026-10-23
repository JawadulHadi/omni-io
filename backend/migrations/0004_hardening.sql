-- 0004: deployment hardening.
--
-- 1. FAQ visibility, so the anonymous widget's FAQ floor only serves public FAQs.
-- 2. Invitation links instead of adding accounts by email: the invitee has to accept.
-- 3. Personal access tokens for MCP clients, which can't refresh a 15-minute JWT.
-- 4. A retention function for the answer audit and other expired rows.
-- 5. match_chunks falls back to an exact search when HNSW comes back short.
-- 6. Drops app_user_connections, which nothing reads or writes.

-- ---------------------------------------------------------------------------
-- 1. FAQ visibility. Existing FAQs stay public, which is how they behaved;
--    new ones start internal, like documents.
-- ---------------------------------------------------------------------------

alter table faqs add column visibility text not null default 'public' check (visibility in ('internal', 'public'));
alter table faqs alter column visibility set default 'internal';

-- ---------------------------------------------------------------------------
-- 2. Invitations. Single-use links: holding the link is the credential. They
--    can't be bound to an email address, because sign-up doesn't verify that
--    the person registering owns it.
-- ---------------------------------------------------------------------------

create table workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  token_hash text not null unique,
  label text,                          -- who it's meant for; informational only
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index workspace_invitations_workspace_idx on workspace_invitations (workspace_id, created_at desc);

alter table workspace_invitations enable row level security;
create policy tenant_isolation on workspace_invitations
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
grant select, insert, delete on workspace_invitations to omniio_app;

-- Pre-tenant: the invitee isn't a member yet, so these go through definer functions.
create function invitation_preview(p_token_hash text)
returns table (workspace_id uuid, workspace_name text, role text)
language sql stable security definer set search_path = public, pg_temp as $$
  select i.workspace_id, w.name, i.role
  from workspace_invitations i
  join workspaces w on w.id = i.workspace_id
  where i.token_hash = p_token_hash and i.expires_at > now();
$$;

-- Consumes the invitation and adds the membership in one statement each, inside
-- the caller's transaction. An existing member keeps their current role.
create function accept_invitation(p_token_hash text, p_user_id uuid)
returns table (workspace_id uuid, workspace_name text, role text)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_workspace uuid;
  v_role text;
begin
  delete from workspace_invitations i
   where i.token_hash = p_token_hash and i.expires_at > now()
  returning i.workspace_id, i.role into v_workspace, v_role;
  if v_workspace is null then
    return;
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (v_workspace, p_user_id, v_role)
  on conflict on constraint workspace_members_pkey do nothing;

  return query
    select m.workspace_id, w.name, m.role
    from workspace_members m
    join workspaces w on w.id = m.workspace_id
    where m.workspace_id = v_workspace and m.user_id = p_user_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Personal access tokens (MCP). Belong to a user, not a workspace — like
--    refresh_tokens there's no RLS; every query filters by user_id.
-- ---------------------------------------------------------------------------

create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index api_tokens_user_idx on api_tokens (user_id, created_at desc);
grant select, insert, update on api_tokens to omniio_app;

-- ---------------------------------------------------------------------------
-- 4. Retention. Runs across every workspace, so it is a definer function the
--    worker calls on a schedule. p_answer_days = 0 keeps the answer audit.
-- ---------------------------------------------------------------------------

create function run_retention(p_answer_days int)
returns table (purged_answers bigint, purged_invitations bigint, purged_refresh_tokens bigint, purged_api_tokens bigint)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_answers bigint := 0;
  v_invitations bigint;
  v_refresh bigint;
  v_api bigint;
begin
  if p_answer_days > 0 then
    delete from answers where created_at < now() - make_interval(days => p_answer_days);
    get diagnostics v_answers = row_count;
  end if;
  delete from workspace_invitations where expires_at < now();
  get diagnostics v_invitations = row_count;
  delete from refresh_tokens where expires_at < now() - interval '1 day';
  get diagnostics v_refresh = row_count;
  delete from api_tokens where revoked_at < now() - interval '30 days' or expires_at < now() - interval '30 days';
  get diagnostics v_api = row_count;
  return query select v_answers, v_invitations, v_refresh, v_api;
end $$;

revoke all on function invitation_preview(text), accept_invitation(text, uuid), run_retention(int) from public;
grant execute on function invitation_preview(text), accept_invitation(text, uuid), run_retention(int) to omniio_app;

-- ---------------------------------------------------------------------------
-- 5. Vector search with an exact fallback. HNSW's iterative scan stops after
--    hnsw.max_scan_tuples, so in a large shared table a small tenant can still
--    get fewer than k rows. Only in that case, search the tenant exactly:
--    "+ 0" keeps the planner off the HNSW index, so it reads the tenant's rows
--    through chunks_workspace_idx — cheap precisely because the tenant is small.
-- ---------------------------------------------------------------------------

create or replace function match_chunks(
  p_workspace_id uuid,
  p_query_embedding vector(768),
  p_top_k int default 5,
  p_public_only boolean default false
)
returns table (id text, document_id uuid, document_title text, content text, similarity double precision)
language sql stable
set hnsw.iterative_scan = 'relaxed_order'
as $$
  with ann as materialized (
    select c.id, c.document_id, d.title as document_title, c.content,
           c.embedding <=> p_query_embedding as distance
    from chunks c
    join documents d on d.id = c.document_id
    where c.workspace_id = p_workspace_id
      and (not p_public_only or d.visibility = 'public')
    order by distance
    limit p_top_k
  ),
  exact as materialized (
    select c.id, c.document_id, d.title as document_title, c.content,
           c.embedding <=> p_query_embedding as distance
    from chunks c
    join documents d on d.id = c.document_id
    where (select count(*) from ann) < p_top_k
      and c.workspace_id = p_workspace_id
      and (not p_public_only or d.visibility = 'public')
    order by (c.embedding <=> p_query_embedding) + 0
    limit p_top_k
  )
  select n.id, n.document_id, n.document_title, n.content, 1 - n.distance
  from (
    select * from ann where (select count(*) from ann) >= p_top_k
    union all
    select * from exact
  ) n
  order by n.distance
  limit p_top_k;
$$;

-- ---------------------------------------------------------------------------
-- 6. Unused since 0001: no code path reads or writes connector secrets.
-- ---------------------------------------------------------------------------

drop table if exists app_user_connections;
