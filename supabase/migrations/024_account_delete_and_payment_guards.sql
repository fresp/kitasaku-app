-- Kitasaku 024: preserve account references and tighten planned-payment settlement.
-- Forward-only. This migration does not rewrite existing transactions or balances.

create or replace function public.prevent_deleting_referenced_account()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.cycles c where c.primary_account_id = old.id)
     or exists (select 1 from public.cycle_reconciliations r where r.account_id = old.id)
     or exists (select 1 from public.cycle_allocations a where a.account_id = old.id)
     or exists (select 1 from public.transactions t
                where t.account_id = old.id or t.counter_account_id = old.id)
     or exists (select 1 from public.recurring_templates t where t.account_id = old.id) then
    raise exception 'Rekening ini masih dirujuk oleh siklus atau histori dan tidak dapat dihapus. Arsipkan rekening agar histori tetap utuh.';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_prevent_deleting_referenced_account on public.accounts;
create trigger trg_prevent_deleting_referenced_account
  before delete on public.accounts
  for each row execute function public.prevent_deleting_referenced_account();

comment on function public.prevent_deleting_referenced_account() is
  'Blocks hard deletion of accounts referenced by cycles, reconciliation snapshots, allocations, transactions, or recurring templates; archive instead.';

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
