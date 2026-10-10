-- Kitasaku 030: paying a debt settles the instalment schedule with it.
-- Apply only after 001-029. Fully idempotent. No data is rewritten.
--
-- allocate_debt_payment (019) moved the money and reduced remaining_amount but
-- never touched obligation_installments, so a payment made from the obligation
-- screen left the schedule untouched: an obligation could read SETTLED while its
-- nine instalments still showed as open. execute_planned_transaction (024) has
-- always mapped a payment across the schedule; this gives the other path the
-- same behaviour, so "bayar tanggungan" means one thing wherever it is pressed.
--
-- The mapping: oldest open instalment first, each filled up to its planned
-- amount, status SETTLED when it is covered and PARTIAL when it is not. Two
-- differences from 024, both deliberate:
--
--   * It does not refuse a payment the schedule cannot absorb. 024 is executing
--     a plan whose amount was derived from the schedule, so a mismatch there is
--     a bug; here the amount is the person's own choice, and a schedule that
--     covers less than remaining_amount (interest booked outside it, a schedule
--     configured after the fact) is a reason to record the payment, not to
--     reject it.
--   * When the payment clears the obligation, every instalment still open is
--     closed with it. The debt is gone; a schedule outliving it would be a
--     reminder to pay something that no longer exists.
--
-- This is what lets the obligation screen offer "Lunasi sisa" truthfully.

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
  v_left bigint;
  v_paid bigint;
  v_planned bigint;
  v_installment_id uuid;
  v_new_remaining bigint;
  v_uid uuid := auth.uid();
  v_title text;
  v_status text;
  v_account_type text;
  v_account_active boolean;
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
  if p_account_id is null then
    raise exception 'Pilih rekening bank atau e-wallet untuk pembayaran.';
  end if;

  select type, is_active into v_account_type, v_account_active
    from public.accounts
    where id = p_account_id and household_id = p_household_id;
  if not found then
    raise exception 'Akun pembayaran tidak ditemukan pada household ini.';
  end if;
  if v_account_active is false or v_account_type not in ('BANK', 'E_WALLET') then
    raise exception 'Pembayaran hanya dapat dicatat pada rekening bank atau e-wallet aktif.';
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

  -- Serialize with the obligation lock: a second payment must see this one's
  -- effect on the schedule rather than racing against a stale snapshot.
  perform 1 from public.obligation_installments i
   where i.household_id = p_household_id
     and i.obligation_id = p_obligation_id
     and i.status not in ('SETTLED', 'CANCELLED')
   for update;

  insert into public.transactions (
    household_id, cycle_id, obligation_id, name, direction, flow_type,
    planned_amount, actual_amount, status, release_date,
    account_id, created_by, executed_by
  ) values (
    p_household_id, p_cycle_id, p_obligation_id, v_title, 'EXPENSE', 'DEBT_PAYMENT',
    p_amount, p_amount, 'PAID', CURRENT_DATE,
    p_account_id, v_uid, v_uid
  ) returning id into v_txn_id;

  v_new_remaining := greatest(0, v_remaining - p_amount);

  update public.obligations
    set remaining_amount = v_new_remaining,
        status = case when v_new_remaining <= 0 then 'SETTLED' else 'PARTIAL' end
    where id = p_obligation_id;

  -- Oldest open instalment first.
  v_left := p_amount;
  for v_installment_id, v_paid, v_planned in
    select i.id, i.paid_amount, i.planned_amount
      from public.obligation_installments i
     where i.household_id = p_household_id
       and i.obligation_id = p_obligation_id
       and i.status not in ('SETTLED', 'CANCELLED')
     order by i.due_date asc nulls last, i.created_at asc, i.id asc
  loop
    exit when v_left <= 0;
    v_paid := greatest(0, v_paid);
    update public.obligation_installments
       set paid_amount = least(v_planned, v_paid + v_left),
           paid_transaction_id = v_txn_id,
           status = case when v_paid + v_left >= v_planned then 'SETTLED' else 'PARTIAL' end
     where id = v_installment_id;
    v_left := greatest(0, v_left - greatest(0, v_planned - v_paid));
  end loop;

  -- The debt is gone, so nothing in the schedule is still owed.
  if v_new_remaining <= 0 then
    update public.obligation_installments
       set paid_amount = planned_amount,
           paid_transaction_id = coalesce(paid_transaction_id, v_txn_id),
           status = 'SETTLED'
     where household_id = p_household_id
       and obligation_id = p_obligation_id
       and status not in ('SETTLED', 'CANCELLED');
  end if;

  insert into public.cycle_allocations (
    household_id, cycle_id, allocation_type, amount,
    obligation_id, account_id, created_by, transaction_id
  ) values (
    p_household_id, p_cycle_id, 'DEBT_PAYMENT', p_amount,
    p_obligation_id, p_account_id, v_uid, v_txn_id
  ) returning id into v_allocation_id;

  return query select v_txn_id, v_allocation_id;
end;
$$;

grant execute on function public.allocate_debt_payment(uuid, uuid, uuid, bigint, uuid) to authenticated;

-- Manual verification (SQL Editor, first run):
--
-- 1. Obligations whose schedule already disagrees with them, left by payments
--    made through 019 before this migration. These are NOT repaired here:
--    re-running the payment is not possible, so decide per row whether to close
--    the leftover instalments by hand.
--   select o.id, o.title, o.status, o.remaining_amount,
--          count(*) filter (where i.status not in ('SETTLED', 'CANCELLED')) as cicilan_terbuka
--     from public.obligations o
--     join public.obligation_installments i on i.obligation_id = o.id
--    where o.status in ('SETTLED', 'PARTIAL')
--    group by o.id, o.title, o.status, o.remaining_amount
--   having count(*) filter (where i.status not in ('SETTLED', 'CANCELLED')) > 0
--      and (o.status = 'SETTLED' or o.remaining_amount = 0);
--
-- 2. A part payment maps to the oldest open instalment and nothing else
--    (expect one PARTIAL or SETTLED row, then roll back):
--   begin;
--   select * from public.allocate_debt_payment(
--     '<household>', '<cycle>', '<obligation>', 100000, '<bank account>');
--   select id, due_date, planned_amount, paid_amount, status
--     from public.obligation_installments
--    where obligation_id = '<obligation>' order by due_date;
--   rollback;
--
-- 3. Paying the whole remaining closes the obligation AND every instalment:
--   begin;
--   select * from public.allocate_debt_payment(
--     '<household>', '<cycle>', '<obligation>',
--     (select remaining_amount from public.obligations where id = '<obligation>'),
--     '<bank account>');
--   select status, count(*) from public.obligation_installments
--    where obligation_id = '<obligation>' group by status;   -- SETTLED only
--   select status, remaining_amount from public.obligations where id = '<obligation>';
--   rollback;
