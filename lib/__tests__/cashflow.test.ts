import { describe, expect, it } from 'vitest';
import { calcCashflow, homeCashBalances } from '../cashflow';
import type { Txn } from '../queries';

function txn(overrides: Partial<Txn>): Txn {
  return {
    id: 'txn', household_id: 'household', cycle_id: 'cycle', recurring_template_id: null,
    obligation_id: null, name: 'row', category_id: null, account_id: 'bank',
    direction: 'EXPENSE', flow_type: 'EXPENSE', planned_amount: 0, actual_amount: 0,
    release_date: null, status: 'PAID', created_by: null, executed_by: null,
    recipient: null, is_final_payment: false, created_at: '', ...overrides,
  };
}

describe('account Home cashflow', () => {
  it('counts only selected-account paid inflows/outflows and ignores other accounts', () => {
    const result = calcCashflow([
      txn({ direction: 'INCOME', flow_type: 'OPERATING_INCOME', actual_amount: 2_000_000 }),
      txn({ actual_amount: 500_000 }),
      txn({ account_id: 'card', actual_amount: 1_510_000 }),
      txn({ account_id: 'cash', actual_amount: 50_000 }),
    ], 'bank');
    expect(result.actualCash).toBe(1_500_000);
  });

  it('includes directional transfer movement, including for a CASH account', () => {
    const txns = [
      txn({ flow_type: 'TRANSFER', account_id: 'bank', counter_account_id: 'cash', planned_amount: 200_000, actual_amount: 200_000 }),
      txn({ flow_type: 'TRANSFER', account_id: 'cash', counter_account_id: 'bank', planned_amount: 50_000, actual_amount: 50_000 }),
      txn({ direction: 'INCOME', flow_type: 'OPERATING_INCOME', account_id: 'cash', actual_amount: 300_000 }),
      txn({ account_id: 'card', actual_amount: 900_000 }),
    ];
    const cash = calcCashflow(txns, 'cash');
    expect(cash.transferIn).toBe(200_000);
    expect(cash.transferOut).toBe(50_000);
    expect(cash.actualCash).toBe(450_000);
    expect(cash.income + cash.transferIn).toBe(500_000);
    expect(cash.expense + cash.transferOut).toBe(50_000);
  });

  it('projects pending movements and counts transfer directionally', () => {
    const result = calcCashflow([
      txn({ direction: 'INCOME', flow_type: 'OPERATING_INCOME', status: 'PENDING', planned_amount: 3_000_000 }),
      txn({ status: 'PENDING', planned_amount: 400_000 }),
      txn({ flow_type: 'TRANSFER', account_id: 'bank', counter_account_id: 'wallet', planned_amount: 200_000, actual_amount: 200_000 }),
      txn({ flow_type: 'TRANSFER', account_id: 'wallet', counter_account_id: 'bank', planned_amount: 100_000, actual_amount: 100_000 }),
      txn({ direction: 'INCOME', flow_type: 'OPERATING_INCOME', account_id: 'card', status: 'PENDING', planned_amount: 9_000_000 }),
    ], 'bank');
    expect(result.actualCash).toBe(-100_000);
    expect(result.projectedRemaining).toBe(2_500_000);
    expect(result.pendingCount).toBe(3);
    expect(result.unpaidExpenseCount).toBe(1);
    expect(result.pendingIncomeCount).toBe(1);
  });

  it('computes an absolute balance only from a stated opening anchor', () => {
    const result = calcCashflow([
      txn({ direction: 'INCOME', flow_type: 'OPERATING_INCOME', actual_amount: 2_000_000 }),
      txn({ flow_type: 'EXPENSE', actual_amount: 500_000 }),
    ], 'bank');
    expect(result.income).toBe(2_000_000);
    expect(result.expense).toBe(500_000);
    expect(homeCashBalances(result, 10_000_000)).toEqual({ actualBalance: 11_500_000, projectedBalance: 11_500_000 });
    expect(homeCashBalances(result, null)).toEqual({ actualBalance: null, projectedBalance: null });
  });

  it('ignores cancelled transactions and keeps movement zero when no account is selected', () => {
    const result = calcCashflow([
      txn({ status: 'CANCELLED', actual_amount: 10_000 }),
      txn({ actual_amount: 99_000 }),
    ], null);
    expect(result.actualCash).toBe(0);
    expect(result.pendingCount).toBe(0);
    expect(result.paidCount).toBe(1);
  });
});
