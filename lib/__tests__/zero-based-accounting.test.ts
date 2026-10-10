import { describe, expect, it } from 'vitest';
import { aggregateCashAllocations, aggregateCashSourceFunds, allocationUsage, overspendTotal } from '../zero-based-accounting';
import type { UsageTxn } from '../zero-based-accounting';

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

  it('keeps transfers out of household source totals', () => {
    const result = aggregateCashSourceFunds([
      { direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 1_000, actual_amount: 1_000, status: 'PAID', account_type: 'BANK' },
      { direction: 'EXPENSE', flow_type: 'TRANSFER', planned_amount: 500, actual_amount: 500, status: 'PAID', account_type: 'BANK' },
    ], 'actual');
    expect(result.total).toBe(1_000);
    expect(result.operatingIncome).toBe(1_000);
  });

  it('counts the persisted allocation row once; transaction outflows are not allocation inputs', () => {
    const allocations = aggregateCashAllocations([allocation('BANK', 500)]);
    expect(allocations.expense).toBe(500);
    expect(allocations.debtPayment).toBe(0);
    expect(allocations.asset).toBe(0);
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

describe('allocationUsage', () => {
  const paid = { id: 't1', status: 'PAID' as const, actual_amount: 659_465 };
  const pending = { id: 't2', status: 'PENDING' as const, actual_amount: 0 };
  const byId = new Map<string, UsageTxn>([[paid.id, paid], [pending.id, pending]]);

  it('reports what moved and how far past the commitment it went', () => {
    expect(allocationUsage({ id: 'a', amount: 500_000, transaction_id: 't1' }, byId))
      .toEqual({ actual: 659_465, delta: 159_465 });
  });

  it('reports a negative delta when the commitment was not used up', () => {
    expect(allocationUsage({ id: 'a', amount: 800_000, transaction_id: 't1' }, byId))
      .toEqual({ actual: 659_465, delta: -140_535 });
  });

  it('says nothing for a plan that has not been executed', () => {
    expect(allocationUsage({ id: 'a', amount: 500_000, transaction_id: 't2' }, byId))
      .toEqual({ actual: null, delta: null });
  });

  it('says nothing for an unlinked or cancelled commitment', () => {
    expect(allocationUsage({ id: 'a', amount: 500_000 }, byId)).toEqual({ actual: null, delta: null });
    expect(allocationUsage({ id: 'a', amount: 500_000, transaction_id: 't1', cancelled_at: 'x' }, byId))
      .toEqual({ actual: null, delta: null });
    expect(allocationUsage({ id: 'a', amount: 500_000, transaction_id: 'gone' }, byId))
      .toEqual({ actual: null, delta: null });
  });
});

describe('overspendTotal', () => {
  const byId = new Map([
    ['over', { id: 'over', status: 'PAID' as const, actual_amount: 659_465 }],
    ['under', { id: 'under', status: 'PAID' as const, actual_amount: 300_000 }],
  ]);

  it('sums only what went past its commitment', () => {
    expect(overspendTotal([
      { id: 'a', amount: 500_000, transaction_id: 'over' },
      { id: 'b', amount: 500_000, transaction_id: 'under' },
      { id: 'c', amount: 500_000 },
    ], byId)).toBe(159_465);
  });

  it('is zero when nothing was exceeded', () => {
    expect(overspendTotal([{ id: 'b', amount: 500_000, transaction_id: 'under' }], byId)).toBe(0);
  });
});
