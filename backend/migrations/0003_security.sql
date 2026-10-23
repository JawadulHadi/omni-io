-- 0003: make row-level security actually enforce isolation.
--
-- 1. The app connects as `omniio_app`: not the table owner, not a superuser, no
--    BYPASSRLS. Superusers always bypass RLS and owners do unless FORCE is set,
--    so connecting as the migration user would make every policy decorative.
-- 2. Policies read `app.workspace_id`, which DbService.tenant() sets with
--    set_config(..., true) inside a per-unit-of-work transaction.
-- 3. nullif(..., ''): once a pooled connection has run SET LOCAL, the setting
--    reads back as '' (not NULL) in later transactions, and ''::uuid throws.
-- 4. Three narrow SECURITY DEFINER functions cover the lookups that happen before
--    a workspace is known (login, widget key, "which workspaces am I in").
--    RLS is ENABLED, not FORCED, so these owner-owned functions can see across
--    tenants — and nothing else can.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'omniio_app') then
    -- Ops gives it LOGIN + a password per environment; docker/initdb does it for dev.
    create role omniio_app nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

grant usage on schema public to omniio_app;
grant select, insert, update, delete on
  workspaces, workspace_members, documents, chunks, faqs, answers, widget_configs,
  refresh_tokens, app_user_connections
  to omniio_app;

-- Column-level grants: the app can never `select password_hash` directly; it gets
-- one user's hash only through auth_find_user().
grant select (id, email, google_sub, display_name, created_at) on users to omniio_app;
grant insert (email, password_hash, google_sub, display_name) on users to omniio_app;
grant update (password_hash, google_sub, display_name) on users to omniio_app;

-- Recreate tenant policies with nullif() and an explicit WITH CHECK, so an insert
-- or update can't write a row into another workspace either.
drop policy if exists tenant_isolation on workspaces;
drop policy if exists tenant_isolation on workspace_members;
drop policy if exists tenant_isolation on documents;
drop policy if exists tenant_isolation on chunks;
drop policy if exists tenant_isolation on faqs;
drop policy if exists tenant_isolation on answers;
drop policy if exists tenant_isolation on widget_configs;

create policy tenant_isolation on workspaces
  using (id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.workspace_id', true), '')::uuid);
create policy tenant_isolation on workspace_members
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
create policy tenant_isolation on documents
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
create policy tenant_isolation on chunks
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
create policy tenant_isolation on faqs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
create policy tenant_isolation on answers
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
create policy tenant_isolation on widget_configs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Pre-tenant lookups (SECURITY DEFINER, search_path pinned, EXECUTE only for the app)
-- ---------------------------------------------------------------------------

create function auth_find_user(p_email text)
returns table (id uuid, password_hash text)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.password_hash from users u where u.email = lower(p_email);
$$;

create function user_workspaces(p_user_id uuid)
returns table (workspace_id uuid, name text, role text)
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id, w.name, m.role
  from workspace_members m
  join workspaces w on w.id = m.workspace_id
  where m.user_id = p_user_id
  order by m.created_at;
$$;

create function workspace_role(p_workspace_id uuid, p_user_id uuid)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role from workspace_members m where m.workspace_id = p_workspace_id and m.user_id = p_user_id;
$$;

create function resolve_widget_key(p_key text)
returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select w.id from workspaces w where w.widget_key = p_key;
$$;

revoke all on function auth_find_user(text), user_workspaces(uuid), workspace_role(uuid, uuid), resolve_widget_key(text) from public;
grant execute on function auth_find_user(text), user_workspaces(uuid), workspace_role(uuid, uuid), resolve_widget_key(text) to omniio_app;

-- ---------------------------------------------------------------------------
-- Vector search: tenant filter inside the SQL (on top of RLS), optional
-- public-only restriction for the anonymous widget, and iterative HNSW scan so
-- the filter can't starve the result set. Requires pgvector >= 0.8.
-- ---------------------------------------------------------------------------

drop function if exists match_chunks(uuid, vector, int);

create function match_chunks(
  p_workspace_id uuid,
  p_query_embedding vector(768),
  p_top_k int default 5,
  p_public_only boolean default false
)
returns table (id text, document_id uuid, document_title text, content text, similarity double precision)
language sql stable
set hnsw.iterative_scan = 'relaxed_order'
as $$
  with nearest as materialized (
    select c.id, c.document_id, d.title as document_title, c.content,
           c.embedding <=> p_query_embedding as distance
    from chunks c
    join documents d on d.id = c.document_id
    where c.workspace_id = p_workspace_id
      and (not p_public_only or d.visibility = 'public')
    order by distance
    limit p_top_k
  )
  select n.id, n.document_id, n.document_title, n.content, 1 - n.distance
  from nearest n
  order by n.distance;
$$;

grant execute on function match_chunks(uuid, vector, int, boolean) to omniio_app;
