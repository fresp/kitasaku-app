-- Kitasaku 007: household profile — member names, payday setting, co-member reads.
--
-- Design source: design.pen "Screen - My Profile" and "Screen 14 - Ruang
-- Keluarga". Both render data that does not exist yet:
--
--   * "Andra" / "Istri Andra" as separate identity from the email address, and
--     a per-member avatar initial.
--   * "Siklus Payday: Tgl 25" — the household's payday day of month, which is
--     what every cycle boundary is derived from.
--   * "ANGGOTA KELUARGA (2 ORANG)" — the member list. This could not be read
--     at all before: the 001 policy on household_members is
--     `using (user_id = auth.uid())`, so a member could only ever see their own
--     row and the screen had no way to count the family.
--
-- Sections:
--   1. households.payday_day
--   2. household_members display name + notification preference
--   3. is_household_member() + co-member SELECT policy (recursion-safe)
--   4. list_household_members() — the family roster, emails included
--   5. create_household / join_household_by_code seed a display name
--   6. households UPDATE policy (rename + payday)
--
-- Idempotency: ADD COLUMN IF NOT EXISTS everywhere; policies are dropped by
-- name before re-creation; the RPCs are CREATE OR REPLACE (their grants
-- survive a replace).
--
-- On emails: the design's member row reads "istri@example.com • Terhubung
-- real-time", so the roster does expose the address. That is a deliberate
-- exception to the usual "show the name, not the address" rule, and it is
-- safe only because the RPC is household-scoped and SECURITY DEFINER — a
-- client cannot reach auth.users directly, and a non-member gets zero rows.
-- The email is never stored in a table of ours; it is read at call time.

-- ============ 1. households.payday_day ============
alter table public.households
  add column if not exists payday_day int;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.households'::regclass
      and conname = 'households_payday_day_check'
  ) then
    alter table public.households
      add constraint households_payday_day_check
      check (payday_day is null or (payday_day >= 1 and payday_day <= 31));
  end if;
end $$;

comment on column public.households.payday_day is
  'Day of month the household gets paid; every payday-to-payday cycle boundary is derived from it. NULL = not set yet, which the UI renders as "belum diatur" rather than guessing 25.';

-- ============ 2. household_members profile fields ============
alter table public.household_members
  add column if not exists display_name varchar;

-- Per-member preference only. Nothing in the money math reads this; it gates
-- whether the app raises an in-app notice when the partner records spending.
alter table public.household_members
  add column if not exists notify_partner_expense boolean not null default true;

comment on column public.household_members.display_name is
  'What this member is called inside the family ("Andra", "Istri Andra"). Separate from the auth email on purpose — the household screen shows this, never the address.';

comment on column public.household_members.notify_partner_expense is
  'Per-member, device-independent preference. Purely a notification gate: it never affects an amount, an allocation, or a status.';

-- ============ 3. Co-member reads, without policy recursion ============
-- A policy on household_members that subqueries household_members is infinite
-- recursion in PostgreSQL. Going through a SECURITY DEFINER function owned by
-- the migration role (which is the table owner, so RLS does not apply to it)
-- breaks the cycle — the same mechanism migrations 002/004/005 already rely on.
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id
      and m.user_id = auth.uid()
  );
$$;

grant execute on function public.is_household_member(uuid) to authenticated;

drop policy if exists household_scoped_select_members on public.household_members;
create policy household_scoped_select_members
  on public.household_members for select
  using (public.is_household_member(household_members.household_id));

-- Write access is intentionally NOT widened: `members_manage_household_tables`
-- (001) still restricts every insert/update/delete to the caller's own row, so
-- a member can rename themselves and toggle their own notification preference
-- but cannot edit, add, or remove anyone else.

-- ============ 4. list_household_members() ============
-- The roster for "ANGGOTA KELUARGA (N ORANG)". SECURITY DEFINER for the same
-- reason as is_household_member(): the join to auth.users is not reachable
-- from the client, and the membership check inside keeps it scoped.
--
-- Ordering puts the caller first (design renders "Andra (Anda)" at the top),
-- then the owner, then by join date — so the list is stable across refreshes
-- rather than whatever the planner happens to return.
create or replace function public.list_household_members(p_household_id uuid)
returns table (
  id uuid,
  user_id uuid,
  role varchar,
  display_name varchar,
  email text,
  notify_partner_expense boolean,
  joined_at timestamptz,
  is_me boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    m.id,
    m.user_id,
    m.role,
    m.display_name,
    u.email::text,
    m.notify_partner_expense,
    m.joined_at,
    (m.user_id = auth.uid()) as is_me
  from public.household_members m
  left join auth.users u on u.id = m.user_id
  where m.household_id = p_household_id
    and public.is_household_member(p_household_id)
  order by
    (m.user_id = auth.uid()) desc,
    (m.role = 'OWNER') desc,
    m.joined_at asc;
$$;

grant execute on function public.list_household_members(uuid) to authenticated;

-- ============ 5. Seed a display name on create / join ============
-- Without this every new member shows as a role label ("Owner"/"Pasangan")
-- until they open the profile screen, and the design's identity block reads as
-- broken on first run. The email local-part is a sane starting point; the
-- member can change it in the app.
create or replace function public.seed_member_display_name(p_user_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    nullif(
      initcap(replace(split_part(nullif(trim(u.email), ''), '@', 1), '.', ' ')),
      ''
    ),
    'Anggota'
  )
  from auth.users u
  where u.id = p_user_id;
$$;

create or replace function public.create_household(p_name text, p_invite_code text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hh public.households;
begin
  if auth.uid() is null then
    raise exception 'Belum login.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Nama ruang keluarga wajib diisi.';
  end if;

  insert into public.households (name, invite_code)
  values (trim(p_name), upper(trim(p_invite_code)))
  returning * into v_hh;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (v_hh.id, auth.uid(), 'OWNER', public.seed_member_display_name(auth.uid()))
  on conflict (household_id, user_id) do update set role = 'OWNER';

  return v_hh;
exception
  when unique_violation then
    raise exception 'Kode undangan sudah dipakai, coba lagi.';
end;
$$;

create or replace function public.join_household_by_code(p_code text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hh public.households;
begin
  if auth.uid() is null then
    raise exception 'Belum login.';
  end if;

  select * into v_hh
  from public.households
  where invite_code = upper(trim(p_code))
  limit 1;

  if v_hh.id is null then
    raise exception 'Kode undangan tidak ditemukan. Cek lagi kodenya ya.';
  end if;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (v_hh.id, auth.uid(), 'PARTNER', public.seed_member_display_name(auth.uid()))
  on conflict (household_id, user_id) do nothing;

  return v_hh;
end;
$$;

grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household_by_code(text) to authenticated;

-- Backfill: existing members get the same seed so the family screen is not
-- blank for a household created before this migration.
update public.household_members m
  set display_name = public.seed_member_display_name(m.user_id)
  where m.display_name is null;

-- ============ 6. Household rename + payday ============
-- 001 only gave `households` a SELECT policy — nothing could write it after
-- creation, so "Keluarga Andra" with its little edit pencil in the design had
-- nowhere to write. Any member may rename and set the payday; there is no
-- owner-only concept in this app (both spouses share the budget), and the
-- invite code is the only thing that is authority-bearing.
drop policy if exists household_scoped_update_households on public.households;
create policy household_scoped_update_households
  on public.households for update
  using (public.is_household_member(households.id))
  with check (public.is_household_member(households.id));

-- The invite code is deliberately NOT renamed: it is upserted at creation and
-- shared with the partner already. Letting a rename rotate it would silently
-- invalidate a code someone has been handed.

-- ============ 7. Realtime for the household roster ============
-- 002/003 registered household_members in the publication, but 003 sets
-- `replica identity full` only on the seven money tables — household_members
-- was left on the default. Without it a DELETE (a member leaving) carries only
-- the primary key, so the client-side filter cannot be evaluated and Ruang
-- Keluarga would keep showing the departed member until a manual refresh.
--
-- household_members has no household_id filter on the client anyway (the list
-- is one small query per household), so this is belt-and-braces; the rename
-- case — `households.name` — is the one that actually needs the row payload.
alter table public.household_members replica identity full;

do $$
declare
  t text;
  tables text[] := array['household_members', 'households'];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'realtime: publication supabase_realtime missing; skipping roster tables (verify via dashboard)';
    return;
  end if;
  -- One at a time: in a multi-table ADD, a single already-registered table
  -- aborts the whole statement and silently skips the rest (the 003 lesson).
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

-- Manual verification (SQL Editor, first run):
--   -- as member A, must see both rows:
--   select role, display_name, notify_partner_expense from public.household_members;
--   -- must be false/no rows: member A cannot rename member B
--   update public.household_members set display_name = 'x'
--    where user_id <> auth.uid();
--   -- must succeed: rename + set payday
--   update public.households set name = 'Keluarga Andra', payday_day = 25;
--   -- the roster RPC, with emails, scoped to the caller's household
--   select * from public.list_household_members('<household-uuid>');
--   -- households + household_members must show registered = true
--   select * from public.realtime_health();

-- ============ 8. Default payday for existing households ============
-- Deliberately NOT backfilled to 25. Guessing a payday would silently rewrite
-- what "this cycle" means for a family that gets paid on the 1st, and the
-- profile screen's "Siklus Payday" row is better off saying "belum diatur"
-- until someone actually picks. Left as a documented no-op so the intent is
-- on the record rather than reversed later by accident.
