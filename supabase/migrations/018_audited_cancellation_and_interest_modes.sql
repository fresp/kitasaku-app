-- Kitasaku 018: audited cancellation and explicit installment interest modes.
-- Never delete a money row from the product: cancellation keeps the original
-- record and records who cancelled it, why, and when.

-- The initial schema only allowed PENDING/PAID. Widen it before the RPCs below
-- write the audited terminal state; the catalog lookup keeps this safe if a later
-- migration has renamed the constraint.
do $$
declare
  r record;
  v_status_attnum smallint;
begin
  select attnum into v_status_attnum
    from pg_attribute
   where attrelid = 'public.transactions'::regclass
     and attname = 'status';
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.transactions'::regclass
       and c.contype = 'c'
       and v_status_attnum = any (c.conkey)
       and pg_get_constraintdef(c.oid) like '%PENDING%'
       and pg_get_constraintdef(c.oid) like '%PAID%'
  loop
    execute format('alter table public.transactions drop constraint %I', r.conname);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and conname = 'transactions_status_check'
  ) then
    alter table public.transactions
      add constraint transactions_status_check
      check (status in ('PENDING', 'PAID', 'CANCELLED'));
  end if;
end $$;

alter table public.transactions
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancellation_reason text,
  add column if not exists cancellation_note text;

-- Planned debt payments have a separate allocation row. Keep that commitment
-- row for audit, but give summaries an explicit inactive marker when its plan is
-- cancelled rather than mutating amount (amount must remain positive).
alter table public.cycle_allocations
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancellation_reason text;

alter table public.obligations
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancellation_reason text,
  add column if not exists cancellation_note text;

alter table public.obligations
  add column if not exists interest_mode text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.obligations'::regclass
      and conname = 'obligations_interest_mode_check'
  ) then
    alter table public.obligations
      add constraint obligations_interest_mode_check check (
        interest_mode is null
        or interest_mode in ('FIXED_INSTALLMENT', 'FLOATING_INTEREST')
      );
  end if;
end $$;

comment on column public.obligations.interest_mode is
  'Installment calculation: FIXED_INSTALLMENT or FLOATING_INTEREST (fixed principal plus monthly interest on remaining principal).';

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
  v_status text;
  v_household uuid;
  v_obligation_id uuid;
  v_cycle_id uuid;
  v_planned_amount bigint;
  v_allocation_count integer;
  v_allocation_id uuid;
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

  select household_id, status, obligation_id, cycle_id, planned_amount
    into v_household, v_status, v_obligation_id, v_cycle_id, v_planned_amount
    from public.transactions where id = p_transaction_id for update;
  if v_household is null then raise exception 'Transaksi tidak ditemukan.'; end if;
  if v_household <> p_household_id then raise exception 'Transaksi bukan milik household ini.'; end if;
  if v_status <> 'PENDING' then
    raise exception 'Hanya transaksi yang belum dieksekusi yang dapat dibatalkan.';
  end if;

  -- A planned obligation row also has a cycle allocation. Legacy schemas do
  -- not link the two rows directly, so only cancel a uniquely identifiable
  -- allocation; refusing an ambiguous match is safer than cancelling another
  -- commitment with the same amount.
  if v_obligation_id is not null and v_cycle_id is not null then
    select count(*) into v_allocation_count
      from public.cycle_allocations
     where household_id = p_household_id
       and cycle_id = v_cycle_id
       and obligation_id = v_obligation_id
       and amount = v_planned_amount
       and cancelled_at is null;
    if v_allocation_count > 1 then
      raise exception 'Alokasi transaksi tidak dapat diidentifikasi dengan aman.';
    end if;
    if v_allocation_count = 1 then
      select id into v_allocation_id
        from public.cycle_allocations
       where household_id = p_household_id
         and cycle_id = v_cycle_id
         and obligation_id = v_obligation_id
         and amount = v_planned_amount
         and cancelled_at is null
       for update;
      update public.cycle_allocations
         set cancelled_at = now(),
             cancelled_by = v_uid,
             cancellation_reason = trim(p_reason)
       where id = v_allocation_id;
    end if;
  end if;

  update public.transactions
    set status = 'CANCELLED', cancelled_at = now(), cancelled_by = v_uid,
        cancellation_reason = trim(p_reason), cancellation_note = nullif(trim(p_note), '')
    where id = p_transaction_id;
end;
$$;

create or replace function public.cancel_obligation(
  p_household_id uuid,
  p_obligation_id uuid,
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
  v_household uuid;
  v_status text;
  v_remaining bigint;
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

  select household_id, status, remaining_amount into v_household, v_status, v_remaining
    from public.obligations where id = p_obligation_id for update;
  if v_household is null then raise exception 'Tanggungan tidak ditemukan.'; end if;
  if v_household <> p_household_id then raise exception 'Tanggungan bukan milik household ini.'; end if;
  if v_status in ('SETTLED', 'CANCELLED') then raise exception 'Tanggungan ini sudah selesai.'; end if;
  if coalesce(v_remaining, 0) < coalesce((select total_amount from public.obligations where id = p_obligation_id), 0)
     or exists (
       select 1 from public.transactions t
        where t.obligation_id = p_obligation_id
          and t.status in ('PENDING', 'PAID')
     ) then
    raise exception 'Tanggungan yang sudah memiliki pembayaran atau rencana pembayaran tidak dapat dibatalkan dari sini.';
  end if;

  update public.obligations
    set status = 'CANCELLED', cancelled_at = now(), cancelled_by = v_uid,
        cancellation_reason = trim(p_reason), cancellation_note = nullif(trim(p_note), '')
    where id = p_obligation_id;

  -- Close any still-planned payment rows and their commitment rows together
  -- with the obligation. They remain available as audit history but cannot be
  -- executed after cancellation.
  update public.transactions
     set status = 'CANCELLED', cancelled_at = now(), cancelled_by = v_uid,
         cancellation_reason = trim(p_reason),
         cancellation_note = nullif(trim(p_note), '')
   where household_id = p_household_id
     and obligation_id = p_obligation_id
     and status = 'PENDING';

  update public.cycle_allocations
     set cancelled_at = now(), cancelled_by = v_uid,
         cancellation_reason = trim(p_reason)
   where household_id = p_household_id
     and obligation_id = p_obligation_id
     and cancelled_at is null;

  update public.obligation_installments
    set status = 'CANCELLED'
    where obligation_id = p_obligation_id and status not in ('SETTLED', 'CANCELLED');
end;
$$;

grant execute on function public.cancel_pending_transaction(uuid, uuid, text, text) to authenticated;
grant execute on function public.cancel_obligation(uuid, uuid, text, text) to authenticated;

-- Prevent stale clients and direct RPC callers from creating or executing a
-- payment after its obligation has been cancelled. Existing pending rows may
-- remain in the audit trail, but they can no longer move money.
create or replace function public.reject_cancelled_obligation_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.obligation_id is not null
     and new.status in ('PENDING', 'PAID')
     and exists (
       select 1 from public.obligations o
        where o.id = new.obligation_id
          and o.status = 'CANCELLED'
     ) then
    raise exception 'Tanggungan yang sudah dibatalkan tidak dapat menerima transaksi.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_cancelled_obligation_transaction on public.transactions;
create trigger trg_reject_cancelled_obligation_transaction
  before insert or update of obligation_id, status on public.transactions
  for each row execute function public.reject_cancelled_obligation_transaction();

create or replace function public.reject_cancelled_obligation_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.obligation_id is not null
     and exists (
       select 1 from public.obligations o
        where o.id = new.obligation_id
          and o.status = 'CANCELLED'
     ) then
    raise exception 'Tanggungan yang sudah dibatalkan tidak dapat dialokasikan.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_cancelled_obligation_allocation on public.cycle_allocations;
create trigger trg_reject_cancelled_obligation_allocation
  before insert or update of obligation_id on public.cycle_allocations
  for each row execute function public.reject_cancelled_obligation_allocation();

-- Re-define the one-shot payment RPC with the same public signature so it
-- refuses a cancelled obligation even when called outside the app.
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
  v_status text;
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

  select remaining_amount, title, status into v_remaining, v_title, v_status
    from public.obligations where id = p_obligation_id for update;
  if not found then
    raise exception 'Obligation % not found', p_obligation_id;
  end if;
  if (select household_id from public.obligations where id = p_obligation_id) <> p_household_id then
    raise exception 'Obligation % does not belong to household %', p_obligation_id, p_household_id;
  end if;
  if v_status in ('SETTLED', 'CANCELLED') then
    raise exception 'Tanggungan ini sudah selesai dan tidak dapat menerima pembayaran.';
  end if;
  if v_remaining <= 0 or p_amount > v_remaining then
    raise exception 'Nominal pembayaran melebihi sisa tanggungan.';
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

grant execute on function public.allocate_debt_payment(uuid, uuid, uuid, bigint, uuid) to authenticated;

-- Keep this migration safe to re-run: the trigger guards above are the
-- database-level protection; the RPC replacement is the atomic payment path.

