import { isZeroBasedCashAccount } from './account';
import { defaultFlowType, resolveModeAmount } from './zero-based';
import type { AllocationType, FlowType, SourceFundsBreakdown, SummaryMode } from './zero-based';

export interface SourceFundRow {
  direction: 'INCOME' | 'EXPENSE';
  flow_type?: FlowType | null;
  obligation_id?: string | null;
  planned_amount: number;
  actual_amount: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  account_type?: string | null;
}

export interface AllocationAccountingRow {
  allocation_type: AllocationType;
  amount: number;
  cancelled_at?: string | null;
  accounts?: { name?: string; type?: string } | { name?: string; type?: string }[] | null;
}

function joinedAccountType(value: AllocationAccountingRow['accounts']): string {
  return (Array.isArray(value) ? value[0]?.type : value?.type) ?? '';
}

export function aggregateCashSourceFunds(rows: SourceFundRow[], mode: SummaryMode): SourceFundsBreakdown {
  let operatingIncome = 0, financingInflow = 0, assetRelease = 0;
  for (const txn of rows) {
    if (txn.status === 'CANCELLED' || !isZeroBasedCashAccount({ type: txn.account_type ?? '' })) continue;
    const flow = txn.flow_type ?? defaultFlowType(txn.direction, txn.obligation_id ?? null);
    const amount = resolveModeAmount(txn, mode);
    if (flow === 'OPERATING_INCOME') operatingIncome += amount;
    else if (flow === 'FINANCING_INFLOW') financingInflow += amount;
    else if (flow === 'ASSET_RELEASE') assetRelease += amount;
  }
  return { operatingIncome, financingInflow, assetRelease, total: operatingIncome + financingInflow + assetRelease };
}

export function aggregateCashAllocations(rows: AllocationAccountingRow[]) {
  const byType: Record<AllocationType, number> = {
    EXPENSE: 0, DEBT_PAYMENT: 0, ASSET: 0, SAVINGS: 0,
    INVESTMENT: 0, EMERGENCY_FUND: 0, OTHER: 0,
  };
  for (const row of rows) {
    if (row.cancelled_at || !isZeroBasedCashAccount({ type: joinedAccountType(row.accounts) })) continue;
    byType[row.allocation_type] += Math.max(0, row.amount);
  }
  return {
    expense: byType.EXPENSE, debtPayment: byType.DEBT_PAYMENT, asset: byType.ASSET,
    savings: byType.SAVINGS, investment: byType.INVESTMENT,
    emergencyFund: byType.EMERGENCY_FUND, other: byType.OTHER,
  };
}

export function eligibleCashAllocation(row: AllocationAccountingRow): boolean {
  return isZeroBasedCashAccount({ type: joinedAccountType(row.accounts) });
}

export interface AllocationUsageRow {
  id: string;
  amount: number;
  transaction_id?: string | null;
  cancelled_at?: string | null;
}

export interface UsageTxn {
  id: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  actual_amount: number;
}

export interface AllocationUsage {
  /** What actually moved, or null when nothing has been executed yet. */
  actual: number | null;
  /** actual − planned. Positive means the commitment was exceeded. */
  delta: number | null;
}

/**
 * What a commitment actually cost, read through the planned row it is linked
 * to (migration 028). An allocation with no link, or whose row has not been
 * executed, reports null rather than zero: "not spent yet" and "spent nothing"
 * are different facts, and showing the second for the first would read as an
 * underspend that is not real.
 */
export function allocationUsage(
  allocation: AllocationUsageRow,
  txnById: Map<string, UsageTxn>,
): AllocationUsage {
  if (allocation.cancelled_at || !allocation.transaction_id) return { actual: null, delta: null };
  const txn = txnById.get(allocation.transaction_id);
  if (!txn || txn.status !== 'PAID') return { actual: null, delta: null };
  return { actual: txn.actual_amount, delta: txn.actual_amount - allocation.amount };
}

/** Every rupiah spent past its commitment this cycle, summed. */
export function overspendTotal(
  allocations: AllocationUsageRow[],
  txnById: Map<string, UsageTxn>,
): number {
  let total = 0;
  for (const a of allocations) {
    const { delta } = allocationUsage(a, txnById);
    if (delta !== null && delta > 0) total += delta;
  }
  return total;
}
