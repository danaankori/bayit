-- Database for the "בית" shopping app. Run once in Supabase: SQL Editor → New query → paste → Run.
-- Safe to run again: everything is "if not exists" / "or replace".

create extension if not exists pgcrypto;

-- A household and the people in it. Users are anonymous Supabase users (no email/password);
-- a phone joins a household with its join code.
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- All app data (stores, products, list items, receipts) as JSON documents.
-- updated_at is set by the server and drives incremental sync.
create table if not exists public.docs (
  household_id uuid not null references public.households(id) on delete cascade,
  coll text not null,
  id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (household_id, coll, id)
);
create index if not exists docs_sync_idx on public.docs (household_id, updated_at);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
for each row execute function public.touch_updated_at();

-- ---------- access rules ----------

create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where household_id = h and user_id = auth.uid());
$$;

-- Explicit access for signed-in phones (new Supabase projects may not expose tables automatically).
-- Row level security below still limits each phone to its own household.
grant usage on schema public to anon, authenticated;
grant select on public.households, public.members to authenticated;
grant select, insert, update on public.docs to authenticated;

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.docs enable row level security;

drop policy if exists households_read on public.households;
create policy households_read on public.households for select using (public.is_member(id));

drop policy if exists members_read on public.members;
create policy members_read on public.members for select using (public.is_member(household_id));

drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select using (public.is_member(household_id));
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert with check (public.is_member(household_id));
drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update using (public.is_member(household_id)) with check (public.is_member(household_id));

-- ---------- household functions ----------

create or replace function public.create_household(p_name text, p_display text) returns json
language plpgsql security definer set search_path = public as $$
declare
  h households;
  code text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  loop
    -- 6 characters without look-alikes (no 0/O, 1/I).
    code := array_to_string(array(
      select substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1) from generate_series(1, 6)), '');
    exit when not exists (select 1 from households where join_code = code);
  end loop;
  insert into households (name, join_code) values (coalesce(nullif(trim(p_name), ''), 'הבית שלנו'), code) returning * into h;
  insert into members (household_id, user_id, display_name) values (h.id, auth.uid(), coalesce(p_display, ''));
  return json_build_object('id', h.id, 'name', h.name, 'code', h.join_code);
end $$;

create or replace function public.join_household(p_code text, p_display text) returns json
language plpgsql security definer set search_path = public as $$
declare
  h households;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into h from households where join_code = upper(trim(p_code));
  if h.id is null then raise exception 'household not found'; end if;
  insert into members (household_id, user_id, display_name) values (h.id, auth.uid(), coalesce(p_display, ''))
  on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return json_build_object('id', h.id, 'name', h.name, 'code', h.join_code);
end $$;

-- Tiny query for the keep-alive job (see .github/workflows/keepalive.yml). Reveals nothing.
create or replace function public.ping() returns int language sql stable as $$ select 1 $$;

grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.ping() to anon, authenticated;

-- Live updates between phones.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
