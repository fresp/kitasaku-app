import { defaultFlowType } from './zero-based';
import type { FlowType } from './zero-based';

export interface HomeCashBalances {
  actualBalance: number | null;
  projectedBalance: number | null;
}

export function homeCashBalances(
  cashflow: Cashflow,
  openingStated: number | null,
): HomeCashBalances {
  if (openingStated === null) {
    return { actualBalance: null, projectedBalance: null };
  }
  return {
    actualBalance: openingStated + cashflow.actualCash,
    projectedBalance: openingStated + cashflow.projectedRemaining,
  };
}

export interface CashflowTxn {
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  direction: 'INCOME' | 'EXPENSE';
  flow_type?: FlowType | null;
  obligation_id?: string | null;
  account_id: string | null;
  counter_account_id?: string | null;
  actual_amount: number;
  planned_amount: number;
}

export interface Cashflow {
  /** Net paid movement for the selected account, excluding pending plans. */
  actualCash: number;
  /** Net cycle movement after applying pending plans. */
  projectedRemaining: number;
  income: number;
  expense: number;
  pendingIncome: number;
  pendingExpense: number;
  transferIn: number;
  transferOut: number;
  /** Every non-cancelled pending row in the cycle, across accounts. */
  pendingCount: number;
  paidCount: number;
  unpaidExpenseCount: number;
  pendingIncomeCount: number;
}

/** Calculates cycle movement for the selected primary bank account. */
export function calcCashflow(txns: CashflowTxn[], primaryAccountId?: string | null): Cashflow {
  let cashIn = 0, cashOut = 0, pendingOut = 0;
  let transferIn = 0, transferOut = 0;
  let pendingCount = 0, paidCount = 0, unpaidExpenseCount = 0, pendingIncomeCount = 0;
  let income = 0, expense = 0, pendingIncome = 0, pendingExpense = 0;
  for (const t of txns) {
    if (t.status === 'CANCELLED') continue;
    if (t.status === 'PENDING') {
      pendingCount += 1;
      if (t.direction === 'EXPENSE') unpaidExpenseCount += 1;
    }
    if (t.status === 'PAID') paidCount += 1;
    if (!primaryAccountId) continue;


    const flow = t.flow_type ?? defaultFlowType(t.direction, t.obligation_id ?? null);
    const transfer = flow === 'TRANSFER';
    const sourceIsPrimary = t.account_id === primaryAccountId;
    const destinationIsPrimary = transfer && t.counter_account_id === primaryAccountId;
    if (!sourceIsPrimary && !destinationIsPrimary) continue;

    const incoming = transfer
      ? destinationIsPrimary
      : sourceIsPrimary && ['OPERATING_INCOME', 'FINANCING_INFLOW', 'ASSET_RELEASE'].includes(flow);
    const outgoing = transfer
      ? sourceIsPrimary
      : sourceIsPrimary && ['EXPENSE', 'DEBT_PAYMENT', 'ASSET_ALLOCATION'].includes(flow);
    const amount = t.status === 'PAID' ? t.actual_amount : t.planned_amount;

    if (t.status === 'PAID') {
      if (incoming) cashIn += amount;
      if (outgoing) cashOut += amount;
      if (transfer) {
        if (destinationIsPrimary) transferIn += amount;
        if (sourceIsPrimary) transferOut += amount;
      } else if (incoming) income += amount;
      else if (outgoing) expense += amount;
    } else if (t.status === 'PENDING') {
      if (incoming) {
        pendingOut -= amount;
        if (t.direction === 'INCOME') pendingIncomeCount += 1;
        if (!transfer) pendingIncome += amount;
      } else if (outgoing) {
        pendingExpense += amount;
        pendingOut += amount;
      }
    }
  }
  const actualCash = cashIn - cashOut;
  return {
    actualCash,
    projectedRemaining: actualCash - pendingOut,
    income,
    expense,
    pendingIncome,
    pendingExpense,
    transferIn,
    transferOut,
    pendingCount,
    paidCount,
    unpaidExpenseCount,
    pendingIncomeCount,
  };
}
