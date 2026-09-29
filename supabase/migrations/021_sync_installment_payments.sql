-- Keep installment progress synchronized with audited payment transactions.
-- Payments are applied oldest-first so a partial payment never skips a cycle.

create or replace function public.sync_obligation_installment_payment(
  p_household_id uuid,
  p_obligation_id uuid,
  p_amount bigint,
  p_transaction_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left bigint := p_amount;
  v_paid bigint;
  v_planned bigint;
  v_id uuid;
begin
  if not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = auth.uid()
  ) then
    raise exception 'Not a member of household %', p_household_id;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal pembayaran harus lebih dari 0.';
  end if;

  for v_id, v_paid, v_planned in
    select i.id, i.paid_amount, i.planned_amount
    from public.obligation_installments i
    where i.household_id = p_household_id
      and i.obligation_id = p_obligation_id
      and i.status not in ('SETTLED', 'CANCELLED')
    order by i.due_date asc nulls last, i.created_at asc, i.id asc
    for update
  loop
    exit when v_left <= 0;
    v_paid := greatest(0, v_paid);
    update public.obligation_installments
      set paid_amount = least(v_planned, v_paid + v_left),
          paid_transaction_id = p_transaction_id,
          status = case
            when v_paid + v_left >= v_planned then 'SETTLED'
            else 'PARTIAL'
          end
      where id = v_id;
    v_left := greatest(0, v_left - greatest(0, v_planned - v_paid));
  end loop;
end;
$$;

grant execute on function public.sync_obligation_installment_payment(uuid, uuid, bigint, uuid) to authenticated;
