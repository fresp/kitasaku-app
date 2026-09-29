-- Kitasaku 019: deterministic fixed and floating installment schedules.
-- Existing financing RPC signatures remain available for older clients. The new
-- overload accepts an explicit schedule mode and monthly rate in basis points.

alter table public.obligations
  add column if not exists interest_rate_bps integer not null default 0
    check (interest_rate_bps >= 0),
  add column if not exists principal_amount bigint
    check (principal_amount is null or principal_amount > 0);

alter table public.obligation_installments
  add column if not exists principal_amount bigint
    check (principal_amount is null or principal_amount > 0),
  add column if not exists interest_amount bigint not null default 0
    check (interest_amount >= 0),
  add column if not exists remaining_principal bigint
    check (remaining_principal is null or remaining_principal >= 0);

comment on column public.obligations.interest_rate_bps is
  'Monthly interest rate in basis points; 100 bps = 1 percent.';
comment on column public.obligation_installments.principal_amount is
  'Immutable principal snapshot for this scheduled installment.';
comment on column public.obligation_installments.interest_amount is
  'Immutable interest snapshot for this scheduled installment.';
comment on column public.obligation_installments.remaining_principal is
  'Principal remaining after this installment snapshot.';

-- New schedule writer. Fixed mode distributes principal plus the existing flat
-- fee evenly. Floating mode distributes principal evenly and calculates rounded
-- monthly interest from the opening balance of each period.
create or replace function public.schedule_obligation_installments_v2(
  p_household_id uuid,
  p_obligation_id uuid,
  p_cycle_id uuid,
  p_principal bigint,
  p_flat_interest bigint,
  p_count int,
  p_start_date date,
  p_interest_mode text,
  p_interest_rate_bps int
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_base_principal bigint;
  v_principal bigint;
  v_interest bigint;
  v_period_total bigint;
  v_remaining bigint;
  v_due date;
  v_cycle uuid;
  v_cycle_start date;
  v_cycle_end date;
  v_id uuid;
  i int;
  v_obligation_household uuid;
begin
  if not exists (select 1 from public.household_members m where m.household_id = p_household_id and m.user_id = v_uid) then
    raise exception 'Not a member of household %', p_household_id;
  end if;
  if p_principal is null or p_principal <= 0 then raise exception 'Pokok harus lebih dari 0.'; end if;
  if p_flat_interest is null or p_flat_interest < 0 then raise exception 'Bunga tetap tidak boleh negatif.'; end if;
  if p_count is null or p_count < 1 or p_count > 600 then raise exception 'Jumlah angsuran harus antara 1 dan 600.'; end if;
  if p_interest_mode not in ('FIXED_INSTALLMENT', 'FLOATING_INTEREST') then raise exception 'Mode bunga tidak dikenal.'; end if;
  if coalesce(p_interest_rate_bps, 0) < 0 then raise exception 'Bunga bulanan tidak boleh negatif.'; end if;

  select household_id into v_obligation_household from public.obligations where id = p_obligation_id;
  if v_obligation_household is null then raise exception 'Obligation % not found', p_obligation_id; end if;
  if v_obligation_household <> p_household_id then raise exception 'Obligation does not belong to household'; end if;
  if exists (select 1 from public.obligation_installments where obligation_id = p_obligation_id) then
    return query select id from public.obligation_installments where obligation_id = p_obligation_id order by due_date nulls last;
    return;
  end if;

  if p_cycle_id is not null then
    select start_date, end_date into v_cycle_start, v_cycle_end
      from public.cycles where id = p_cycle_id and household_id = p_household_id;
  end if;

  v_base_principal := p_principal / p_count;
  v_remaining := p_principal;
  v_due := coalesce(p_start_date, current_date);

  for i in 1..p_count loop
    v_principal := case when i = p_count then v_remaining else v_base_principal end;
    if p_interest_mode = 'FLOATING_INTEREST' then
      v_interest := floor((v_remaining * coalesce(p_interest_rate_bps, 0) + 5000)::numeric / 10000)::bigint;
    else
      -- Keep principal and flat interest as separate integer schedules. This
      -- avoids a negative interest snapshot when principal division has a
      -- remainder (for example 10,000 over 3 periods with no fee).
      v_interest := (p_flat_interest / p_count)
        + case when i <= (p_flat_interest - (p_flat_interest / p_count) * p_count) then 1 else 0 end;
    end if;
    v_remaining := v_remaining - v_principal;
    v_cycle := null;
    if v_cycle_start is not null and v_due between v_cycle_start and v_cycle_end then v_cycle := p_cycle_id; end if;

    insert into public.obligation_installments (
      household_id, obligation_id, cycle_id, planned_amount, principal_amount,
      interest_amount, remaining_principal, due_date, status
    ) values (
      p_household_id, p_obligation_id, v_cycle, v_principal + v_interest,
      v_principal, v_interest, v_remaining, v_due, 'OPEN'
    ) returning id into v_id;
    return next v_id;
    v_due := (v_due + interval '1 month')::date;
  end loop;
end;
$$;

drop function if exists public.create_financing_with_obligation(uuid, uuid, bigint, text, text, text, uuid, date, text, int, date, bigint, date);

create or replace function public.create_financing_with_obligation(
  p_household_id uuid, p_cycle_id uuid, p_amount bigint, p_name text,
  p_obligation_title text, p_obligation_type text, p_account_id uuid,
  p_due_date date, p_repayment_method text default null,
  p_installment_count int default null, p_start_date date default null,
  p_interest_fee_amount bigint default 0, p_release_date date default null,
  p_interest_mode text default null, p_interest_rate_bps int default 0
)
returns table (transaction_id uuid, obligation_id uuid, installment_count int, total_repayment bigint)
language plpgsql security definer set search_path = public
as $$
declare
  v_txn_id uuid; v_obligation_id uuid; v_uid uuid := auth.uid();
  v_mode text := coalesce(p_interest_mode, case when p_installment_count is null then null else 'FIXED_INSTALLMENT' end);
  v_interest bigint := coalesce(p_interest_fee_amount, 0); v_total bigint; v_count int;
begin
  if not exists (select 1 from public.household_members m where m.household_id = p_household_id and m.user_id = v_uid) then raise exception 'Not a member of household %', p_household_id; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Nominal pembiayaan harus lebih dari 0.'; end if;
  if v_interest < 0 or p_interest_rate_bps < 0 then raise exception 'Bunga tidak boleh negatif.'; end if;
  if p_obligation_type not in ('BILL', 'LOAN', 'REIMBURSEMENT', 'INSTALLMENT') then raise exception 'Unknown obligation type %', p_obligation_type; end if;
  if p_installment_count is not null and (p_installment_count < 1 or p_installment_count > 600) then raise exception 'Jumlah angsuran harus antara 1 dan 600.'; end if;
  if p_installment_count is not null and v_mode not in ('FIXED_INSTALLMENT', 'FLOATING_INTEREST') then raise exception 'Mode bunga tidak dikenal.'; end if;
  if p_installment_count is null then v_total := p_amount + v_interest; else
    if v_mode = 'FLOATING_INTEREST' then
      v_total := p_amount;
      -- Total with floating interest is calculated from the generated snapshots below.
    else v_total := p_amount + v_interest; end if;
  end if;

  insert into public.transactions (household_id, cycle_id, name, direction, flow_type, planned_amount, actual_amount, status, release_date, account_id, created_by, executed_by)
  values (p_household_id, p_cycle_id, p_name, 'INCOME', 'FINANCING_INFLOW', p_amount, p_amount, 'PAID', coalesce(p_release_date, current_date), p_account_id, v_uid, v_uid)
  returning id into v_txn_id;

  insert into public.obligations (household_id, title, type, total_amount, remaining_amount, status, due_date, source_transaction_id, repayment_method, planned_installment_amount, installment_count, current_installment, start_date, interest_fee_amount, interest_mode, interest_rate_bps, principal_amount)
  values (p_household_id, p_obligation_title, p_obligation_type, v_total, v_total, 'OPEN', p_due_date, v_txn_id, p_repayment_method,
    case when p_installment_count is null then null else v_total / p_installment_count end, p_installment_count,
    case when p_installment_count is null then null else 1 end, p_start_date, v_interest, v_mode, p_interest_rate_bps, p_amount)
  returning id into v_obligation_id;

  v_count := p_installment_count;
  if v_count is not null then
    select count(*) into v_count from public.schedule_obligation_installments_v2(
      p_household_id, v_obligation_id, p_cycle_id, p_amount, v_interest, p_installment_count,
      p_start_date, v_mode, p_interest_rate_bps);
    if v_mode = 'FLOATING_INTEREST' then
      select coalesce(sum(planned_amount), 0) into v_total from public.obligation_installments where obligation_id = v_obligation_id;
      update public.obligations set total_amount = v_total, remaining_amount = v_total,
        planned_installment_amount = (select planned_amount from public.obligation_installments where obligation_id = v_obligation_id order by due_date limit 1),
        interest_fee_amount = greatest(0, v_total - p_amount)
        where id = v_obligation_id;
    end if;
  end if;
  return query select v_txn_id, v_obligation_id, v_count, v_total;
end;
$$;

grant execute on function public.schedule_obligation_installments_v2(uuid, uuid, uuid, bigint, bigint, int, date, text, int) to authenticated;
grant execute on function public.create_financing_with_obligation(uuid, uuid, bigint, text, text, text, uuid, date, text, int, date, bigint, date, text, int) to authenticated;
