-- Kitasaku 034: bayar beberapa tanggungan dalam satu transfer (Phase 16).
-- Apply only after 001–033 (032_special_budgets is not required; nothing here
-- references special_budget_id). Fully idempotent. No existing rows are rewritten.
--
--   1. payment_batches + transactions.payment_batch_id: one bank debit, many rows.
--   2. execute_planned_transaction / bulk_execute_row_problem: a plan for an
--      obligation WITHOUT an installment schedule can be executed again.
--   3. Payment events carry the batch id; the per-obligation push is skipped
--      inside a summary batch; new notification kind OBLIGATIONS_BULK_PAID.
--   4. preview_pay_obligations_bulk / pay_obligations_bulk (two-step, atomic).
--   5. Realtime for payment_batches.
-- See docs/phase-16-bulk-bayar-tanggungan.md.

-- ============ 1. payment_batches ============

create table if not exists public.payment_batches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  cycle_id uuid references public.cycles(id) on delete set null,
  account_id uuid references public.accounts(id),
  paid_at date not null,
  subtotal bigint not null check (subtotal > 0),
  total_debited bigint not null,
  fee_amount bigint not null default 0 check (fee_amount >= 0),
  fee_transaction_id uuid references public.transactions(id) on delete set null,
  item_count int not null check (item_count > 0),
  items jsonb not null default '[]'::jsonb,
  note text check (note is null or length(note) <= 280),
  recipient_ids uuid[] not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint payment_batches_total_check check (total_debited = subtotal + fee_amount)
);

create index if not exists payment_batches_household_idx
  on public.payment_batches (household_id, paid_at desc);

alter table public.payment_batches enable row level security;

drop policy if exists "household_scoped_select_payment_batches" on public.payment_batches;
create policy "household_scoped_select_payment_batches"
  on public.payment_batches for select
  using (public.is_household_member(household_id));
-- No insert/update/delete policies: rows come only from pay_obligations_bulk.

alter table public.transactions
  add column if not exists payment_batch_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_payment_batch_id_fkey') then
    alter table public.transactions
      add constraint transactions_payment_batch_id_fkey
      foreign key (payment_batch_id) references public.payment_batches(id) on delete set null;
  end if;
end $$;

create index if not exists idx_transactions_payment_batch
  on public.transactions (payment_batch_id) where payment_batch_id is not null;

-- ============ 2. Plans without a schedule are payable again ============

-- Redefined from 029; the only change is the guarded "tidak dapat dipetakan".
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
    -- 034: only a scheduled obligation must absorb the whole payment. Without a
    -- schedule there is nothing to map onto, and refusing made every planned
    -- Reimburse/Tagihan unpayable.
    if v_has_installments and v_left > 0 then
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

-- Redefined from 033: the schedule check only applies to scheduled obligations.
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
    if exists (select 1 from public.obligation_installments i
                where i.household_id = p_household_id and i.obligation_id = v_txn.obligation_id)
       and v_outstanding < v_txn.planned_amount then
      return 'Belum ada jadwal cicilan yang cukup. Bayar dari Detail Tanggungan.';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.bulk_execute_row_problem(uuid, uuid) from public;

-- ============ 3. Events, push suppression, notification kind ============

-- Redefined from 033: the payment event remembers its batch.
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
                       'account_name', (select a.name from public.accounts a where a.id = new.account_id),
                       'payment_batch_id', new.payment_batch_id)
  );
  return null;
end;
$$;

drop trigger if exists trg_log_obligation_payment on public.transactions;
create trigger trg_log_obligation_payment
  after insert or update of status on public.transactions
  for each row execute function public.log_obligation_payment();

-- Redefined from 033: PAYMENT inside a summary batch is not pushed.
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

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'notifications_kind_check'
              and pg_get_constraintdef(oid) not like '%OBLIGATIONS_BULK_PAID%') then
    alter table public.notifications drop constraint notifications_kind_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notifications_kind_check') then
    alter table public.notifications add constraint notifications_kind_check check (kind in (
      'OBLIGATION_CREATED', 'OBLIGATION_PAYMENT', 'OBLIGATION_CANCELLED',
      'OBLIGATION_SCHEDULE_CHANGED', 'OBLIGATION_STATUS_CHANGED', 'TRANSACTIONS_SHARED',
      'OBLIGATIONS_BULK_PAID'
    ));
  end if;
end $$;

-- ============ 4. Bulk pay: plan (shared by preview and pay) ============

-- Months as Riwayat writes them, for the notification body.
create or replace function public.short_date_id(p_date date)
returns text
language sql
immutable
set search_path = public
as $$
  select extract(day from p_date)::int || ' ' ||
         (array['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'])[extract(month from p_date)::int];
$$;

-- One row per requested item. Read-only: pay_obligations_bulk takes the locks
-- first and then calls this, so the plan it acts on cannot move underneath it.
create or replace function public.bulk_pay_plan(
  p_household_id uuid,
  p_cycle_id uuid,
  p_items jsonb
)
returns table (
  idx int,
  obligation_id uuid,
  title text,
  requested_by uuid,
  ok boolean,
  reason text,
  mode text,
  amount bigint,
  installment_count int,
  installment_from int,
  installment_to int,
  open_installments int,
  remaining_before bigint,
  remaining_after bigint,
  pending_id uuid,
  pending_planned bigint,
  allocation_id uuid,
  allocation_amount bigint,
  remainder bigint,
  extra_allocation bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item record;
  v_ob public.obligations%rowtype;
  v_amount_in bigint;
  v_count_in int;
  v_open int;
  v_pending_count int;
  v_dupes int;
begin
  for v_item in
    select (e.ord)::int as ord, e.value as item
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(value, ord)
  loop
    idx := v_item.ord;
    obligation_id := nullif(v_item.item ->> 'obligation_id', '')::uuid;
    title := null; requested_by := null; ok := false; reason := null; mode := null;
    amount := 0; installment_count := null; installment_from := null; installment_to := null;
    open_installments := 0; remaining_before := 0; remaining_after := 0;
    pending_id := null; pending_planned := null; allocation_id := null; allocation_amount := null;
    remainder := 0; extra_allocation := 0;
    v_amount_in := nullif(v_item.item ->> 'amount', '')::bigint;
    v_count_in := nullif(v_item.item ->> 'installment_count', '')::int;

    select * into v_ob from public.obligations o
     where o.id = obligation_id and o.household_id = p_household_id;
    if not found then
      reason := 'Tanggungan tidak ditemukan.';
      return next; continue;
    end if;
    title := v_ob.title;
    requested_by := v_ob.created_by;
    remaining_before := v_ob.remaining_amount;

    select count(*) into v_dupes
      from jsonb_array_elements(p_items) as d(value)
     where d.value ->> 'obligation_id' = obligation_id::text;
    if v_dupes > 1 then
      reason := 'Dipilih lebih dari sekali.';
      return next; continue;
    end if;
    if v_ob.status in ('SETTLED', 'CANCELLED') or v_ob.cancelled_at is not null or v_ob.remaining_amount <= 0 then
      reason := 'Tanggungan ini sudah selesai.';
      return next; continue;
    end if;

    select count(*) into v_open
      from public.obligation_installments i
     where i.household_id = p_household_id and i.obligation_id = v_ob.id
       and i.status not in ('SETTLED', 'CANCELLED');
    open_installments := v_open;

    if v_open > 0 then
      if v_count_in is null or v_amount_in is not null then
        reason := 'Tanggungan bercicilan dibayar per cicilan.';
        return next; continue;
      end if;
      if v_count_in < 1 or v_count_in > v_open then
        reason := 'Jumlah cicilan harus 1 sampai ' || v_open || '.';
        return next; continue;
      end if;
      installment_count := v_count_in;
      select coalesce(sum(greatest(0, s.planned_amount - greatest(0, s.paid_amount))), 0)
        into amount
        from (
          select i.planned_amount, i.paid_amount
            from public.obligation_installments i
           where i.household_id = p_household_id and i.obligation_id = v_ob.id
             and i.status not in ('SETTLED', 'CANCELLED')
           order by i.due_date asc nulls last, i.created_at asc, i.id asc
           limit v_count_in
        ) s;
      -- Position in the whole (non-cancelled) schedule, for "cicilan ke-5 & ke-6".
      select count(*) + 1 into installment_from
        from public.obligation_installments i
       where i.household_id = p_household_id and i.obligation_id = v_ob.id
         and i.status = 'SETTLED';
      installment_to := installment_from + v_count_in - 1;
      if amount <= 0 then
        reason := 'Cicilan terpilih tidak punya sisa tagihan.';
        return next; continue;
      end if;
      if amount > v_ob.remaining_amount then
        reason := 'Nominal cicilan melebihi sisa tanggungan. Bayar dari Detail Tanggungan.';
        return next; continue;
      end if;
    else
      if v_amount_in is null or v_count_in is not null then
        reason := 'Tanggungan tanpa jadwal cicilan dibayar dengan nominal.';
        return next; continue;
      end if;
      if v_amount_in < 1 or v_amount_in > v_ob.remaining_amount then
        reason := 'Nominal harus antara Rp 1 dan sisa tanggungan.';
        return next; continue;
      end if;
      amount := v_amount_in;
    end if;
    remaining_after := v_ob.remaining_amount - amount;

    select count(*) into v_pending_count
      from public.transactions t
     where t.household_id = p_household_id and t.cycle_id = p_cycle_id
       and t.obligation_id = v_ob.id and t.status = 'PENDING';
    if v_pending_count > 1 then
      reason := 'Ada ' || v_pending_count || ' rencana untuk tanggungan ini di siklus aktif. Bayar dari Detail Tanggungan.';
      return next; continue;
    end if;

    if v_pending_count = 1 then
      select t.id, t.planned_amount into pending_id, pending_planned
        from public.transactions t
       where t.household_id = p_household_id and t.cycle_id = p_cycle_id
         and t.obligation_id = v_ob.id and t.status = 'PENDING';
      select a.id, a.amount into allocation_id, allocation_amount
        from public.cycle_allocations a
       where a.household_id = p_household_id and a.transaction_id = pending_id
         and a.cancelled_at is null;
      remainder := greatest(0, least(pending_planned - amount, remaining_after));
      mode := case when remainder > 0 then 'EXECUTE_SPLIT' else 'EXECUTE' end;
      extra_allocation := amount + remainder - coalesce(allocation_amount, 0);
    else
      mode := 'NEW_PAYMENT';
      extra_allocation := amount;
    end if;

    ok := true;
    return next;
  end loop;
end;
$$;
revoke all on function public.bulk_pay_plan(uuid, uuid, jsonb) from public;

-- Global checks shared by preview and pay. NULL when fine.
create or replace function public.bulk_pay_problem(
  p_household_id uuid,
  p_account_id uuid,
  p_paid_at date,
  p_items jsonb
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_acc public.accounts%rowtype;
  v_n int := coalesce(jsonb_array_length(case when jsonb_typeof(p_items) = 'array' then p_items end), 0);
begin
  if v_n < 1 or v_n > 50 then
    return 'Pilih 1 sampai 50 tanggungan.';
  end if;
  if not exists (
    select 1 from public.cycles c
     where c.household_id = p_household_id and c.is_active and c.cancelled_at is null
  ) then
    return 'Belum ada siklus aktif. Buka siklus dulu sebelum membayar tanggungan.';
  end if;
  select * into v_acc from public.accounts a where a.id = p_account_id and a.household_id = p_household_id;
  if not found or v_acc.is_active is distinct from true or v_acc.type not in ('BANK', 'E_WALLET') then
    return 'Pembayaran tanggungan hanya dari rekening bank atau e-wallet aktif.';
  end if;
  if p_paid_at is null or p_paid_at > current_date then
    return 'Tanggal pembayaran tidak boleh kosong atau di masa depan.';
  end if;
  return null;
end;
$$;
revoke all on function public.bulk_pay_problem(uuid, uuid, date, jsonb) from public;

-- Resolves the fee category without writing: the given one, or "Biaya Transfer"
-- when it already exists. NULL id + ok means it will be created on pay.
create or replace function public.bulk_pay_fee_category(
  p_household_id uuid,
  p_fee_category_id uuid,
  out category_id uuid,
  out category_name text,
  out is_valid boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  is_valid := true;
  if p_fee_category_id is not null then
    select c.id, c.name into category_id, category_name
      from public.categories c
     where c.id = p_fee_category_id and c.household_id = p_household_id
       and c.type = 'EXPENSE' and c.system_role is null;
    if not found then
      is_valid := false;
    end if;
    return;
  end if;
  select c.id, c.name into category_id, category_name
    from public.categories c
   where c.household_id = p_household_id and c.type = 'EXPENSE' and c.system_role is null
     and lower(trim(c.name)) = 'biaya transfer'
   order by c.id
   limit 1;
  if not found then
    category_id := null;
    category_name := 'Biaya Transfer';
  end if;
end;
$$;
revoke all on function public.bulk_pay_fee_category(uuid, uuid) from public;

create or replace function public.preview_pay_obligations_bulk(
  p_household_id uuid,
  p_account_id uuid,
  p_paid_at date,
  p_items jsonb,
  p_total_debited bigint,
  p_fee_category_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_problem text;
  v_cycle_id uuid;
  v_items jsonb;
  v_subtotal bigint;
  v_all_ok boolean;
  v_fee bigint;
  v_fee_cat record;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Bukan anggota ruang keluarga ini.';
  end if;
  v_problem := public.bulk_pay_problem(p_household_id, p_account_id, p_paid_at, p_items);
  if v_problem is not null then
    return jsonb_build_object('error', v_problem, 'all_ok', false, 'items', '[]'::jsonb);
  end if;
  select c.id into v_cycle_id from public.cycles c
   where c.household_id = p_household_id and c.is_active and c.cancelled_at is null
   order by c.start_date desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'obligation_id', p.obligation_id, 'title', p.title, 'ok', p.ok, 'reason', p.reason,
           'mode', p.mode, 'amount', p.amount, 'installment_count', p.installment_count,
           'installment_from', p.installment_from, 'installment_to', p.installment_to,
           'open_installments', p.open_installments,
           'remaining_before', p.remaining_before, 'remaining_after', p.remaining_after,
           'remainder', p.remainder, 'extra_allocation', p.extra_allocation,
           'requested_by', p.requested_by) order by p.idx), '[]'::jsonb),
         coalesce(sum(p.amount) filter (where p.ok), 0),
         coalesce(bool_and(p.ok), false)
    into v_items, v_subtotal, v_all_ok
    from public.bulk_pay_plan(p_household_id, v_cycle_id, p_items) p;

  if p_total_debited is null or p_total_debited < v_subtotal then
    return jsonb_build_object(
      'error', 'Total keluar dari rekening tidak boleh lebih kecil dari subtotal. Atur bayar sebagian di baris tanggungannya.',
      'all_ok', false, 'items', v_items, 'subtotal', v_subtotal);
  end if;
  v_fee := p_total_debited - v_subtotal;
  select * into v_fee_cat from public.bulk_pay_fee_category(p_household_id, p_fee_category_id);
  if v_fee > 0 and not v_fee_cat.is_valid then
    return jsonb_build_object('error', 'Kategori biaya tidak valid.', 'all_ok', false,
                              'items', v_items, 'subtotal', v_subtotal);
  end if;

  return jsonb_build_object(
    'error', null,
    'all_ok', v_all_ok,
    'items', v_items,
    'subtotal', v_subtotal,
    'total_debited', p_total_debited,
    'fee_amount', v_fee,
    'fee_category_id', case when v_fee > 0 then v_fee_cat.category_id end,
    'fee_category_name', case when v_fee > 0 then v_fee_cat.category_name end,
    'fee_category_new', v_fee > 0 and v_fee_cat.category_id is null,
    'plans_executed', (select count(*) from jsonb_array_elements(v_items) x
                        where (x.value ->> 'ok')::boolean and x.value ->> 'mode' in ('EXECUTE', 'EXECUTE_SPLIT')),
    'remainder_plans', (select count(*) from jsonb_array_elements(v_items) x
                         where (x.value ->> 'ok')::boolean and (x.value ->> 'remainder')::bigint > 0),
    'extra_allocation', (select coalesce(sum((x.value ->> 'extra_allocation')::bigint), 0)
                           from jsonb_array_elements(v_items) x where (x.value ->> 'ok')::boolean)
  );
end;
$$;
grant execute on function public.preview_pay_obligations_bulk(uuid, uuid, date, jsonb, bigint, uuid) to authenticated;

-- Body of the batch summary for one recipient. Mirrors bulkPayNotification()
-- in lib/bulk-pay.ts; change both together.
create or replace function public.bulk_pay_notification_body(
  p_batch_id uuid,
  p_recipient uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_b public.payment_batches%rowtype;
  v_account text;
  v_mine int;
  v_lines text[] := '{}';
  v_total int;
  v_row record;
  v_shown int := 0;
begin
  select * into v_b from public.payment_batches where id = p_batch_id;
  select a.name into v_account from public.accounts a where a.id = v_b.account_id;

  select count(*) into v_mine
    from jsonb_array_elements(v_b.items) x
   where x.value ->> 'requested_by' = p_recipient::text;

  if v_mine > 0 then
    v_lines := v_lines || (v_mine || ' pengajuanmu sudah dibayar dari ' || coalesce(v_account, 'rekening') || '.');
  else
    v_lines := v_lines || ('Dari ' || coalesce(v_account, 'rekening') || ', ' || public.short_date_id(v_b.paid_at) || '.');
  end if;
  if nullif(trim(coalesce(v_b.note, '')), '') is not null then
    v_lines := v_lines || ('“' || trim(v_b.note) || '”');
  end if;

  v_total := jsonb_array_length(v_b.items);

  for v_row in
    select x.value ->> 'title' as title,
           (x.value ->> 'amount')::bigint as amount,
           nullif(x.value ->> 'installment_count', '')::int as installment_count,
           (x.value ->> 'remaining_after')::bigint as remaining_after
      from jsonb_array_elements(v_b.items) with ordinality as x(value, ord)
     order by (x.value ->> 'requested_by' = p_recipient::text) is true desc, x.ord asc
     limit 5
  loop
    v_shown := v_shown + 1;
    v_lines := v_lines || ('• ' || v_row.title || ' — ' || public.fmt_rupiah(v_row.amount) || ' ('
      || case
           when v_row.installment_count is not null then v_row.installment_count || ' cicilan'
           when coalesce(v_row.remaining_after, 0) <= 0 then 'lunas'
           else 'sisa ' || public.fmt_rupiah(v_row.remaining_after)
         end || ')');
  end loop;
  if v_total > v_shown then
    v_lines := v_lines || ('dan ' || (v_total - v_shown) || ' lainnya');
  end if;
  if v_b.fee_amount > 0 then
    v_lines := v_lines || ('Biaya transfer ' || public.fmt_rupiah(v_b.fee_amount));
  end if;
  return array_to_string(v_lines, E'\n');
end;
$$;
revoke all on function public.bulk_pay_notification_body(uuid, uuid) from public;

-- What the batch remembers about one item, frozen at payment time.
create or replace function public.bulk_pay_item_snapshot(p_plan record, p_transaction_id uuid)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
begin
  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'obligation_id', p_plan.obligation_id,
    'title', p_plan.title,
    'requested_by', p_plan.requested_by,
    'amount', p_plan.amount,
    'installment_count', p_plan.installment_count,
    'installment_from', p_plan.installment_from,
    'installment_to', p_plan.installment_to,
    'remaining_after', p_plan.remaining_after,
    'remainder_planned', p_plan.remainder
  );
end;
$$;

create or replace function public.pay_obligations_bulk(
  p_household_id uuid,
  p_account_id uuid,
  p_paid_at date,
  p_items jsonb,
  p_total_debited bigint,
  p_fee_category_id uuid default null,
  p_note text default null,
  p_notify_member_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_problem text;
  v_cycle_id uuid;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_plan record;
  v_bad record;
  v_subtotal bigint;
  v_count int;
  v_fee bigint;
  v_fee_cat record;
  v_fee_category_id uuid;
  v_debt_category_id uuid;
  v_batch_id uuid;
  v_txn_id uuid;
  v_pending public.transactions%rowtype;
  v_alloc_account uuid;
  v_left bigint;
  v_paid bigint;
  v_planned bigint;
  v_installment_id uuid;
  v_new_remaining bigint;
  v_summary boolean;
  v_recipients uuid[];
  v_recipient uuid;
  v_title text;
  v_items jsonb := '[]'::jsonb;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'Bukan anggota ruang keluarga ini.';
  end if;
  if v_note is not null and length(v_note) > 280 then
    raise exception 'Catatan maksimal 280 karakter.';
  end if;
  v_problem := public.bulk_pay_problem(p_household_id, p_account_id, p_paid_at, p_items);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  if exists (
    select 1 from unnest(coalesce(p_notify_member_ids, '{}')) as r(id)
     where r.id = v_uid
        or not exists (select 1 from public.household_members m
                        where m.household_id = p_household_id and m.user_id = r.id)
  ) then
    raise exception 'Penerima harus anggota lain di ruang keluarga ini.';
  end if;

  select c.id into v_cycle_id from public.cycles c
   where c.household_id = p_household_id and c.is_active and c.cancelled_at is null
   order by c.start_date desc limit 1
   for share;

  -- Lock order: obligations by id, then their plans in this cycle. Two members
  -- paying overlapping batches queue here instead of deadlocking.
  perform 1 from public.obligations o
   where o.household_id = p_household_id
     and o.id in (select (x.value ->> 'obligation_id')::uuid from jsonb_array_elements(p_items) x)
   order by o.id
   for update;
  perform 1 from public.transactions t
   where t.household_id = p_household_id and t.cycle_id = v_cycle_id and t.status = 'PENDING'
     and t.obligation_id in (select (x.value ->> 'obligation_id')::uuid from jsonb_array_elements(p_items) x)
   order by t.id
   for update;

  create temporary table if not exists pg_temp.bulk_pay_items on commit drop as
    select * from public.bulk_pay_plan(p_household_id, v_cycle_id, p_items) limit 0;
  -- pg-safeupdate (on for API calls in Supabase) rejects an unqualified DELETE.
  delete from pg_temp.bulk_pay_items where true;
  insert into pg_temp.bulk_pay_items select * from public.bulk_pay_plan(p_household_id, v_cycle_id, p_items);

  select * into v_bad from pg_temp.bulk_pay_items where not ok order by idx limit 1;
  if found then
    raise exception '%: %', coalesce(v_bad.title, 'Tanggungan'), v_bad.reason;
  end if;

  select coalesce(sum(amount), 0), count(*) into v_subtotal, v_count from pg_temp.bulk_pay_items;
  if p_total_debited is null or p_total_debited < v_subtotal then
    raise exception 'Total keluar dari rekening tidak boleh lebih kecil dari subtotal. Atur bayar sebagian di baris tanggungannya.';
  end if;
  v_fee := p_total_debited - v_subtotal;
  if v_fee > 0 then
    select * into v_fee_cat from public.bulk_pay_fee_category(p_household_id, p_fee_category_id);
    if not v_fee_cat.is_valid then
      raise exception 'Kategori biaya tidak valid.';
    end if;
    v_fee_category_id := v_fee_cat.category_id;
    if v_fee_category_id is null then
      insert into public.categories (household_id, name, type, monthly_budget)
      values (p_household_id, 'Biaya Transfer', 'EXPENSE', 0)
      returning id into v_fee_category_id;
    end if;
  end if;

  select c.id into v_debt_category_id from public.categories c
   where c.household_id = p_household_id and c.system_role = 'DEBT_PAYMENT';

  -- A batch of one item without a fee reads like any single payment: the
  -- Phase 15 per-obligation push still goes out and requesters are not added.
  v_summary := v_count > 1 or v_fee > 0;

  insert into public.payment_batches (
    household_id, cycle_id, account_id, paid_at, subtotal, total_debited, fee_amount,
    item_count, note, created_by
  ) values (
    p_household_id, v_cycle_id, p_account_id, p_paid_at, v_subtotal, p_total_debited, v_fee,
    v_count, v_note, v_uid
  ) returning id into v_batch_id;

  for v_plan in select * from pg_temp.bulk_pay_items order by idx loop
    if v_plan.mode in ('EXECUTE', 'EXECUTE_SPLIT') then
      select * into v_pending from public.transactions where id = v_plan.pending_id;
      -- Tag first: the payment trigger reads the batch id off the row it logs.
      -- planned_amount follows what is paid; a split's remainder is planned on
      -- its own row below, so keeping the old figure would plan it twice.
      update public.transactions
         set payment_batch_id = v_batch_id,
             planned_amount = v_plan.amount,
             category_id = coalesce(category_id, v_debt_category_id)
       where id = v_plan.pending_id;
      v_txn_id := v_plan.pending_id;
      perform public.execute_planned_transaction(
        p_household_id, v_plan.pending_id, v_plan.amount, p_account_id, p_paid_at, false
      );

      if v_plan.allocation_id is not null then
        select account_id into v_alloc_account from public.cycle_allocations where id = v_plan.allocation_id;
        update public.cycle_allocations set amount = v_plan.amount where id = v_plan.allocation_id;
      else
        v_alloc_account := p_account_id;
        insert into public.cycle_allocations (
          household_id, cycle_id, allocation_type, amount, obligation_id, account_id,
          category_id, created_by, transaction_id
        ) values (
          p_household_id, v_cycle_id, 'DEBT_PAYMENT', v_plan.amount, v_plan.obligation_id, p_account_id,
          coalesce(v_pending.category_id, v_debt_category_id), v_uid, v_plan.pending_id
        );
      end if;

      v_items := v_items || jsonb_build_array(public.bulk_pay_item_snapshot(v_plan, v_plan.pending_id));

      if v_plan.remainder > 0 then
        insert into public.transactions (
          household_id, cycle_id, obligation_id, name, direction, flow_type,
          planned_amount, actual_amount, status, release_date,
          category_id, account_id, created_by
        ) values (
          p_household_id, v_cycle_id, v_plan.obligation_id, v_pending.name, 'EXPENSE', 'DEBT_PAYMENT',
          v_plan.remainder, v_plan.remainder, 'PENDING', null,
          coalesce(v_pending.category_id, v_debt_category_id), v_pending.account_id, v_uid
        ) returning id into v_txn_id;
        insert into public.cycle_allocations (
          household_id, cycle_id, allocation_type, amount, obligation_id, account_id,
          category_id, created_by, transaction_id
        ) values (
          p_household_id, v_cycle_id, 'DEBT_PAYMENT', v_plan.remainder, v_plan.obligation_id, v_alloc_account,
          coalesce(v_pending.category_id, v_debt_category_id), v_uid, v_txn_id
        );
      end if;
    else
      -- No plan in this cycle: same shape as allocate_debt_payment (030), with
      -- the chosen date, the debt category and the batch tag.
      insert into public.transactions (
        household_id, cycle_id, obligation_id, name, direction, flow_type,
        planned_amount, actual_amount, status, release_date,
        category_id, account_id, created_by, executed_by, payment_batch_id
      ) values (
        p_household_id, v_cycle_id, v_plan.obligation_id, v_plan.title, 'EXPENSE', 'DEBT_PAYMENT',
        v_plan.amount, v_plan.amount, 'PAID', p_paid_at,
        v_debt_category_id, p_account_id, v_uid, v_uid, v_batch_id
      ) returning id into v_txn_id;
      v_items := v_items || jsonb_build_array(public.bulk_pay_item_snapshot(v_plan, v_txn_id));

      v_new_remaining := greatest(0, v_plan.remaining_before - v_plan.amount);
      update public.obligations
         set remaining_amount = v_new_remaining,
             status = case when v_new_remaining <= 0 then 'SETTLED' else 'PARTIAL' end
       where id = v_plan.obligation_id;

      v_left := v_plan.amount;
      for v_installment_id, v_paid, v_planned in
        select i.id, i.paid_amount, i.planned_amount
          from public.obligation_installments i
         where i.household_id = p_household_id
           and i.obligation_id = v_plan.obligation_id
           and i.status not in ('SETTLED', 'CANCELLED')
         order by i.due_date asc nulls last, i.created_at asc, i.id asc
      loop
        exit when v_left <= 0;
        v_paid := greatest(0, v_paid);
        update public.obligation_installments
           set paid_amount = least(v_planned, v_paid + v_left),
               paid_transaction_id = v_txn_id,
               status = case when v_paid + v_left >= v_planned then 'SETTLED' else 'PARTIAL' end
         where id = v_installment_id;
        v_left := greatest(0, v_left - greatest(0, v_planned - v_paid));
      end loop;
      if v_new_remaining <= 0 then
        update public.obligation_installments
           set paid_amount = planned_amount,
               paid_transaction_id = coalesce(paid_transaction_id, v_txn_id),
               status = 'SETTLED'
         where household_id = p_household_id
           and obligation_id = v_plan.obligation_id
           and status not in ('SETTLED', 'CANCELLED');
      end if;

      insert into public.cycle_allocations (
        household_id, cycle_id, allocation_type, amount, obligation_id, account_id,
        category_id, created_by, transaction_id
      ) values (
        p_household_id, v_cycle_id, 'DEBT_PAYMENT', v_plan.amount, v_plan.obligation_id, p_account_id,
        v_debt_category_id, v_uid, v_txn_id
      );
    end if;
  end loop;

  if v_fee > 0 then
    insert into public.transactions (
      household_id, cycle_id, name, direction, flow_type,
      planned_amount, actual_amount, status, release_date,
      category_id, account_id, created_by, executed_by, payment_batch_id
    ) values (
      p_household_id, v_cycle_id, 'Biaya transfer', 'EXPENSE', 'EXPENSE',
      v_fee, v_fee, 'PAID', p_paid_at,
      v_fee_category_id, p_account_id, v_uid, v_uid, v_batch_id
    ) returning id into v_txn_id;
    update public.payment_batches set fee_transaction_id = v_txn_id where id = v_batch_id;
  end if;

  -- Recipients: requesters of any item (only when this is a summary batch),
  -- plus whoever the payer chose. Never the payer.
  select coalesce(array_agg(distinct r), '{}') into v_recipients
    from (
      select b.requested_by as r from pg_temp.bulk_pay_items b
       where v_summary and b.requested_by is not null and b.requested_by <> v_uid
         and exists (select 1 from public.household_members m
                      where m.household_id = p_household_id and m.user_id = b.requested_by)
      union
      select x from unnest(coalesce(p_notify_member_ids, '{}')) as x
    ) s;

  update public.payment_batches set recipient_ids = v_recipients, items = v_items where id = v_batch_id;

  v_title := public.member_label(p_household_id, v_uid) || ' bayar ' || v_count || ' tanggungan · '
          || public.fmt_rupiah(p_total_debited);
  foreach v_recipient in array v_recipients loop
    perform public.notify_member(
      p_household_id, v_recipient, 'OBLIGATIONS_BULK_PAID', v_uid, null, null,
      v_title, public.bulk_pay_notification_body(v_batch_id, v_recipient),
      jsonb_build_object('payment_batch_id', v_batch_id, 'count', v_count, 'total_debited', p_total_debited)
    );
  end loop;

  return v_batch_id;
end;
$$;
grant execute on function public.pay_obligations_bulk(uuid, uuid, date, jsonb, bigint, uuid, text, uuid[]) to authenticated;


-- ============ 5. Realtime ============

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_batches') then
    alter publication supabase_realtime add table public.payment_batches;
  end if;
end $$;

alter table public.payment_batches replica identity full;

-- realtime_health() is not redefined (contract owned by 003, see 033).

-- Manual verification (SQL Editor, first run):
--
-- 1. Objects and realtime (expect 1 row, relreplident = 'f'; then 2 rows):
--   select pt.tablename, c.relreplident
--     from pg_publication_tables pt
--     join pg_class c on c.relname = pt.tablename and c.relnamespace = 'public'::regnamespace
--    where pt.pubname = 'supabase_realtime' and pt.tablename = 'payment_batches';
--   select proname from pg_proc where proname in ('preview_pay_obligations_bulk', 'pay_obligations_bulk');
--
-- 2. Preview is read-only and reports per item (pick an open tanggungan):
--   select public.preview_pay_obligations_bulk(
--     '<household>', '<bank account>', current_date,
--     '[{"obligation_id": "<obligation>", "amount": 1000}]'::jsonb, 1000, null);
--
-- 3. A planned Reimburse/Tagihan without a schedule can be executed again
--    (expect no exception, then roll back):
--   begin;
--   select public.execute_planned_transaction(t.household_id, t.id, t.planned_amount,
--          '<bank account>', current_date, false)
--     from public.transactions t
--    where t.status = 'PENDING' and t.obligation_id is not null
--      and not exists (select 1 from public.obligation_installments i where i.obligation_id = t.obligation_id)
--    limit 1;
--   rollback;
--
-- 4. Existing double counts from the Detail Tanggungan path (Phase 16 follow-up).
--    Obligations with a PENDING plan whose planned amount exceeds what is still
--    owed, or with more than one live allocation in the active cycle. Resolve per
--    row by cancelling the stale plan in the app (Batalkan rencana); nothing here
--    changes data:
--   select o.title, o.remaining_amount, t.id as pending_id, t.planned_amount
--     from public.transactions t
--     join public.obligations o on o.id = t.obligation_id
--     join public.cycles c on c.id = t.cycle_id and c.is_active and c.cancelled_at is null
--    where t.status = 'PENDING' and t.planned_amount > o.remaining_amount;
--   select o.title, count(*) as live_allocations, sum(a.amount) as allocated, o.remaining_amount
--     from public.cycle_allocations a
--     join public.obligations o on o.id = a.obligation_id
--     join public.cycles c on c.id = a.cycle_id and c.is_active and c.cancelled_at is null
--    where a.cancelled_at is null
--    group by o.id, o.title, o.remaining_amount
--   having count(*) > 1;
--
-- 5. After a real batch from the app: one batch, its rows, and one summary per
--    recipient, no OBLIGATION_PAYMENT for the same moment:
--   select id, item_count, subtotal, fee_amount, total_debited, recipient_ids
--     from public.payment_batches order by created_at desc limit 1;
--   select name, flow_type, actual_amount, status from public.transactions
--    where payment_batch_id = '<batch>';
--   select kind, title, body from public.notifications order by created_at desc limit 5;
