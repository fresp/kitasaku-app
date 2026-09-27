-- Kitasaku 008: obligation repayment mode.
--
-- Design source: design.pen "Screen - Detail Pinjaman" — the "Mode Pembayaran"
-- card with three options and one selected:
--   * "Lunas bln depan"   -> LUMP_NEXT_MONTH
--   * "Cicil per siklus"  -> INSTALLMENT
--   * "Manual"            -> MANUAL
--
-- Why this is a separate column from `repayment_method` (005): the two answer
-- different questions. `repayment_method` is HOW the money moves (TRANSFER,
-- CASH, AUTO_DEBIT, ...); `repayment_mode` is the SHAPE of the plan — settle it
-- in one go next cycle, split it across a schedule, or decide per payment.
-- Collapsing them would force the picker to offer "Transfer" as a plan.
--
-- Nothing in the money maths reads this column. It changes no amount, no
-- allocation and no status; it only decides which shape the Detail Pinjaman
-- screen presents and which schedule it offers to generate.
--
-- Deliberately NOT backfilled. A guess ("every loan with a schedule is
-- INSTALLMENT, everything else is LUMP_NEXT_MONTH") would write a plan the
-- family never chose, and the screen would then show a mode as though someone
-- had picked it. NULL means "not chosen yet": the client derives a *display*
-- default from `installment_count` (see `repaymentModeOf` in
-- lib/obligation.ts) and only writes the column when a person taps an option —
-- the same stance 007 takes on `households.payday_day`.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS; the constraint is added only when
-- absent; the RPC is CREATE OR REPLACE.
--
-- ============ 1. obligations.repayment_mode ============
alter table public.obligations
  add column if not exists repayment_mode text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.obligations'::regclass
      and conname = 'obligations_repayment_mode_check'
  ) then
    alter table public.obligations
      add constraint obligations_repayment_mode_check check (
        repayment_mode is null
        or repayment_mode in ('LUMP_NEXT_MONTH', 'INSTALLMENT', 'MANUAL')
      );
  end if;
end $$;

comment on column public.obligations.repayment_mode is
  'Plan shape: LUMP_NEXT_MONTH | INSTALLMENT | MANUAL. NULL = not chosen; the client derives a display default and only writes on an explicit tap. Not read by any money calculation.';

-- ============ 2. set_obligation_repayment_mode ============
-- An RPC rather than a direct table write so the household check and the value
-- check live in one place and a malformed value cannot reach the column from a
-- hand-rolled client. It moves no money, so it deliberately does not touch
-- transactions, cycle_allocations, or remaining_amount.
create or replace function public.set_obligation_repayment_mode(
  p_household_id uuid,
  p_obligation_id uuid,
  p_mode text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_household uuid;
begin
  if not exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = v_uid
  ) then
    raise exception 'Not a member of household %', p_household_id;
  end if;

  if p_mode is not null
     and p_mode not in ('LUMP_NEXT_MONTH', 'INSTALLMENT', 'MANUAL') then
    raise exception 'Mode pembayaran tidak dikenal: %', p_mode;
  end if;

  select household_id into v_household
    from public.obligations where id = p_obligation_id;
  if v_household is null then
    raise exception 'Obligation % not found', p_obligation_id;
  end if;
  if v_household <> p_household_id then
    raise exception 'Obligation % does not belong to household %', p_obligation_id, p_household_id;
  end if;

  update public.obligations
    set repayment_mode = p_mode
    where id = p_obligation_id;
end;
$$;

grant execute on function public.set_obligation_repayment_mode(uuid, uuid, text) to authenticated;

-- Manual verification (SQL Editor, first run):
--   -- as a member: must succeed, and must NOT change remaining_amount
--   select remaining_amount from public.obligations where id = '<obligation-uuid>';
--   select public.set_obligation_repayment_mode('<household-uuid>', '<obligation-uuid>', 'INSTALLMENT');
--   select repayment_mode, remaining_amount from public.obligations where id = '<obligation-uuid>';
--   -- must fail: unknown mode
--   select public.set_obligation_repayment_mode('<household-uuid>', '<obligation-uuid>', 'YOLO');
--   -- must fail: obligation of another household
--   select public.set_obligation_repayment_mode('<other-household-uuid>', '<obligation-uuid>', 'MANUAL');
