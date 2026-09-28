-- ============================================================================
-- 013 — Backfill `accounts.sort_order` for households seeded after 010
-- ============================================================================
--
-- Why the number skips 012
-- ------------------------
-- Phase 12 (`cycles.primary_account_id`, see docs/phase-12-rekonsiliasi-tutup-siklus.md
-- §2.1) is planned to land as 012. This migration is independent of it and
-- touches a different table, so it takes the next free number rather than
-- claiming 012 and colliding with that plan.
--
-- The gap this closes
-- -------------------
-- `010_account_management.sql` §6 numbered the four seeded accounts (Mandiri 1,
-- CC Mandiri 2, ShopeePay 3, Tunai 4) so the picker would read them in the
-- order the seed writes them. That UPDATE only matched rows that existed when
-- 010 ran.
--
-- `lib/seed.ts` did not write `sort_order` at the time, so every household
-- created *after* 010 got four rows tied at the column default of 0.
-- `sortAccounts` (lib/account.ts) breaks a tie alphabetically, and 'CC Mandiri'
-- sorts before 'Mandiri' — so the credit card became the first account. Quick
-- Add defaults to the first account, and writes `OPERATING_INCOME` against it,
-- which is how a family's salary ends up recorded as arriving on a card.
--
-- `lib/seed.ts` now writes the same 1..4 explicitly, so no new household can
-- land in this gap. This migration only repairs the ones already in it.
--
-- Why re-running 010's statement is the right shape
-- -------------------------------------------------
-- The `not exists (... sort_order <> 0)` guard is what makes this safe and
-- still correct: it matches a household only while *every* row is untouched at
-- 0, and leaves one alone the moment a member has arranged the list or added an
-- account of their own. That is exactly the set of households this migration is
-- for, so the predicate is reused verbatim rather than loosened to
-- `sort_order = 0` per row — the latter would renumber rows in a household that
-- has deliberately ordered them, which is worse than leaving the gap.
--
-- Idempotent: on a second run the guard matches nothing, since the first run
-- left those households with non-zero sort_order.
--
-- No RLS, realtime, or schema change: `sort_order` already exists (010) and
-- `accounts` is already in the realtime publication with replica identity full
-- (003), so a repaired order reaches the partner's phone with no republication.
-- ============================================================================

with seeded(name, ord) as (
  values ('Mandiri', 1), ('CC Mandiri', 2), ('ShopeePay', 3), ('Tunai', 4)
)
update public.accounts a
  set sort_order = s.ord
  from seeded s
  where a.name = s.name
    and a.sort_order = 0
    and not exists (
      select 1 from public.accounts x
      where x.household_id = a.household_id
        and x.sort_order <> 0
    );
