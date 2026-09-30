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
