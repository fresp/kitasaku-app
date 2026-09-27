# Phase 2 — Payment paths, guards, and cache coherence

Phase 1 shipped the domain contract but left two ways to pay an obligation and
several mutations that never invalidated the new projections. Phase 2 closes
that gap before the Home dashboard reads from those projections.

## 2A — One classification, one commitment, one execution

### The problem

Two code paths could pay the same obligation and they disagreed:

| Path | Txn it wrote | Allocation row |
|---|---|---|
| `useAllocateObligation` | `EXPENSE` / `PENDING` | none |
| `allocate_debt_payment` (RPC) | `DEBT_PAYMENT` / `PAID` | yes |

So the same 1jt payment landed in "Pengeluaran" through one screen and in
"Pembayaran Kewajiban" through the other, and "Total Alokasi" only moved for one
of them. On top of that, `useMarkAsPaid` decremented `remaining_amount`
unconditionally — running it against a row the RPC had already settled would
have decremented a second time.

### The rules now in force

1. **Obligation rows are always `DEBT_PAYMENT`.** Any transaction carrying an
   `obligation_id` classifies as debt paydown, so the ledger and the allocation
   slot agree no matter which path created the row.
2. **A commitment is an allocation.** Committing money to an obligation writes a
   `cycle_allocations` row at *plan* time, not at execution time. "Total Alokasi"
   therefore reflects intent, which is what zero-based budgeting means.
3. **One execution, one decrement.** `canMarkAsPaid(txn)` is the single gate for
   the `PENDING → PAID` transition. `allocate_debt_payment` writes its row already
   `PAID`, so it is never payable again.

| Path | Txn | Allocation | When to use |
|---|---|---|---|
| `useAllocateObligation` → `useMarkAsPaid` | `DEBT_PAYMENT` / `PENDING` → `PAID` | written at plan time | Plan first, pay later |
| `useAllocateDebtPayment` (RPC) | `DEBT_PAYMENT` / `PAID` | written by the RPC | Pay now, plan retroactively |

Both end in the same place: a `DEBT_PAYMENT` row plus exactly one
`cycle_allocations` row, and exactly one decrement of `remaining_amount`.

`useMarkAsPaid` deliberately does **not** write an allocation — the row it
confirms was already allocated. `allocate_debt_payment` writes its own because
nothing planned it first.

### Pure guards (`lib/zero-based.ts`)

- `canMarkAsPaid({ status, obligation_id?, flow_type? })` — true only for
  `PENDING`. Every caller asks this; nobody checks `status` inline.
- `isObligationPaydown({ status, obligation_id?, flow_type? })` — true when the
  row carries an `obligation_id`, i.e. executing it must reduce the obligation.

`components/ui/TransactionRow.tsx` renders the pay action only when
`canMarkAsPaid` allows it, so a settled row is not offered an action that would
only fail on tap.

### Cache coherence

`invalidateMoneyKeys(qc)` in `lib/queries.ts` is now the only place that decides
which keys a money-moving mutation invalidates: `['txns']`, `['oblig']`,
`['alloc']`, `['source-funds']`, `['zero-summary']`. `useMarkAsPaid`,
`useQuickAdd`, `useAllocateObligation`, `useCreateCycle`, and
`useCreateObligation` all route through it. Dispersion of these keys was the bug:
marking something paid used to leave `['source-funds']` and `['zero-summary']`
stale until a manual refresh.

### Canonical state names

New obligations are written as `OPEN`. `UNPAID` survives only as a read alias
(migration 004) so existing rows keep working.

## Verified

`npx vitest run` — 18/18 (13 domain cases + 5 guard cases) · `npx tsc --noEmit` —
clean · `npx expo lint` — no new findings (the 2 remaining are pre-existing in
`app/(auth)/setup-choice.tsx` and `app/_layout.tsx`).
