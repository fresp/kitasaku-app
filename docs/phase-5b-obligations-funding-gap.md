# Phase 5B — Tanggungan, Detail Pinjaman, Funding Gap

Phase 5A was the identity half of Phase 5. This is the money half: the pool of
what the family owes (`Screen 3 - Tanggungan`), the single-obligation view
(`Screen - Detail Pinjaman`), and the screen that explains why a cycle cannot
be opened yet (`Screen 7B - Funding Gap`).

The whole phase is built on one idea: an obligation has a *state* — not paid
yet, partially paid, late, settled — and four different screens must agree on
what that state is. So the state machine lives in one pure module, and the
screens only lay out what it returns.

## 1. Migration 008 — `supabase/migrations/008_obligation_repayment_mode.sql`

One column and one RPC:

```sql
alter table public.obligations add column if not exists repayment_mode text;
-- check: null, or one of LUMP_NEXT_MONTH | INSTALLMENT | MANUAL
create or replace function public.set_obligation_repayment_mode(
  p_household_id uuid, p_obligation_id uuid, p_mode text
) returns void language plpgsql security definer ...
grant execute on function public.set_obligation_repayment_mode(uuid, uuid, text) to authenticated;
```

Three decisions worth naming:

- **A new column, not `repayment_method`.** `repayment_method` (migration 005)
  already means *how* money moves — TRANSFER, CASH, AUTO_DEBIT, PAYROLL, OTHER.
  The design's "Mode Pembayaran" card means the *shape of the plan*: pay it all
  next cycle, split it into installments, or decide each time. Overloading one
  column with both would make `AUTO_DEBIT` and `INSTALLMENT` look like the same
  axis, and the first query that filtered on it would be wrong.
- **Nothing in the money maths reads it.** `repayment_mode` is presentation
  only. The schedule that actually splits a loan into installments is
  `obligation_installments`, written by the Phase 2B RPC. This column answers
  "what does the family intend", not "what will the ledger do".
- **It is deliberately not backfilled.** `NULL` means nobody has chosen. The
  client derives a *display* default (`repaymentModeOf`) and marks it
  `derived: true`, so the screen can say "this is a guess" instead of showing a
  plan nobody picked. Guessing `LUMP_NEXT_MONTH` would be worse than guessing
  anything else: "we will clear this next cycle" is a decision, and defaulting
  to it would make an unpaid loan look like it had a plan. Same stance as
  migration 007's `payday_day`.

The RPC is `SECURITY DEFINER` with an explicit membership check and a
household-ownership check on the obligation, so a client cannot set the mode on
another family's loan even by guessing a uuid. It is idempotent: setting the
same mode twice is a no-op update, and `p_mode = null` clears the choice.

## 2. `lib/obligation.ts` — the state machine, in one place

Pure module. It imports only `./format` and `MONTHS_ID` from `./zero-based`,
both of which are import-free, so Vitest can load it — nothing here may
transitively reach `react-native` (see the Phase 5A doc for why).

The functions fall into five groups:

**Types and filters.** `normalizeObligationType` folds migration 004's legacy
aliases (`DEBT` → `LOAN`, `REIMBURSE` → `REIMBURSEMENT`) and maps anything
unrecognized to `BILL`. This is what lets the filter tabs, the type badge, and
the counterparty copy treat an old row exactly like a new one — otherwise one
family sees a `DEBT` badge where another sees `Pinjaman`. On top of it:
`obligationTypeLabel`, `obligationFilterOf`, `matchesObligationFilter`,
`isSettled`.

**Dates.** `daysBetween` parses both sides in UTC so a phone in Jakarta
(UTC+7) and one in UTC agree on how many days late a bill is; a local-midnight
parse would be off by one for half the planet. `longDateLabel` / `shortDateLabel`
/ `longDateFullLabel` format `YYYY-MM-DD` into `25 Okt 2026` / `25 Okt` /
`25 September 2026`. The private `parseDateOnly` **rejects** malformed dates
rather than letting them roll over — see the bug in §5.

**Loan state — the core.** `loanState(o, todayISO)` returns one of `OPEN`,
`RUNNING`, `OVERDUE`, `SETTLED`, `CANCELLED`. The order of checks is the whole
function:

1. `CANCELLED`, then `SETTLED` win outright — nothing to chase.
2. `remaining <= 0` is `SETTLED` even if the stored status was never updated.
3. A stored `OVERDUE` is honoured.
4. **A due date in the past is `OVERDUE` — and this is checked before
   `RUNNING`.** This is the case the naive implementation gets wrong: a loan 20%
   paid and three days past its due date is not "Berjalan • 20%", it is late,
   and "Segera bayar" is the only useful thing to say. Pinned by test 62.
5. Otherwise `paid > 0` is `RUNNING`, else `OPEN`.

The overdue verdict is derived from the **date**, not just the stored status.
Nothing sweeps `OPEN` → `OVERDUE` on a schedule, so trusting the status alone
would leave a bill silent on the day after it was due — exactly when it
matters. A stored `OVERDUE` with a future date is still treated as overdue:
someone marked it on purpose. A bill due *today* is not late.

`obligationBadge(state, pct)` maps the state to the design's four badges:
`Belum dibayar`, `Berjalan • 20%`, `Jatuh Tempo!`, `Lunas • 100%`.

**Copy.** `counterpartyLabel` says "Pemberi: X" for a loan and "Kepada: X" for
everything else — the preposition is the whole point, and getting it backwards
on a loan tells the family they are owed money they owe. `loanBreakdownText`,
`principalInterestText` (principal = total − interest, because the stored total
already includes interest since Phase 2B, and announcing the full total as
principal would overstate the debt by exactly the interest), `paidCue`,
`overdueNote`, `installmentProgressLabel`.

**Repayment mode and the backlog.** `repaymentModeOf` returns the stored value
when there is one (`derived: false`); otherwise it infers from
`installment_count > 1` → `INSTALLMENT`, else `MANUAL`, both flagged
`derived: true`. It never guesses `LUMP_NEXT_MONTH`. `obligationBacklog` builds
the dark overview card's eyebrow and sub-line from **open rows only** — a
settled obligation is not part of what the family still owes, and including it
would inflate the number the whole screen is about.
`obligationFilterCounts` gives the per-tab counts, also skipping settled rows.

## 3. Screens

### `app/(tabs)/obligations.tsx` — Screen 3 - Tanggungan

Rewritten around the design's five filter tabs (Semua / Pinjaman / Reimburse /
Cicilan / Tagihan, with open counts), the dark `obligationBacklog` overview
card, and `ObligationRow` per obligation. The inline create form for a plain
`BILL` survives, with copy pointing at Quick Add → Terima Pinjaman for loans
that have a schedule.

`todayISO` is read once per render rather than held in state: a stored "today"
would go stale the moment the app is left open across midnight, and every
card's overdue verdict depends on it.

### `components/ui/ObligationCard.tsx` — one component, four variants

The design draws four loan cards (`Belum dibayar`, `Berjalan • 20%`,
`Jatuh Tempo!`, `Lunas • 100%`) plus two reimbursement cards. They are the same
card with different state, which is exactly why they are one component: four
copies is how the overdue variant ends up missing whatever the running variant
learned. The icon carries the state too (scale / alert / check-check), so the
card is readable without relying on the badge colour alone.

### `components/ui/ObligationRow.tsx` — card plus its action panel

Owns the two queries that are per-obligation (installments and payment history)
and the two write panels — "Catat Pembayaran" and "Alokasikan ke anggaran".
Both panels go through SQL RPCs, so `remaining_amount` is only ever decremented
inside the database.

**Pay and allocate are different actions and the copy says so.** "Alokasikan"
only sets money aside in this cycle's budget; the remaining balance does not
move until a payment is recorded. The panel text spells that out, because
conflating the two is how a family ends up thinking a debt is paid when only
the budget was reserved.

### `app/loan-detail.tsx` — Screen - Detail Pinjaman

Loan hero (`SISA PINJAMAN`, "N% dibayar", amount, track, "Diterima 25 September
2026 • Dana masuk ke Mandiri"), the RINGKASAN KEWAJIBAN card (total principal /
interest / paid / remaining, divider, next schedule date, installment plan),
the Mode Pembayaran card with the three `REPAYMENT_MODES` options, the Riwayat
Pembayaran section with the design's empty state, and the two CTAs.

- Everything the hero and summary say comes from `lib/obligation.ts` — the same
  functions the Tanggungan card uses, so the card and this screen cannot
  disagree about the same row.
- "Ubah Rencana Pembayaran" **scrolls to the mode card** rather than picking a
  mode for the person. Silently rewriting the plan on a button press would
  change a decision nobody made. The y offset is measured `onLayout`, not
  hardcoded, because the summary card grows with interest and installment rows.
- The received-account line reads the loan's own receipt transaction by id
  (`useTransactionById`), because the receipt may sit in a cycle that is no
  longer active.

### `app/funding-gap.tsx` — Screen 7B - Funding Gap

The blocked version of Buka Siklus. `new-cycle.tsx` is the form you fill in
from scratch; this is the projection when the cycle already has numbers and the
required allocation exceeds the source funds, so the only useful content is the
arithmetic and the ways out of it: Nav (eyebrow "PAYDAY SETUP · FUNDING GAP
NOV"), period card, income card, clone-14-pos card, "Pembayaran Kewajiban
Siklus Ini", the zero-based allocation card ending in "= Funding Gap (Kebutuhan
Pendanaan)", the "STRATEGI TUTUP FUNDING GAP" card (Tambah Pendapatan /
Pencairan Aset / Pinjaman Baru, each a tap into Quick Add), the CTA, and the
lock note.

- **The arithmetic is not recomputed here.** `sourceFunds` and
  `requiredAllocation` come from `useCycleSourceFunds` and `useCycleAllocations`
  — the same queries Home's allocation dashboard reads — so the gap on this
  screen and the gap on Home cannot disagree.
- Home's cycle pill now routes here when `summary.status === 'FUNDING_GAP'`
  instead of to the blank form. Landing someone on a form when the answer is
  "you are short Rp 5jt" hides the actual problem.
- When the gap is closed the same screen flips to the unallocated-funds view
  and the CTA hands off to `new-cycle`; it does not open the cycle itself.

## 4. Data layer

`lib/queries.ts` gains:

- `useObligationPayments(householdId, obligationId)` — every payment ever booked
  against one obligation, across **all** cycles. Deliberately not the cycle
  ledger filtered down: a loan taken in May and paid through November has
  payments in cycles that are no longer active, and a cycle-scoped query would
  render the Riwayat Pembayaran section empty for exactly the loans with the
  most history.
- `useTransactionById(householdId, txnId)` — one transaction with its account
  and category, so Detail Pinjaman can name where the loan money landed even
  when the receipt's cycle is closed.
- `useSetRepaymentMode()` — calls the migration 008 RPC. It moves no money, so
  it invalidates `['oblig']` only; routing it through `invalidateMoneyKeys`
  would refetch every projection just to learn that a label changed.
- `invalidateMoneyKeys` now also invalidates `['obl-payments']`, so a payment
  recorded anywhere refreshes the per-obligation history.

The `Obligation` interface gains `repayment_mode?: string | null` with a doc
comment pointing at `repaymentModeOf`.

## 5. A real bug found by a test

Test 56 asserted that `shortDateLabel('2026-13-01')` is `null`. It failed with
`expected '1 Jan' to be null`.

`Date.UTC(2026, 12, 1)` does not reject month 13 — it **rolls over** to 1 Jan
2027. So a typo in a due date would have rendered as a plausible-looking real
date, and the obligation would have looked due in a month that does not exist.
The fix is in `parseDateOnly`: range-check month (1–12) and day (1–31) before
building the timestamp, then verify the round trip lands on the same calendar
day (rejecting 31 Feb → 3 Mar). The test was split into 56 and 57 to pin both
the range check and the round-trip check.

## Verified

- `npx vitest run` — 84/84 passing (49 → 84: `lib/__tests__/obligation.test.ts`
  tests 50–84).
- `npx tsc --noEmit` — clean.
- `npx expo lint` — the 2 pre-existing problems
  (`app/(auth)/setup-choice.tsx:27`, `app/_layout.tsx:32`). No new findings.

## Not done in this phase

- Phase 5C — `Screen 2C - Insight & Aset 2026` and its seven chart sections.
  "Insight & Aset 2026" on My Profile is still a row with no handler.
- Migration 008 has not been run against a live database (same as 005, 006,
  and 007). Until it runs, `repayment_mode` reads as `undefined` and every
  obligation shows a `derived` mode — which is the intended degraded behaviour,
  not a crash.
- The design's Home "Lepas aset" action row is still not implemented; Home has
  "Kelola tanggungan" instead.
