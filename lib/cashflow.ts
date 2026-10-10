import { isZeroBasedCashAccount } from './account';
import { defaultFlowType } from './zero-based';
import type { FlowType } from './zero-based';

export interface HomeCashBalances {
  actualBalance: number | null;
  projectedBalance: number | null;
}

export function homeCashBalances(cashflow: Cashflow, openingStated: number | null): HomeCashBalances {
  if (openingStated === null) return { actualBalance: null, projectedBalance: null };
  return {
    actualBalance: openingStated + cashflow.actualCash,
    projectedBalance: openingStated + cashflow.projectedRemaining,
  };
}

export interface CashflowTxn {
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  /** Joined account row; PostgREST returns it as an object or a one-item array. */
  accounts?: { type?: string | null } | { type?: string | null }[] | null;
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
  /**
   * Pending rows that will leave the SELECTED account — the count that belongs
   * with `pendingExpense`. `unpaidExpenseCount` spans the whole cycle, so
   * pairing that one with a per-account amount would show a count and a figure
   * that disagree.
   */
  pendingOutflowCount: number;
  paidCount: number;
  unpaidExpenseCount: number;
  pendingIncomeCount: number;
}

/** Calculates cycle movement for one selected account. */
export function calcCashflow(txns: CashflowTxn[], accountId?: string | null): Cashflow {
  let cashIn = 0;
  let cashOut = 0;
  let pendingOut = 0;
  let transferIn = 0;
  let transferOut = 0;
  let pendingCount = 0;
  let pendingOutflowCount = 0;
  let paidCount = 0;
  let unpaidExpenseCount = 0;
  let pendingIncomeCount = 0;
  let income = 0;
  let expense = 0;
  let pendingIncome = 0;
  let pendingExpense = 0;

  for (const t of txns) {
    if (t.status === 'CANCELLED') continue;
    if (t.status === 'PENDING') {
      pendingCount += 1;
      if (t.direction === 'EXPENSE') unpaidExpenseCount += 1;
    }
    if (t.status === 'PAID') paidCount += 1;
    if (!accountId) continue;

    const flow = t.flow_type ?? defaultFlowType(t.direction, t.obligation_id ?? null);
    const transfer = flow === 'TRANSFER';
    const sourceIsAccount = t.account_id === accountId;
    const destinationIsAccount = transfer && t.counter_account_id === accountId;
    if (!sourceIsAccount && !destinationIsAccount) continue;

    const incoming = transfer
      ? destinationIsAccount
      : sourceIsAccount && ['OPERATING_INCOME', 'FINANCING_INFLOW', 'ASSET_RELEASE'].includes(flow);
    const outgoing = transfer
      ? sourceIsAccount
      : sourceIsAccount && ['EXPENSE', 'DEBT_PAYMENT', 'ASSET_ALLOCATION'].includes(flow);
    const amount = t.status === 'PAID' ? t.actual_amount : t.planned_amount;

    if (t.status === 'PAID') {
      if (incoming) cashIn += amount;
      if (outgoing) cashOut += amount;
      if (transfer) {
        if (destinationIsAccount) transferIn += amount;
        if (sourceIsAccount) transferOut += amount;
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
        pendingOutflowCount += 1;
      }
    }
  }

  const actualCash = cashIn - cashOut;
  return {
    actualCash,
    projectedRemaining: actualCash - pendingOut,
    pendingOutflowCount,
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

const OUTGOING_FLOWS = ['EXPENSE', 'DEBT_PAYMENT', 'ASSET_ALLOCATION'];

/**
 * What this cycle spent from accounts that hold no cash of their own — a credit
 * card, or physical cash. Home's balance figures are per cash account, so this
 * money never shows there: it left no bank account, and for a card it has not
 * left anything yet. Surfaced as a note so a card purchase does not read as a
 * transaction that went missing.
 *
 * A row whose account is not joined is left out: unknown is not the same as
 * non-cash, and guessing would overstate the note.
 */
export function nonCashSpend(txns: CashflowTxn[]): number {
  let total = 0;
  for (const t of txns) {
    if (t.status !== 'PAID') continue;
    const joined = Array.isArray(t.accounts) ? t.accounts[0] : t.accounts;
    const type = joined?.type;
    if (!type || isZeroBasedCashAccount({ type })) continue;
    const flow = t.flow_type ?? defaultFlowType(t.direction, t.obligation_id ?? null);
    if (!OUTGOING_FLOWS.includes(flow)) continue;
    total += t.actual_amount;
  }
  return total;
}
