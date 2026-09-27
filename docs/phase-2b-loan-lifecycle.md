# Phase 2B — Loan lifecycle and installment schedule

Migration `005_loan_lifecycle_installments.sql`. Phase 1 created the loan
metadata columns and `obligation_installments` but nothing ever wrote them: a
loan created through the app had no repayment method, no interest, and an empty
schedule. This phase makes the lifecycle real.

## Decisions

**A loan's `total_amount` is the repayment total** — principal plus interest.
`remaining_amount` starts equal to it, so the existing progress and allocation
maths keeps working untouched, and the number the family sees on the obligation
card is what they actually owe, not what they borrowed. `interest_fee_amount` is
kept separately for display.

**`planned_installment_amount` is computed, never supplied.** Accepting it from
the client would allow a stored value that disagrees with the generated
schedule. One source of truth: the splitter.

**Remainder goes to the earliest installments.** `10jt / 3` is not divisible, so
the schedule is `3.333.334 + 3.333.333 + 3.333.333`. Deterministic and
order-stable, and the schedule always sums exactly to the repayment total —
verified in the test suite, not assumed.

**Installments are scheduled into a cycle only when their due date falls inside
it.** A loan with a grace period therefore starts as backlog, which is exactly
what `cycle_id` null means in migration 004. No special-casing needed.

**An obligation with installments is never double-scheduled.** Calling the
splitter on an obligation that already has rows returns the existing rows rather
than appending a second schedule.

## What migration 005 adds

| Object | Purpose |
|---|---|
| `create_financing_with_obligation` v2 | Now takes repayment method, installment count, start date, interest. Returns `(transaction_id, obligation_id, installment_count, total_repayment)`. |
| `schedule_obligation_installments` | Splits a repayment total into a dated schedule. Reused by the v2 RPC. |
| `set_installment_cycle` | Attaches a backlog installment to a cycle, or detaches it. |

The v1 8-argument signature is **dropped, not shadowed** — `create or replace`
with a changed signature would leave both overloads callable and the app would
keep hitting the version without metadata. Because the new arguments all have
defaults, the old 8-argument call still resolves correctly to v2.

## Client layer

- `useCreateFinancingLoan` — extended with `repaymentMethod`, `installmentCount`,
  `startDate`, `interestFeeAmount`; mirrors the SQL validation for fast feedback.
- `useObligationInstallments(h, obligationId)` — one obligation's schedule.
- `useCycleInstallments(h, cycleId)` — a cycle's schedule, with obligation titles.
- `useScheduleInstallments` / `useSetInstallmentCycle` — the two RPCs.
- `LOAN_REPAYMENT_METHODS` / `LoanRepaymentMethod` — the allowed methods, so the
  picker and the SQL agree by construction.

`lib/zero-based.ts` gains two pure helpers:

- `splitInstallments(total, count)` — the same split as the SQL, so the UI can
  preview a schedule before anything is saved. The test suite pins the shared
  examples so the two implementations cannot drift silently.
- `isInstallmentOpen(installment)` — `SETTLED` and `CANCELLED` are both
  not-outstanding; every other status is.

Realtime now invalidates `['installments']` when `obligation_installments`
changes.

## Verified

`npx vitest run` — 24/24 · `npx tsc --noEmit` — clean · `npx expo lint` — no new
findings.

Migration 005 has not been run against a live database; there are no credentials
in this environment. Run it in the Supabase SQL Editor and confirm with the
verification query at the bottom of the file (12 installments summing to
14.000.000 for a 12jt loan with 2jt interest).
