-- Kitasaku 010: managed accounts — the identity fields an account screen needs.
--
-- Design source: design.pen
--   * "Screen 2 - Konfirmasi Sheet" — the "Bayar dari" pills. "Mandiri" renders
--     a `•• 8821` sub-line, "CC Mandiri" renders `•• 4402`, and "ShopeePay"
--     currently renders `Rp 2,1 jt`.
--   * "Screen 8 - Alokasi Modal" — `AKUN SUMBER: Mandiri •• 8821`.
--   * "Screen 9 - Template Rutin" — `Mandiri •• 8821  •  Tgl 10`.
--   * "Screen - Managed Account" (new; prompted in
--     Family Spending/PEN_DEV_MANAGED_ACCOUNT_PROMPT.md).
--
-- 001 gave `accounts` three columns — name, type, household_id — and every
-- screen above renders a fourth thing the table cannot store: an account
-- identifier. Until now that identifier lived only inside the design file, and
-- the app's offline fallback carried a hardcoded `BCA •• 8821` in
-- lib/mockData.ts. This migration makes it real, so the number a family types
-- is the number every screen masks.
--
-- ============ Why there is deliberately NO balance column ============
-- The design's ShopeePay pill shows `Rp 2,1 jt` where the other two show an
-- account number. That is NOT modelled here, and the prompt asks pen.dev to
-- remove it. Two reasons:
--
--   1. A stored balance is a second source of truth. The moment a transaction
--      is edited, an allocation is moved, or a cycle is reopened, a
--      `accounts.balance` column is wrong until something remembers to rewrite
--      it — and nothing in this schema does. Every other money figure in this
--      app is derived from the ledger (see `assetSummary` / `liabilitySeries`
--      in lib/insight.ts, which reconstruct a balance backwards from today's
--      transactions precisely because there is no stored opening balance).
--   2. The sub-line means two different things on the same row of pills — a
--      masked number on "Mandiri" and a rupiah amount on "ShopeePay". A picker
--      whose rows answer different questions is read as a list of balances that
--      happens to be missing two of them.
--
-- If a per-account balance is ever wanted, it is a query — opening balance plus
-- the account's transactions — not a column. Adding one later is a new
-- migration; adding one now costs correctness on every write path in the app.
--
-- ============ Why `is_active` instead of deleting ============
-- Three tables reference `accounts`, and none of them agree on what a delete
-- should mean (verified against the live constraint catalogue):
--
--   transactions.account_id          NO ACTION   (001, declared with no clause)
--   recurring_templates.account_id   NO ACTION   (001, declared with no clause)
--   cycle_allocations.account_id     SET NULL    (004, declared explicitly)
--
-- So the database already refuses to delete an account any transaction or
-- template points at. That is the correct behaviour — the ledger must not
-- silently forget which account paid a bill — but it means a retired account
-- ("CC Mandiri lama") can never be removed, only hidden. `is_active = false` is
-- that hide: the account stops appearing in pickers, and its history keeps
-- resolving its name.
--
-- The third reference is the sharper argument for archiving. Because
-- `cycle_allocations` is SET NULL, a delete that *is* allowed — an account no
-- transaction or template uses, but which older allocations still name — would
-- succeed and silently blank the account on those allocations. The allocation's
-- amount and category survive, so nothing looks broken; the account just quietly
-- stops being recorded. Archiving keeps that row intact.
--
-- The client therefore offers `Hapus` only for an account with no transaction
-- and no template reference, and offers `Arsipkan` otherwise. That is a UI
-- mirror of the constraint above, not a separate policy.
--
-- ============ What this migration does NOT change ============
-- No RLS change. 001 already ships `household_scoped_select_accounts` plus
-- `household_scoped_write_accounts` (FOR ALL, with a matching WITH CHECK), so
-- every member can already create, rename, archive and re-activate an account
-- in their own household. 003 already put `accounts` in the realtime
-- publication with `replica identity full`, so new and changed columns stream to
-- the other spouse with no further setup.
--
-- No money maths reads any column below. Not one amount, allocation or status
-- changes; these fields only describe which account a payment came from.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS everywhere; the constraints and the
-- index are created only when absent; the seed update is guarded so re-running
-- cannot renumber accounts someone has already reordered.
--
-- Run order: after 001 (the table) and after 003 (realtime). Independent of
-- 004–009, so it is safe to apply on its own once the earlier migrations are in.

-- ============ 1. accounts.account_number ============
-- Stored in full, masked at render time.
--
-- The alternative — storing only the last four digits — was rejected: a family
-- that wants to actually use the number (copy it into a banking app, read it
-- out to a teller) would have to go find the card again, and the stored value
-- could never be shown even when the user is looking straight at their own
-- account. The masking is a presentation rule, so it lives in the client
-- (`maskAccountNumber`), and this column keeps what was typed.
--
-- The client normalises on input (trim, drop spaces and dashes) before writing,
-- so `1234 5678 9012` and `1234-5678-9012` cannot become two different rows for
-- the same account. Length is bounded here rather than the character set;
-- Indonesian banks are numeric but e-wallet and virtual-account identifiers are
-- not uniformly so, and a CHECK on digits would reject a legitimate one.
alter table public.accounts
  add column if not exists account_number text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.accounts'::regclass
      and conname = 'accounts_account_number_length_check'
  ) then
    alter table public.accounts
      add constraint accounts_account_number_length_check
      check (account_number is null or length(account_number) between 4 and 34);
  end if;
end $$;

comment on column public.accounts.account_number is
  'Full account identifier as the family typed it (normalised: no spaces or dashes). Never rendered in full outside the Managed Account screen — every other screen masks it to the last four digits. NULL = not recorded yet, which the UI renders as the account type label rather than an invented number.';

-- One account number appears at most once per household. Multiple NULLs are
-- allowed (Postgres treats NULLs as distinct in a unique index), so a household
-- whose e-wallet has no number can still have several rows.
create unique index if not exists idx_accounts_household_account_number
  on public.accounts (household_id, account_number);

-- ============ 2. accounts.account_holder_name ============
-- The name on the account, which is frequently NOT the app user: "Mandiri"
-- might be the account that receives a parent's transfer, and "CC Mandiri" may
-- be issued to the spouse. The design's managed-account row has room for this
-- line, and without it two accounts at the same bank are distinguishable only
-- by their last four digits.
alter table public.accounts
  add column if not exists account_holder_name varchar;

comment on column public.accounts.account_holder_name is
  'Name printed on the account ("Andra Pratama", "Istri Andra"). Often differs from the household member using it — that is the point of storing it. NULL = not recorded.';

-- ============ 3. accounts.is_active ============
-- Archive flag. See the header for why a retired account is hidden rather than
-- deleted. NOT NULL default true so every existing row is active with no
-- backfill, and the client can treat the column as a plain boolean.
alter table public.accounts
  add column if not exists is_active boolean not null default true;

comment on column public.accounts.is_active is
  'false = archived: hidden from every account picker (Bayar dari, Alokasi, Template, Quick Add) but still resolvable by past transactions. Accounts are never deleted from the app — transactions.account_id is NO ACTION and cycle_allocations.account_id is SET NULL, so a delete either fails or silently blanks history.';

-- ============ 4. accounts.sort_order ============
-- Pickers currently order by `name` (lib/queries.ts `useAccounts`), which is
-- alphabetical and arbitrary: a household reads "CC Mandiri, Mandiri, Tunai"
-- where it means "Mandiri, CC Mandiri, Tunai". This column is the family's own
-- order, edited by drag or by up/down in the Managed Account screen.
--
-- Default 0 and NOT NULL, so existing rows tie and fall back to the name
-- ordering the app already uses — no visible reshuffle on migration day.
alter table public.accounts
  add column if not exists sort_order int not null default 0;

comment on column public.accounts.sort_order is
  'The family''s own display order for this account, ascending. Ties (and the default 0 on pre-010 rows) fall back to ordering by name, which is what the app did before this column existed.';

-- ============ 5. accounts.icon ============
-- Same stance as 009 on `categories.icon`: an explicit, optional choice, NOT
-- constrained to a list of values. The asset pack grows, and a CHECK would need
-- a migration per new icon — worse, an icon removed from the pack would make
-- its rows unwritable. The client validates against BRAND_ART_NAMES and falls
-- back to the icon derived from the account TYPE when the stored name is not in
-- the pack it ships with, so a stale value is inert rather than fatal.
--
-- NULL means "no explicit choice", which is every row today. The client derives
-- an icon from `type` (BANK → landmark, CREDIT_CARD → credit-card, E_WALLET →
-- wallet, CASH → banknote), so the screens look complete with no backfill — and
-- a backfill would write a choice nobody made, the same stance 007 takes on
-- `households.payday_day` and 008 on `obligations.repayment_mode`.
alter table public.accounts
  add column if not exists icon text;

comment on column public.accounts.icon is
  'Asset-pack icon name, without .svg. NULL = not chosen; the client derives one from `type`. Validated client-side against BRAND_ART_NAMES, so a name the shipped pack does not have is ignored rather than fatal.';

-- ============ 6. Give the four seeded accounts a stable order ============
-- lib/seed.ts inserts Mandiri, CC Mandiri, ShopeePay, Tunai in that order, which
-- is the order a household reads them in — but sort_order defaulted every row
-- to 0, so the picker would sort them alphabetically instead and the seed's own
-- intent would be lost.
--
-- Guarded to run once: the `not exists` test means a household that has already
-- arranged its accounts (or added one) is left exactly as it is. Only the
-- untouched four-row seed is numbered, and only the four names the seed writes.
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

-- ============ 7. Nothing to change in RLS, realtime, or the seed ============
--   * RLS: `household_scoped_write_accounts` (001) is FOR ALL with a matching
--     WITH CHECK, so inserts, updates and the archive/re-activate round-trip all
--     already pass for any member of the household.
--   * Realtime: `accounts` is in the `supabase_realtime` publication with
--     `replica identity full` (003), so a rename or an archive on one phone
--     reaches the other without a manual refresh. New columns need no
--     republication.
--   * seed: lib/seed.ts keeps inserting `{ name, type }` only. Deliberately no
--     placeholder number — a seeded `0000` would look like a real account to the
--     masking rule and to anyone reading the picker. New accounts start with the
--     number blank until someone types it.

-- Manual verification (SQL Editor, first run):
--   -- 1. the columns exist and every existing row is active with no number
--   select name, type, account_number, account_holder_name, is_active, sort_order, icon
--     from public.accounts order by sort_order, name;
--   -- expected: account_number NULL on all rows, is_active true, icon NULL,
--   -- and the four seeded accounts numbered 1..4
--
--   -- 2. a full number round-trips, and the client masks it
--   update public.accounts set account_number = '1370008821'
--    where id = '<account-uuid>';
--   select account_number, right(account_number, 4) as masked from public.accounts
--    where id = '<account-uuid>';
--   -- expected: 1370008821 | 8821
--
--   -- 3. the same number twice in one household is refused
--   update public.accounts set account_number = '1370008821'
--    where id = '<other-account-uuid>';
--   -- expected: ERROR duplicate key value violates unique constraint
--   --           "idx_accounts_household_account_number"
--
--   -- 4. two accounts with NO number are both allowed
--   update public.accounts set account_number = null where id = '<account-uuid>';
--   -- expected: UPDATE 1 (no conflict)
--
--   -- 5. archiving is an update, and the row survives
--   update public.accounts set is_active = false where id = '<account-uuid>';
--   select name, is_active from public.accounts where id = '<account-uuid>';
--   -- expected: the row is still there with is_active = false
--
--   -- 6. deleting an account a transaction points at is refused (the reason
--   --    archive exists at all) — run against an account used in the ledger
--   delete from public.accounts where id = '<used-account-uuid>';
--   -- expected: ERROR update or delete on table "accounts" violates foreign key
--   --           constraint on table "transactions"
--
--   -- 7. cross-household isolation: every column above is still scoped by 001
--   select count(*) from public.accounts;
--   -- expected: only the caller's household, never another family's accounts
--
--   -- 8. realtime is still healthy after the change
--   select * from public.realtime_health();
