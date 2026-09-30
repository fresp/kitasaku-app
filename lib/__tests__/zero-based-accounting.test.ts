import { describe, expect, it } from 'vitest';
import { aggregateCashAllocations, aggregateCashSourceFunds } from '../zero-based-accounting';

const allocation = (type: string | null, amount: number, allocation_type: 'EXPENSE' | 'DEBT_PAYMENT' = 'EXPENSE') => ({
  allocation_type,
  amount,
  accounts: type ? { type } : null,
});

describe('liquid-account Zero-Based totals', () => {
  it('includes bank/e-wallet sources and excludes credit card, cash, and unassigned', () => {
    const result = aggregateCashSourceFunds([
      { direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 1_000, actual_amount: 1_000, status: 'PAID', account_type: 'BANK' },
      { direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 2_000, actual_amount: 2_000, status: 'PAID', account_type: 'E_WALLET' },
      { direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 3_000, actual_amount: 3_000, status: 'PAID', account_type: 'CREDIT_CARD' },
      { direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 4_000, actual_amount: 4_000, status: 'PAID', account_type: 'CASH' },
      { direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 5_000, actual_amount: 5_000, status: 'PAID', account_type: null },
    ], 'actual');
    expect(result.total).toBe(3_000);
    expect(result.operatingIncome).toBe(3_000);
  });

  it('excludes cancelled sources and resolves planned versus actual pending income', () => {
    const rows = [
      { direction: 'INCOME' as const, flow_type: 'OPERATING_INCOME' as const, planned_amount: 5_000, actual_amount: 0, status: 'PENDING' as const, account_type: 'BANK' },
      { direction: 'INCOME' as const, flow_type: 'OPERATING_INCOME' as const, planned_amount: 7_000, actual_amount: 7_000, status: 'CANCELLED' as const, account_type: 'BANK' },
    ];
    expect(aggregateCashSourceFunds(rows, 'planned').total).toBe(5_000);
    expect(aggregateCashSourceFunds(rows, 'actual').total).toBe(0);
  });

  it('counts only active liquid-account allocations and excludes unassigned/CC/CASH history', () => {
    const result = aggregateCashAllocations([
      allocation('BANK', 1_000),
      allocation('E_WALLET', 2_000, 'DEBT_PAYMENT'),
      allocation('CREDIT_CARD', 3_000),
      allocation('CASH', 4_000),
      allocation(null, 5_000),
      { ...allocation('BANK', 6_000), cancelled_at: '2026-09-30T00:00:00Z' },
    ]);
    expect(result.expense).toBe(1_000);
    expect(result.debtPayment).toBe(2_000);
  });
});

