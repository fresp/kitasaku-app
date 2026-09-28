-- Kitasaku 012: Phase 12 cycle reconciliation and the UNTRACKED system category.
--
-- Design source: docs/phase-12-rekonsiliasi-tutup-siklus.md, sections 2.1,
-- 2.2, 2.3, and section 3. A reconciliation row is a dated fact (a balance
-- the family stated at a point in time), not a stored running account balance.
--
-- Idempotency follows the repository migration convention:
--   * ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS
--   * constraints are widened by dropping checks found from pg_constraint and
--     re-adding the canonical constraint
--   * policies and triggers are dropped by name before being recreated
--   * realtime is added one table per guarded statement
--
-- This migration deliberately does not add any balance column.

-- ============ 1. cycles.primary_account_id ==========
-- Nullable by design: cycles created before Phase 12 have no reconciliation
-- anchor and must remain usable until the family chooses a bank account.
alter table public.cycles
  add column if not exists primary_account_id uuid
    references public.accounts(id) on delete set null;

comment on column public.cycles.primary_account_id is
  'The one bank account used as this cycle''s reconciliation anchor. NULL means the cycle predates Phase 12 or has not been configured yet.';

-- The picker is not the integrity boundary. Enforce both household ownership
-- and the BANK-only rule for inserts and updates sent directly to Postgres.
create or replace function public.validate_cycle_primary_account_household()
returns trigger
language plpgsql
as $$
declare
  v_ref_household uuid;
  v_type text;
begin
  if NEW.primary_account_id is not null then
    select a.household_id, a.type
      into v_ref_household, v_type
      from public.accounts a
      where a.id = NEW.primary_account_id;

    if v_ref_household is null or v_ref_household <> NEW.household_id then
      raise exception
        'cycles: primary account % does not belong to household %',
        NEW.primary_account_id, NEW.household_id;
    end if;

    if v_type <> 'BANK' then
      raise exception
        'cycles: primary account must be a BANK account, got %', v_type;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_validate_cycle_primary_account_household on public.cycles;
create trigger trg_validate_cycle_primary_account_household
  before insert or update on public.cycles
  for each row execute function public.validate_cycle_primary_account_household();

-- ============ 2. cycle_reconciliations ==========
-- recorded_net and delta are snapshots. They must not be recomputed from the
-- mutable transaction ledger after a family has stated the closing balance.
create table if not exists public.cycle_reconciliations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  opening_stated bigint,
  closing_stated bigint not null,
  recorded_net bigint not null,
  delta bigint not null,
  adjustment_txn_id uuid references public.transactions(id) on delete set null,
  noted_at timestamptz not null default now(),
  noted_by uuid references auth.users(id),
  unique (cycle_id)
);

comment on table public.cycle_reconciliations is
  'Dated reconciliation fact: the household-stated opening/closing balance and frozen ledger delta for one cycle. Not a running account balance.';
comment on column public.cycle_reconciliations.opening_stated is
  'Stated opening balance; NULL for the first cycle because no prior closing anchor exists.';
comment on column public.cycle_reconciliations.closing_stated is
  'Stated closing balance at the one snapshot taken when the cycle is closed.';
comment on column public.cycle_reconciliations.recorded_net is
  'Frozen delta recorded from PAID income/expense activity on the cycle primary account at snapshot time.';
comment on column public.cycle_reconciliations.delta is
  'Frozen reconciliation difference: actual movement minus recorded_net; zero means the stated balance matches.';
comment on column public.cycle_reconciliations.adjustment_txn_id is
  'Optional adjustment transaction created by the reconciliation flow; retained to make adjustment writes exactly-once.';

create index if not exists idx_cycle_reconciliations_household
  on public.cycle_reconciliations (household_id);
create index if not exists idx_cycle_reconciliations_cycle
  on public.cycle_reconciliations (cycle_id);
create index if not exists idx_cycle_reconciliations_account
  on public.cycle_reconciliations (account_id);
create index if not exists idx_cycle_reconciliations_household_cycle
  on public.cycle_reconciliations (household_id, cycle_id);

-- Keep the denormalised household key aligned with both referenced records.
-- The foreign keys above guarantee existence; this trigger prevents a caller
-- from combining rows belonging to different households.
create or replace function public.validate_cycle_reconciliation_household()
returns trigger
language plpgsql
as $$
declare
  v_cycle_household uuid;
  v_account_household uuid;
begin
  select c.household_id
    into v_cycle_household
    from public.cycles c
    where c.id = NEW.cycle_id;
  if v_cycle_household is null or v_cycle_household <> NEW.household_id then
    raise exception
      'cycle_reconciliations: cycle % does not belong to household %',
      NEW.cycle_id, NEW.household_id;
  end if;

  select a.household_id
    into v_account_household
    from public.accounts a
    where a.id = NEW.account_id;
  if v_account_household is null or v_account_household <> NEW.household_id then
    raise exception
      'cycle_reconciliations: account % does not belong to household %',
      NEW.account_id, NEW.household_id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_validate_cycle_reconciliation_household
  on public.cycle_reconciliations;
create trigger trg_validate_cycle_reconciliation_household
  before insert or update on public.cycle_reconciliations
  for each row execute function public.validate_cycle_reconciliation_household();

-- ============ 3. RLS ==========
-- Same names and membership predicate as cycle_allocations in migration 004.
alter table public.cycle_reconciliations enable row level security;

drop policy if exists household_scoped_select_cycle_reconciliations
  on public.cycle_reconciliations;
create policy household_scoped_select_cycle_reconciliations
  on public.cycle_reconciliations for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = cycle_reconciliations.household_id
      and m.user_id = auth.uid()
  ));

drop policy if exists household_scoped_write_cycle_reconciliations
  on public.cycle_reconciliations;
create policy household_scoped_write_cycle_reconciliations
  on public.cycle_reconciliations for all
  using (exists (
    select 1 from public.household_members m
    where m.household_id = cycle_reconciliations.household_id
      and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = cycle_reconciliations.household_id
      and m.user_id = auth.uid()
  ));

-- ============ 4. Realtime ==========
-- Guard the publication because local/dev databases may not have Realtime
-- enabled. Keep this as one ADD TABLE statement for this one table; unlike a
-- multi-table ALTER PUBLICATION, no already-registered sibling can mask it.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime
        add table public.cycle_reconciliations;
      raise notice 'realtime: cycle_reconciliations added to publication';
    exception
      when duplicate_object then
        raise notice 'realtime: cycle_reconciliations already registered (skipped)';
    end;
  else
    raise notice 'realtime: publication supabase_realtime missing; skipping cycle_reconciliations (verify via dashboard)';
  end if;
end $$;

alter table public.cycle_reconciliations replica identity full;

-- ============ 5. System category role: UNTRACKED ==========
-- Migration 006 created this check with only DEBT_PAYMENT and
-- FINANCING_INFLOW. Locate checks by column rather than trusting an automatic
-- constraint name, then replace them with the widened vocabulary.
do $$
declare
  r record;
  v_role_attnum smallint;
begin
  select attnum
    into v_role_attnum
    from pg_attribute
    where attrelid = 'public.categories'::regclass
      and attname = 'system_role';

  for r in
    select c.conname as name
      from pg_constraint c
      where c.conrelid = 'public.categories'::regclass
        and c.contype = 'c'
        and v_role_attnum = any (c.conkey)
  loop
    execute format('alter table public.categories drop constraint %I', r.name);
  end loop;
end $$;

alter table public.categories
  add constraint categories_system_role_check
  check (system_role is null or system_role in (
    'DEBT_PAYMENT', 'FINANCING_INFLOW', 'UNTRACKED'
  ));

-- The partial unique index from migration 006 makes each role unique per
-- household. It is recreated defensively for databases that were upgraded
-- without that migration's index.
create unique index if not exists idx_categories_household_system_role
  on public.categories (household_id, system_role)
  where system_role is not null;

-- Existing households need all three system categories. monthly_budget = 0 is
-- intentional: it means NO_BUDGET until the family chooses a trash budget; the
-- migration must not invent a budget and immediately report indiscipline.
do $$
declare
  hh record;
begin
  for hh in select h.id from public.households h loop
    if not exists (
      select 1 from public.categories c
      where c.household_id = hh.id and c.system_role = 'DEBT_PAYMENT'
    ) then
      insert into public.categories
        (household_id, name, monthly_budget, type, is_system, system_role)
      values
        (hh.id, 'Pinjaman', 0, 'EXPENSE', true, 'DEBT_PAYMENT');
    end if;

    if not exists (
      select 1 from public.categories c
      where c.household_id = hh.id and c.system_role = 'FINANCING_INFLOW'
    ) then
      insert into public.categories
        (household_id, name, monthly_budget, type, is_system, system_role)
      values
        (hh.id, 'Pemasukan Pendanaan', 0, 'INCOME', true, 'FINANCING_INFLOW');
    end if;

    if not exists (
      select 1 from public.categories c
      where c.household_id = hh.id and c.system_role = 'UNTRACKED'
    ) then
      insert into public.categories
        (household_id, name, monthly_budget, type, is_system, system_role)
      values
        (hh.id, 'Tidak Terlacak', 0, 'EXPENSE', true, 'UNTRACKED');
    end if;
  end loop;
end $$;

-- Seed the same three roles for every household created after this migration.
-- SECURITY DEFINER is required because create_household() inserts the household
-- before its member row; the trigger must not depend on membership RLS. The
-- inserts are guarded by role existence so re-running the function is safe and
-- does not alter a family's name or budget choices.
create or replace function public.seed_household_system_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.categories c
    where c.household_id = NEW.id and c.system_role = 'DEBT_PAYMENT'
  ) then
    insert into public.categories
      (household_id, name, monthly_budget, type, is_system, system_role)
    values
      (NEW.id, 'Pinjaman', 0, 'EXPENSE', true, 'DEBT_PAYMENT');
  end if;

  if not exists (
    select 1 from public.categories c
    where c.household_id = NEW.id and c.system_role = 'FINANCING_INFLOW'
  ) then
    insert into public.categories
      (household_id, name, monthly_budget, type, is_system, system_role)
    values
      (NEW.id, 'Pemasukan Pendanaan', 0, 'INCOME', true, 'FINANCING_INFLOW');
  end if;

  if not exists (
    select 1 from public.categories c
    where c.household_id = NEW.id and c.system_role = 'UNTRACKED'
  ) then
    insert into public.categories
      (household_id, name, monthly_budget, type, is_system, system_role)
    values
      (NEW.id, 'Tidak Terlacak', 0, 'EXPENSE', true, 'UNTRACKED');
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_seed_household_system_categories on public.households;
create trigger trg_seed_household_system_categories
after insert on public.households
for each row execute function public.seed_household_system_categories();

-- Manual verification (SQL Editor):
-- 1. Every existing household has exactly one category for each role.
-- 2. A primary account from another household or a non-BANK account is rejected.
-- 3. A second reconciliation for one cycle fails on the unique key.
-- 4. Realtime has cycle_reconciliations with replica identity FULL when enabled.
