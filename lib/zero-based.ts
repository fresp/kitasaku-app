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

export interface CycleReadiness {
  sourceFunds: number;
  requiredAllocation: number;
  unallocatedFunds: number;
  fundingGap: number;
  status: ZeroBasedStatus;
  /**
   * Whether the cycle may open. Exactly `fundingGap === 0`: a plan that needs
   * more than it has cannot be opened, and one that is fully funded can —
   * leftover unallocated funds are shown as a warning, not a blocker, matching
   * the design's "Alokasi lengkap · N belum punya tujuan" banner.
   */
  canOpen: boolean;
}

/**
 * The one readiness verdict for a cycle.
 *
 * Buka Siklus (`new-cycle.tsx`) and Funding Gap (`funding-gap.tsx`) are two
 * views of one question — can this cycle open, and if not, by how much is it
 * short? They used to answer it from different sides of the arithmetic: Buka
 * Siklus summed only routine expenses and debt payments, Funding Gap also
 * subtracted savings/asset allocations. The gate is defined once here so the
 * two screens cannot disagree, and so a new allocation bucket cannot silently
 * drop out of the total the way asset allocations once did.
 *
 * Both operands are normalized by `calculate*` below, so a `null` source or a
 * negative row contributes 0 rather than poisoning the sum with `NaN`.
 */
export function cycleReadiness(
  requiredAllocation: AmountInput,
  sourceFunds: AmountInput
): CycleReadiness {
  const source = normalizeAmount(sourceFunds);
  const required = normalizeAmount(requiredAllocation);
  const fundingGap = calculateFundingGap(required, source);
  const unallocatedFunds = calculateUnallocatedFunds(source, required);
  return {
    sourceFunds: source,
    requiredAllocation: required,
    unallocatedFunds,
    fundingGap,
    status: fundingGap > 0 ? 'FUNDING_GAP' : unallocatedFunds > 0 ? 'UNALLOCATED' : 'COMPLETE',
    canOpen: fundingGap === 0,
  };
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
 * Whether an installment row is still owed. `CANCELLED` is settled-by-decision,
 * not outstanding, so it is excluded alongside `SETTLED`.
 */
export function isInstallmentOpen(installment: {
  status: 'OPEN' | 'PARTIAL' | 'OVERDUE' | 'SETTLED' | 'CANCELLED';
}): boolean {
  return installment.status !== 'SETTLED' && installment.status !== 'CANCELLED';
}

/**
 * Splits a repayment total into `count` installments of equal size, with the
 * integer-division remainder spread one unit at a time over the FIRST
 * installments. Returns [] for invalid input rather than throwing, so callers
 * can render a preview while the user is still typing.
 *
 * MUST stay identical to `public.schedule_obligation_installments` in
 * migration 005 — that function is the one that actually writes the rows; this
 * one exists so the UI can show the split before anything is saved. The test
 * suite pins the shared examples.
 */
export function splitInstallments(
  total: AmountInput,
  count: AmountInput
): number[] {
  const t = normalizeAmount(total);
  if (count === null || count === undefined || !Number.isFinite(count)) return [];
  const n = Math.floor(count);
  if (n < 1 || n > 600) return [];
  if (t < n) return []; // would produce a 0-amount installment
  const base = Math.floor(t / n);
  const remainder = t - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
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

/**
 * What a row is *worth on screen* in the ledger.
 *
 * `resolveModeAmount('actual')` answers "how much money actually moved", which
 * is 0 for a PENDING row — right for the projection, useless in Riwayat: a
 * planned-but-unpaid bill would render as "− Rp 0" and its summary as Rp 0.
 * The ledger shows the plan for a row that has not been executed and the real
 * figure once it has.
 *
 * A PAID row with no recorded actual falls back to its plan rather than to
 * zero. `actual == 0` on a settled row is never a real payment (both pay paths
 * reject it), so it means the column was never written — and a settled line
 * reporting Rp 0 would understate the ledger.
 */
export function ledgerDisplayAmount(txn: {
  planned_amount: AmountInput;
  actual_amount: AmountInput;
  status: 'PENDING' | 'PAID';
}): number {
  if (txn.status === 'PENDING') return normalizeAmount(txn.planned_amount);
  const actual = normalizeAmount(txn.actual_amount);
  return actual > 0 ? actual : normalizeAmount(txn.planned_amount);
}

// ============ Phase 4: budget health, ledger grouping, template labels ============

export type BudgetHealthStatus = 'OVER' | 'WATCH' | 'SAFE' | 'NO_BUDGET';

export interface BudgetHealth {
  status: BudgetHealthStatus;
  /** Ratio in whole percent, capped at 999 for display sanity. */
  ratioPct: number;
  /** How far past the pagu, 0 when at or under it. */
  overAmount: number;
  /** Remaining pagu, 0 once exceeded. */
  remainingAmount: number;
  /** Design copy: MELEBIHI RENCANA / CEK RINCIAN / ANGGARAN AMAN / TANPA PAGU. */
  label: string;
  /** Maps to `Badge`'s tone vocabulary. */
  tone: 'pending' | 'alert' | 'paid' | 'default';
}

/**
 * The single budget-health rule. Budget Health, Detail Kategori, and Kelola
 * Kategori all render the same judgement, so the thresholds (100% / 80%) and
 * the copy live here rather than in three screens that can drift apart.
 *
 * `NO_BUDGET` is the case the old screens got wrong in opposite directions:
 * a category with no pagu but real spending was reported "ANGGARAN AMAN" in
 * Detail Kategori and "MELEBIHI RENCANA" in Budget Health. Neither is true —
 * there is no plan to be safe or over against.
 */
export function budgetHealthStatus(spent: AmountInput, budget: AmountInput): BudgetHealth {
  const s = normalizeAmount(spent);
  const b = normalizeAmount(budget);
  if (b <= 0) {
    return {
      status: s > 0 ? 'NO_BUDGET' : 'SAFE',
      ratioPct: s > 0 ? 999 : 0,
      overAmount: 0,
      remainingAmount: 0,
      label: s > 0 ? 'TANPA PAGU' : 'ANGGARAN AMAN',
      tone: s > 0 ? 'alert' : 'paid',
    };
  }
  const ratio = s / b;
  const ratioPct = Math.min(999, Math.round(ratio * 100));
  if (ratio > 1) {
    return {
      status: 'OVER',
      ratioPct,
      overAmount: s - b,
      remainingAmount: 0,
      label: 'MELEBIHI RENCANA',
      tone: 'pending',
    };
  }
  if (ratio > 0.8) {
    return {
      status: 'WATCH',
      ratioPct,
      overAmount: 0,
      remainingAmount: b - s,
      label: 'CEK RINCIAN',
      tone: 'alert',
    };
  }
  return {
    status: 'SAFE',
    ratioPct,
    overAmount: 0,
    remainingAmount: b - s,
    label: 'ANGGARAN AMAN',
    tone: 'paid',
  };
}

/** Bar fill percentage for a health row: 0 when no budget, else capped at 100. */
export function budgetFillPct(health: BudgetHealth): number {
  if (health.status === 'NO_BUDGET') return 100;
  return Math.max(2, Math.min(100, health.ratioPct));
}

/**
 * Indonesian short months. Exported because `profile.ts` formats dates too
 * ("Dibuat Sep 2026", "25 Sep – 24 Okt"); a second copy of this array is how
 * one screen ends up saying "Agu" while another says "Aug".
 */
export const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** `2026-09-25` -> `25 Sep`. Returns null for anything unparseable. */
export function formatShortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const month = MONTHS_ID[parseInt(m[2], 10) - 1];
  if (!month) return null;
  return `${parseInt(m[3], 10)} ${month}`;
}

/**
 * Ledger day heading, matching the design's "Hari Ini · 25 Sep" /
 * "Kemarin · 24 Sep" / "25 Sep 2026". Both dates are passed in so this stays
 * pure and testable — the caller decides what "today" is.
 *
 * `release_date` is null for a row that has not been executed, which is every
 * row cloned when a cycle opens. Those are not "undated": their date simply
 * does not exist yet, and a heading saying so is more honest than an empty
 * bucket at the bottom of the list.
 */
export function ledgerDayLabel(
  dateISO: string | null | undefined,
  todayISO: string
): string {
  const short = formatShortDate(dateISO);
  if (!short) return 'Belum bertanggal';
  const year = /^(\d{4})/.exec(dateISO!)?.[1];
  if (dateISO!.slice(0, 10) === todayISO.slice(0, 10)) return `Hari Ini · ${short}`;
  const y = new Date(`${todayISO.slice(0, 10)}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (dateISO!.slice(0, 10) === y.toISOString().slice(0, 10)) return `Kemarin · ${short}`;
  return year ? `${short} ${year}` : short;
}

export interface LedgerFilterRow {
  name: string;
  direction: 'INCOME' | 'EXPENSE';
  account_id?: string | null;
  accountName?: string | null;
  categoryName?: string | null;
  status?: 'PENDING' | 'PAID';
}

export interface LedgerFilter {
  query?: string;
  /** `null`/absent = every direction. */
  direction?: 'INCOME' | 'EXPENSE' | null;
  /** `null`/absent = every account. */
  accountId?: string | null;
  /** `null`/absent = every status. `PENDING` is Home's "belum dibayar" deep link. */
  status?: 'PENDING' | 'PAID' | null;
}

/**
 * Ledger search + chips. The design's placeholder is "Cari transaksi atau
 * toko...", so the needle is matched against the transaction name, the account
 * (the "toko"), and the category — matching only `name` would make searching
 * for a merchant silently fail.
 */
export function filterLedger<T extends LedgerFilterRow>(rows: T[], filter: LedgerFilter): T[] {
  const needle = (filter.query ?? '').trim().toLowerCase();
  return rows.filter((r) => {
    if (filter.direction && r.direction !== filter.direction) return false;
    if (filter.accountId && r.account_id !== filter.accountId) return false;
    // Applied only when the caller asked for a status *and* the row carries
    // one. An absent status on the row means "unknown", and dropping those
    // would hide rows rather than narrow the list.
    if (filter.status && r.status && r.status !== filter.status) return false;
    if (!needle) return true;
    return (
      r.name.toLowerCase().includes(needle) ||
      (r.accountName ?? '').toLowerCase().includes(needle) ||
      (r.categoryName ?? '').toLowerCase().includes(needle)
    );
  });
}

export interface LedgerTotals {
  expense: number;
  income: number;
  expenseCount: number;
  incomeCount: number;
}

/**
 * Totals for the ledger summary block. Sums the amount the caller already
 * resolved for the row (planned or actual), so the ledger and the zero-based
 * projection can never disagree about what a row is worth.
 */
export function summarizeLedger<T extends { direction: 'INCOME' | 'EXPENSE'; amount: number }>(
  rows: T[]
): LedgerTotals {
  let expense = 0, income = 0, expenseCount = 0, incomeCount = 0;
  for (const r of rows) {
    const amount = normalizeAmount(r.amount);
    if (r.direction === 'INCOME') { income += amount; incomeCount += 1; }
    else { expense += amount; expenseCount += 1; }
  }
  return { expense, income, expenseCount, incomeCount };
}

/** Design's "Tgl 5" fragment on a template card; null when no due day is set. */
export function templateDueLabel(dueDay: number | null | undefined): string | null {
  if (dueDay === null || dueDay === undefined) return null;
  if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) return null;
  return `Tgl ${Math.floor(dueDay)}`;
}
