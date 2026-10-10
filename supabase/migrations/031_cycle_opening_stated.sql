-- Kitasaku 031: a cycle can state the balance it started from.
-- Apply only after 001-030. Fully idempotent. No data is rewritten.
--
-- Until now the opening balance of a cycle was only ever derived: it is the
-- closing balance of the cycle before it, read from cycle_reconciliations or
-- cycle_account_snapshots (lib/queries.ts useHomeCashBalance). That works from
-- the second cycle onward and never for the first, and it means the number is
-- not available until a month after the household starts using the app. Until
-- it exists Home cannot show a balance at all: it falls back to "Pergerakan
-- akun", a net movement that reads like a balance and is often negative.
--
-- So the household may now state it when the cycle is opened. The stored figure
-- is the balance of the cycle's own primary account on its first day; every
-- other account keeps deriving its opening from the prior cycle, which is what
-- the per-account reconciliation has always done.
--
-- Derived still wins where both exist: a prior cycle that was actually
-- reconciled is a measured figure, while this one is typed from memory.

alter table public.cycles
  add column if not exists opening_stated bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'cycles_opening_stated_nonneg'
       and conrelid = 'public.cycles'::regclass
  ) then
    alter table public.cycles
      add constraint cycles_opening_stated_nonneg
      check (opening_stated is null or opening_stated >= 0);
  end if;
end;
$$;

comment on column public.cycles.opening_stated is
  'Balance of this cycle''s primary account on its first day, as stated by the household when the cycle was opened. NULL means derive it from the prior cycle''s closing figure, which takes precedence when both exist.';

-- A cycle that has already been reconciled has a measured opening; letting the
-- stated one change underneath it would move the delta after the fact.
create or replace function public.guard_opening_stated_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.opening_stated is distinct from old.opening_stated
     and exists (select 1 from public.cycle_reconciliations r where r.cycle_id = old.id) then
    raise exception 'Siklus ini sudah direkonsiliasi, saldo awalnya tidak dapat diubah.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_opening_stated_update on public.cycles;
create trigger trg_guard_opening_stated_update
  before update of opening_stated on public.cycles
  for each row execute function public.guard_opening_stated_update();

-- Manual verification (SQL Editor, first run):
--
-- 1. The column and its guard exist:
--   select column_name, data_type from information_schema.columns
--    where table_name = 'cycles' and column_name = 'opening_stated';
--   select tgname from pg_trigger where tgname = 'trg_guard_opening_stated_update';
--
-- 2. Cycles that would benefit — no prior cycle to derive an opening from, so
--    Home can only show movement for them until this is filled in:
--   select c.id, c.name, c.start_date, c.opening_stated, c.primary_account_id
--     from public.cycles c
--    where c.cancelled_at is null
--      and not exists (select 1 from public.cycles p
--                       where p.household_id = c.household_id
--                         and p.cancelled_at is null
--                         and p.end_date < c.start_date)
--    order by c.start_date;
--
-- 3. The guard refuses a change on a reconciled cycle (expect the exception):
--   update public.cycles set opening_stated = 1
--    where id = (select cycle_id from public.cycle_reconciliations limit 1);
--
-- 4. Backfilling the active cycle by hand, if you want the figure now rather
--    than at the next cycle open (replace the amount with the real balance):
--   update public.cycles set opening_stated = <saldo>
--    where id = '<cycle id>' and opening_stated is null;
