-- Kitasaku 033: kolaborasi ruang — requester, activity trail, member notifications.
-- Apply only after 001–031 (032_special_budgets lives on feat/special-budgets and
-- is independent of this file; the numbers are kept apart so both can merge).
-- Fully idempotent. Contract: docs/phase-15-kolaborasi-ruang.md.
--
-- What this adds:
--   1. obligations.created_by — who submitted a tanggungan. Set from auth.uid(),
--      immutable. Existing rows stay NULL ("Tidak tercatat"); no backfill.
--   2. obligation_events — append-only trail written only by triggers:
--      CREATED, PAYMENT, SCHEDULE_CHANGED, CANCELLED, STATUS_CHANGED.
--   3. notifications — one row per recipient. Obligation events fan out
--      automatically; transaction "kabar" is opt-in via share_transactions or
--      bulk_execute_transactions. A Database Webhook on INSERT drives push.
--   4. push_tokens + register/unregister RPCs.
--   5. preview_bulk_execute / bulk_execute_transactions — bulk paid becomes a
--      verify step plus one all-or-nothing write, replacing the client loop.

-- ============ 0. Helpers ============

create or replace function public.fmt_rupiah(p_amount bigint)
returns text
language sql
immutable
set search_path = public
as $$
  select 'Rp ' || replace(to_char(coalesce(p_amount, 0), 'FM999,999,999,999,990'), ',', '.');
$$;

create or replace function public.member_label(p_household_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(trim(m.display_name), '')
       from public.household_members m
      where m.household_id = p_household_id and m.user_id = p_user_id),
    (select split_part(u.email::text, '@', 1) from auth.users u where u.id = p_user_id),
    'Anggota'
  );
$$;

create or replace function public.obligation_kind_label(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_type in ('REIMBURSEMENT', 'REIMBURSE') then 'reimburse'
    when p_type in ('LOAN', 'DEBT') then 'pinjaman'
    when p_type = 'INSTALLMENT' then 'cicilan'
    else 'tagihan'
  end;
$$;

create or replace function public.cancellation_reason_label(p_reason text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_reason
    when 'WRONG_INPUT' then 'salah input'
    when 'DUPLICATE' then 'tercatat dobel'
    when 'NOT_HAPPENED' then 'tidak jadi'
    when 'OTHER' then 'lainnya'
    else nullif(trim(coalesce(p_reason, '')), '')
  end;
$$;

-- ============ 1. obligations.created_by ============

alter table public.obligations
  add column if not exists created_by uuid references auth.users(id);

alter table public.obligations
  alter column created_by set default auth.uid();

comment on column public.obligations.created_by is
  'Pengaju tanggungan (Phase 15). Set from auth.uid() on insert, immutable. NULL = created before 033 ("Tidak tercatat").';

create or replace function public.guard_obligation_created_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- The signed-in caller is the requester; a client cannot submit on
    -- someone else's behalf.
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    return new;
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Pengaju tanggungan tidak dapat diubah.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_obligation_created_by on public.obligations;
create trigger trg_guard_obligation_created_by
  before insert or update of created_by on public.obligations
  for each row execute function public.guard_obligation_created_by();

-- ============ 2. obligation_events ============

create table if not exists public.obligation_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  obligation_id uuid not null references public.obligations(id) on delete cascade,
  kind text not null check (kind in ('CREATED', 'PAYMENT', 'SCHEDULE_CHANGED', 'CANCELLED', 'STATUS_CHANGED')),
  actor_user_id uuid references auth.users(id),
  transaction_id uuid references public.transactions(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  amount bigint,
  remaining_after bigint,
  is_final boolean,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  txid bigint not null default txid_current(),
  created_at timestamptz not null default now()
);

create index if not exists obligation_events_obligation_idx
  on public.obligation_events (obligation_id, created_at);

-- One SCHEDULE_CHANGED per obligation per database transaction: configuring a
-- schedule updates the obligation and inserts many installment rows at once.
create unique index if not exists obligation_events_schedule_once
  on public.obligation_events (obligation_id, txid) where kind = 'SCHEDULE_CHANGED';

alter table public.obligation_events enable row level security;

drop policy if exists "household_scoped_select_obligation_events" on public.obligation_events;
create policy "household_scoped_select_obligation_events"
  on public.obligation_events for select
  using (public.is_household_member(household_id));
-- No insert/update/delete policies: rows come only from the triggers below.

-- ============ 3. Event triggers ============

create or replace function public.log_obligation_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.obligation_events (household_id, obligation_id, kind, actor_user_id, amount, payload)
  values (new.household_id, new.id, 'CREATED', coalesce(auth.uid(), new.created_by), new.total_amount,
          jsonb_build_object('title', new.title, 'type', new.type));
  return null;
end;
$$;

drop trigger if exists trg_log_obligation_created on public.obligations;
create trigger trg_log_obligation_created
  after insert on public.obligations
  for each row execute function public.log_obligation_created();

-- Order matters: a cancellation also flips status; a schedule change resets
-- remaining_amount. A payment only lowers remaining_amount (and may flip
-- status) and is logged from transactions instead, so it is skipped here —
-- a final payment is never recorded twice.
create or replace function public.log_obligation_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

drop trigger if exists trg_log_obligation_updated on public.obligations;
create trigger trg_log_obligation_updated
  after update on public.obligations
  for each row execute function public.log_obligation_updated();

create or replace function public.log_installments_scheduled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  select title into v_title from public.obligations where id = new.obligation_id;
  insert into public.obligation_events (household_id, obligation_id, kind, actor_user_id, payload)
  values (new.household_id, new.obligation_id, 'SCHEDULE_CHANGED', auth.uid(),
          jsonb_build_object('title', v_title))
  on conflict do nothing;
  return null;
end;
$$;

drop trigger if exists trg_log_installments_scheduled on public.obligation_installments;
create trigger trg_log_installments_scheduled
  after insert on public.obligation_installments
  for each row execute function public.log_installments_scheduled();

-- Both payment paths write the transaction BEFORE lowering the obligation
-- (allocate_debt_payment: INSERT then UPDATE, 030; execute_planned_transaction:
-- UPDATE PENDING→PAID then UPDATE, 029), and both compute the new remainder as
-- greatest(0, remaining − amount). Reading the obligation here therefore sees
-- the pre-payment remainder and reproduces their figure exactly.
create or replace function public.log_obligation_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ob public.obligations%rowtype;
  v_after bigint;
begin
  if new.obligation_id is null or new.status <> 'PAID' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'PAID' then
    return null;
  end if;
  select * into v_ob from public.obligations where id = new.obligation_id;
  if not found then return null; end if;
  v_after := greatest(0, v_ob.remaining_amount - coalesce(new.actual_amount, 0));
  insert into public.obligation_events (
    household_id, obligation_id, kind, actor_user_id, transaction_id, account_id,
    amount, remaining_after, is_final, payload
  ) values (
    new.household_id, new.obligation_id, 'PAYMENT', coalesce(auth.uid(), new.executed_by), new.id, new.account_id,
    new.actual_amount, v_after, v_after = 0,
    jsonb_build_object('title', v_ob.title,
                       'account_name', (select a.name from public.accounts a where a.id = new.account_id))
  );
  return null;
end;
$$;

drop trigger if exists trg_log_obligation_payment on public.transactions;
create trigger trg_log_obligation_payment
  after insert or update of status on public.transactions
  for each row execute function public.log_obligation_payment();

-- ============ 4. notifications ============

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'OBLIGATION_CREATED', 'OBLIGATION_PAYMENT', 'OBLIGATION_CANCELLED',
    'OBLIGATION_SCHEDULE_CHANGED', 'OBLIGATION_STATUS_CHANGED', 'TRANSACTIONS_SHARED'
  )),
  actor_user_id uuid references auth.users(id),
  obligation_id uuid references public.obligations(id) on delete cascade,
  event_id uuid references public.obligation_events(id) on delete cascade,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  push_enabled boolean not null default true,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "recipient_select_notifications" on public.notifications;
create policy "recipient_select_notifications"
  on public.notifications for select
  using (recipient_user_id = auth.uid());
-- No insert/update/delete policies: rows come from triggers and RPCs, and the
-- only change a recipient makes goes through mark_notification_read.

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = p_notification_id and recipient_user_id = auth.uid();
$$;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.notify_member(
  p_household_id uuid, p_recipient uuid, p_kind text, p_actor uuid,
  p_obligation_id uuid, p_event_id uuid, p_title text, p_body text, p_payload jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (
    household_id, recipient_user_id, kind, actor_user_id, obligation_id, event_id,
    title, body, payload, push_enabled
  )
  select p_household_id, p_recipient, p_kind, p_actor, p_obligation_id, p_event_id,
         p_title, p_body, coalesce(p_payload, '{}'::jsonb), coalesce(m.notify_partner_expense, true)
    from public.household_members m
   where m.household_id = p_household_id and m.user_id = p_recipient;
$$;
revoke all on function public.notify_member(uuid, uuid, text, uuid, uuid, uuid, text, text, jsonb) from public;

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

drop trigger if exists trg_fan_out_obligation_event on public.obligation_events;
create trigger trg_fan_out_obligation_event
  after insert on public.obligation_events
  for each row execute function public.fan_out_obligation_event();

-- ============ 5. Kabar transaksi (opt-in) ============

-- Shared by share_transactions and bulk_execute_transactions. Validates and
-- writes one TRANSACTIONS_SHARED row per recipient; returns how many were sent.
create or replace function public.write_transactions_share(
  p_household_id uuid, p_transaction_ids uuid[], p_recipient_ids uuid[], p_note text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
  v_in bigint;
  v_out bigint;
  v_names text[];
  v_actor text;
  v_title text;
  v_body text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_recipient uuid;
  v_sent int := 0;
  v_amount_of bigint;
  v_verb text;
begin
  if coalesce(array_length(p_recipient_ids, 1), 0) = 0 then
    return 0;
  end if;
  if coalesce(array_length(p_transaction_ids, 1), 0) = 0 then
    raise exception 'Pilih transaksi yang ingin dikabarkan.';
  end if;
  if v_note is not null and length(v_note) > 280 then
    raise exception 'Catatan maksimal 280 karakter.';
  end if;

  if exists (
    select 1 from unnest(p_transaction_ids) as x(id)
     where not exists (
       select 1 from public.transactions t
        where t.id = x.id and t.household_id = p_household_id
          and (t.created_by = v_uid or t.executed_by = v_uid)
     )
  ) then
    raise exception 'Hanya transaksi yang kamu catat atau bayar yang bisa dikabarkan.';
  end if;

  if exists (
    select 1 from unnest(p_recipient_ids) as r(id)
     where r.id = v_uid
        or not exists (select 1 from public.household_members m
                        where m.household_id = p_household_id and m.user_id = r.id)
  ) then
    raise exception 'Penerima harus anggota lain di ruang keluarga ini.';
  end if;

  select count(*),
         coalesce(sum(case when t.direction = 'INCOME' then
                    case when t.status = 'PAID' then t.actual_amount else t.planned_amount end end), 0),
         coalesce(sum(case when t.direction = 'EXPENSE' then
                    case when t.status = 'PAID' then t.actual_amount else t.planned_amount end end), 0),
         array_agg(t.name order by t.release_date nulls last, t.name)
    into v_count, v_in, v_out, v_names
    from public.transactions t
   where t.id = any (p_transaction_ids) and t.household_id = p_household_id;

  v_actor := public.member_label(p_household_id, v_uid);
  if v_count = 1 then
    select case
             when t.status <> 'PAID' then ' mencatat rencana '
             when t.direction = 'INCOME' then ' menerima '
             else ' membayar '
           end
      into v_verb
      from public.transactions t where t.id = p_transaction_ids[1];
    v_amount_of := case when v_out > 0 then v_out else v_in end;
    v_title := v_actor || v_verb || v_names[1] || ' · ' || public.fmt_rupiah(v_amount_of);
    v_body := coalesce('"' || v_note || '"', 'Ketuk untuk lihat detailnya.');
  else
    select case
             when bool_or(t.status <> 'PAID') then ' mencatat '
             when bool_and(t.direction = 'EXPENSE') then ' membayar '
             when bool_and(t.direction = 'INCOME') then ' menerima '
             else ' mengeksekusi '
           end
      into v_verb
      from public.transactions t
     where t.id = any (p_transaction_ids) and t.household_id = p_household_id;
    v_title := v_actor || v_verb || v_count || ' transaksi'
            || case when v_out > 0 then ' · keluar ' || public.fmt_rupiah(v_out) else '' end
            || case when v_in > 0 then ' · masuk ' || public.fmt_rupiah(v_in) else '' end;
    v_body := array_to_string(v_names[1:3], ', ')
           || case when v_count > 3 then ', +' || (v_count - 3) || ' lainnya' else '' end
           || '.' || coalesce(' "' || v_note || '"', '');
  end if;

  for v_recipient in select distinct r.id from unnest(p_recipient_ids) as r(id) loop
    perform public.notify_member(
      p_household_id, v_recipient, 'TRANSACTIONS_SHARED', v_uid, null, null, v_title, v_body,
      jsonb_build_object('transaction_ids', to_jsonb(p_transaction_ids), 'note', v_note,
                         'count', v_count, 'total_in', v_in, 'total_out', v_out)
    );
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.write_transactions_share(uuid, uuid[], uuid[], text) from public;

create or replace function public.share_transactions(
  p_household_id uuid, p_transaction_ids uuid[], p_recipient_ids uuid[], p_note text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Bukan anggota ruang keluarga ini.';
  end if;
  return public.write_transactions_share(p_household_id, p_transaction_ids, p_recipient_ids, p_note);
end;
$$;
grant execute on function public.share_transactions(uuid, uuid[], uuid[], text) to authenticated;

-- ============ 6. Bulk paid: verify, then commit ============

-- One reason per row, or NULL when the row can be executed as planned (planned
-- amount, the row's own account, today). Mirrors execute_planned_transaction
-- (029) plus the client rule that a tanggungan is paid from bank/e-wallet.
create or replace function public.bulk_execute_row_problem(p_household_id uuid, p_transaction_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_txn public.transactions%rowtype;
  v_acc public.accounts%rowtype;
  v_ob public.obligations%rowtype;
  v_cycle_cancelled timestamptz;
  v_outstanding bigint;
begin
  select * into v_txn from public.transactions
   where id = p_transaction_id and household_id = p_household_id;
  if not found then return 'Transaksi tidak ditemukan.'; end if;
  if v_txn.status <> 'PENDING' then return 'Sudah diproses. Muat ulang daftar.'; end if;
  if coalesce(v_txn.planned_amount, 0) <= 0 then return 'Nominal rencana kosong.'; end if;
  if v_txn.cycle_id is not null then
    select cancelled_at into v_cycle_cancelled from public.cycles where id = v_txn.cycle_id;
    if v_cycle_cancelled is not null then return 'Siklusnya sudah dibatalkan.'; end if;
  end if;
  if v_txn.account_id is null then return 'Belum ada akun. Bayar satu per satu.'; end if;
  select * into v_acc from public.accounts
   where id = v_txn.account_id and household_id = p_household_id;
  if not found or v_acc.is_active is distinct from true then return 'Akunnya tidak aktif.'; end if;
  if v_txn.obligation_id is not null then
    if v_acc.type not in ('BANK', 'E_WALLET') then
      return 'Tanggungan harus dibayar dari rekening bank atau e-wallet.';
    end if;
    select * into v_ob from public.obligations where id = v_txn.obligation_id;
    if not found or v_ob.status in ('SETTLED', 'CANCELLED') or v_ob.remaining_amount <= 0 then
      return 'Tanggungannya sudah selesai.';
    end if;
    if v_txn.planned_amount > v_ob.remaining_amount then
      return 'Melebihi sisa tanggungan.';
    end if;
    -- execute_planned_transaction (029) maps every payment onto the open
    -- installment schedule and refuses what it cannot map.
    select coalesce(sum(greatest(0, i.planned_amount - greatest(0, i.paid_amount))), 0)
      into v_outstanding
      from public.obligation_installments i
     where i.household_id = p_household_id
       and i.obligation_id = v_txn.obligation_id
       and i.status not in ('SETTLED', 'CANCELLED');
    if v_outstanding < v_txn.planned_amount then
      return 'Belum ada jadwal cicilan yang cukup. Bayar dari Detail Tanggungan.';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.bulk_execute_row_problem(uuid, uuid) from public;

create or replace function public.preview_bulk_execute(p_household_id uuid, p_transaction_ids uuid[])
returns table (transaction_id uuid, ok boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Bukan anggota ruang keluarga ini.';
  end if;
  return query
    select x.id, p.problem is null, p.problem
      from unnest(p_transaction_ids) as x(id)
      cross join lateral (select public.bulk_execute_row_problem(p_household_id, x.id) as problem) p;
end;
$$;
grant execute on function public.preview_bulk_execute(uuid, uuid[]) to authenticated;

-- All-or-nothing: every row is re-checked, then executed through
-- execute_planned_transaction in this same transaction, so any failure rolls
-- the whole batch back and no kabar is written for money that did not move.
create or replace function public.bulk_execute_transactions(
  p_household_id uuid,
  p_transaction_ids uuid[],
  p_recipient_ids uuid[] default null,
  p_note text default null
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_problem text;
  v_name text;
  v_txn public.transactions%rowtype;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Bukan anggota ruang keluarga ini.';
  end if;
  if coalesce(array_length(p_transaction_ids, 1), 0) = 0 then
    raise exception 'Pilih minimal satu transaksi.';
  end if;

  for v_id in select distinct x.id from unnest(p_transaction_ids) as x(id) loop
    v_problem := public.bulk_execute_row_problem(p_household_id, v_id);
    if v_problem is not null then
      select name into v_name from public.transactions where id = v_id;
      raise exception '%: %', coalesce(v_name, 'Transaksi'), v_problem;
    end if;
  end loop;

  for v_id in select distinct x.id from unnest(p_transaction_ids) as x(id) loop
    select * into v_txn from public.transactions where id = v_id;
    perform public.execute_planned_transaction(
      p_household_id, v_id, v_txn.planned_amount, v_txn.account_id, current_date, false
    );
    return next v_id;
  end loop;

  perform public.write_transactions_share(p_household_id, p_transaction_ids, p_recipient_ids, p_note);
  return;
end;
$$;
grant execute on function public.bulk_execute_transactions(uuid, uuid[], uuid[], text) to authenticated;

-- ============ 7. Push tokens ============

create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
-- No policies: only the RPCs below (as the caller) and the service role
-- (edge function) touch this table.

create or replace function public.register_push_token(p_token text, p_platform text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Masuk dulu untuk menerima notifikasi.'; end if;
  if p_token is null or length(trim(p_token)) < 10 then raise exception 'Token notifikasi tidak valid.'; end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (trim(p_token), auth.uid(), p_platform, now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;
grant execute on function public.register_push_token(text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_tokens where token = trim(p_token) and user_id = auth.uid();
$$;
grant execute on function public.unregister_push_token(text) to authenticated;

-- ============ 8. Setting: one general toggle ============

comment on column public.household_members.notify_partner_expense is
  'Notifikasi Ruang Keluarga (Phase 15): when false, this member''s notifications are still written but not pushed.';

-- ============ 9. Realtime ============

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'obligation_events') then
    alter publication supabase_realtime add table public.obligation_events;
  end if;
end $$;

alter table public.notifications replica identity full;
alter table public.obligation_events replica identity full;

create or replace function public.realtime_health()
returns table (tablename text, registered boolean, replica_identity text)
language sql
security definer
set search_path = public, pg_catalog
as $$
  with targets(tablename) as (
    values ('transactions'),('obligations'),('recurring_templates'),('cycles'),
           ('categories'),('accounts'),('household_members'),('households'),
           ('notifications'),('obligation_events')
  )
  select
    d.tablename,
    exists (
      select 1 from pg_publication_tables pt
      where pt.pubname = 'supabase_realtime'
        and pt.schemaname = 'public'
        and pt.tablename = d.tablename
    ) as registered,
    coalesce(c.relreplident::text, '-') as replica_identity
  from targets d
  left join pg_class c
    on c.relname = d.tablename
   and c.relnamespace = 'public'::regnamespace
  order by d.tablename;
$$;
grant execute on function public.realtime_health() to anon, authenticated;

-- Manual verification (SQL Editor, first run):
--
-- 1. Objects exist and realtime is registered (expect registered = true and
--    replica_identity = 'f' for notifications and obligation_events):
--   select * from public.realtime_health();
--   select column_name from information_schema.columns
--    where table_name = 'obligations' and column_name = 'created_by';
--
-- 2. Trail is written by triggers. Pick a household you belong to, pay part of
--    an open tanggungan from the app, then:
--   select kind, actor_user_id, amount, remaining_after, is_final, created_at
--     from public.obligation_events where obligation_id = '<id>' order by created_at;
--   A final payment shows ONE row (PAYMENT, is_final = true), no STATUS_CHANGED.
--
-- 3. Fan-out: the requester (created_by) got a row, the actor did not:
--   select recipient_user_id, kind, title, body, push_enabled
--     from public.notifications order by created_at desc limit 10;
--
-- 4. Bulk preview returns one row per id; a PAID id reports a reason:
--   select * from public.preview_bulk_execute('<household>', array['<txn id>']::uuid[]);
--
-- 5. Push delivery (manual setup, not part of SQL):
--   a. Deploy: supabase functions deploy send-push --no-verify-jwt
--   b. Secrets: supabase secrets set PUSH_WEBHOOK_SECRET=<random>
--      (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform)
--   c. Dashboard → Database → Webhooks → new: table public.notifications,
--      event INSERT, type Supabase Edge Function send-push, HTTP header
--      x-webhook-secret: <same random>.
--   d. EAS: upload FCM V1 service-account credentials for Android.
--   e. After a test push, check that dead tokens were pruned:
--      select count(*) from public.push_tokens;
