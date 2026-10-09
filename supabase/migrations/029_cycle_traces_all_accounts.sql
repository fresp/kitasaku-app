-- Kitasaku 029: a cycle traces transactions from every account.
-- Apply only after 001-028. Fully idempotent. No data is rewritten.
--
-- Reverses the write-side half of 028. A transaction on a credit card or cash
-- account keeps its cycle_id: the cycle is the audit trail of what happened that
-- period, whatever account paid. The exclusion that 028 was built for still
-- holds, but it belongs to the read side only, where it already lived before
-- 028 and still does:
--   * Reconciliation is anchored on the cycle's primary BANK account
--     (close_cycle_reconciliation, reconciliationPreview), so a card row can
--     never reach it.
--   * Zero-based is evaluated per account and only offered for BANK / E_WALLET
--     (useZeroBasedSummaryForAccount), and the cycle-wide source-funds and
--     allocation aggregates filter on account type
--     (lib/zero-based-accounting.ts).
--   * Year insight filters on account type as of this change
--     (lib/insight.ts).
-- See docs/phase-12-rekonsiliasi-tutup-siklus.md.

-- ---------------------------------------------------------------------------
-- 1. Drop the write guards from 028.
-- ---------------------------------------------------------------------------

drop trigger if exists trg_guard_cycle_transaction_account on public.transactions;
drop function if exists public.guard_cycle_transaction_account();
drop trigger if exists trg_guard_template_account on public.recurring_templates;
drop function if exists public.guard_template_account();

-- ---------------------------------------------------------------------------
-- 2. Drop the settle-outside-cycle path.
-- ---------------------------------------------------------------------------
-- There is nothing to settle outside a cycle any more: a card payment is
-- confirmed like any other. Rows already written through it keep their
-- replaces_transaction_id link, so that column stays.

drop function if exists public.settle_pending_outside_cycle(uuid, uuid, uuid, bigint, date, boolean);

-- ---------------------------------------------------------------------------
-- 3. Executing a plan accepts any active account.
-- ---------------------------------------------------------------------------
-- Redefined from 024 (and 028 section 5) with both account-type restrictions
-- removed; the rest of the body is unchanged. The BANK / E_WALLET restriction
-- here predates 028 -- without this, a plan could never be paid from a card at
-- all.

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
    raise exception 'Pilih akun untuk transaksi ini.';
  end if;
  if p_release_date is null or p_release_date > current_date then
    raise exception 'Tanggal transaksi tidak boleh di masa depan.';
  end if;

  -- 029: any active account of this household, credit card and cash included.
  -- A cycle traces every transaction whatever the account; which accounts count
  -- toward the cycle's cash figures is decided when reading, not when writing.
  select type, is_active into v_account_type, v_account_active
    from public.accounts
   where id = p_account_id and household_id = p_household_id;
  if not found or v_account_active is distinct from true then
    raise exception 'Pilih akun aktif milik household ini.';
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

-- Manual verification (SQL Editor, first run):
--
-- 1. The 028 write guards are gone and the settle path with them:
--   select tgname from pg_trigger
--    where tgname in ('trg_guard_cycle_transaction_account', 'trg_guard_template_account');
--   -- 0 rows
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and proname in ('guard_cycle_transaction_account', 'guard_template_account',
--                      'settle_pending_outside_cycle');
--   -- 0 rows
--
-- 2. What 028 kept is still there (the allocation <-> planned row link):
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and proname in ('release_pending_transaction', 'cancel_pending_transaction',
--                      'validate_cycle_allocation_transaction');
--   -- 3 rows
--
-- 3. Rows settled outside a cycle while 028 was live. Under the rule this
--    migration restores they belong to the cycle of their release_date, but
--    they are NOT moved automatically: the original plan was cancelled and its
--    allocation released, so re-attaching them is a judgement call per row.
--    Review these by hand and decide whether to re-plan them in the app:
--   select t.id, t.name, t.release_date, t.actual_amount,
--          acc.name as account, acc.type,
--          prev.id as cancelled_plan_id, prev.cycle_id as original_cycle
--     from public.transactions t
--     left join public.accounts acc on acc.id = t.account_id
--     left join public.transactions prev on prev.id = t.replaces_transaction_id
--    where t.replaces_transaction_id is not null
--    order by t.release_date desc;
--
-- 4. Executing a plan from a credit card is accepted again (expect no
--    exception, then roll back):
--   begin;
--   select public.execute_planned_transaction(
--     t.household_id, t.id, t.planned_amount,
--     (select a.id from public.accounts a
--       where a.household_id = t.household_id and a.type = 'CREDIT_CARD'
--         and a.is_active limit 1),
--     current_date, false)
--     from public.transactions t
--    where t.status = 'PENDING' and t.cycle_id is not null
--    limit 1;
--   rollback;
