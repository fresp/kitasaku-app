-- Kitasaku 003: fix table registration in the Realtime publication + verification tooling.
--
-- Why 002 is not enough:
--   `alter publication ... add table a, b, c` is ONE statement. If any one of those
--   tables is already a member, the whole statement fails (duplicate_object) and the
--   `exception when duplicate_object then null` block swallows it silently → the other
--   tables are never registered, with no error message at all. So "it has been run"
--   does not mean the tables are actually registered.
--
-- 003 does this: register ONE AT A TIME (one failure does not cancel the rest),
-- set replica identity so DELETE/UPDATE filters work, then provide a
-- realtime_health() RPC so the status can be PROVEN, not guessed.

-- ============ 1. Make sure the publication exists ============
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Publication supabase_realtime does not exist. Enable Realtime first in the Supabase Dashboard (Database > Replication).';
  end if;
end $$;

-- ============ 2. Register tables one by one (idempotent) ============
do $$
declare
  t text;
  tables text[] := array[
    'transactions',
    'obligations',
    'recurring_templates',
    'cycles',
    'categories',
    'accounts',
    'household_members'
  ];
begin
  foreach t in array tables loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'realtime: % added to publication', t;
    exception
      when duplicate_object then
        raise notice 'realtime: % already registered (skipped)', t;
    end;
  end loop;
end $$;

-- ============ 3. Replica identity: so the household_id filter applies on DELETE ============
-- By default only the primary key is sent on DELETE, so the client-side
-- `household_id=eq.<uuid>` filter cannot be evaluated and the DELETE event is lost.
alter table public.transactions        replica identity full;
alter table public.obligations         replica identity full;
alter table public.recurring_templates replica identity full;
alter table public.cycles              replica identity full;
alter table public.categories          replica identity full;
alter table public.accounts            replica identity full;

-- ============ 4. Verification RPC: prove the tables are really registered ============
-- Drop first: the return column was renamed (terdaftar -> registered), and Postgres
-- rejects `create or replace` when the return type of an existing function changes.
drop function if exists public.realtime_health();

create or replace function public.realtime_health()
returns table (tablename text, registered boolean, replica_identity text)
language sql
security definer
set search_path = public, pg_catalog
as $$
  with targets(tablename) as (
    values ('transactions'),('obligations'),('recurring_templates'),('cycles'),
           ('categories'),('accounts'),('household_members'),('households')
  )
  select
    d.tablename,
    exists (
      select 1 from pg_publication_tables pt
      where pt.pubname = 'supabase_realtime'
        and pt.schemaname = 'public'
        and pt.tablename = d.tablename
    ) as registered,
    coalesce(c.relreplident::text, '-') as replica_identity
  from targets d
  left join pg_class c
    on c.relname = d.tablename
   and c.relnamespace = 'public'::regnamespace
  order by d.tablename;
$$;

-- May be called with the anon key so it can be checked without signing in.
grant execute on function public.realtime_health() to anon, authenticated;
