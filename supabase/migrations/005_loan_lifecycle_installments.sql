-- Kitasaku 005: loan lifecycle — installments, interest, repayment method.
--
-- Phase 1 (migration 004) added the loan metadata columns and the
-- obligation_installments table but never populated them: the financing RPC
-- only accepted an amount and a due date, so a loan created through the app had
-- no repayment method, no interest, and an empty schedule. Phase 2B fills that
-- in without changing any existing column.
--
-- Sections:
--   1. create_financing_with_obligation v2 (installments, interest, method)
--   2. schedule_obligation_installments — reusable split of a repayment total
--   3. set_installment_cycle — attach a backlog installment to a cycle
--
-- Decisions recorded here (not silent assumptions):
--   - `total_amount` of a loan is the REPAYMENT total: principal + interest.
--     `remaining_amount` starts equal to it, so the existing progress/
--     allocation maths keeps working unchanged and a loan's real cost is what
--     the family owes.
--   - `planned_installment_amount` is COMPUTED, never supplied: accepting it
--     from the client would allow a stored value that disagrees with the
--     generated schedule. One source of truth.
--   - Rounding: integer division, and the remainder is spread one unit at a
--     time over the FIRST installments. Deterministic and order-stable; the
--     schedule always sums exactly to the repayment total.
--   - Installments are scheduled (cycle_id set) only when their due date falls
--     inside the given cycle. A loan with a grace period therefore starts as
--     backlog, which is exactly what cycle_id-null means in 004.
--
-- Does NOT modify existing columns, existing rows, or realtime_health().

-- ============ 1. create_financing_with_obligation v2 ============
-- The signature changes, so the v1 function must be dropped rather than
-- replaced — `create or replace` would silently leave the 8-arg overload
-- callable and the app would keep hitting the version without metadata.
drop function if exists public.create_financing_with_obligation(uuid, uuid, bigint, text, text, text, uuid, date);

create or replace function public.create_financing_with_obligation(
  p_household_id uuid,
  p_cycle_id uuid,
  p_amount bigint,
  p_name text,
  p_obligation_title text,
  p_obligation_type text,
  p_account_id uuid,
  p_due_date date,
  p_repayment_method text default null,
  p_installment_count int default null,
  p_start_date date default null,
  p_interest_fee_amount bigint default 0
)
returns table (
  transaction_id uuid,
  obligation_id uuid,
  installment_count int,
  total_repayment bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn_id uuid;
  v_obligation_id uuid;
  v_uid uuid := auth.uid();
  v_interest bigint := coalesce(p_interest_fee_amount, 0);
  v_total bigint;
  v_count int;
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
  if v_interest < 0 then
    raise exception 'Bunga/biaya tidak boleh negatif.';
  end if;
  if p_obligation_type not in ('BILL', 'LOAN', 'REIMBURSEMENT', 'INSTALLMENT') then
    raise exception 'Unknown obligation type %', p_obligation_type;
  end if;
  if p_installment_count is not null and (p_installment_count < 1 or p_installment_count > 600) then
    raise exception 'Jumlah angsuran harus antara 1 dan 600.';
  end if;

  v_total := p_amount + v_interest;
  -- An installment schedule of zero rupiah is not a schedule; refuse rather
  -- than write rows that violate planned_amount > 0.
  if p_installment_count is not null and v_total < p_installment_count then
    raise exception 'Total pembiayaan terlalu kecil untuk % angsuran.', p_installment_count;
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
    status, due_date, source_transaction_id,
    repayment_method, planned_installment_amount, installment_count,
    current_installment, start_date, interest_fee_amount
  ) values (
    p_household_id, p_obligation_title, p_obligation_type, v_total, v_total,
    'OPEN', p_due_date, v_txn_id,
    p_repayment_method,
    case when p_installment_count is null then null else v_total / p_installment_count end,
    p_installment_count,
    case when p_installment_count is null then null else 1 end,
    p_start_date, v_interest
  ) returning id into v_obligation_id;

  v_count := p_installment_count;
  if v_count is not null then
    -- Reuses the same splitter the standalone RPC uses, so a loan created here
    -- and one scheduled later produce byte-identical schedules.
    select count(*) into v_count
      from public.schedule_obligation_installments(
        p_household_id, v_obligation_id, p_cycle_id, v_total, p_installment_count, p_start_date
      );
  end if;

  return query select v_txn_id, v_obligation_id, v_count, v_total;
end;
$$;

-- ============ 2. schedule_obligation_installments ============
-- Splits `p_total` into `p_count` rows one month apart from `p_start_date`,
-- spreading the integer-division remainder over the first installments.
-- Idempotent in the sense that it refuses to double-schedule: an obligation
-- that already has rows is returned as-is rather than appended to.
create or replace function public.schedule_obligation_installments(
  p_household_id uuid,
  p_obligation_id uuid,
  p_cycle_id uuid,
  p_total bigint,
  p_count int,
  p_start_date date
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_base bigint;
  v_remainder bigint;
  v_amount bigint;
  v_due date;
  v_cycle uuid;
  v_cycle_start date;
  v_cycle_end date;
  v_id uuid;
  i int;
  v_obligation_household uuid;
begin
  if not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = v_uid
  ) then
    raise exception 'Not a member of household %', p_household_id;
  end if;
  if p_count is null or p_count < 1 or p_count > 600 then
    raise exception 'Jumlah angsuran harus antara 1 dan 600.';
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'Total pembiayaan harus lebih dari 0.';
  end if;
  if p_total < p_count then
    raise exception 'Total pembiayaan terlalu kecil untuk % angsuran.', p_count;
  end if;

  select household_id into v_obligation_household
    from public.obligations where id = p_obligation_id;
  if v_obligation_household is null then
    raise exception 'Obligation % not found', p_obligation_id;
  end if;
  if v_obligation_household <> p_household_id then
    raise exception 'Obligation % does not belong to household %', p_obligation_id, p_household_id;
  end if;

  -- Already scheduled: return the existing rows instead of duplicating them.
  if exists (select 1 from public.obligation_installments where obligation_id = p_obligation_id) then
    return query select i.id from public.obligation_installments i
      where i.obligation_id = p_obligation_id order by i.due_date nulls last;
    return;
  end if;

  -- Cycle window, used to decide which installments land in the given cycle.
  if p_cycle_id is not null then
    select start_date, end_date into v_cycle_start, v_cycle_end
      from public.cycles where id = p_cycle_id and household_id = p_household_id;
  end if;

  v_base := p_total / p_count;
  v_remainder := p_total - (v_base * p_count);
  v_due := coalesce(p_start_date, CURRENT_DATE);

  for i in 1..p_count loop
    -- Remainder goes to the earliest installments, one unit each.
    v_amount := v_base + case when i <= v_remainder then 1 else 0 end;

    v_cycle := null;
    if v_cycle_start is not null
       and v_due >= v_cycle_start
       and v_due <= v_cycle_end then
      v_cycle := p_cycle_id;
    end if;

    insert into public.obligation_installments (
      household_id, obligation_id, cycle_id, planned_amount, due_date, status
    ) values (
      p_household_id, p_obligation_id, v_cycle, v_amount, v_due, 'OPEN'
    ) returning id into v_id;

    return next v_id;
    v_due := (v_due + interval '1 month')::date;
  end loop;
end;
$$;

-- ============ 3. set_installment_cycle ============
-- Attaching a backlog installment (cycle_id null) to a cycle is how the plan
-- pulls last month's unpaid installment into this cycle. Kept as its own RPC so
-- the client never has to write obligation_installments directly and the
-- household check happens in one place.
create or replace function public.set_installment_cycle(
  p_household_id uuid,
  p_installment_id uuid,
  p_cycle_id uuid
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
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = v_uid
  ) then
    raise exception 'Not a member of household %', p_household_id;
  end if;
  if not exists (
    select 1 from public.obligation_installments i
    where i.id = p_installment_id and i.household_id = p_household_id
  ) then
    raise exception 'Installment % not found in household %', p_installment_id, p_household_id;
  end if;
  if p_cycle_id is not null and not exists (
    select 1 from public.cycles c
    where c.id = p_cycle_id and c.household_id = p_household_id
  ) then
    raise exception 'Cycle % does not belong to household %', p_cycle_id, p_household_id;
  end if;

  update public.obligation_installments
    set cycle_id = p_cycle_id
    where id = p_installment_id;
end;
$$;

grant execute on function public.create_financing_with_obligation(uuid, uuid, bigint, text, text, text, uuid, date, text, int, date, bigint) to authenticated;
grant execute on function public.schedule_obligation_installments(uuid, uuid, uuid, bigint, int, date) to authenticated;
grant execute on function public.set_installment_cycle(uuid, uuid, uuid) to authenticated;

-- Manual verification (SQL Editor, first run):
--   -- 1. A 12jt loan over 12 months with 2jt interest yields one INCOME row,
--   --    an obligation totalling 14jt, and 12 installments summing to 14jt.
--   select * from create_financing_with_obligation(
--     '<household>', '<cycle>', 12000000, 'Pinjaman Bank', 'Pinjaman Bank', 'LOAN',
--     null, null, 'TRANSFER', 12, CURRENT_DATE, 2000000);
--   select count(*), sum(planned_amount) from obligation_installments
--     where obligation_id = '<obligation>';   -- expect 12, 14000000
