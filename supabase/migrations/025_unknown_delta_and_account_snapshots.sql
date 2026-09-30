-- Kitasaku 025: preserve unknown first-cycle delta and add stated secondary snapshots.
-- Forward-only. No snapshots or transaction history are synthesized.

alter table public.cycle_reconciliations
  alter column delta drop not null;

comment on column public.cycle_reconciliations.delta is
  'Frozen reconciliation difference; NULL when the opening anchor is unknown.';

create table if not exists public.cycle_account_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  closing_stated bigint not null check (closing_stated >= 0),
  noted_at timestamptz not null default now(),
  noted_by uuid references auth.users(id) on delete set null,
  unique (cycle_id, account_id)
);

create index if not exists idx_cycle_account_snapshots_household_cycle
  on public.cycle_account_snapshots (household_id, cycle_id);
create index if not exists idx_cycle_account_snapshots_account
  on public.cycle_account_snapshots (account_id);

create or replace function public.validate_cycle_account_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cycle_household uuid;
  v_account_household uuid;
  v_account_type text;
  v_account_active boolean;
begin
  select household_id into v_cycle_household
    from public.cycles where id = new.cycle_id;
  if v_cycle_household is null or v_cycle_household <> new.household_id then
    raise exception 'cycle_account_snapshots: cycle does not belong to household.';
  end if;
  select household_id, type, is_active into v_account_household, v_account_type, v_account_active
    from public.accounts where id = new.account_id;
  if v_account_household is null or v_account_household <> new.household_id then
    raise exception 'cycle_account_snapshots: account does not belong to household.';
  end if;
  if v_account_type not in ('BANK', 'E_WALLET') or v_account_active is distinct from true then
    raise exception 'Snapshot hanya dapat dicatat untuk rekening kas aktif.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_cycle_account_snapshot on public.cycle_account_snapshots;
create trigger trg_validate_cycle_account_snapshot
  before insert or update on public.cycle_account_snapshots
  for each row execute function public.validate_cycle_account_snapshot();

alter table public.cycle_account_snapshots enable row level security;
drop policy if exists household_scoped_select_cycle_account_snapshots on public.cycle_account_snapshots;
create policy household_scoped_select_cycle_account_snapshots
  on public.cycle_account_snapshots for select
  using (exists (select 1 from public.household_members m
    where m.household_id = cycle_account_snapshots.household_id and m.user_id = auth.uid()));
drop policy if exists household_scoped_write_cycle_account_snapshots on public.cycle_account_snapshots;
create policy household_scoped_write_cycle_account_snapshots
  on public.cycle_account_snapshots for all
  using (exists (select 1 from public.household_members m
    where m.household_id = cycle_account_snapshots.household_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.household_members m
    where m.household_id = cycle_account_snapshots.household_id and m.user_id = auth.uid()));

alter table public.cycle_account_snapshots replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.cycle_account_snapshots;
    exception when duplicate_object then
      raise notice 'realtime: cycle_account_snapshots already registered (skipped)';
    end;
  else
    raise notice 'realtime: publication missing; skipping cycle_account_snapshots';
  end if;
end $$;

create or replace function public.close_cycle_reconciliation(
  p_household_id uuid,
  p_cycle_id uuid,
  p_account_id uuid,
  p_opening_stated bigint,
  p_closing_stated bigint,
  p_recorded_net bigint,
  p_delta bigint,
  p_category_id uuid,
  p_sweep_requested boolean default false
)
returns table (
  reconciliation_id uuid,
  adjustment_txn_id uuid,
  swept_amount bigint,
  swept_account_count integer,
  sweep_skipped boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cycle public.cycles%rowtype;
  v_account public.accounts%rowtype;
  v_prior_cycle_id uuid;
  v_expected_opening bigint;
  v_expected_recorded_net bigint := 0;
  v_expected_delta bigint;
  v_reconciliation_id uuid;
  v_adjustment_txn_id uuid;
  v_swept_amount bigint := 0;
  v_swept_account_count integer := 0;
  v_candidate_count integer := 0;
  v_sweep_skipped boolean := false;
  r record;
begin
  if not exists (select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = v_uid) then
    raise exception 'Not a member of household %', p_household_id;
  end if;
  select * into v_cycle from public.cycles c
   where c.id = p_cycle_id and c.household_id = p_household_id for update;
  if not found then raise exception 'Cycle % does not belong to household %', p_cycle_id, p_household_id; end if;
  if not v_cycle.is_active or v_cycle.closed_at is not null then raise exception 'Siklus ini sudah ditutup.'; end if;
  select * into v_account from public.accounts a
   where a.id = p_account_id and a.household_id = p_household_id;
  if not found or v_account.type <> 'BANK' or v_account.is_active is distinct from true then
    raise exception 'Reconciliation account must be an active BANK.';
  end if;
  if v_cycle.primary_account_id is distinct from p_account_id then
    raise exception 'Akun rekonsiliasi harus sama dengan akun primer siklus.';
  end if;
  if p_closing_stated is null or p_closing_stated < 0 then raise exception 'Saldo akhir tidak boleh negatif.'; end if;
  if exists (select 1 from public.cycle_reconciliations r where r.cycle_id = p_cycle_id) then
    raise exception 'Siklus ini sudah direkonsiliasi.';
  end if;
  if exists (select 1 from public.transactions t where t.household_id = p_household_id
      and t.cycle_id = p_cycle_id and t.status = 'PENDING') then
    raise exception 'Masih ada transaksi yang belum dieksekusi.';
  end if;
  if exists (select 1 from public.transactions t where t.household_id = p_household_id
      and t.cycle_id = p_cycle_id and t.account_id is null) then
    raise exception 'Masih ada transaksi tanpa akun.';
  end if;
  if exists (select 1 from public.transactions t where t.household_id = p_household_id
      and t.cycle_id is null and (t.account_id = p_account_id or t.counter_account_id = p_account_id)) then
    raise exception 'Masih ada transaksi non-siklus pada akun primer yang belum ditinjau.';
  end if;

  select c.id into v_prior_cycle_id from public.cycles c
   where c.household_id = p_household_id and c.end_date < v_cycle.start_date
   order by c.end_date desc limit 1;
  if v_prior_cycle_id is null then
    v_expected_opening := null;
  else
    select r.closing_stated into v_expected_opening from public.cycle_reconciliations r
     where r.household_id = p_household_id and r.cycle_id = v_prior_cycle_id
       and r.account_id = p_account_id;
    if not found then v_expected_opening := null; end if;
  end if;
  if p_opening_stated is distinct from v_expected_opening then
    raise exception 'Saldo awal tidak cocok dengan jangkar siklus sebelumnya.';
  end if;

  select coalesce(sum(case
    when t.flow_type = 'TRANSFER' and t.account_id = p_account_id then -t.actual_amount
    when t.flow_type = 'TRANSFER' and t.counter_account_id = p_account_id then t.actual_amount
    when t.account_id = p_account_id and t.flow_type in ('OPERATING_INCOME','FINANCING_INFLOW','ASSET_RELEASE') then t.actual_amount
    when t.account_id = p_account_id and t.flow_type in ('EXPENSE','DEBT_PAYMENT','ASSET_ALLOCATION') then -t.actual_amount
    else 0 end), 0)::bigint into v_expected_recorded_net
    from public.transactions t where t.household_id = p_household_id
      and t.cycle_id = p_cycle_id and t.status = 'PAID';
  v_expected_delta := case when v_expected_opening is null then null
    else (p_closing_stated - v_expected_opening) - v_expected_recorded_net end;
  if p_recorded_net is distinct from v_expected_recorded_net or p_delta is distinct from v_expected_delta then
    raise exception 'Angka rekonsiliasi berubah. Muat ulang pratinjau lalu coba lagi.';
  end if;

  create temporary table _cycle_sweep_candidates (account_id uuid primary key, amount bigint not null) on commit drop;
  insert into _cycle_sweep_candidates (account_id, amount)
  select a.id, sum(case
    when t.flow_type = 'TRANSFER' and t.counter_account_id = a.id then t.actual_amount
    when t.flow_type = 'TRANSFER' and t.account_id = a.id then -t.actual_amount
    when t.account_id = a.id and t.flow_type in ('OPERATING_INCOME','FINANCING_INFLOW','ASSET_RELEASE') then t.actual_amount
    when t.account_id = a.id and t.flow_type in ('EXPENSE','DEBT_PAYMENT','ASSET_ALLOCATION') then -t.actual_amount
    else 0 end)::bigint
  from public.accounts a left join public.transactions t
    on t.household_id = p_household_id and t.cycle_id = p_cycle_id and t.status = 'PAID'
    and (t.account_id = a.id or t.counter_account_id = a.id)
  where a.household_id = p_household_id and a.is_active = true
    and a.type in ('BANK', 'E_WALLET', 'CASH') and a.id <> p_account_id
  group by a.id
  having sum(case
    when t.flow_type = 'TRANSFER' and t.counter_account_id = a.id then t.actual_amount
    when t.flow_type = 'TRANSFER' and t.account_id = a.id then -t.actual_amount
    when t.account_id = a.id and t.flow_type in ('OPERATING_INCOME','FINANCING_INFLOW','ASSET_RELEASE') then t.actual_amount
    when t.account_id = a.id and t.flow_type in ('EXPENSE','DEBT_PAYMENT','ASSET_ALLOCATION') then -t.actual_amount
    else 0 end) > 0;
  select count(*)::integer, coalesce(sum(amount), 0)::bigint into v_candidate_count, v_swept_amount from _cycle_sweep_candidates;
  if v_candidate_count > 0 and not p_sweep_requested
     and (select h.sweep_policy from public.households h where h.id = p_household_id) = 'REQUIRED' then
    raise exception 'Sapu akun wajib diselesaikan sebelum siklus ditutup.';
  end if;
  v_sweep_skipped := v_candidate_count > 0 and not p_sweep_requested;

  if v_expected_delta is not null and v_expected_delta <> 0 then
    if p_category_id is null then raise exception 'Kategori Tidak Terlacak belum tersedia.'; end if;
    insert into public.transactions (household_id, cycle_id, name, category_id, account_id,
      direction, flow_type, planned_amount, actual_amount, status, release_date, created_by, executed_by)
    values (p_household_id, p_cycle_id, 'Penyesuaian Saldo', p_category_id, p_account_id,
      case when v_expected_delta < 0 then 'EXPENSE' else 'INCOME' end,
      case when v_expected_delta < 0 then 'EXPENSE' else 'OPERATING_INCOME' end,
      abs(v_expected_delta), abs(v_expected_delta), 'PAID', current_date, v_uid, v_uid)
    returning id into v_adjustment_txn_id;
    if v_expected_delta < 0 then
      insert into public.cycle_allocations (household_id, cycle_id, allocation_type, amount,
        category_id, account_id, note, created_by)
      values (p_household_id, p_cycle_id, 'OTHER', abs(v_expected_delta), p_category_id,
        p_account_id, 'Rekonsiliasi ' || current_date::text, v_uid);
    end if;
  end if;

  insert into public.cycle_reconciliations (household_id, cycle_id, account_id, opening_stated,
    closing_stated, recorded_net, delta, adjustment_txn_id, noted_by)
  values (p_household_id, p_cycle_id, p_account_id, v_expected_opening, p_closing_stated,
    v_expected_recorded_net, v_expected_delta, v_adjustment_txn_id, v_uid)
  returning id into v_reconciliation_id;

  if p_sweep_requested then
    for r in select account_id, amount from _cycle_sweep_candidates order by account_id loop
      insert into public.transactions (household_id, cycle_id, name, direction, flow_type,
        planned_amount, actual_amount, status, release_date, account_id, counter_account_id, created_by, executed_by)
      values (p_household_id, p_cycle_id, 'Sapu akun ke akun primer', 'EXPENSE', 'TRANSFER',
        r.amount, r.amount, 'PAID', current_date, r.account_id, p_account_id, v_uid, v_uid);
      v_swept_account_count := v_swept_account_count + 1;
    end loop;
  end if;
  update public.cycles set is_active = false, closed_at = now(), closed_by = v_uid,
    sweep_completed_at = case when p_sweep_requested then now() else null end,
    sweep_skipped = v_sweep_skipped where id = p_cycle_id;
  return query select v_reconciliation_id, v_adjustment_txn_id,
    case when p_sweep_requested then v_swept_amount else 0 end, v_swept_account_count, v_sweep_skipped;
end;
$$;

grant execute on function public.close_cycle_reconciliation(uuid, uuid, uuid, bigint, bigint, bigint, bigint, uuid, boolean) to authenticated;
