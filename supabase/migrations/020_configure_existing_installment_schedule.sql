-- Kitasaku 020: configure an installment schedule from an existing obligation.
-- This is intentionally separate from the financing-inflow RPC: the obligation
-- already exists, so no transaction or cash movement is created.

create or replace function public.configure_obligation_installments(
  p_household_id uuid,
  p_obligation_id uuid,
  p_cycle_id uuid,
  p_principal bigint,
  p_flat_interest bigint,
  p_count int,
  p_start_date date,
  p_interest_mode text,
  p_interest_rate_bps int default 0
)
returns table (installment_count int, total_repayment bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_obligation public.obligations%rowtype;
  v_total bigint;
  v_count int;
begin
  if not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = v_uid
  ) then
    raise exception 'Not a member of household %', p_household_id;
  end if;
  if p_principal is null or p_principal <= 0 then
    raise exception 'Pokok harus lebih dari 0.';
  end if;
  if p_count is null or p_count < 1 or p_count > 600 then
    raise exception 'Jumlah angsuran harus antara 1 dan 600.';
  end if;
  if p_principal < p_count then
    raise exception 'Pokok terlalu kecil untuk % angsuran.', p_count;
  end if;
  if coalesce(p_flat_interest, 0) < 0 or coalesce(p_interest_rate_bps, 0) < 0 then
    raise exception 'Bunga tidak boleh negatif.';
  end if;
  if p_interest_mode not in ('FIXED_INSTALLMENT', 'FLOATING_INTEREST') then
    raise exception 'Mode bunga tidak dikenal.';
  end if;

  select * into v_obligation
  from public.obligations
  where id = p_obligation_id and household_id = p_household_id
  for update;
  if not found then raise exception 'Tanggungan tidak ditemukan.'; end if;
  if v_obligation.status in ('CANCELLED', 'SETTLED') then
    raise exception 'Tanggungan yang sudah selesai atau dibatalkan tidak dapat dijadwalkan.';
  end if;
  if exists (
    select 1 from public.obligation_installments
    where obligation_id = p_obligation_id
  ) then
    raise exception 'Jadwal cicilan sudah ada dan tidak dapat ditimpa.';
  end if;
  if exists (
    select 1 from public.transactions
    where obligation_id = p_obligation_id and status = 'PAID'
  ) then
    raise exception 'Jadwal tidak dapat diubah setelah ada pembayaran.';
  end if;

  v_total := p_principal + coalesce(p_flat_interest, 0);
  select count(*) into v_count
  from public.schedule_obligation_installments_v2(
    p_household_id, p_obligation_id, p_cycle_id, p_principal,
    coalesce(p_flat_interest, 0), p_count, coalesce(p_start_date, current_date),
    p_interest_mode, coalesce(p_interest_rate_bps, 0)
  );

  if p_interest_mode = 'FLOATING_INTEREST' then
    select coalesce(sum(i.planned_amount), 0) into v_total
    from public.obligation_installments i
    where i.obligation_id = p_obligation_id;
  end if;

  update public.obligations
  set total_amount = v_total,
      remaining_amount = v_total,
      principal_amount = p_principal,
      interest_fee_amount = greatest(0, v_total - p_principal),
      interest_mode = p_interest_mode,
      interest_rate_bps = case when p_interest_mode = 'FLOATING_INTEREST' then coalesce(p_interest_rate_bps, 0) else 0 end,
      repayment_method = 'INSTALLMENT',
      planned_installment_amount = (
        select i.planned_amount from public.obligation_installments i
        where i.obligation_id = p_obligation_id order by i.due_date, i.id limit 1
      ),
      installment_count = p_count,
      current_installment = 1,
      start_date = coalesce(p_start_date, current_date)
  where id = p_obligation_id;

  return query select v_count, v_total;
end;
$$;

grant execute on function public.configure_obligation_installments(uuid, uuid, uuid, bigint, bigint, int, date, text, int) to authenticated;
