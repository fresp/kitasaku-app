# Phase 1 — Domain Contract (zero-based allocation + financing)

Source: `lib/zero-based.ts` (pure, zero-import). Formulas below are authoritative.

## 1. Flow types (`transactions.flow_type`)

| Flow | Meaning | Source slot |
|---|---|---|
| `OPERATING_INCOME` | Salary / operating income | operatingIncome |
| `FINANCING_INFLOW` | Loan received (must be set explicitly) | financingInflow |
| `ASSET_RELEASE` | Asset sold / released to cash | assetRelease |
| `EXPENSE` | Consumptive spend (default) | — (outflow) |
| `DEBT_PAYMENT` | Obligation paydown | — (outflow, own allocation slot) |
| `ASSET_ALLOCATION` | Asset purchase outflow | — (outflow) |

Backfill (migration 004): `direction='INCOME' AND flow_type='EXPENSE'` → `OPERATING_INCOME`.
`EXPENSE` rows with `obligation_id` are NOT backfilled (see TODO).

## 2. Zero-based formulas

1. `sourceFunds = operatingIncome + financingInflow + assetRelease` (each via `normalizeAmount`)
2. `totalAllocation = expense + debtPayment + asset + savings + investment + emergencyFund + other` (from `cycle_allocations` only)
3. `unallocatedFunds = sourceFunds − totalAllocation` (signed; `-0` → `0`)
4. `fundingGap = max(requiredAllocation − sourceFunds, 0)`; status = `FUNDING_GAP` if gap > 0, else `UNALLOCATED` if unallocated > 0, else `COMPLETE`

`normalizeAmount`: `null`/`undefined`/`NaN` → `0`; negatives clamped to `0`; `-0` → `0`.

## 3. Allocation types (`cycle_allocations.allocation_type`)

`EXPENSE` · `DEBT_PAYMENT` · `ASSET` · `SAVINGS` · `INVESTMENT` · `EMERGENCY_FUND` · `OTHER`.
`ASSET` holds the ASSET slot only — SAVINGS & co. are separate slots, never folded in.

## 4. Obligation type/status aliases (compat, no data migration)

Type: `DEBT`→old alias of `LOAN`, `REIMBURSE`→old alias of `REIMBURSEMENT`. Status: `UNPAID`→old alias of `OPEN`.
New metadata columns (all nullable except `interest_fee_amount DEFAULT 0`): `repayment_method`,
`planned_installment_amount`, `installment_count`, `current_installment`, `start_date`, `due_date`,
`interest_fee_amount`, `source_transaction_id → transactions.id (SET NULL)`.
`obligation_installments`: per-cycle schedule (`cycle_id` nullable = backlog); payments live in `transactions`, never here.

## 5. Planned vs actual + anti-double-count

`resolveModeAmount`: `planned` → `planned_amount`; `actual` → PAID ? `actual_amount` : `0`.
`requiredAllocation` is always the planned total; mode affects only source funds.
Allocation total comes ONLY from `cycle_allocations`; transaction outflows classify ledger rows but are never summed into it.

## 6. Migration 004 contents

`transactions.flow_type` + backfill + 6 indexes · `cycle_allocations` + household-consistency trigger
`validate_cycle_allocation_household()` · obligations metadata + widened checks · `obligation_installments` ·
RLS (`household_scoped_select/write_cycle_allocations`, same pair for `obligation_installments`) ·
realtime (`cycle_allocations`, `obligation_installments`, one statement each + `REPLICA IDENTITY FULL`) ·
RPCs `create_financing_with_obligation → (transaction_id, obligation_id)` and
`allocate_debt_payment → (transaction_id, allocation_id)` (`SECURITY DEFINER`, membership check, `GRANT TO authenticated`).
Verify: `select * from pg_publication_tables where pubname='supabase_realtime'
and tablename in ('cycle_allocations','obligation_installments')` → 2 rows (dashboard, first run).

## 7. New hooks (`lib/queries.ts`)

`useCycleSourceFunds(h,c,mode)` · `useCycleAllocations(h,c)` · `useZeroBasedSummary(h,c,mode)`
(key `['zero-summary',h,c,mode]`, single `Promise.all` fetch) · `useCycleAllocationSummary` (alias) ·
`useFundingGap` (selector, same key) · `useObligationSummaries` (reuses `['oblig']`) ·
`useTransactionLedger` (reuses `['txns']`) · `useCreateAllocation` / `useUpdateAllocation` /
`useDeleteAllocation` (client validates `amount > 0`) · `useCreateFinancingLoan` / `useAllocateDebtPayment`
(RPC wrappers). Realtime (`lib/realtime.ts`) invalidates `['alloc']`, `['zero-summary']`, `['oblig']`.

## 8. Open TODOs (decisions deferred, not silent assumptions)

- When an `EXPENSE` txn with `obligation_id` may count as `DEBT_PAYMENT` (needs proven pattern).
- Consolidating `DEBT`/`REIMBURSE` → `LOAN`/`REIMBURSEMENT` and `UNPAID` → `OPEN` (later phase).
- Full asset-tracking scope (later phase); `allocate_debt_payment` txns are PAID — confirming them again via
  `useMarkAsPaid` would double-decrement `remaining_amount` (phase-2 guard).
- "Allocations = the only total" resolves txn-vs-allocation ambiguity for this phase.
