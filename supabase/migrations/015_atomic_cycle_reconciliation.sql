-- Kitasaku 015: atomic cycle reconciliation snapshot and adjustment.
-- The client passes the already-reviewed frozen figures; this function makes the
-- adjustment transaction, optional OTHER allocation, and snapshot one commit.

create or replace function public.record_cycle_reconciliation(
  p_household_id uuid,
  p_cycle_id uuid,
  p_account_id uuid,
  p_opening_stated bigint,
  p_closing_stated bigint,
  p_recorded_net bigint,
  p_delta bigint,
  p_category_id uuid
)
returns table (reconciliation_id uuid, adjustment_txn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_txn_id uuid := null;
  v_cycle_household uuid;
  v_account_household uuid;
  v_account_type text;
begin
  if not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = v_uid
  ) then
    raise exception 'Not a member of household %', p_household_id;
  end if;

  if p_closing_stated is null or p_closing_stated < 0 then
    raise exception 'Saldo akhir tidak boleh negatif.';
  end if;

  select c.household_id into v_cycle_household
    from public.cycles c where c.id = p_cycle_id;
  if v_cycle_household is null or v_cycle_household <> p_household_id then
    raise exception 'Cycle % does not belong to household %', p_cycle_id, p_household_id;
  end if;

  select a.household_id, a.type into v_account_household, v_account_type
    from public.accounts a where a.id = p_account_id;
  if v_account_household is null or v_account_household <> p_household_id then
    raise exception 'Account % does not belong to household %', p_account_id, p_household_id;
  end if;
  if v_account_type <> 'BANK' then
    raise exception 'Reconciliation account must be BANK.';
  end if;

  if exists (
    select 1 from public.cycle_reconciliations r where r.cycle_id = p_cycle_id
  ) then
    raise exception 'Siklus ini sudah direkonsiliasi.';
  end if;

  if exists (
    select 1
      from public.transactions t
     where t.household_id = p_household_id
       and t.cycle_id = p_cycle_id
       and t.status = 'PENDING'
  ) then
    raise exception 'Masih ada transaksi yang belum dieksekusi.';
  end if;

  if exists (
    select 1
      from public.transactions t
     where t.household_id = p_household_id
       and t.cycle_id = p_cycle_id
       and t.account_id is null
  ) then
    raise exception 'Masih ada transaksi tanpa akun.';
  end if;

  if p_delta <> 0 then
    if p_category_id is null then
      raise exception 'Kategori Tidak Terlacak belum tersedia.';
    end if;

    insert into public.transactions (
      household_id, cycle_id, name, category_id, account_id,
      direction, flow_type, planned_amount, actual_amount, status,
      release_date, created_by, executed_by
    ) values (
      p_household_id, p_cycle_id, 'Penyesuaian Saldo', p_category_id, p_account_id,
      case when p_delta < 0 then 'EXPENSE' else 'INCOME' end,
      case when p_delta < 0 then 'EXPENSE' else 'OPERATING_INCOME' end,
      abs(p_delta), abs(p_delta), 'PAID', current_date, v_uid, v_uid
    ) returning id into v_txn_id;

    if p_delta < 0 then
      insert into public.cycle_allocations (
        household_id, cycle_id, allocation_type, amount,
        category_id, account_id, note, created_by
      ) values (
        p_household_id, p_cycle_id, 'OTHER', abs(p_delta),
        p_category_id, p_account_id,
        'Rekonsiliasi ' || current_date::text, v_uid
      );
    end if;
  end if;

  return query
  insert into public.cycle_reconciliations (
    household_id, cycle_id, account_id, opening_stated, closing_stated,
    recorded_net, delta, adjustment_txn_id, noted_by
  ) values (
    p_household_id, p_cycle_id, p_account_id, p_opening_stated, p_closing_stated,
    p_recorded_net, p_delta, v_txn_id, v_uid
  ) returning id, v_txn_id;
end;
$$;

grant execute on function public.record_cycle_reconciliation(
  uuid, uuid, uuid, bigint, bigint, bigint, bigint, uuid
) to authenticated;
