-- Kitasaku 017: allow Quick Add to preserve the transaction date.
-- The date belongs to the executed transaction, not the date it was entered.

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
  p_interest_fee_amount bigint default 0,
  p_release_date date default null
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
  if p_installment_count is not null and v_total < p_installment_count then
    raise exception 'Total pembiayaan terlalu kecil untuk % angsuran.', p_installment_count;
  end if;

  insert into public.transactions (
    household_id, cycle_id, name, direction, flow_type,
    planned_amount, actual_amount, status, release_date,
    account_id, created_by, executed_by
  ) values (
    p_household_id, p_cycle_id, p_name, 'INCOME', 'FINANCING_INFLOW',
    p_amount, p_amount, 'PAID', coalesce(p_release_date, current_date),
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
    select count(*) into v_count
      from public.schedule_obligation_installments(
        p_household_id, v_obligation_id, p_cycle_id, v_total, p_installment_count, p_start_date
      );
  end if;

  return query select v_txn_id, v_obligation_id, v_count, v_total;
end;
$$;

grant execute on function public.create_financing_with_obligation(
  uuid, uuid, bigint, text, text, text, uuid, date, text, int, date, bigint, date
) to authenticated;
