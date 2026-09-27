-- Kitasaku 004: zero-based allocation, financing lifecycle, loan metadata.
--
-- Design source: design.pen terbaru (zero-based allocation, operating income,
-- financing inflow, asset release, debt payment, asset allocation, funding gap,
-- loan/reimbursement/installment lifecycle, cycle allocation records).
--
-- Sections (in order):
--   1. transactions.flow_type + backfill + indexes
--   2. cycle_allocations table + household-consistency trigger
--   3. obligations loan metadata + widened type/status checks
--   4. obligation_installments schedule table
--   5. (two-way financing link: obligations.source_transaction_id -> transactions.id
--      complements the existing transactions.obligation_id -> obligations.id;
--      both SET NULL so history survives; no clone trigger, no cascade to history)
--   6. RLS for the two new tables (mirrors the household_scoped_* pattern of 001)
--   7. Realtime registration, one table per statement (pattern of 003)
--   8. Atomic RPCs: create_financing_with_obligation, allocate_debt_payment
--
-- Idempotency notes:
--   - ADD COLUMN / CREATE TABLE / CREATE INDEX use IF NOT EXISTS.
--   - CHECK widening drops by column lookup in pg_constraint (constraint names
--     may be auto-generated on some environments), then re-adds verbatim names.
--   - Realtime ADD TABLE blocks swallow duplicate_object one table at a time.
-- Does NOT touch realtime_health() (its return contract must stay stable).

-- ============ 1. transactions.flow_type ============
alter table public.transactions
  add column if not exists flow_type text not null default 'EXPENSE';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and conname = 'transactions_flow_type_check'
  ) then
    alter table public.transactions
      add constraint transactions_flow_type_check check (
        flow_type in (
          'OPERATING_INCOME', 'FINANCING_INFLOW', 'ASSET_RELEASE',
          'EXPENSE', 'DEBT_PAYMENT', 'ASSET_ALLOCATION'
        )
      );
  end if;
end $$;

-- Backfill: INCOME rows predate flow_type and are operating income by default.
-- EXPENSE rows are left alone, including rows with obligation_id set: an
-- automatic backfill to DEBT_PAYMENT is forbidden until an obligation pattern
-- is proven (see docs/phase-1-domain-contract.md TODO).
update public.transactions
  set flow_type = 'OPERATING_INCOME'
  where direction = 'INCOME' and flow_type = 'EXPENSE';

create index if not exists idx_transactions_household on public.transactions (household_id);
create index if not exists idx_transactions_cycle on public.transactions (cycle_id);
create index if not exists idx_transactions_flow on public.transactions (flow_type);
create index if not exists idx_transactions_status on public.transactions (status);
create index if not exists idx_transactions_release_date on public.transactions (release_date);
create index if not exists idx_transactions_household_cycle_flow
  on public.transactions (household_id, cycle_id, flow_type);

-- ============ 2. cycle_allocations ============
-- The ONLY total that counts as "allocation" (anti-double-count: transactions
-- are never summed into the allocation total; see docs).
create table if not exists public.cycle_allocations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  allocation_type text not null check (
    allocation_type in (
      'EXPENSE', 'DEBT_PAYMENT', 'ASSET', 'SAVINGS',
      'INVESTMENT', 'EMERGENCY_FUND', 'OTHER'
    )
  ),
  amount bigint not null check (amount > 0),
  category_id uuid references public.categories(id) on delete set null,
  obligation_id uuid references public.obligations(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_cycle_allocations_household on public.cycle_allocations (household_id);
create index if not exists idx_cycle_allocations_cycle on public.cycle_allocations (cycle_id);
create index if not exists idx_cycle_allocations_obligation on public.cycle_allocations (obligation_id);
create index if not exists idx_cycle_allocations_category on public.cycle_allocations (category_id);
create index if not exists idx_cycle_allocations_household_cycle
  on public.cycle_allocations (household_id, cycle_id);

-- Allocation rows may only reference data owned by the same household.
create or replace function public.validate_cycle_allocation_household()
returns trigger
language plpgsql
as $$
declare
  v_cycle_household uuid;
  v_ref_household uuid;
begin
  select household_id into v_cycle_household
    from public.cycles where id = NEW.cycle_id;
  if v_cycle_household is null or v_cycle_household <> NEW.household_id then
    raise exception 'cycle_allocations: cycle % does not belong to household %', NEW.cycle_id, NEW.household_id;
  end if;

  if NEW.category_id is not null then
    select household_id into v_ref_household
      from public.categories where id = NEW.category_id;
    if v_ref_household is null or v_ref_household <> NEW.household_id then
      raise exception 'cycle_allocations: category % does not belong to household %', NEW.category_id, NEW.household_id;
    end if;
  end if;

  if NEW.obligation_id is not null then
    select household_id into v_ref_household
      from public.obligations where id = NEW.obligation_id;
    if v_ref_household is null or v_ref_household <> NEW.household_id then
      raise exception 'cycle_allocations: obligation % does not belong to household %', NEW.obligation_id, NEW.household_id;
    end if;
  end if;

  if NEW.account_id is not null then
    select household_id into v_ref_household
      from public.accounts where id = NEW.account_id;
    if v_ref_household is null or v_ref_household <> NEW.household_id then
      raise exception 'cycle_allocations: account % does not belong to household %', NEW.account_id, NEW.household_id;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_validate_cycle_allocation_household on public.cycle_allocations;
create trigger trg_validate_cycle_allocation_household
  before insert or update on public.cycle_allocations
  for each row execute function public.validate_cycle_allocation_household();

-- ============ 3. obligations loan metadata + widened checks ============
-- Widen type/status compatibly: old aliases (DEBT, REIMBURSE, UNPAID) keep
-- working; no data migration. Consolidation is scheduled for a later phase.
-- DEBT is the old alias of LOAN; REIMBURSE is the old alias of REIMBURSEMENT;
-- UNPAID is the old alias of OPEN.
do $$
declare
  r record;
  v_type_attnum smallint;
  v_status_attnum smallint;
begin
  select attnum into v_type_attnum from pg_attribute
    where attrelid = 'public.obligations'::regclass and attname = 'type';
  for r in
    select c.conname as name from pg_constraint c
      where c.conrelid = 'public.obligations'::regclass
        and c.contype = 'c' and v_type_attnum = any (c.conkey)
  loop
    execute format('alter table public.obligations drop constraint %I', r.name);
  end loop;

  select attnum into v_status_attnum from pg_attribute
    where attrelid = 'public.obligations'::regclass and attname = 'status';
  for r in
    select c.conname as name from pg_constraint c
      where c.conrelid = 'public.obligations'::regclass
        and c.contype = 'c' and v_status_attnum = any (c.conkey)
  loop
    execute format('alter table public.obligations drop constraint %I', r.name);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.obligations'::regclass
      and conname = 'obligations_type_check'
  ) then
    alter table public.obligations
      add constraint obligations_type_check check (
        type in ('BILL', 'LOAN', 'REIMBURSEMENT', 'INSTALLMENT', 'DEBT', 'REIMBURSE')
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.obligations'::regclass
      and conname = 'obligations_status_check'
  ) then
    alter table public.obligations
      add constraint obligations_status_check check (
        status in ('OPEN', 'UNPAID', 'PARTIAL', 'OVERDUE', 'SETTLED', 'CANCELLED')
      );
  end if;
end $$;

comment on constraint obligations_type_check on public.obligations is
  'DEBT is the legacy alias of LOAN; REIMBURSE is the legacy alias of REIMBURSEMENT. Consolidation scheduled for a later phase; do not migrate data here.';
comment on constraint obligations_status_check on public.obligations is
  'UNPAID is the legacy alias of OPEN. Consolidation scheduled for a later phase; do not migrate data here.';

alter table public.obligations add column if not exists repayment_method text;
alter table public.obligations add column if not exists planned_installment_amount bigint check (planned_installment_amount >= 0);
alter table public.obligations add column if not exists installment_count int check (installment_count > 0);
alter table public.obligations add column if not exists current_installment int check (current_installment > 0);
alter table public.obligations add column if not exists start_date date;
alter table public.obligations add column if not exists due_date date;
alter table public.obligations add column if not exists interest_fee_amount bigint not null default 0 check (interest_fee_amount >= 0);
alter table public.obligations add column if not exists source_transaction_id uuid references public.transactions(id) on delete set null;

create index if not exists idx_obligations_source_transaction on public.obligations (source_transaction_id);
create index if not exists idx_obligations_due_date on public.obligations (due_date);

-- ============ 4. obligation_installments ============
-- Per-cycle schedule for an obligation. Payment history is never stored here:
-- payments live in transactions, so editing the schedule cannot erase history.
-- cycle_id is nullable: an installment without a cycle is backlog.
create table if not exists public.obligation_installments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  obligation_id uuid not null references public.obligations(id) on delete cascade,
  cycle_id uuid references public.cycles(id) on delete set null,
  planned_amount bigint not null check (planned_amount > 0),
  due_date date,
  status text not null default 'OPEN' check (
    status in ('OPEN', 'PARTIAL', 'OVERDUE', 'SETTLED', 'CANCELLED')
  ),
  paid_amount bigint not null default 0 check (paid_amount >= 0),
  paid_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_obligation_installments_household on public.obligation_installments (household_id);
create index if not exists idx_obligation_installments_obligation on public.obligation_installments (obligation_id);
create index if not exists idx_obligation_installments_cycle on public.obligation_installments (cycle_id);
create index if not exists idx_obligation_installments_obligation_cycle
  on public.obligation_installments (obligation_id, cycle_id);

-- ============ 6. RLS (mirrors the 001 household_scoped_* pattern) ============
alter table public.cycle_allocations enable row level security;
alter table public.obligation_installments enable row level security;

drop policy if exists household_scoped_select_cycle_allocations on public.cycle_allocations;
create policy household_scoped_select_cycle_allocations
  on public.cycle_allocations for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = cycle_allocations.household_id and m.user_id = auth.uid()
  ));

drop policy if exists household_scoped_write_cycle_allocations on public.cycle_allocations;
create policy household_scoped_write_cycle_allocations
  on public.cycle_allocations for all
  using (exists (
    select 1 from public.household_members m
    where m.household_id = cycle_allocations.household_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = cycle_allocations.household_id and m.user_id = auth.uid()
  ));

drop policy if exists household_scoped_select_obligation_installments on public.obligation_installments;
create policy household_scoped_select_obligation_installments
  on public.obligation_installments for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = obligation_installments.household_id and m.user_id = auth.uid()
  ));

drop policy if exists household_scoped_write_obligation_installments on public.obligation_installments;
create policy household_scoped_write_obligation_installments
  on public.obligation_installments for all
  using (exists (
    select 1 from public.household_members m
    where m.household_id = obligation_installments.household_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = obligation_installments.household_id and m.user_id = auth.uid()
  ));

-- ============ 7. Realtime (one table per statement, pattern of 003) ============
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.cycle_allocations';
      raise notice 'realtime: cycle_allocations added to publication';
    exception
      when duplicate_object then
        raise notice 'realtime: cycle_allocations already registered (skipped)';
    end;
  else
    raise notice 'realtime: publication supabase_realtime missing; skipping cycle_allocations (verify via dashboard)';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.obligation_installments';
      raise notice 'realtime: obligation_installments added to publication';
    exception
      when duplicate_object then
        raise notice 'realtime: obligation_installments already registered (skipped)';
    end;
  else
    raise notice 'realtime: publication supabase_realtime missing; skipping obligation_installments (verify via dashboard)';
  end if;
end $$;

alter table public.cycle_allocations replica identity full;
alter table public.obligation_installments replica identity full;

-- Manual verification (SQL Editor, first run):
--   select * from pg_publication_tables
--    where pubname = 'supabase_realtime'
--      and tablename in ('cycle_allocations', 'obligation_installments');
-- Must return 2 rows. realtime_health() is intentionally NOT extended here.

-- ============ 8. Atomic RPCs ============
-- Without these, a financing loan (or debt payment) needs two separate client
-- inserts, leaving half-written data when the second one fails. Both RPCs run
-- in a single transaction with a household-membership check.

-- Financing inflow + linked obligation in one transaction.
-- Returns (transaction_id, obligation_id).
create or replace function public.create_financing_with_obligation(
  p_household_id uuid,
  p_cycle_id uuid,
  p_amount bigint,
  p_name text,
  p_obligation_title text,
  p_obligation_type text,
  p_account_id uuid,
  p_due_date date
)
returns table (transaction_id uuid, obligation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn_id uuid;
  v_obligation_id uuid;
  v_uid uuid := auth.uid();
begin
  if not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = v_uid
  ) then
    raise exception 'Not a member of household %', p_household_id;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal pembiayaan harus lebih dari 0.';
  end if;
  if p_obligation_type not in ('BILL', 'LOAN', 'REIMBURSEMENT', 'INSTALLMENT') then
    raise exception 'Unknown obligation type %', p_obligation_type;
  end if;

  insert into public.transactions (
    household_id, cycle_id, name, direction, flow_type,
    planned_amount, actual_amount, status, release_date,
    account_id, created_by, executed_by
  ) values (
    p_household_id, p_cycle_id, p_name, 'INCOME', 'FINANCING_INFLOW',
    p_amount, p_amount, 'PAID', CURRENT_DATE,
    p_account_id, v_uid, v_uid
  ) returning id into v_txn_id;

  insert into public.obligations (
    household_id, title, type, total_amount, remaining_amount,
    status, due_date, source_transaction_id
  ) values (
    p_household_id, p_obligation_title, p_obligation_type, p_amount, p_amount,
    'OPEN', p_due_date, v_txn_id
  ) returning id into v_obligation_id;

  return query select v_txn_id, v_obligation_id;
end;
$$;

-- Debt payment: outflow txn + obligation paydown + allocation record, atomically.
-- The txn is created PAID so the obligation paydown is coherent with the ledger;
-- confirming a PENDING allocation txn via useMarkAsPaid on these rows would
-- decrement remaining_amount a second time (phase-2 guard, see docs TODO).
-- Returns (transaction_id, allocation_id).
create or replace function public.allocate_debt_payment(
  p_household_id uuid,
  p_cycle_id uuid,
  p_obligation_id uuid,
  p_amount bigint,
  p_account_id uuid
)
returns table (transaction_id uuid, allocation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn_id uuid;
  v_allocation_id uuid;
  v_remaining bigint;
  v_uid uuid := auth.uid();
  v_title text;
begin
  if not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = v_uid
  ) then
    raise exception 'Not a member of household %', p_household_id;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal pembayaran harus lebih dari 0.';
  end if;

  select remaining_amount, title into v_remaining, v_title
    from public.obligations where id = p_obligation_id for update;
  if not found then
    raise exception 'Obligation % not found', p_obligation_id;
  end if;
  if (select household_id from public.obligations where id = p_obligation_id) <> p_household_id then
    raise exception 'Obligation % does not belong to household %', p_obligation_id, p_household_id;
  end if;

  insert into public.transactions (
    household_id, cycle_id, obligation_id, name, direction, flow_type,
    planned_amount, actual_amount, status, release_date,
    account_id, created_by, executed_by
  ) values (
    p_household_id, p_cycle_id, p_obligation_id, v_title, 'EXPENSE', 'DEBT_PAYMENT',
    p_amount, p_amount, 'PAID', CURRENT_DATE,
    p_account_id, v_uid, v_uid
  ) returning id into v_txn_id;

  update public.obligations
    set remaining_amount = greatest(0, v_remaining - p_amount),
        status = case when greatest(0, v_remaining - p_amount) <= 0 then 'SETTLED' else 'PARTIAL' end
    where id = p_obligation_id;

  insert into public.cycle_allocations (
    household_id, cycle_id, allocation_type, amount,
    obligation_id, account_id, created_by
  ) values (
    p_household_id, p_cycle_id, 'DEBT_PAYMENT', p_amount,
    p_obligation_id, p_account_id, v_uid
  ) returning id into v_allocation_id;

  return query select v_txn_id, v_allocation_id;
end;
$$;

grant execute on function public.create_financing_with_obligation(uuid, uuid, bigint, text, text, text, uuid, date) to authenticated;
grant execute on function public.allocate_debt_payment(uuid, uuid, uuid, bigint, uuid) to authenticated;
