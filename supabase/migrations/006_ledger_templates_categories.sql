-- Kitasaku 006: ledger, template, and category management support.
--
-- Design source: design.pen screens 5 (Budget Health), 6 (Riwayat),
-- 9 (Template Rutin), 10 (Detail Kategori), and "Kelola Kategori".
--
-- Sections (in order):
--   1. recurring_templates.due_day  (design: "Tgl 5" on each template card)
--   2. categories.system_role + is_system  (design: the "Sistem" rows
--      "Pinjaman" and "Pemasukan Pendanaan" that cannot be deleted)
--   3. backfill the two system categories for existing households
--   4. delete guard for system categories
--
-- Idempotency notes:
--   - ADD COLUMN uses IF NOT EXISTS; the CHECK is added only when absent.
--   - The backfill inserts by role, not by name, and is guarded per household.
--   - No table is created, so RLS/realtime need no changes here.

-- ============ 1. recurring_templates.due_day ============
-- Day of month a routine bill is due. Nullable on purpose: an existing
-- template with no known due day must not be forced to invent one, and the UI
-- simply omits the "Tgl N" fragment when it is null.
alter table public.recurring_templates
  add column if not exists due_day int;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.recurring_templates'::regclass
      and conname = 'recurring_templates_due_day_check'
  ) then
    alter table public.recurring_templates
      add constraint recurring_templates_due_day_check
      check (due_day is null or (due_day >= 1 and due_day <= 31));
  end if;
end $$;

-- ============ 2. categories.system_role + is_system ============
-- Some categories are not user data, they are the app's own vocabulary: the
-- obligation paydown slot and the financing-inflow slot. The ledger and the
-- zero-based summary refer to them by role, never by name, because the name is
-- user-editable. `is_system` exists separately so the UI can say "cannot be
-- deleted" without inferring it from a role it happens to know about.
alter table public.categories
  add column if not exists is_system boolean not null default false;

alter table public.categories
  add column if not exists system_role text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.categories'::regclass
      and conname = 'categories_system_role_check'
  ) then
    alter table public.categories
      add constraint categories_system_role_check
      check (system_role is null or system_role in ('DEBT_PAYMENT', 'FINANCING_INFLOW'));
  end if;
end $$;

-- A role implies system, and a role may only be held by one category per
-- household. Without this index a second household-level "Pinjaman" row could
-- be seeded twice and the role lookup would become ambiguous.
create unique index if not exists idx_categories_household_system_role
  on public.categories (household_id, system_role)
  where system_role is not null;

-- ============ 3. backfill system categories ============
-- Inserted per household so every existing family gets the same vocabulary the
-- new screens expect. `on conflict do nothing` relies on the partial unique
-- index above, so re-running is safe.
do $$
declare
  hh record;
begin
  for hh in select id from public.households loop
    insert into public.categories (household_id, name, monthly_budget, type, is_system, system_role)
    values (hh.id, 'Pinjaman', 0, 'EXPENSE', true, 'DEBT_PAYMENT')
    on conflict do nothing;

    insert into public.categories (household_id, name, monthly_budget, type, is_system, system_role)
    values (hh.id, 'Pemasukan Pendanaan', 0, 'INCOME', true, 'FINANCING_INFLOW')
    on conflict do nothing;
  end loop;
exception
  -- `on conflict do nothing` has no index inference target for a partial
  -- unique index on some PG versions; fall back to explicit existence checks.
  when others then
    for hh in select id from public.households loop
      if not exists (
        select 1 from public.categories
        where household_id = hh.id and system_role = 'DEBT_PAYMENT'
      ) then
        insert into public.categories (household_id, name, monthly_budget, type, is_system, system_role)
        values (hh.id, 'Pinjaman', 0, 'EXPENSE', true, 'DEBT_PAYMENT');
      end if;

      if not exists (
        select 1 from public.categories
        where household_id = hh.id and system_role = 'FINANCING_INFLOW'
      ) then
        insert into public.categories (household_id, name, monthly_budget, type, is_system, system_role)
        values (hh.id, 'Pemasukan Pendanaan', 0, 'INCOME', true, 'FINANCING_INFLOW');
      end if;
    end loop;
end $$;

-- ============ 4. delete guard ============
-- Deleting a system category would orphan the ledger's classification: rows
-- pointing at it keep a dangling `category_id` and the role lookup returns
-- nothing. Refuse at the database, not only in the UI.
create or replace function public.prevent_system_category_delete()
returns trigger
language plpgsql
as $$
begin
  if OLD.is_system then
    raise exception 'Kategori sistem (%) tidak dapat dihapus.', OLD.name
      using errcode = 'check_violation';
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_prevent_system_category_delete on public.categories;
create trigger trg_prevent_system_category_delete
  before delete on public.categories
  for each row execute function public.prevent_system_category_delete();

-- Manual verification (SQL Editor, after running):
--   -- 1. Every household has exactly one category per role.
--   select household_id, system_role, count(*) from public.categories
--     where system_role is not null group by 1, 2;  -- expect count = 1 each
--   -- 2. Deleting one is refused.
--   delete from public.categories where system_role = 'DEBT_PAYMENT';  -- error
--   -- 3. due_day accepts 1..31 only.
--   update public.recurring_templates set due_day = 32;  -- error
