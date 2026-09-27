# Phase 4 — Ledger, templates, and categories

Phase 4 fills in the three `design.pen` screens that had no implementation
behind them: Screen 6 (Riwayat), Screen 9 (Template Rutin), and Screen 5 /
10 + "Kelola Kategori" (the budget-health family). The unifying work was
collapsing three copies of the same budget judgement into one function.

## 1. One budget-health rule, three screens

Before this phase the "is this category over its pagu?" decision was written
inline in `app/(tabs)/categories.tsx`, `app/category-detail.tsx`, and
`app/templates.tsx`-adjacent code, with hardcoded `#DC2626` / `#D97706` /
`#059669` literals in each. Worse, the two screens disagreed about the edge
case: with no pagu but real spending, Budget Health reported MELEBIHI RENCANA
and Detail Kategori reported ANGGARAN AMAN. Neither is true — there is no plan
to be over or safe against.

`budgetHealthStatus(spent, budget)` in `lib/zero-based.ts` is now the only
place that rule lives:

| Status | When | Copy | Badge tone |
| --- | --- | --- | --- |
| `OVER` | `spent > budget` | MELEBIHI RENCANA | `pending` |
| `WATCH` | `80% < ratio <= 100%` | CEK RINCIAN | `alert` |
| `SAFE` | `ratio <= 80%`, or nothing spent and no pagu | ANGGARAN AMAN | `paid` |
| `NO_BUDGET` | `budget = 0` and `spent > 0` | TANPA PAGU | `alert` |

The thresholds and the boundary behaviour are pinned by tests 25–30. Test 26
records the one genuinely surprising case: spending *exactly* the pagu is not
OVER (`overAmount` stays 0) but is still WATCH, not SAFE, because the whole pagu
is consumed. That matches the pre-existing inline check, so the refactor changes
no verdict — it only removes the duplication.

`budgetFillPct` keeps the 2%-floor bar width that every screen was doing by
hand, and returns 100 for a no-pagu row so the bar reads as "unmeasured" rather
than "2% used".

## 2. Screen 6 — Riwayat (`app/(tabs)/history.tsx`)

Rewritten around `actual` mode. Home answers "is the plan sound?" and reads
`planned`; the ledger answers "what has actually happened?" and reads `actual`.

Reading `actual` naively makes the screen useless for the thing it is mostly used
for. `resolveModeAmount('actual')` returns `0` for a PENDING row — right for the
projection, and on a ledger it renders a planned-but-unpaid bill as "− Rp 0" and
totals the cycle's unpaid obligations at zero. Rows therefore print
`ledgerDisplayAmount(row)` (`lib/zero-based.ts`): the plan while PENDING, the real
figure once PAID, and the plan again for a PAID row with no recorded actual, since
both pay paths reject a zero payment. `LedgerRow` carries both numbers — `amount`
(mode-resolved, what the projections consume) and `displayAmount` (what the screen
prints) — and the summary block totals `displayAmount` for the same reason.

New behaviour:

- **Status filter** — `Semua` / `Belum dieksekusi` / `Sudah dieksekusi` chips, with
  Home's "N transaksi belum dibayar" alert deep-linking to
  `/(tabs)/history?status=PENDING`. The filter lives in the URL, not in component
  state: a tab screen stays mounted once visited, so state initialised from the
  param would be correct on the first visit and silently ignored on every one after
  it. `statusFromParam` reads it each render and `router.setParams` writes it back.
  The chips say "dieksekusi" rather than "dibayar" because the filter is on status
  alone — an un-cleared salary lands in that bucket, and Home's alert (which counts
  expenses only) is the one that says "belum dibayar".
- **Status chip counts** are computed against the search/direction/account set with
  the status filter deliberately left off, so "Belum dieksekusi · 3" keeps meaning
  "3 pending rows match what you have already narrowed to" instead of collapsing to
  the count of the chip just tapped.
- **Unexecuted rows group separately, at the top**, under "Belum dieksekusi". They
  have no `release_date` to sort by — every row cloned at cycle open is PENDING with
  a null date — so date-bucketing them would bury the whole "what do we still owe"
  list under an undated heading at the bottom, the opposite of what the alert that
  links here promises.
- **A pending row is tappable** and opens `/payment-confirm`; executed rows stay
  inert, because payment-confirm is built to refuse them and a row that opens only
  to say "already paid" is worse than one that does nothing.
- **Search matches more than the name.** The design's placeholder is "Cari
  transaksi atau toko...", so `filterLedger` matches the transaction name, the
  account (the *toko*), and the category. Searching only `name` would make
  searching for a merchant silently return nothing.
- **Direction and account chips** compose with the query, so "Pengeluaran on
  Mandiri matching 'listrik'" is one filter state, not three screens.
- **Summary block** totals the *filtered* rows, not the whole cycle — a summary
  that ignores the active filter is a lie about what is on screen.
- **Day grouping** uses `ledgerDayLabel`, producing the design's "Hari Ini ·
  25 Sep" / "Kemarin · 24 Sep" / "20 Sep 2026". Both dates are passed in so the
  function stays pure and testable. Its null case reads "Belum bertanggal", not
  "Tanpa tanggal" — a null `release_date` means the date does not exist yet, not
  that nobody wrote one down.
- **Pagination**: 30 rows, then "Muat N transaksi lainnya" (design's footer).
- **Per-flow chips** (`FLOW_LABELS` / `FLOW_TONES`) give each flow type its
  colour from the Phase 3 token set, so a financing inflow looks the same here
  as it does on the Home hero.
- Empty state distinguishes "no transactions" from "no matches" and offers a
  reset-filter action in the second case.

## 3. Screen 9 — Template Rutin (`app/templates.tsx`)

Rewritten. The governing idea: **a template is a promise about future cycles,
not a record of past spending.** Everything on this screen edits the template
row only — cloned transactions keep the amount they were created with, and
changing a default affects the next cycle opened. The form says so in as many
words, because "edit" on a budgeting screen naturally reads as "fix history".

- **Baseline card**: ACTIVE EXPENSE templates summed. Income templates are
  excluded — an income template is not a commitment, and including it would
  overstate what the next cycle must fund.
- **Aktif / Selesai tabs** with counts, matching the design.
- **`due_day`** (migration 006) renders as the design's "Tgl 5" fragment via
  `templateDueLabel`, which returns null for 0, 32, or garbage rather than
  printing it.
- **Edit and create share one form** (`Draft`), so a field added to one path
  cannot go missing from the other.
- `useCreateTemplate` / `useUpdateTemplate` / `useSetTemplateStatus` replace
  the inline `requireSupabase()` calls the screen used to make directly, which
  meant it also had to call `tmplQ.refetch()` by hand and never invalidated the
  money keys.

## 4. Screens 5 & 10 + "Kelola Kategori"

**Budget Health** (`app/(tabs)/categories.tsx`) gained the design's progress
ring and now reads in `actual` mode. `components/ui/BudgetRing.tsx` draws it
with `react-native-svg`, already a dependency for the sign-in screen — pulling
in a charting library for one arc would cost more than it gives. The ring is
capped at 100%: a category at 202% should not draw a ring that wraps twice and
reads as "more than complete". The overrun is carried by the label and colour,
which is where the real information is.

**Detail Kategori** (`app/category-detail.tsx`) gained the "Ubah pagu" control
writing `categories.monthly_budget`, plus a separate insight for the no-pagu
case. It keeps the pending/paid split visible: the paid count is what the health
figure is measured against, and the screen states how many rows are excluded.

**Kelola Kategori** (`app/manage-categories.tsx`, new) is the category manager.
System categories are listed **first and separately**, because they are not the
family's data — they are the app's vocabulary, and burying them among custom
rows invites an attempt to delete one. They can be renamed, not removed.
`useDeleteCategory` mirrors the guard for a clear message, but migration 006's
trigger is what actually enforces it.

## 5. `supabase/migrations/006_ledger_templates_categories.sql`

| Object | Why |
| --- | --- |
| `recurring_templates.due_day int` + check 1..31 | design's "Tgl 5"; nullable because an existing template must not have to invent a due day |
| `categories.is_system boolean` | lets the UI say "cannot be deleted" without inferring it from a role it happens to know about |
| `categories.system_role text` + check | `DEBT_PAYMENT` / `FINANCING_INFLOW`; the ledger resolves these by *role*, never by name, because the name is user-editable |
| partial unique index on `(household_id, system_role)` | one category per role per household, so the role lookup is unambiguous |
| per-household backfill | every existing family gets the same vocabulary; guarded so re-running is safe |
| `prevent_system_category_delete()` trigger | refuses the delete at the database, not only in the UI |

The backfill is wrapped in an exception handler: `on conflict do nothing` has no
index-inference target for a *partial* unique index on some PostgreSQL versions,
so it falls back to explicit existence checks per household per role.

**This migration has not been run against a live database.**

## 6. New query hooks

`useCreateTemplate`, `useUpdateTemplate`, `useSetTemplateStatus`,
`useCreateCategory`, `useUpdateCategory`, `useDeleteCategory`. All of them
invalidate through the shared helper rather than calling `refetch()` inline.
`useDeleteCategory` also routes through `invalidateMoneyKeys` — the deleted
category's rows survive (`ON DELETE SET NULL`) but their joined names vanish, so
every view showing them is stale.

`lib/realtime.ts` now invalidates `['txns']` and `['alloc']` when a category
changes, for the same reason.

## Verified

- `npx vitest run` — 36/36 passing (24 → 36: budget health 25–30, ledger
  grouping/filtering 31–36).
- `npx tsc --noEmit` — clean.
- `npx expo lint` — back to the 2 pre-existing problems
  (`app/(auth)/setup-choice.tsx:27`, `app/_layout.tsx:32`). Three new findings
  were introduced and fixed during this phase: an unused `ChevronRight` import
  in `categories.tsx` and two unescaped quotes in `category-detail.tsx`.

## Not done in this phase

- `HeroSplitCard` is still unused (carried over from Phase 3).
- The design's Screen 3 "Tanggungan" detail (`Screen - Detail Pinjaman`) with
  its repayment-mode selector and payment history is Phase 5 work; the
  installment data it needs already exists from Phase 2B.
- Migrations 005 and 006 have not been run against a live database.
