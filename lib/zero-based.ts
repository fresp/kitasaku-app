// Kitasaku Phase 1: zero-based allocation domain contract.
//
// Pure module: zero imports (types only), no DB/React/side-effects.
// All money math funnels through `normalizeAmount`, the single place where
// the negative-input rule lives. Aggregators never branch on planned/actual;
// the projection layer resolves per-mode amounts via `resolveModeAmount`
// before calling into `calculate*`.
//
// Anti-double-count rule (mirrored in lib/queries.ts + docs): the allocation
// total comes ONLY from cycle_allocations rows. Transaction `flow_type`
// outflow values classify ledger rows (consumptive expense vs debt payment)
// but are never added to the required/total allocation.

export type FlowType =
  | 'OPERATING_INCOME'
  | 'FINANCING_INFLOW'
  | 'ASSET_RELEASE'
  | 'EXPENSE'
  | 'DEBT_PAYMENT'
  | 'ASSET_ALLOCATION';

export type AllocationType =
  | 'EXPENSE'
  | 'DEBT_PAYMENT'
  | 'ASSET'
  | 'SAVINGS'
  | 'INVESTMENT'
  | 'EMERGENCY_FUND'
  | 'OTHER';

export type ZeroBasedStatus = 'COMPLETE' | 'UNALLOCATED' | 'FUNDING_GAP';

export type FundingGapStatus = ZeroBasedStatus;

export type SummaryMode = 'planned' | 'actual';

export type AmountInput = number | null | undefined;

export interface SourceFundsBreakdown {
  operatingIncome: number;
  financingInflow: number;
  assetRelease: number;
  total: number;
}

export interface AllocationBreakdown {
  expense: number;
  debtPayment: number;
  asset: number;
  savings: number;
  investment: number;
  emergencyFund: number;
  other: number;
  total: number;
}

export interface ZeroBasedSummary {
  sourceFunds: SourceFundsBreakdown;
  allocations: AllocationBreakdown;
  unallocatedFunds: number;
  requiredAllocation: number;
  fundingGap: number;
  status: ZeroBasedStatus;
}

export interface LoanMetadata {
  obligationType: 'BILL' | 'LOAN' | 'REIMBURSEMENT' | 'INSTALLMENT';
  lenderOrRecipient: string | null;
  repaymentMethod: string | null;
  plannedInstallmentAmount: number | null;
  installmentCount: number | null;
  currentInstallment: number | null;
  startDate: string | null;
  dueDate: string | null;
  interestFeeAmount: number | null;
  linkedFinancingTransactionId: string | null;
  status: 'OPEN' | 'PARTIAL' | 'OVERDUE' | 'SETTLED' | 'CANCELLED';
}

export interface ObligationSummary {
  id: string;
  householdId: string;
  title: string;
  type: string;
  status: string;
  totalAmount: number;
  remainingAmount: number;
  paidAmount: number;
  progressPct: number;
}

/**
 * Single normalization point for every amount in this module.
 * `null`/`undefined`/`NaN` -> `0`; `-0` -> `0`; negative values are
 * clamped to `0` (corrections/credits are out of scope for Phase 1 —
 * change this one function, not each `calculate*`, if that changes).
 */
export function normalizeAmount(v: AmountInput): number {
  if (v === null || v === undefined) return 0;
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  if (v <= 0) return 0; // clamps negatives; also maps -0 -> +0
  return v;
}

export function calculateSourceFunds(
  operatingIncome: AmountInput,
  financingInflow: AmountInput,
  assetRelease: AmountInput
): number {
  return (
    normalizeAmount(operatingIncome) +
    normalizeAmount(financingInflow) +
    normalizeAmount(assetRelease)
  );
}

export function calculateTotalAllocation(
  expenseAllocation: AmountInput,
  debtPaymentAllocation: AmountInput,
  assetAllocation: AmountInput
): number {
  return (
    normalizeAmount(expenseAllocation) +
    normalizeAmount(debtPaymentAllocation) +
    normalizeAmount(assetAllocation)
  );
}

/**
 * `source - total`. Operands are normalized first; the signed difference is
 * preserved (over-allocation yields a defined negative), with only `-0`
 * mapped to `0` so no `-0` ever escapes.
 */
export function calculateUnallocatedFunds(
  sourceFunds: AmountInput,
  totalAllocation: AmountInput
): number {
  const diff = normalizeAmount(sourceFunds) - normalizeAmount(totalAllocation);
  return Object.is(diff, -0) ? 0 : diff;
}

/** `max(required - source, 0)`, with `-0` mapped to `0`. */
export function calculateFundingGap(
  requiredAllocation: AmountInput,
  sourceFunds: AmountInput
): number {
  const gap = Math.max(
    normalizeAmount(requiredAllocation) - normalizeAmount(sourceFunds),
    0
  );
  return Object.is(gap, -0) ? 0 : gap;
}

export interface ZeroBasedSummaryArgs {
  source: {
    operatingIncome?: AmountInput;
    financingInflow?: AmountInput;
    assetRelease?: AmountInput;
  };
  allocations: {
    expense?: AmountInput;
    debtPayment?: AmountInput;
    asset?: AmountInput;
    savings?: AmountInput;
    investment?: AmountInput;
    emergencyFund?: AmountInput;
    other?: AmountInput;
  };
  requiredAllocation: AmountInput;
}

/**
 * Builds the full summary. `allocations.asset` holds the ASSET slot only;
 * SAVINGS/INVESTMENT/EMERGENCY_FUND/OTHER are separate projection slots and
 * are NOT folded into `asset` (callers must not nest them inside `asset`),
 * so `total` is a plain sum with no double-count. Omitted savings-like
 * slots default to `0`.
 */
export function calculateZeroBasedSummary(
  args: ZeroBasedSummaryArgs
): ZeroBasedSummary {
  const operatingIncome = normalizeAmount(args.source.operatingIncome);
  const financingInflow = normalizeAmount(args.source.financingInflow);
  const assetRelease = normalizeAmount(args.source.assetRelease);
  const sourceFunds: SourceFundsBreakdown = {
    operatingIncome,
    financingInflow,
    assetRelease,
    total: calculateSourceFunds(operatingIncome, financingInflow, assetRelease),
  };

  const expense = normalizeAmount(args.allocations.expense);
  const debtPayment = normalizeAmount(args.allocations.debtPayment);
  const asset = normalizeAmount(args.allocations.asset);
  const savings = normalizeAmount(args.allocations.savings);
  const investment = normalizeAmount(args.allocations.investment);
  const emergencyFund = normalizeAmount(args.allocations.emergencyFund);
  const other = normalizeAmount(args.allocations.other);
  const allocations: AllocationBreakdown = {
    expense,
    debtPayment,
    asset,
    savings,
    investment,
    emergencyFund,
    other,
    total:
      expense +
      debtPayment +
      asset +
      savings +
      investment +
      emergencyFund +
      other,
  };

  const requiredAllocation = normalizeAmount(args.requiredAllocation);
  const unallocatedFunds = calculateUnallocatedFunds(
    sourceFunds.total,
    allocations.total
  );
  const fundingGap = calculateFundingGap(requiredAllocation, sourceFunds.total);
  const status: ZeroBasedStatus =
    fundingGap > 0
      ? 'FUNDING_GAP'
      : unallocatedFunds > 0
        ? 'UNALLOCATED'
        : 'COMPLETE';
  return {
    sourceFunds,
    allocations,
    unallocatedFunds,
    requiredAllocation,
    fundingGap,
    status,
  };
}

/**
 * Classification default for rows (or old clients) without `flow_type`.
 * INCOME always classifies as operating income — financing inflow must be
 * set explicitly so it never leaks into operating income. EXPENSE stays
 * EXPENSE even when `obligation_id` is set: auto-backfill to DEBT_PAYMENT
 * is forbidden until an obligation pattern is proven (see docs TODO).
 */
export function defaultFlowType(
  direction: 'INCOME' | 'EXPENSE',
  obligationId: string | null
): FlowType {
  void obligationId;
  return direction === 'INCOME' ? 'OPERATING_INCOME' : 'EXPENSE';
}

/** Rows a payment may be executed against. */
export interface PayableTxn {
  status: 'PENDING' | 'PAID';
  obligation_id?: string | null;
  flow_type?: FlowType | null;
}

/**
 * Single gate for whether a row may still be paid, i.e. whether the
 * PENDING -> PAID transition is available.
 *
 * Phase 2 guard (see docs TODO): `allocate_debt_payment` writes its
 * transaction already PAID and decrements `remaining_amount` inside the same
 * SQL transaction. Re-confirming such a row would decrement the obligation a
 * second time, so an already-PAID row is never payable again. This is the only
 * place that rule lives; every caller (payment-confirm, obligation rows) must
 * ask this function rather than checking `status` inline.
 */
export function canMarkAsPaid(txn: PayableTxn): boolean {
  return txn.status === 'PENDING';
}

/**
 * Whether executing this row must also reduce the linked obligation.
 * A DEBT_PAYMENT row or any row carrying an `obligation_id` is a paydown;
 * combined with `canMarkAsPaid` this keeps the decrement exactly-once.
 */
export function isObligationPaydown(txn: PayableTxn): boolean {
  return !!txn.obligation_id;
}

/**
 * Planned-vs-actual source of truth for every projection: `planned` reads
 * `planned_amount`; `actual` reads `actual_amount` only for PAID rows
 * (PENDING rows contribute 0 in actual mode).
 */
export function resolveModeAmount(
  txn: {
    planned_amount: AmountInput;
    actual_amount: AmountInput;
    status: 'PENDING' | 'PAID';
  },
  mode: SummaryMode
): number {
  if (mode === 'actual') {
    return txn.status === 'PAID' ? normalizeAmount(txn.actual_amount) : 0;
  }
  return normalizeAmount(txn.planned_amount);
}
