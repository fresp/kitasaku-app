-- Kitasaku 032: special budgets (Anggaran Khusus).
-- Apply only after 001–031. Fully idempotent. No existing row is rewritten.
--
-- A special budget tracks spending for something with dates that sits outside
-- the routine cycle: Lebaran, a trip, a renovation, school fees. It is a lens
-- over ordinary transactions, not a new place where money lives:
--
--   * money still lives in accounts; balances and reconciliation keep counting
--     every row, tagged or not;
--   * a transaction tagged with special_budget_id is excluded from the cycle's
--     zero-based figures (lib/zero-based-accounting.ts) and counted in the
--     budget's own figures instead;
--   * funding a budget from the cycle is an OTHER cycle_allocations row that
--     names the budget, so the cycle sees an allocation and no cash moves.
--
-- Budget figures (mirrored by lib/special-budget.ts):
--   funds_in  = PAID tagged OPERATING_INCOME + FINANCING_INFLOW + ASSET_RELEASE
--             + live cycle_allocations naming the budget
--   spent     = PAID tagged EXPENSE
--   moved_out = PAID tagged ASSET_ALLOCATION (remaining moved into savings)
--   remaining = funds_in − spent − moved_out
--
-- V1 limits, enforced below: only executed (PAID) rows on BANK/E_WALLET
-- accounts can be tagged; no recurring or debt rows; a closed budget is
-- terminal and its money rows are frozen.

-- ============ 1. special_budgets ==========
create table if not exists public.special_budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  close_destination text,
  closed_remaining bigint,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'special_budgets_name_len'
                   and conrelid = 'public.special_budgets'::regclass) then
    alter table public.special_budgets
      add constraint special_budgets_name_len check (char_length(btrim(name)) between 1 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'special_budgets_date_order'
                   and conrelid = 'public.special_budgets'::regclass) then
    alter table public.special_budgets
      add constraint special_budgets_date_order check (end_date >= start_date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'special_budgets_close_destination'
                   and conrelid = 'public.special_budgets'::regclass) then
    alter table public.special_budgets
      add constraint special_budgets_close_destination
      check (close_destination is null or close_destination in ('CYCLE', 'ASSET', 'NONE'));
  end if;
end;
$$;

create index if not exists idx_special_budgets_household
  on public.special_budgets (household_id);
create index if not exists idx_special_budgets_household_open
  on public.special_budgets (household_id, end_date) where closed_at is null;

comment on table public.special_budgets is
  'Anggaran Khusus: spending tracked for a dated purpose outside the routine cycle. A lens over tagged transactions; money stays in accounts.';

-- ============ 2. tags on transactions and cycle_allocations ==========
alter table public.transactions
  add column if not exists special_budget_id uuid;
alter table public.cycle_allocations
  add column if not exists special_budget_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_special_budget_id_fkey'
                   and conrelid = 'public.transactions'::regclass) then
    alter table public.transactions
      add constraint transactions_special_budget_id_fkey
      foreign key (special_budget_id) references public.special_budgets(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cycle_allocations_special_budget_id_fkey'
                   and conrelid = 'public.cycle_allocations'::regclass) then
    alter table public.cycle_allocations
      add constraint cycle_allocations_special_budget_id_fkey
      foreign key (special_budget_id) references public.special_budgets(id) on delete set null;
  end if;
end;
$$;

create index if not exists idx_transactions_special_budget
  on public.transactions (special_budget_id) where special_budget_id is not null;
create index if not exists idx_cycle_allocations_special_budget
  on public.cycle_allocations (special_budget_id) where special_budget_id is not null;

-- ============ 3. RLS ==========
alter table public.special_budgets enable row level security;

drop policy if exists household_scoped_select_special_budgets on public.special_budgets;
create policy household_scoped_select_special_budgets
  on public.special_budgets for select
  using (public.is_household_member(household_id));

drop policy if exists household_scoped_write_special_budgets on public.special_budgets;
create policy household_scoped_write_special_budgets
  on public.special_budgets for all
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- ============ 4. remaining (one formula for RPCs and verification) ==========
-- SECURITY INVOKER: RLS still scopes the read to the caller's household.
create or replace function public.special_budget_remaining(p_budget_id uuid)
returns bigint
language sql
stable
set search_path = public
as $$
  select
      coalesce((select sum(t.actual_amount) from public.transactions t
                 where t.special_budget_id = p_budget_id
                   and t.status = 'PAID' and t.cancelled_at is null
                   and t.flow_type in ('OPERATING_INCOME', 'FINANCING_INFLOW', 'ASSET_RELEASE')), 0)
    + coalesce((select sum(a.amount) from public.cycle_allocations a
                 where a.special_budget_id = p_budget_id and a.cancelled_at is null), 0)
    - coalesce((select sum(t.actual_amount) from public.transactions t
                 where t.special_budget_id = p_budget_id
                   and t.status = 'PAID' and t.cancelled_at is null
                   and t.flow_type in ('EXPENSE', 'ASSET_ALLOCATION')), 0);
$$;

grant execute on function public.special_budget_remaining(uuid) to authenticated;

-- ============ 5. guards ==========
-- Guards are SECURITY INVOKER on purpose: `current_user = 'postgres'` then
-- means "called from a SECURITY DEFINER RPC owned by postgres", the same
-- convention as 027. A guard declared SECURITY DEFINER would always see
-- postgres and let every client write through.

create or replace function public.guard_special_budget_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if current_user <> 'postgres' and (
         new.closed_at is not null or new.closed_by is not null
      or new.close_destination is not null or new.closed_remaining is not null) then
      raise exception 'Anggaran khusus baru tidak boleh langsung ditutup.';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if current_user <> 'postgres' and (
         exists (select 1 from public.transactions t where t.special_budget_id = old.id)
      or exists (select 1 from public.cycle_allocations a where a.special_budget_id = old.id)) then
      raise exception 'Anggaran khusus yang sudah punya transaksi tidak dapat dihapus.';
    end if;
    return old;
  end if;

  if current_user = 'postgres' then return new; end if;
  if old.closed_at is not null then
    raise exception 'Anggaran khusus yang sudah ditutup tidak dapat diubah.';
  end if;
  if new.household_id is distinct from old.household_id then
    raise exception 'Anggaran khusus tidak dapat dipindah ke keluarga lain.';
  end if;
  if new.closed_at is distinct from old.closed_at
     or new.closed_by is distinct from old.closed_by
     or new.close_destination is distinct from old.close_destination
     or new.closed_remaining is distinct from old.closed_remaining then
    raise exception 'Tutup anggaran khusus melalui alur penutupan.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_special_budget_write on public.special_budgets;
create trigger trg_guard_special_budget_write
  before insert or update or delete on public.special_budgets
  for each row execute function public.guard_special_budget_write();

create or replace function public.guard_transaction_special_budget()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_budget public.special_budgets%rowtype;
  v_account_type text;
begin
  -- Rows of a closed budget are frozen: its figures were settled at close.
  if tg_op in ('UPDATE', 'DELETE') and old.special_budget_id is not null
     and current_user <> 'postgres' then
    select * into v_budget from public.special_budgets where id = old.special_budget_id;
    if found and v_budget.closed_at is not null then
      if tg_op = 'DELETE' then
        raise exception 'Transaksi anggaran khusus "%" yang sudah ditutup tidak dapat dihapus.', v_budget.name;
      end if;
      if new.special_budget_id is distinct from old.special_budget_id
         or new.actual_amount is distinct from old.actual_amount
         or new.planned_amount is distinct from old.planned_amount
         or new.status is distinct from old.status
         or new.flow_type is distinct from old.flow_type
         or new.account_id is distinct from old.account_id
         or new.cancelled_at is distinct from old.cancelled_at then
        raise exception 'Anggaran khusus "%" sudah ditutup. Nominal, status, dan akun transaksinya tidak dapat diubah.', v_budget.name;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  if new.special_budget_id is null then return new; end if;

  select * into v_budget from public.special_budgets
   where id = new.special_budget_id for share;
  if not found or v_budget.household_id is distinct from new.household_id then
    raise exception 'Anggaran khusus bukan milik keluarga ini.';
  end if;

  -- Only checked when the tag is new, so later edits (a cancellation, a
  -- rename) of an already tagged row in an open budget still go through.
  if tg_op = 'INSERT' or new.special_budget_id is distinct from old.special_budget_id then
    if v_budget.closed_at is not null then
      raise exception 'Anggaran khusus "%" sudah ditutup.', v_budget.name;
    end if;
    if new.status is distinct from 'PAID' or new.cancelled_at is not null then
      raise exception 'Hanya transaksi yang sudah terjadi yang dapat masuk anggaran khusus.';
    end if;
  end if;

  if new.flow_type not in ('OPERATING_INCOME', 'FINANCING_INFLOW', 'ASSET_RELEASE', 'EXPENSE', 'ASSET_ALLOCATION') then
    raise exception 'Pembayaran tanggungan dan transfer antar rekening tidak dapat masuk anggaran khusus.';
  end if;
  if new.recurring_template_id is not null then
    raise exception 'Transaksi rutin tidak dapat masuk anggaran khusus.';
  end if;
  if new.obligation_id is not null then
    raise exception 'Pembayaran tanggungan tidak dapat masuk anggaran khusus.';
  end if;

  select type into v_account_type from public.accounts where id = new.account_id;
  if v_account_type is null or v_account_type not in ('BANK', 'E_WALLET') then
    raise exception 'Anggaran khusus hanya untuk transaksi dari rekening bank atau e-wallet.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_transaction_special_budget on public.transactions;
create trigger trg_guard_transaction_special_budget
  before insert or update or delete on public.transactions
  for each row execute function public.guard_transaction_special_budget();

create or replace function public.guard_allocation_special_budget()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_budget public.special_budgets%rowtype;
  v_account_type text;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.special_budget_id is not null
     and current_user <> 'postgres' then
    select * into v_budget from public.special_budgets where id = old.special_budget_id;
    if found and v_budget.closed_at is not null then
      if tg_op = 'DELETE'
         or new.special_budget_id is distinct from old.special_budget_id
         or new.amount is distinct from old.amount
         or new.cancelled_at is distinct from old.cancelled_at then
        raise exception 'Anggaran khusus "%" sudah ditutup. Dananya tidak dapat diubah.', v_budget.name;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  if new.special_budget_id is null then return new; end if;

  select * into v_budget from public.special_budgets
   where id = new.special_budget_id for share;
  if not found or v_budget.household_id is distinct from new.household_id then
    raise exception 'Anggaran khusus bukan milik keluarga ini.';
  end if;
  if (tg_op = 'INSERT' or new.special_budget_id is distinct from old.special_budget_id)
     and v_budget.closed_at is not null then
    raise exception 'Anggaran khusus "%" sudah ditutup.', v_budget.name;
  end if;
  if new.allocation_type is distinct from 'OTHER' then
    raise exception 'Dana anggaran khusus dari siklus harus bertipe alokasi lainnya.';
  end if;
  select type into v_account_type from public.accounts where id = new.account_id;
  if v_account_type is null or v_account_type not in ('BANK', 'E_WALLET') then
    raise exception 'Dana anggaran khusus dari siklus harus memakai rekening bank atau e-wallet.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_allocation_special_budget on public.cycle_allocations;
create trigger trg_guard_allocation_special_budget
  before insert or update or delete on public.cycle_allocations
  for each row execute function public.guard_allocation_special_budget();

-- ============ 6. RPC: fund a budget from the cycle ==========
-- An allocation in the cycle, no cash movement: the money is already in the
-- account, the cycle only gives up its claim on it.
create or replace function public.fund_special_budget_from_cycle(
  p_household_id uuid,
  p_budget_id uuid,
  p_cycle_id uuid,
  p_account_id uuid,
  p_amount bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_budget public.special_budgets%rowtype;
  v_cycle public.cycles%rowtype;
  v_id uuid;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Bukan anggota keluarga ini.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal harus lebih dari Rp 0.';
  end if;

  select * into v_budget from public.special_budgets
   where id = p_budget_id and household_id = p_household_id for update;
  if not found then raise exception 'Anggaran khusus tidak ditemukan.'; end if;
  if v_budget.closed_at is not null then
    raise exception 'Anggaran khusus "%" sudah ditutup.', v_budget.name;
  end if;

  select * into v_cycle from public.cycles
   where id = p_cycle_id and household_id = p_household_id for share;
  if not found then raise exception 'Siklus tidak ditemukan.'; end if;
  if v_cycle.cancelled_at is not null or v_cycle.closed_at is not null
     or v_cycle.is_active is distinct from true then
    raise exception 'Dana hanya dapat disisihkan dari siklus yang sedang berjalan.';
  end if;

  if not exists (select 1 from public.accounts
                  where id = p_account_id and household_id = p_household_id
                    and is_active = true and type in ('BANK', 'E_WALLET')) then
    raise exception 'Pilih rekening bank atau e-wallet aktif.';
  end if;

  insert into public.cycle_allocations
    (household_id, cycle_id, allocation_type, amount, account_id, special_budget_id, note, created_by)
  values
    (p_household_id, p_cycle_id, 'OTHER', p_amount, p_account_id, p_budget_id,
     'Anggaran khusus: ' || v_budget.name, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.fund_special_budget_from_cycle(uuid, uuid, uuid, uuid, bigint) to authenticated;

-- ============ 7. RPC: close a budget ==========
-- p_expected_remaining is the figure the user confirmed; a partner's write in
-- between changes it and the close is refused rather than settling a number
-- nobody saw.
--
-- remaining > 0: CYCLE  → nothing is written; the money stays in the account
--                         and is no longer claimed by the budget.
--                ASSET  → ASSET_ALLOCATION into p_asset_id, tagged.
-- remaining < 0: CYCLE  → OTHER allocation in the running cycle, tagged.
--                ASSET  → ASSET_RELEASE from p_asset_id, tagged.
-- remaining = 0: nothing is written; destination is recorded as NONE.
create or replace function public.close_special_budget(
  p_household_id uuid,
  p_budget_id uuid,
  p_expected_remaining bigint,
  p_destination text,
  p_cycle_id uuid,
  p_account_id uuid,
  p_asset_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_budget public.special_budgets%rowtype;
  v_cycle public.cycles%rowtype;
  v_remaining bigint;
  v_destination text;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Bukan anggota keluarga ini.';
  end if;

  select * into v_budget from public.special_budgets
   where id = p_budget_id and household_id = p_household_id for update;
  if not found then raise exception 'Anggaran khusus tidak ditemukan.'; end if;
  if v_budget.closed_at is not null then
    raise exception 'Anggaran khusus "%" sudah ditutup.', v_budget.name;
  end if;

  v_remaining := public.special_budget_remaining(p_budget_id);
  if p_expected_remaining is distinct from v_remaining then
    raise exception 'Angka anggaran khusus berubah. Muat ulang lalu coba lagi.';
  end if;

  if v_remaining = 0 then
    v_destination := 'NONE';
  else
    if p_destination not in ('CYCLE', 'ASSET') then
      raise exception 'Pilih ke mana sisa anggaran dipindahkan.';
    end if;
    v_destination := p_destination;
  end if;

  if v_destination = 'ASSET' or (v_destination = 'CYCLE' and v_remaining < 0) then
    if not exists (select 1 from public.accounts
                    where id = p_account_id and household_id = p_household_id
                      and is_active = true and type in ('BANK', 'E_WALLET')) then
      raise exception 'Pilih rekening bank atau e-wallet aktif.';
    end if;
    if p_cycle_id is not null then
      select * into v_cycle from public.cycles
       where id = p_cycle_id and household_id = p_household_id for share;
      if not found or v_cycle.cancelled_at is not null or v_cycle.closed_at is not null then
        raise exception 'Siklus tidak valid untuk penutupan ini.';
      end if;
    end if;
  end if;

  if v_destination = 'ASSET' then
    if not exists (select 1 from public.assets
                    where id = p_asset_id and household_id = p_household_id and is_active = true) then
      raise exception 'Pilih simpanan yang masih aktif.';
    end if;
    insert into public.transactions
      (household_id, cycle_id, name, direction, flow_type, planned_amount, actual_amount,
       status, release_date, account_id, asset_id, special_budget_id, created_by, executed_by)
    values
      (p_household_id, p_cycle_id,
       case when v_remaining > 0 then 'Sisa ' || v_budget.name
            else 'Tutup kekurangan ' || v_budget.name end,
       case when v_remaining > 0 then 'EXPENSE' else 'INCOME' end,
       case when v_remaining > 0 then 'ASSET_ALLOCATION' else 'ASSET_RELEASE' end,
       abs(v_remaining), abs(v_remaining), 'PAID', current_date,
       p_account_id, p_asset_id, p_budget_id, v_uid, v_uid);
  elsif v_destination = 'CYCLE' and v_remaining < 0 then
    if p_cycle_id is null or v_cycle.is_active is distinct from true then
      raise exception 'Kekurangan hanya dapat ditutup dari siklus yang sedang berjalan.';
    end if;
    insert into public.cycle_allocations
      (household_id, cycle_id, allocation_type, amount, account_id, special_budget_id, note, created_by)
    values
      (p_household_id, p_cycle_id, 'OTHER', -v_remaining, p_account_id, p_budget_id,
       'Tutup kekurangan anggaran khusus: ' || v_budget.name, v_uid);
  end if;

  update public.special_budgets
     set closed_at = now(), closed_by = v_uid,
         close_destination = v_destination, closed_remaining = v_remaining
   where id = p_budget_id;

  return v_remaining;
end;
$$;

grant execute on function public.close_special_budget(uuid, uuid, bigint, text, uuid, uuid, uuid) to authenticated;

-- ============ 8. Realtime (one table per statement) ==========
-- realtime_health() keeps the target set owned by 003, as 014 does.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.special_budgets';
      raise notice 'realtime: special_budgets added to publication';
    exception when duplicate_object then
      raise notice 'realtime: special_budgets already registered (skipped)';
    end;
  else
    raise notice 'realtime: publication supabase_realtime missing; skipping special_budgets (verify via dashboard)';
  end if;
end;
$$;

alter table public.special_budgets replica identity full;

-- Manual verification (SQL Editor, first run):
--
-- 1. Table, columns and guards exist:
--   select column_name from information_schema.columns
--    where table_name in ('transactions', 'cycle_allocations') and column_name = 'special_budget_id';
--   select tgname from pg_trigger where tgname in (
--     'trg_guard_special_budget_write', 'trg_guard_transaction_special_budget',
--     'trg_guard_allocation_special_budget');
--   -- expected: two columns, three triggers.
--
-- 2. Realtime registration:
--   select pt.tablename, c.relreplident::text
--     from pg_publication_tables pt
--     join pg_class c on c.relname = pt.tablename and c.relnamespace = 'public'::regnamespace
--    where pt.pubname = 'supabase_realtime' and pt.tablename = 'special_budgets';
--   -- expected: one row, 'f'.
--
-- 3. Guards (run as an authenticated member through the app or with
--    `set role authenticated` plus a JWT claim; as postgres they are bypassed):
--   -- a PENDING row cannot be tagged → 'Hanya transaksi yang sudah terjadi …'
--   -- a DEBT_PAYMENT row cannot be tagged → 'Pembayaran tanggungan …'
--   -- a credit-card row cannot be tagged → 'Anggaran khusus hanya untuk …'
--   -- setting closed_at directly → 'Tutup anggaran khusus melalui alur penutupan.'
--
-- 4. Remaining matches the app for every open budget:
--   select b.name, public.special_budget_remaining(b.id) as remaining
--     from public.special_budgets b where b.closed_at is null;
--
-- 5. Cycle zero-based is untouched by tagged rows — the cycle's source funds
--    must equal its untagged inflows only:
--   select t.cycle_id,
--          sum(t.actual_amount) filter (where t.special_budget_id is null) as cycle_inflow,
--          sum(t.actual_amount) filter (where t.special_budget_id is not null) as budget_inflow
--     from public.transactions t
--    where t.flow_type in ('OPERATING_INCOME', 'FINANCING_INFLOW', 'ASSET_RELEASE')
--      and t.status = 'PAID' and t.cancelled_at is null
--    group by t.cycle_id;
