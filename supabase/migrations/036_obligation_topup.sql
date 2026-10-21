-- Kitasaku 036: tambah pokok tanggungan (top up an existing obligation).
-- Apply only after 001–035. Fully idempotent. Contract: docs/phase-17-tambah-pokok.md.
--
-- Before this, more debt on an existing tanggungan was recorded by editing the
-- principal through "Atur Tenor & Cicilan". That rewrote the obligation, logged
-- a misleading SCHEDULE_CHANGED, forced a schedule onto reimburse/tagihan, and
-- never recorded the money that came in. This file adds one RPC instead:
--
--   topup_obligation(household, obligation, amount, occurred_on, account?, note?)
--     - raises total_amount and remaining_amount (and principal_amount when set)
--       by `amount`, once, under a row lock;
--     - writes one TOPUP event (kind added here) — the trigger that would log
--       SCHEDULE_CHANGED for the same update is told to stay quiet;
--     - with an account: one PAID FINANCING_INFLOW into that BANK/E_WALLET in the
--       active cycle. It has NO obligation_id (any row with obligation_id is a
--       DEBT_PAYMENT); the link lives on obligation_events.transaction_id. No
--       cycle_allocations row: income is a source, never an allocation;
--     - rejects obligations with open installments (6 cicilan terbuka would no
--       longer add up to the remainder). Those go through Atur Tenor & Cicilan.
--   The requester is told through the usual fan-out (OBLIGATION_TOPUP), never
--   when they topped up themselves. No new table, so nothing new for realtime.

-- ============ 1. New kinds ============

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'obligation_events_kind_check'
              and pg_get_constraintdef(oid) not like '%TOPUP%') then
    alter table public.obligation_events drop constraint obligation_events_kind_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'obligation_events_kind_check') then
    alter table public.obligation_events add constraint obligation_events_kind_check check (kind in (
      'CREATED', 'PAYMENT', 'SCHEDULE_CHANGED', 'CANCELLED', 'STATUS_CHANGED', 'TOPUP'
    ));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'notifications_kind_check'
              and pg_get_constraintdef(oid) not like '%OBLIGATION_TOPUP%') then
    alter table public.notifications drop constraint notifications_kind_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notifications_kind_check') then
    alter table public.notifications add constraint notifications_kind_check check (kind in (
      'OBLIGATION_CREATED', 'OBLIGATION_PAYMENT', 'OBLIGATION_CANCELLED',
      'OBLIGATION_SCHEDULE_CHANGED', 'OBLIGATION_STATUS_CHANGED', 'TRANSACTIONS_SHARED',
      'OBLIGATIONS_BULK_PAID', 'OBLIGATION_TOPUP'
    ));
  end if;
end $$;

-- ============ 2. Update trigger: a top up is not a schedule change ============

-- Redefined from 033. topup_obligation writes its TOPUP event before it updates
-- the obligation, in the same database transaction; that event already tells
-- the story, so the total_amount change is not logged again.
create or replace function public.log_obligation_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.obligation_events e
     where e.obligation_id = new.id and e.kind = 'TOPUP' and e.txid = txid_current()
  ) then
    return null;
  end if;
  if old.cancelled_at is null and new.cancelled_at is not null then
    insert into public.obligation_events (household_id, obligation_id, kind, actor_user_id, reason, payload)
    values (new.household_id, new.id, 'CANCELLED', coalesce(auth.uid(), new.cancelled_by),
            new.cancellation_reason,
            jsonb_build_object('title', new.title, 'note', new.cancellation_note));
  elsif (new.total_amount, new.installment_count, new.planned_installment_amount, new.repayment_mode,
         new.repayment_method, new.interest_mode, new.due_date)
        is distinct from
        (old.total_amount, old.installment_count, old.planned_installment_amount, old.repayment_mode,
         old.repayment_method, old.interest_mode, old.due_date) then
    insert into public.obligation_events (household_id, obligation_id, kind, actor_user_id, amount, payload)
    values (new.household_id, new.id, 'SCHEDULE_CHANGED', auth.uid(), new.total_amount,
            jsonb_build_object('title', new.title))
    on conflict do nothing;
  elsif new.status is distinct from old.status and new.remaining_amount >= old.remaining_amount then
    insert into public.obligation_events (household_id, obligation_id, kind, actor_user_id, payload)
    values (new.household_id, new.id, 'STATUS_CHANGED', auth.uid(),
            jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status));
  end if;
  return null;
end;
$$;

-- ============ 3. Fan-out: OBLIGATION_TOPUP to the requester ============

-- Redefined from 034; only the TOPUP branch is new.
create or replace function public.fan_out_obligation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ob public.obligations%rowtype;
  v_actor text;
  v_kind text;
  v_title text;
  v_body text;
  v_recipient uuid;
  v_payload jsonb;
begin
  select * into v_ob from public.obligations where id = new.obligation_id;
  if not found then return null; end if;
  v_actor := case when new.actor_user_id is null then 'Seseorang'
                  else public.member_label(new.household_id, new.actor_user_id) end;
  v_payload := jsonb_build_object('obligation_id', new.obligation_id, 'event_kind', new.kind);

  if new.kind = 'CREATED' then
    v_title := v_actor || ' mengajukan ' || public.obligation_kind_label(v_ob.type) || ' ' || public.fmt_rupiah(new.amount);
    v_body := v_ob.title || '. Ketuk untuk lihat.';
    for v_recipient in
      select m.user_id from public.household_members m
       where m.household_id = new.household_id
         and m.user_id is distinct from new.actor_user_id
    loop
      perform public.notify_member(new.household_id, v_recipient, 'OBLIGATION_CREATED', new.actor_user_id,
                                   new.obligation_id, new.id, v_title, v_body, v_payload);
    end loop;
    return null;
  end if;

  -- Everything else goes to the requester only, never to the actor themself,
  -- and not at all for rows created before 033.
  if v_ob.created_by is null or v_ob.created_by = new.actor_user_id then
    return null;
  end if;

  if new.kind = 'PAYMENT' then
    -- 034: inside a summary batch the requester gets one OBLIGATIONS_BULK_PAID
    -- instead. The event itself is still written; only this push is skipped.
    if exists (
      select 1 from public.payment_batches b
       where b.id = nullif(new.payload ->> 'payment_batch_id', '')::uuid
         and (b.item_count > 1 or b.fee_amount > 0)
    ) then
      return null;
    end if;
    v_kind := 'OBLIGATION_PAYMENT';
    if coalesce(new.is_final, false) then
      v_title := 'Pengajuanmu sudah lunas';
      v_body := v_ob.title || ' lunas dibayar ' || v_actor || '.';
    else
      v_title := 'Pengajuanmu dibayar ' || public.fmt_rupiah(new.amount);
      v_body := v_ob.title || ' · oleh ' || v_actor
             || coalesce(' dari ' || (new.payload ->> 'account_name'), '')
             || '. Sisa ' || public.fmt_rupiah(new.remaining_after) || '.';
    end if;
  elsif new.kind = 'TOPUP' then
    v_kind := 'OBLIGATION_TOPUP';
    v_title := 'Pokok ' || v_ob.title || ' bertambah ' || public.fmt_rupiah(new.amount);
    v_body := 'Oleh ' || v_actor
           || coalesce(' · masuk ke ' || (new.payload ->> 'account_name'), '')
           || '. Sisa ' || public.fmt_rupiah(new.remaining_after) || '.';
  elsif new.kind = 'CANCELLED' then
    v_kind := 'OBLIGATION_CANCELLED';
    v_title := v_ob.title || ' dibatalkan';
    v_body := 'Oleh ' || v_actor || coalesce(' · alasan: ' || public.cancellation_reason_label(new.reason), '')
             || coalesce(' — ' || nullif(trim(new.payload ->> 'note'), ''), '') || '.';
  elsif new.kind = 'SCHEDULE_CHANGED' then
    v_kind := 'OBLIGATION_SCHEDULE_CHANGED';
    v_title := 'Jadwal ' || v_ob.title || ' diubah';
    v_body := 'Oleh ' || v_actor || '.';
  else
    v_kind := 'OBLIGATION_STATUS_CHANGED';
    v_title := 'Status ' || v_ob.title || ' berubah';
    v_body := 'Oleh ' || v_actor || '.';
  end if;

  perform public.notify_member(new.household_id, v_ob.created_by, v_kind, new.actor_user_id,
                               new.obligation_id, new.id, v_title, v_body, v_payload);
  return null;
end;
$$;

-- ============ 4. RPC ============

create or replace function public.topup_obligation(
  p_household_id uuid,
  p_obligation_id uuid,
  p_amount bigint,
  p_occurred_on date,
  p_account_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_ob public.obligations%rowtype;
  v_open int;
  v_account public.accounts%rowtype;
  v_cycle_id uuid;
  v_category_id uuid;
  v_txn_id uuid;
  v_event_id uuid;
  v_total_after bigint;
  v_remaining_after bigint;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Bukan anggota ruang keluarga ini.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal tambahan harus lebih dari Rp 0.';
  end if;
  if p_occurred_on is null or p_occurred_on > current_date then
    raise exception 'Tanggal tidak boleh di masa depan.';
  end if;
  if v_note is not null and length(v_note) > 280 then
    raise exception 'Catatan maksimal 280 karakter.';
  end if;

  select * into v_ob from public.obligations
   where id = p_obligation_id and household_id = p_household_id
   for update;
  if not found then
    raise exception 'Tanggungan tidak ditemukan.';
  end if;
  if v_ob.status in ('SETTLED', 'CANCELLED') or v_ob.cancelled_at is not null then
    raise exception 'Tanggungan ini sudah selesai. Catat sebagai tanggungan baru.';
  end if;

  select count(*) into v_open
    from public.obligation_installments i
   where i.household_id = p_household_id and i.obligation_id = v_ob.id
     and i.status not in ('SETTLED', 'CANCELLED');
  if v_open > 0 then
    raise exception 'Tanggungan ini punya jadwal cicilan. Atur ulang tenor dan pokoknya lewat Atur Tenor & Cicilan.';
  end if;

  v_total_after := v_ob.total_amount + p_amount;
  v_remaining_after := v_ob.remaining_amount + p_amount;

  if p_account_id is not null then
    select * into v_account from public.accounts
     where id = p_account_id and household_id = p_household_id;
    if not found or v_account.is_active is distinct from true
       or v_account.type not in ('BANK', 'E_WALLET') then
      raise exception 'Uang masuk hanya bisa ke rekening BANK atau E_WALLET aktif.';
    end if;

    select c.id into v_cycle_id from public.cycles c
     where c.household_id = p_household_id and c.is_active and c.cancelled_at is null
     order by c.start_date desc limit 1
     for share;
    if v_cycle_id is null then
      raise exception 'Buka siklus aktif dulu untuk mencatat uang masuk.';
    end if;

    select c.id into v_category_id from public.categories c
     where c.household_id = p_household_id and c.system_role = 'FINANCING_INFLOW'
     limit 1;

    insert into public.transactions (
      household_id, cycle_id, name, direction, flow_type,
      planned_amount, actual_amount, status, release_date,
      category_id, account_id, created_by, executed_by
    ) values (
      p_household_id, v_cycle_id, 'Tambah pokok · ' || v_ob.title, 'INCOME', 'FINANCING_INFLOW',
      p_amount, p_amount, 'PAID', p_occurred_on,
      v_category_id, p_account_id, v_uid, v_uid
    ) returning id into v_txn_id;
  end if;

  -- The event goes first: log_obligation_updated looks for it in this
  -- transaction and then skips the SCHEDULE_CHANGED it would otherwise write.
  insert into public.obligation_events (
    household_id, obligation_id, kind, actor_user_id, transaction_id, account_id,
    amount, remaining_after, is_final, payload
  ) values (
    p_household_id, v_ob.id, 'TOPUP', v_uid, v_txn_id, p_account_id,
    p_amount, v_remaining_after, false,
    jsonb_build_object(
      'title', v_ob.title,
      'occurred_on', p_occurred_on,
      'note', v_note,
      'total_before', v_ob.total_amount,
      'total_after', v_total_after,
      'remaining_before', v_ob.remaining_amount,
      'account_name', case when p_account_id is null then null else v_account.name end
    )
  ) returning id into v_event_id;

  update public.obligations
     set total_amount = v_total_after,
         remaining_amount = v_remaining_after,
         principal_amount = case when principal_amount is null then null else principal_amount + p_amount end
   where id = v_ob.id;

  return jsonb_build_object(
    'event_id', v_event_id,
    'transaction_id', v_txn_id,
    'total_amount', v_total_after,
    'remaining_amount', v_remaining_after
  );
end;
$$;

revoke all on function public.topup_obligation(uuid, uuid, bigint, date, uuid, text) from public;
grant execute on function public.topup_obligation(uuid, uuid, bigint, date, uuid, text) to authenticated;

-- ============ Manual verification (SQL Editor, first run) ============
--
-- 1. Kinds and function are in place (expect TOPUP / OBLIGATION_TOPUP and one row):
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('obligation_events_kind_check', 'notifications_kind_check');
--   select proname from pg_proc where proname = 'topup_obligation';
--
-- 2. A top up without money in moves only the obligation and writes exactly one
--    TOPUP event, no SCHEDULE_CHANGED (run as a member; roll back):
--   begin;
--   select public.topup_obligation('<household>', '<obligation without schedule>', 1000, current_date);
--   select kind, amount, remaining_after from public.obligation_events
--    where obligation_id = '<obligation>' order by created_at desc limit 2;
--   rollback;
--
-- 3. With an account: one FINANCING_INFLOW, no obligation_id, no allocation:
--   begin;
--   select public.topup_obligation('<household>', '<obligation>', 1000, current_date, '<bank account>');
--   select flow_type, obligation_id, actual_amount from public.transactions
--    where name like 'Tambah pokok · %' order by created_at desc limit 1;
--   select count(*) from public.cycle_allocations
--    where transaction_id in (select transaction_id from public.obligation_events where kind = 'TOPUP');
--   rollback;
--
-- 4. Consistency after real use (expect zero rows): every TOPUP with money in
--    points at a PAID FINANCING_INFLOW of the same amount.
--   select e.id from public.obligation_events e
--     left join public.transactions t on t.id = e.transaction_id
--    where e.kind = 'TOPUP' and e.account_id is not null
--      and (t.id is null or t.flow_type <> 'FINANCING_INFLOW' or t.status <> 'PAID'
--           or t.actual_amount <> e.amount or t.obligation_id is not null);
