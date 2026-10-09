-- Kitasaku 028: cycle-bound rows use cash accounts only; other accounts are audit-only history.
-- Apply only after 001–027. Fully idempotent. Forward-only: existing rows are not rewritten,
-- except the cycle_allocations.transaction_id backfill (links only, no amounts change).
--
-- Rule: a transaction with cycle_id set, and every recurring template, may only reference an
-- account of type BANK or E_WALLET (or no account yet). CREDIT_CARD and CASH accounts are
-- recorded with cycle_id NULL: visible as history, never counted in source funds,
-- allocations, cashflow, reconciliation or sweep. See docs/phase-12 ("Kartu kredit").

-- ---------------------------------------------------------------------------
-- 1. Link each allocation to the planned transaction it commits.
-- ---------------------------------------------------------------------------
-- cancel_pending_transaction (018) could only find the allocation of obligation rows, so a
-- cancelled PENDING EXPENSE left its allocation active and understated unallocated funds.

alter table public.cycle_allocations
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null;

-- Backfill: pair rows that share an identical key. Within a group of identical keys any
-- pairing is equivalent (same cycle, type, obligation, category, account, amount), so groups
-- are paired by row order when both sides have the same count. Other rows stay unlinked and
-- are listed by the verification queries at the end of this file.
with txn_keys as (
  select t.id, t.household_id, t.cycle_id,
    case when t.flow_type = 'DEBT_PAYMENT' then 'DEBT_PAYMENT' else 'EXPENSE' end as allocation_type,
    t.obligation_id, t.category_id, t.account_id, t.planned_amount as amount,
    (t.status = 'CANCELLED') as is_cancelled,
    row_number() over w as rn,
    count(*) over w_all as n
  from public.transactions t
  where t.cycle_id is not null
    and t.direction = 'EXPENSE'
    and t.flow_type in ('EXPENSE', 'DEBT_PAYMENT')
    and not exists (select 1 from public.cycle_allocations a where a.transaction_id = t.id)
  window w_all as (
    partition by t.household_id, t.cycle_id,
      case when t.flow_type = 'DEBT_PAYMENT' then 'DEBT_PAYMENT' else 'EXPENSE' end,
      t.obligation_id, t.category_id, t.account_id, t.planned_amount, (t.status = 'CANCELLED')
  ),
  w as (w_all order by t.created_at, t.id)
),
alloc_keys as (
  select a.id, a.household_id, a.cycle_id, a.allocation_type,
    a.obligation_id, a.category_id, a.account_id, a.amount,
    (a.cancelled_at is not null) as is_cancelled,
    row_number() over w as rn,
    count(*) over w_all as n
  from public.cycle_allocations a
  where a.transaction_id is null
    and a.allocation_type in ('EXPENSE', 'DEBT_PAYMENT')
  window w_all as (
    partition by a.household_id, a.cycle_id, a.allocation_type,
      a.obligation_id, a.category_id, a.account_id, a.amount, (a.cancelled_at is not null)
  ),
  w as (w_all order by a.created_at, a.id)
),
pairs as (
  select ak.id as allocation_id, tk.id as transaction_id
  from alloc_keys ak
  join txn_keys tk
    on tk.household_id = ak.household_id
   and tk.cycle_id = ak.cycle_id
   and tk.allocation_type = ak.allocation_type
   and tk.obligation_id is not distinct from ak.obligation_id
   and tk.category_id is not distinct from ak.category_id
   and tk.account_id is not distinct from ak.account_id
   and tk.amount = ak.amount
   and tk.is_cancelled = ak.is_cancelled
   and tk.n = ak.n
   and tk.rn = ak.rn
)
update public.cycle_allocations a
   set transaction_id = p.transaction_id
  from pairs p
 where a.id = p.allocation_id
   and a.transaction_id is null;

create index if not exists idx_cycle_allocations_transaction
  on public.cycle_allocations (transaction_id);
create unique index if not exists uq_cycle_allocations_live_transaction
  on public.cycle_allocations (transaction_id)
  where transaction_id is not null and cancelled_at is null;

create or replace function public.validate_cycle_allocation_transaction()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_household uuid;
  v_cycle uuid;
begin
  if new.transaction_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.transaction_id is not distinct from old.transaction_id
     and new.cycle_id is not distinct from old.cycle_id
     and new.household_id is not distinct from old.household_id then
    return new;
  end if;
  select household_id, cycle_id into v_household, v_cycle
    from public.transactions where id = new.transaction_id;
  if v_household is distinct from new.household_id or v_cycle is distinct from new.cycle_id then
    raise exception 'Alokasi harus merujuk transaksi pada siklus dan household yang sama.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_cycle_allocation_transaction on public.cycle_allocations;
create trigger trg_validate_cycle_allocation_transaction
  before insert or update of transaction_id, cycle_id, household_id on public.cycle_allocations
  for each row execute function public.validate_cycle_allocation_transaction();

-- ---------------------------------------------------------------------------
-- 2. Guards: cycle rows and templates only use BANK / E_WALLET.
-- ---------------------------------------------------------------------------
-- Checked on insert and when cycle_id/account_id actually change, so unrelated edits to
-- legacy rows (for example renaming a PENDING row planned on a credit card) still work.

create or replace function public.guard_cycle_transaction_account()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_type text;
begin
  if tg_op = 'UPDATE'
     and new.cycle_id is not distinct from old.cycle_id
     and new.account_id is not distinct from old.account_id then
    return new;
  end if;
  if new.cycle_id is null or new.account_id is null then
    return new;
  end if;
  select type into v_type from public.accounts where id = new.account_id;
  if v_type is not null and v_type not in ('BANK', 'E_WALLET') then
    raise exception 'Akun kartu kredit atau tunai hanya bisa dipakai untuk transaksi di luar siklus.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_cycle_transaction_account on public.transactions;
create trigger trg_guard_cycle_transaction_account
  before insert or update of cycle_id, account_id on public.transactions
  for each row execute function public.guard_cycle_transaction_account();

create or replace function public.guard_template_account()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_type text;
begin
  if tg_op = 'UPDATE' and new.account_id is not distinct from old.account_id then
    return new;
  end if;
  if new.account_id is null then
    return new;
  end if;
  select type into v_type from public.accounts where id = new.account_id;
  if v_type is not null and v_type not in ('BANK', 'E_WALLET') then
    raise exception 'Template rutin hanya bisa memakai rekening bank atau e-wallet.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_template_account on public.recurring_templates;
create trigger trg_guard_template_account
  before insert or update of account_id on public.recurring_templates
  for each row execute function public.guard_template_account();

-- ---------------------------------------------------------------------------
-- 3. One internal path to close a PENDING row and release its allocation.
-- ---------------------------------------------------------------------------
-- Not callable by clients: only the SECURITY DEFINER RPCs below use it, after their own
-- membership check.

create or replace function public.release_pending_transaction(
  p_household_id uuid,
  p_transaction_id uuid,
  p_reason text,
  p_note text,
  p_uid uuid
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_txn public.transactions%rowtype;
  v_linked integer;
  v_allocation_id uuid;
begin
  select * into v_txn from public.transactions where id = p_transaction_id for update;
  if not found then raise exception 'Transaksi tidak ditemukan.'; end if;
  if v_txn.household_id <> p_household_id then raise exception 'Transaksi bukan milik household ini.'; end if;
  if v_txn.status <> 'PENDING' then
    raise exception 'Hanya transaksi yang belum dieksekusi yang dapat dibatalkan.';
  end if;

  update public.cycle_allocations
     set cancelled_at = now(), cancelled_by = p_uid, cancellation_reason = p_reason
   where household_id = p_household_id
     and transaction_id = p_transaction_id
     and cancelled_at is null;
  get diagnostics v_linked = row_count;

  -- Legacy rows written before 028 carry no transaction_id. Fall back to an identical
  -- commitment: obligation rows by obligation + amount (as 018 did), other rows by
  -- category + account + amount. Identical commitments are interchangeable, so the oldest
  -- one is released and linked for audit.
  if v_linked = 0 and v_txn.cycle_id is not null and v_txn.direction = 'EXPENSE'
     and v_txn.flow_type in ('EXPENSE', 'DEBT_PAYMENT') then
    select a.id into v_allocation_id
      from public.cycle_allocations a
     where a.household_id = p_household_id
       and a.cycle_id = v_txn.cycle_id
       and a.transaction_id is null
       and a.cancelled_at is null
       and a.allocation_type = case when v_txn.flow_type = 'DEBT_PAYMENT' then 'DEBT_PAYMENT' else 'EXPENSE' end
       and a.obligation_id is not distinct from v_txn.obligation_id
       and a.amount = v_txn.planned_amount
       and (v_txn.obligation_id is not null
            or (a.category_id is not distinct from v_txn.category_id
                and a.account_id is not distinct from v_txn.account_id))
     order by a.created_at, a.id
     limit 1
     for update;
    if found then
      update public.cycle_allocations
         set cancelled_at = now(), cancelled_by = p_uid, cancellation_reason = p_reason,
             transaction_id = p_transaction_id
       where id = v_allocation_id;
    end if;
  end if;

  update public.transactions
     set status = 'CANCELLED', cancelled_at = now(), cancelled_by = p_uid,
         cancellation_reason = p_reason, cancellation_note = nullif(trim(p_note), '')
   where id = p_transaction_id;
end;
$$;

revoke all on function public.release_pending_transaction(uuid, uuid, text, text, uuid) from public;
revoke all on function public.release_pending_transaction(uuid, uuid, text, text, uuid) from anon, authenticated;

create or replace function public.cancel_pending_transaction(
  p_household_id uuid,
  p_transaction_id uuid,
  p_reason text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = v_uid
  ) then
    raise exception 'Not a member of household %', p_household_id;
  end if;
  if coalesce(trim(p_reason), '') not in ('WRONG_INPUT', 'DUPLICATE', 'NOT_HAPPENED', 'OTHER') then
    raise exception 'Alasan pembatalan tidak dikenal.';
  end if;
  if length(coalesce(trim(p_note), '')) > 500 then
    raise exception 'Catatan pembatalan maksimal 500 karakter.';
  end if;
  perform public.release_pending_transaction(p_household_id, p_transaction_id, trim(p_reason), p_note, v_uid);
end;
$$;

grant execute on function public.cancel_pending_transaction(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Settle a PENDING plan outside the cycle (credit card / cash).
-- ---------------------------------------------------------------------------
-- Audit-preserving: the planned row is cancelled (reason PAID_OUTSIDE_CYCLE) together with
-- its allocation, and a new PAID row with cycle_id NULL records what actually happened.

alter table public.transactions
  add column if not exists replaces_transaction_id uuid references public.transactions(id) on delete set null;

create index if not exists idx_transactions_replaces
  on public.transactions (replaces_transaction_id) where replaces_transaction_id is not null;

create or replace function public.settle_pending_outside_cycle(
  p_household_id uuid,
  p_transaction_id uuid,
  p_account_id uuid,
  p_actual_amount bigint,
  p_release_date date,
  p_is_final boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_txn public.transactions%rowtype;
  v_account_type text;
  v_account_active boolean;
  v_new_id uuid;
begin
  if not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = v_uid
  ) then
    raise exception 'Not a member of household %', p_household_id;
  end if;
  if p_actual_amount is null or p_actual_amount <= 0 then
    raise exception 'Nominal pembayaran harus lebih dari 0.';
  end if;
  if p_release_date is null or p_release_date > current_date then
    raise exception 'Tanggal transaksi tidak boleh di masa depan.';
  end if;

  select type, is_active into v_account_type, v_account_active
    from public.accounts
   where id = p_account_id and household_id = p_household_id;
  if not found or v_account_active is distinct from true then
    raise exception 'Pilih akun aktif milik household ini.';
  end if;
  if v_account_type in ('BANK', 'E_WALLET') then
    raise exception 'Rekening bank atau e-wallet dicatat lewat Konfirmasi & Bayar, bukan di luar siklus.';
  end if;

  select * into v_txn
    from public.transactions
   where id = p_transaction_id and household_id = p_household_id
   for update;
  if not found then raise exception 'Transaksi tidak ditemukan.'; end if;
  if v_txn.status <> 'PENDING' then
    raise exception 'Transaksi ini sudah diproses. Muat ulang sebelum mencoba lagi.';
  end if;
  if v_txn.cycle_id is null then
    raise exception 'Transaksi ini sudah berada di luar siklus.';
  end if;
  if v_txn.obligation_id is not null or v_txn.flow_type <> 'EXPENSE' or v_txn.direction <> 'EXPENSE' then
    raise exception 'Hanya pengeluaran biasa yang bisa dicatat di luar siklus. Pembayaran tanggungan harus memakai rekening bank atau e-wallet.';
  end if;

  perform public.release_pending_transaction(
    p_household_id, p_transaction_id, 'PAID_OUTSIDE_CYCLE', 'Dibayar di luar siklus', v_uid);

  insert into public.transactions (household_id, cycle_id, name, direction, flow_type,
    planned_amount, actual_amount, status, release_date, category_id, account_id,
    replaces_transaction_id, created_by, executed_by)
  values (p_household_id, null, v_txn.name, 'EXPENSE', 'EXPENSE',
    p_actual_amount, p_actual_amount, 'PAID', p_release_date, v_txn.category_id, p_account_id,
    p_transaction_id, v_uid, v_uid)
  returning id into v_new_id;

  if coalesce(p_is_final, false) and v_txn.recurring_template_id is not null then
    update public.recurring_templates
       set status = 'COMPLETED'
     where id = v_txn.recurring_template_id
       and household_id = p_household_id;
  end if;

  return v_new_id;
end;
$$;

revoke all on function public.settle_pending_outside_cycle(uuid, uuid, uuid, bigint, date, boolean) from public;
grant execute on function public.settle_pending_outside_cycle(uuid, uuid, uuid, bigint, date, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A PENDING plan on a credit card / cash account cannot be executed as a
--    cash movement.
-- ---------------------------------------------------------------------------
-- Sections 2-4 close the paths that create such a row, but legacy plans made
-- before 028 are left alive on purpose. execute_planned_transaction sets
-- account_id = p_account_id, so executing one of those silently rewrote the row
-- to a bank account: the money never left the bank, yet the cycle counted it.
-- Redefined from 024 with that one guard added; the rest of the body is
-- unchanged.

create or replace function public.execute_planned_transaction(
  p_household_id uuid,
  p_transaction_id uuid,
  p_actual_amount bigint,
  p_account_id uuid,
  p_release_date date,
  p_is_final boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_txn public.transactions%rowtype;
  v_account_type text;
  v_account_active boolean;
  v_plan_account_type text;
  v_remaining bigint;
  v_obligation_status text;
  v_left bigint;
  v_paid bigint;
  v_planned bigint;
  v_installment_id uuid;
  v_has_installments boolean;
  v_installment_outstanding bigint;
begin
  if not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = v_uid
  ) then
    raise exception 'Not a member of household %', p_household_id;
  end if;
  if p_actual_amount is null or p_actual_amount <= 0 then
    raise exception 'Nominal pembayaran harus lebih dari 0.';
  end if;
  if p_account_id is null then
    raise exception 'Pilih rekening bank atau e-wallet aktif untuk transaksi ini.';
  end if;
  if p_release_date is null or p_release_date > current_date then
    raise exception 'Tanggal transaksi tidak boleh di masa depan.';
  end if;

  select type, is_active into v_account_type, v_account_active
    from public.accounts
   where id = p_account_id and household_id = p_household_id;
  if not found or v_account_active is distinct from true
     or v_account_type not in ('BANK', 'E_WALLET') then
    raise exception 'Transaksi hanya dapat dicatat pada rekening bank atau e-wallet aktif.';
  end if;

  select * into v_txn
    from public.transactions
   where id = p_transaction_id and household_id = p_household_id
   for update;
  if not found then raise exception 'Transaksi tidak ditemukan.'; end if;
  if v_txn.status <> 'PENDING' then
    raise exception 'Transaksi ini sudah diproses. Muat ulang sebelum mencoba lagi.';
  end if;

  -- 028: the plan itself must sit on a cash account. This RPC overwrites
  -- account_id with p_account_id, so without this check a plan made on a
  -- credit card would silently be rebooked as money leaving the bank and the
  -- cycle would reconcile short by its amount. Settle it outside the cycle, or
  -- move the plan to a bank / e-wallet first if it was planned on the wrong
  -- account.
  if v_txn.cycle_id is not null and v_txn.account_id is not null then
    select type into v_plan_account_type
      from public.accounts where id = v_txn.account_id;
    if v_plan_account_type is not null and v_plan_account_type not in ('BANK', 'E_WALLET') then
      raise exception 'Rencana ini memakai kartu kredit atau tunai. Catat di luar siklus, atau ubah akun rencana ke rekening bank/e-wallet lebih dulu.';
    end if;
  end if;
  if v_txn.flow_type = 'DEBT_PAYMENT' then
    if v_txn.direction <> 'EXPENSE' or v_txn.obligation_id is null then
      raise exception 'Transaksi pembayaran tanggungan tidak memiliki referensi yang valid.';
    end if;
  elsif v_txn.obligation_id is not null then
    raise exception 'Transaksi dengan tanggungan harus bertipe DEBT_PAYMENT.';
  end if;

  if v_txn.obligation_id is not null then
    select remaining_amount, status into v_remaining, v_obligation_status
      from public.obligations
     where id = v_txn.obligation_id and household_id = p_household_id
     for update;
    if not found then raise exception 'Tanggungan tidak ditemukan.'; end if;
    if v_obligation_status in ('CANCELLED', 'SETTLED') or v_remaining <= 0 then
      raise exception 'Tanggungan ini sudah selesai dan tidak dapat menerima pembayaran.';
    end if;
    if p_actual_amount > v_remaining then
      raise exception 'Nominal pembayaran melebihi sisa tanggungan.';
    end if;

    -- Serialize with the obligation lock and reject any amount that cannot be
    -- assigned to the outstanding schedule. paid_transaction_id is only the
    -- latest related pointer; paid_amount remains the cumulative progress.
    perform 1 from public.obligation_installments i
     where i.household_id = p_household_id
       and i.obligation_id = v_txn.obligation_id
       and i.status not in ('SETTLED', 'CANCELLED')
     for update;
    select exists (
      select 1 from public.obligation_installments i
       where i.household_id = p_household_id and i.obligation_id = v_txn.obligation_id
    ) into v_has_installments;
    if v_has_installments then
      select coalesce(sum(greatest(0, i.planned_amount - greatest(0, i.paid_amount))), 0)
        into v_installment_outstanding
        from public.obligation_installments i
       where i.household_id = p_household_id
         and i.obligation_id = v_txn.obligation_id
         and i.status not in ('SETTLED', 'CANCELLED');
      if p_actual_amount > v_installment_outstanding then
        raise exception 'Nominal pembayaran melebihi sisa jadwal cicilan.';
      end if;
    end if;
  end if;

  update public.transactions
     set status = 'PAID', actual_amount = p_actual_amount,
         release_date = p_release_date, executed_by = v_uid,
         account_id = p_account_id, is_final_payment = coalesce(p_is_final, false)
   where id = p_transaction_id;

  if v_txn.obligation_id is not null then
    v_left := p_actual_amount;
    for v_installment_id, v_paid, v_planned in
      select i.id, i.paid_amount, i.planned_amount
        from public.obligation_installments i
       where i.household_id = p_household_id
         and i.obligation_id = v_txn.obligation_id
         and i.status not in ('SETTLED', 'CANCELLED')
       order by i.due_date asc nulls last, i.created_at asc, i.id asc
       for update
    loop
      exit when v_left <= 0;
      v_paid := greatest(0, v_paid);
      update public.obligation_installments
         set paid_amount = least(v_planned, v_paid + v_left),
             paid_transaction_id = p_transaction_id,
             status = case when v_paid + v_left >= v_planned then 'SETTLED' else 'PARTIAL' end
       where id = v_installment_id;
      v_left := greatest(0, v_left - greatest(0, v_planned - v_paid));
    end loop;
    if v_left > 0 then
      raise exception 'Pembayaran tidak dapat dipetakan seluruhnya ke jadwal cicilan.';
    end if;

    update public.obligations
       set remaining_amount = greatest(0, v_remaining - p_actual_amount),
           status = case when greatest(0, v_remaining - p_actual_amount) <= 0 then 'SETTLED' else 'PARTIAL' end
     where id = v_txn.obligation_id;
  end if;

  if coalesce(p_is_final, false) and v_txn.recurring_template_id is not null then
    update public.recurring_templates
       set status = 'COMPLETED'
     where id = v_txn.recurring_template_id
       and household_id = p_household_id;
  end if;
end;
$$;

grant execute on function public.execute_planned_transaction(uuid, uuid, bigint, uuid, date, boolean) to authenticated;

-- Manual verification (SQL Editor, first run):
--
-- 1. Objects exist:
--   select proname from pg_proc
--    where proname in ('release_pending_transaction', 'settle_pending_outside_cycle',
--                      'guard_cycle_transaction_account', 'guard_template_account',
--                      'validate_cycle_allocation_transaction');   -- 5 rows
--   select has_function_privilege('authenticated',
--     'public.release_pending_transaction(uuid, uuid, text, text, uuid)', 'execute');  -- false
--
-- 2. Backfill coverage. Active planned rows in live cycles that are still unlinked:
--   select t.id, t.name, t.status, t.planned_amount, c.name as cycle
--     from public.transactions t join public.cycles c on c.id = t.cycle_id
--    where c.cancelled_at is null and c.closed_at is null
--      and t.status = 'PENDING' and t.direction = 'EXPENSE'
--      and t.flow_type in ('EXPENSE', 'DEBT_PAYMENT')
--      and not exists (select 1 from public.cycle_allocations a
--                       where a.transaction_id = t.id and a.cancelled_at is null);
--   Rows here are either quick-add plans (which never had an allocation) or rows whose
--   amount/account was edited after the cycle opened. Review them by hand.
--
-- 3. Allocations still active although their planned row was cancelled before 028
--    (the bug this migration fixes for future cancellations):
--   select a.id, a.cycle_id, a.allocation_type, a.amount, a.category_id, a.account_id
--     from public.cycle_allocations a join public.cycles c on c.id = a.cycle_id
--    where a.cancelled_at is null and a.transaction_id is null
--      and a.allocation_type = 'EXPENSE' and c.cancelled_at is null and c.closed_at is null;
--   For each one confirm whether it still belongs to a live plan before cancelling it.
--
-- 4. Legacy rows that break the new rule (left as-is; settle or re-plan them in the app):
--   select t.id, t.name, t.status, acc.name as account, acc.type
--     from public.transactions t join public.accounts acc on acc.id = t.account_id
--    where t.cycle_id is not null and t.status = 'PENDING' and acc.type not in ('BANK', 'E_WALLET');
--   select tpl.id, tpl.name, tpl.status, acc.name as account, acc.type
--     from public.recurring_templates tpl join public.accounts acc on acc.id = tpl.account_id
--    where acc.type not in ('BANK', 'E_WALLET');
--
-- 5. Guard fires (expect an exception, then nothing written):
--   insert into public.recurring_templates (household_id, name, direction, default_amount, account_id)
--   select a.household_id, 'test-028', 'EXPENSE', 1, a.id
--     from public.accounts a where a.type = 'CREDIT_CARD' limit 1;
--
-- 6. Executing a legacy plan that still sits on a credit card is refused
--    (expect the exception, then the row stays PENDING):
--   select public.execute_planned_transaction(
--     t.household_id, t.id, t.planned_amount,
--     (select a.id from public.accounts a
--       where a.household_id = t.household_id and a.type = 'BANK' and a.is_active limit 1),
--     current_date, false)
--     from public.transactions t join public.accounts acc on acc.id = t.account_id
--    where t.status = 'PENDING' and t.cycle_id is not null
--      and acc.type not in ('BANK', 'E_WALLET')
--    limit 1;
