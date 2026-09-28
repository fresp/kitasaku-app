-- Kitasaku 014: transfers, investment positions, valuations, and sweep policy.
--
-- Design source: docs/phase-13-zero-based-per-akun.md, sections 3, 5, and 7.0.
--
-- This migration deliberately does not add an account balance, an INVESTMENT
-- account type, or any balance/account-maths trigger. Transfers are ledger rows;
-- assets are positions whose stated values are recorded separately.
--
-- Idempotency:
--   * columns/tables/indexes use IF NOT EXISTS;
--   * named constraints and triggers are installed only when absent (or replaced);
--   * realtime registration is attempted one table per statement and skips an
--     already registered table.
-- Does not alter public.realtime_health(), whose return contract is stable.

-- ============ 1. transfers on transactions ==========
-- 004 already introduced flow_type. Keep every existing flow and widen the
-- check to add only TRANSFER. Dropping checks attached solely to flow_type is
-- necessary because 004's check may already be present under that name (or an
-- auto-generated name in an older environment).
alter table public.transactions
  add column if not exists flow_type text not null default 'EXPENSE';

-- Backfill rows created before flow_type existed, matching migration 004's
-- classification rule. This must run before the widened check below.
update public.transactions
  set flow_type = 'OPERATING_INCOME'
  where direction = 'INCOME' and flow_type = 'EXPENSE';

do $$
declare
  v_attnum smallint;
  r record;
begin
  select attnum into v_attnum
    from pg_attribute
   where attrelid = 'public.transactions'::regclass
     and attname = 'flow_type'
     and not attisdropped;

  if v_attnum is not null then
    for r in
      select c.conname
        from pg_constraint c
       where c.conrelid = 'public.transactions'::regclass
         and c.contype = 'c'
         and c.conkey = array[v_attnum]::smallint[]
    loop
      execute format('alter table public.transactions drop constraint %I', r.conname);
    end loop;
  end if;
end $$;

alter table public.transactions
  add constraint transactions_flow_type_check check (
    flow_type in (
      'OPERATING_INCOME', 'FINANCING_INFLOW', 'ASSET_RELEASE',
      'EXPENSE', 'DEBT_PAYMENT', 'ASSET_ALLOCATION', 'TRANSFER'
    )
  );

-- A transfer has a source account and a counterparty account. Both foreign
-- keys retain the transaction if an account is archived/deleted later.
alter table public.transactions
  add column if not exists counter_account_id uuid;

alter table public.transactions
  add column if not exists asset_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.transactions'::regclass
       and conname = 'transactions_counter_account_id_fkey_phase13'
  ) then
    alter table public.transactions
      add constraint transactions_counter_account_id_fkey_phase13
      foreign key (counter_account_id) references public.accounts(id) on delete set null;
  end if;
end $$;

create index if not exists idx_transactions_counter_account
  on public.transactions (counter_account_id);
create index if not exists idx_transactions_asset
  on public.transactions (asset_id);
create index if not exists idx_transactions_household_flow
  on public.transactions (household_id, flow_type);

-- ============ 2. asset positions and dated valuations ==========
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  band text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.asset_valuations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  stated_value bigint not null,
  valued_at date not null,
  noted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- The transactions.asset_id FK cannot be created until assets exists. This is
-- separate and idempotent so a partially applied migration can be resumed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.transactions'::regclass
       and conname = 'transactions_asset_id_fkey_phase13'
  ) then
    alter table public.transactions
      add constraint transactions_asset_id_fkey_phase13
      foreign key (asset_id) references public.assets(id) on delete set null;
  end if;
end $$;

create index if not exists idx_assets_household
  on public.assets (household_id);
create index if not exists idx_assets_household_active
  on public.assets (household_id, is_active);
create index if not exists idx_asset_valuations_household
  on public.asset_valuations (household_id);
create index if not exists idx_asset_valuations_asset
  on public.asset_valuations (asset_id);
create index if not exists idx_asset_valuations_asset_date
  on public.asset_valuations (asset_id, valued_at desc);
create index if not exists idx_asset_valuations_household_date
  on public.asset_valuations (household_id, valued_at desc);

-- ============ 3. household consistency and transfer invariants ==========
-- Foreign keys prove that referenced rows exist, but do not prove that they
-- belong to the transaction/valuation household. These triggers close that
-- cross-household gap and prevent a transfer from naming itself as its counter.
create or replace function public.validate_transaction_phase13_references()
returns trigger
language plpgsql
as $$
declare
  v_ref_household uuid;
begin
  if NEW.account_id is not null then
    select household_id into v_ref_household
      from public.accounts where id = NEW.account_id;
    if v_ref_household is null or v_ref_household <> NEW.household_id then
      raise exception 'transactions: account % does not belong to household %',
        NEW.account_id, NEW.household_id;
    end if;
  end if;

  if NEW.counter_account_id is not null then
    if NEW.account_id is not null and NEW.counter_account_id = NEW.account_id then
      raise exception 'transactions: counter_account_id must differ from account_id';
    end if;

    select household_id into v_ref_household
      from public.accounts where id = NEW.counter_account_id;
    if v_ref_household is null or v_ref_household <> NEW.household_id then
      raise exception 'transactions: counter account % does not belong to household %',
        NEW.counter_account_id, NEW.household_id;
    end if;
  end if;

  if NEW.asset_id is not null then
    select household_id into v_ref_household
      from public.assets where id = NEW.asset_id;
    if v_ref_household is null or v_ref_household <> NEW.household_id then
      raise exception 'transactions: asset % does not belong to household %',
        NEW.asset_id, NEW.household_id;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_validate_transaction_phase13_references
  on public.transactions;
create trigger trg_validate_transaction_phase13_references
  before insert or update on public.transactions
  for each row execute function public.validate_transaction_phase13_references();

create or replace function public.validate_asset_valuation_phase13_references()
returns trigger
language plpgsql
as $$
declare
  v_asset_household uuid;
begin
  select household_id into v_asset_household
    from public.assets where id = NEW.asset_id;
  if v_asset_household is null or v_asset_household <> NEW.household_id then
    raise exception 'asset_valuations: asset % does not belong to household %',
      NEW.asset_id, NEW.household_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_validate_asset_valuation_phase13_references
  on public.asset_valuations;
create trigger trg_validate_asset_valuation_phase13_references
  before insert or update on public.asset_valuations
  for each row execute function public.validate_asset_valuation_phase13_references();

-- ============ 4. RLS ==========
alter table public.assets enable row level security;
alter table public.asset_valuations enable row level security;

drop policy if exists household_scoped_select_assets on public.assets;
create policy household_scoped_select_assets
  on public.assets for select
  using (exists (
    select 1 from public.household_members m
     where m.household_id = assets.household_id and m.user_id = auth.uid()
  ));

drop policy if exists household_scoped_write_assets on public.assets;
create policy household_scoped_write_assets
  on public.assets for all
  using (exists (
    select 1 from public.household_members m
     where m.household_id = assets.household_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
     where m.household_id = assets.household_id and m.user_id = auth.uid()
  ));

drop policy if exists household_scoped_select_asset_valuations on public.asset_valuations;
create policy household_scoped_select_asset_valuations
  on public.asset_valuations for select
  using (exists (
    select 1 from public.household_members m
     where m.household_id = asset_valuations.household_id and m.user_id = auth.uid()
  ));

drop policy if exists household_scoped_write_asset_valuations on public.asset_valuations;
create policy household_scoped_write_asset_valuations
  on public.asset_valuations for all
  using (exists (
    select 1 from public.household_members m
     where m.household_id = asset_valuations.household_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
     where m.household_id = asset_valuations.household_id and m.user_id = auth.uid()
  ));

-- ============ 5. sweep policy setting ==========
alter table public.households
  add column if not exists sweep_policy varchar not null default 'OFFERED';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.households'::regclass
       and conname = 'households_sweep_policy_check'
  ) then
    alter table public.households
      add constraint households_sweep_policy_check
      check (sweep_policy in ('REQUIRED', 'OFFERED'));
  end if;
end $$;

comment on column public.households.sweep_policy is
  'Cycle-close treatment for account sweep: REQUIRED blocks close until swept; OFFERED presents a non-blocking offer.';

-- ============ 6. Realtime (one table per statement) ==========
-- Do not extend or replace realtime_health(); its return contract is owned by
-- migration 003. These blocks are safe when Realtime is not enabled yet.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.assets';
      raise notice 'realtime: assets added to publication';
    exception when duplicate_object then
      raise notice 'realtime: assets already registered (skipped)';
    end;
  else
    raise notice 'realtime: publication supabase_realtime missing; skipping assets (verify via dashboard)';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.asset_valuations';
      raise notice 'realtime: asset_valuations added to publication';
    exception when duplicate_object then
      raise notice 'realtime: asset_valuations already registered (skipped)';
    end;
  else
    raise notice 'realtime: publication supabase_realtime missing; skipping asset_valuations (verify via dashboard)';
  end if;
end $$;

alter table public.assets replica identity full;
alter table public.asset_valuations replica identity full;

-- Manual verification (SQL Editor, first run):
--   -- 1. Existing flow values survive and TRANSFER is accepted.
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.transactions'::regclass
--      and conname = 'transactions_flow_type_check';
--   -- expected: the definition contains all six prior values plus TRANSFER.
--
--   -- 2. A same-household transfer succeeds; a self-counter is rejected.
--   insert into public.transactions
--     (household_id, name, account_id, counter_account_id, direction,
--      flow_type, planned_amount, actual_amount)
--   values ('<household-uuid>', 'Test transfer', '<account-uuid>',
--           '<other-account-uuid>', 'EXPENSE', 'TRANSFER', 1, 1);
--   -- expected: one row; repeat with the same account UUID in both columns:
--   -- ERROR transactions: counter_account_id must differ from account_id.
--
--   -- 3. Cross-household account/asset references are rejected by the trigger,
--   -- and an asset valuation must use an asset from its own household.
--
--   -- 4. RLS exposes only the caller's household.
--   select count(*) from public.assets;
--   select count(*) from public.asset_valuations;
--   -- expected: no rows from another household.
--
--   -- 5. Realtime is registered without changing its RPC return shape.
--   select pt.tablename, c.relreplident::text as replica_identity
--     from pg_publication_tables pt
--     join pg_class c on c.relname = pt.tablename
--                       and c.relnamespace = 'public'::regnamespace
--    where pt.pubname = 'supabase_realtime'
--      and pt.schemaname = 'public'
--      and pt.tablename in ('assets', 'asset_valuations');
--   -- expected: two rows, each replica_identity = 'f'.
--   -- realtime_health() intentionally retains its existing target-row set and
--   -- return columns; inspect it separately to confirm that contract is intact.
