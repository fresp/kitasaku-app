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

Anti-double-count has a second, later sibling: `resolveModeAmount('actual')` answers
"how much money actually moved", which is `0` for a PENDING row — correct for the
projection, useless in a ledger that lists rows the family still has to pay. The
ledger therefore prints `ledgerDisplayAmount(txn)` instead: the plan while the row is
PENDING, the real figure once it is PAID, and the plan again if a PAID row has no
recorded actual (`actual = 0` on a settled row means the column was never written —
both pay paths reject a zero payment). `amount` keeps the mode-resolved value so the
Home projections are unaffected; `LedgerRow` carries both.

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

`calcCashflow` classifies pending rows by direction and exposes `unpaidExpenseCount` /
`pendingIncomeCount` alongside the raw `pendingCount`, because a PENDING INCOME row ("Gaji
Bulanan", pending until payday) is not a bill — Home's "N transaksi belum dibayar" alert reads
the expense count, while Riwayat's status filter uses the raw status.

## 8. Where allocations come from at cycle open

The plan becomes binding the moment the cycle opens, so that is where its commitments are
written — not lazily as the family taps each row. `useCreateCycle` materialises, in order:

1. the `cycles` row, deactivating the previous active cycle;
2. one PENDING `transactions` row per selected routine position, per carried-over obligation
   (`flow_type = 'DEBT_PAYMENT'`, `obligation_id` set, name = the obligation title verbatim so it
   matches what `useAllocateObligation` writes), and one for the payday figure (`'Gaji Bulanan'`,
   `OPERATING_INCOME`);
3. one `cycle_allocations` row per commitment — `EXPENSE` per routine EXPENSE item, `DEBT_PAYMENT`
   per obligation. Income is a *source*, never an allocation, so it deliberately has no row here.

This is what makes the gate and the dashboard agree from the first render: `app/new-cycle.tsx`
computes `requiredAllocation = recurringExpense + totalDebtPayment` against
`sourceFunds = income + recurringIncome`, and the same split is what gets written to
`cycle_allocations`. Summing routine income into the requirement (as the screen once did) would
both understate the funds available and book a salary as an EXPENSE commitment.

Execution is unchanged: `useMarkAsPaid` on the PENDING row is the only path that moves cash, and
it writes no second allocation — one commitment, one allocation row.

Atomicity caveat: this is three round trips, so a failure between them can leave a cycle with
rows but no allocations. The `create_financing_with_obligation` / `allocate_debt_payment` RPCs
exist to avoid exactly that shape; folding cycle creation into a `create_cycle_with_plan` RPC is
the follow-up tracked in the release audit.

### 8.1 Allocation ↔ planned row (migration 028)

`cycle_allocations.transaction_id` menunjuk baris PENDING yang melahirkan komitmen itu
(`useCreateCycle`, `useAllocateObligation`). Membatalkan atau men-settle rencana di luar
siklus melepas **tepat** alokasi tersebut melalui `release_pending_transaction`
(internal, tidak bisa dipanggil client). Sebelum 028, `cancel_pending_transaction` hanya
menemukan alokasi baris tanggungan, sehingga rencana `EXPENSE` yang dibatalkan
meninggalkan alokasi aktif dan `unallocated` tercatat terlalu kecil. Baris lama tanpa
link dicocokkan ke komitmen identik (kategori + akun + nominal, atau tanggungan +
nominal); komitmen identik saling dapat dipertukarkan.

### 8.2 Satu angka dan hitungannya berasal dari baris yang sama

Setiap kali sebuah hitungan ditampilkan bersebelahan dengan nominal — "2 tagihan
belum dibayar · Rp 800.000" — keduanya **wajib** diturunkan dari himpunan baris
yang sama, idealnya dari satu fungsi. Aturan ini ditulis karena pola bugnya
muncul tiga kali dalam satu hari: banner ledger menghitung seluruh baris PENDING
siklus sementara section-nya dibangun dari 30 baris pertama; `unpaidExpenseCount`
se-siklus nyaris dipasangkan dengan `pendingExpense` per akun (karena itu
`pendingOutflowCount` ditambahkan di `lib/cashflow.ts`); dan baris "Terdekat" di
Home mencari di tiga baris yang dicetak, bukan di seluruh transaksi.

Konsekuensinya untuk kode baru: jangan pernah memasangkan `count` dari satu
query dengan `sum` dari query lain, dan setiap agregasi uang se-siklus yang
ditambahkan harus ikut memfilter tipe akun seperti
`lib/zero-based-accounting.ts` dan `countsTowardInsight` di `lib/insight.ts`.
Frasa yang mengungkapkan fakta yang sama di lebih dari satu layar ditulis sekali
sebagai fungsi — lihat `unpaidPlansLabel` di `lib/format.ts`.

## 9. Open TODOs (decisions deferred, not silent assumptions)

- ~~When an `EXPENSE` txn with `obligation_id` may count as `DEBT_PAYMENT`~~ → **resolved in Phase 2A**:
  an obligation row is always `DEBT_PAYMENT`; see `docs/phase-2-payment-paths.md`.
- Consolidating `DEBT`/`REIMBURSE` → `LOAN`/`REIMBURSEMENT` (later phase). `UNPAID` is no longer
  written by new rows (Phase 2A writes `OPEN`); the alias stays for old rows only.
- Full asset-tracking scope (later phase).
- ~~`allocate_debt_payment` txns are PAID — confirming them again via `useMarkAsPaid` would
  double-decrement~~ → **resolved in Phase 2A**: `canMarkAsPaid()` is the single gate.
- "Allocations = the only total" resolves txn-vs-allocation ambiguity for this phase.
