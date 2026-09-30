-- Executed debt payments must always identify the active cash account that
-- moved the money. Planning rows remain nullable; this applies only to the
-- atomic path that writes a PAID transaction and its allocation.
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
