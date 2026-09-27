import { describe, expect, it } from 'vitest';
import {
  calculateFundingGap,
  calculateSourceFunds,
  calculateUnallocatedFunds,
  calculateZeroBasedSummary,
  canMarkAsPaid,
  defaultFlowType,
  isInstallmentOpen,
  isObligationPaydown,
  normalizeAmount,
  resolveModeAmount,
  splitInstallments,
} from '../zero-based';

// Shared fixture: operating 10jt + financing 3jt + asset release 2jt.
const SOURCE = { operatingIncome: 10_000_000, financingInflow: 3_000_000, assetRelease: 2_000_000 };

function summarize(overrides: {
  source?: Partial<typeof SOURCE>;
  allocations?: { expense?: number; debtPayment?: number; asset?: number };
  requiredAllocation?: number;
}) {
  return calculateZeroBasedSummary({
    source: { ...SOURCE, ...overrides.source },
    allocations: { expense: 0, debtPayment: 0, asset: 0, ...overrides.allocations },
    requiredAllocation: overrides.requiredAllocation ?? 0,
  });
}

describe('zero-based domain contract', () => {
  it('1: source only counts operating income when others are zero', () => {
    const summary = summarize({
      source: { operatingIncome: 10_000_000, financingInflow: 0, assetRelease: 0 },
    });
    expect(summary.sourceFunds.operatingIncome).toBe(10_000_000);
    expect(summary.sourceFunds.total).toBe(10_000_000);
    expect(calculateSourceFunds(10_000_000, 0, 0)).toBe(10_000_000);
  });

  it('2: operating + financing sum into source total', () => {
    const summary = summarize({
      source: { operatingIncome: 10_000_000, financingInflow: 3_000_000, assetRelease: 0 },
    });
    expect(summary.sourceFunds.total).toBe(13_000_000);
  });

  it('3: asset release adds to source total (10jt + 3jt + 2jt = 15jt)', () => {
    const summary = summarize({});
    expect(summary.sourceFunds.assetRelease).toBe(2_000_000);
    expect(summary.sourceFunds.total).toBe(15_000_000);
  });

  it('4: fully allocated source yields zero unallocated and COMPLETE', () => {
    const summary = summarize({
      allocations: { expense: 10_000_000, debtPayment: 3_000_000, asset: 2_000_000 },
      requiredAllocation: 15_000_000,
    });
    expect(summary.allocations.total).toBe(15_000_000);
    expect(summary.unallocatedFunds).toBe(0);
    expect(summary.fundingGap).toBe(0);
    expect(summary.status).toBe('COMPLETE');
  });

  it('5: leftover source is reported as UNALLOCATED', () => {
    const summary = summarize({
      allocations: { expense: 8_000_000, debtPayment: 2_000_000, asset: 1_000_000 },
      requiredAllocation: 11_000_000,
    });
    expect(summary.unallocatedFunds).toBe(4_000_000);
    expect(summary.fundingGap).toBe(0);
    expect(summary.status).toBe('UNALLOCATED');
  });

  it('6: required 20jt against 15jt source yields 5jt FUNDING_GAP', () => {
    const summary = summarize({
      allocations: { expense: 8_000_000, debtPayment: 2_000_000, asset: 1_000_000 },
      requiredAllocation: 20_000_000,
    });
    expect(summary.requiredAllocation).toBe(20_000_000);
    expect(summary.fundingGap).toBe(5_000_000);
    expect(summary.status).toBe('FUNDING_GAP');
  });

  it('7: over-allocation keeps a defined negative unallocated plus a positive gap', () => {
    const summary = summarize({
      allocations: { expense: 12_000_000, debtPayment: 4_000_000, asset: 2_000_000 },
      requiredAllocation: 18_000_000,
    });
    expect(summary.unallocatedFunds).toBe(-3_000_000);
    expect(summary.fundingGap).toBe(3_000_000);
    expect(summary.status).toBe('FUNDING_GAP');
  });

  it('8: financing inflow lands in its own slot, never in operating income', () => {
    const summary = summarize({
      source: { operatingIncome: 10_000_000, financingInflow: 5_000_000, assetRelease: 0 },
    });
    expect(summary.sourceFunds.operatingIncome).toBe(10_000_000);
    expect(summary.sourceFunds.financingInflow).toBe(5_000_000);
    expect(summary.sourceFunds.total).toBe(15_000_000);
  });

  it('9: debt payment lands in its own slot, never in consumptive expense', () => {
    const summary = summarize({
      allocations: { expense: 5_000_000, debtPayment: 4_000_000, asset: 0 },
      requiredAllocation: 9_000_000,
    });
    expect(summary.allocations.expense).toBe(5_000_000);
    expect(summary.allocations.debtPayment).toBe(4_000_000);
    expect(summary.allocations.total).toBe(9_000_000);
  });

  it('10: null/undefined inputs normalize to 0', () => {
    expect(normalizeAmount(null)).toBe(0);
    expect(normalizeAmount(undefined)).toBe(0);
    expect(calculateSourceFunds(null, undefined, null)).toBe(0);
    const summary = calculateZeroBasedSummary({
      source: { operatingIncome: null, financingInflow: undefined, assetRelease: null },
      allocations: {},
      requiredAllocation: null,
    });
    expect(summary.sourceFunds.total).toBe(0);
    expect(summary.allocations.total).toBe(0);
    expect(summary.status).toBe('COMPLETE');
  });

  it('11: planned vs actual diverge via resolveModeAmount (PENDING actual = 0)', () => {
    const pending = { planned_amount: 7_000_000, actual_amount: 7_000_000, status: 'PENDING' as const };
    const paid = { planned_amount: 7_000_000, actual_amount: 6_500_000, status: 'PAID' as const };
    expect(resolveModeAmount(pending, 'planned')).toBe(7_000_000);
    expect(resolveModeAmount(pending, 'actual')).toBe(0);
    expect(resolveModeAmount(paid, 'actual')).toBe(6_500_000);
  });

  it('12: empty input yields all-zero summary', () => {
    const summary = calculateZeroBasedSummary({
      source: {},
      allocations: {},
      requiredAllocation: 0,
    });
    expect(summary.sourceFunds).toEqual({ operatingIncome: 0, financingInflow: 0, assetRelease: 0, total: 0 });
    expect(summary.allocations.total).toBe(0);
    expect(summary.unallocatedFunds).toBe(0);
    expect(summary.fundingGap).toBe(0);
    expect(summary.status).toBe('COMPLETE');
  });

  it('13: no output is ever -0', () => {
    expect(Object.is(calculateFundingGap(0, 0), -0)).toBe(false);
    expect(Object.is(calculateUnallocatedFunds(0, 0), -0)).toBe(false);
    expect(Object.is(normalizeAmount(-0), -0)).toBe(false);
    expect(Object.is(calculateSourceFunds(-0, -0, -0), -0)).toBe(false);
    const summary = summarize({
      allocations: { expense: 10_000_000, debtPayment: 3_000_000, asset: 2_000_000 },
      requiredAllocation: 15_000_000,
    });
    for (const v of [
      summary.sourceFunds.total,
      summary.allocations.total,
      summary.unallocatedFunds,
      summary.fundingGap,
      summary.requiredAllocation,
    ]) {
      expect(Object.is(v, -0)).toBe(false);
    }
  });
});

describe('payment-path guards (phase 2A)', () => {
  it('14: only a PENDING row is payable', () => {
    expect(canMarkAsPaid({ status: 'PENDING' })).toBe(true);
    expect(canMarkAsPaid({ status: 'PAID' })).toBe(false);
  });

  it('15: an already-PAID debt payment is never payable again (double-decrement guard)', () => {
    // allocate_debt_payment writes its txn PAID and decrements remaining_amount
    // in the same SQL transaction. This is the exact shape of such a row.
    const executed = {
      status: 'PAID' as const,
      obligation_id: 'ob-1',
      flow_type: 'DEBT_PAYMENT' as const,
    };
    expect(canMarkAsPaid(executed)).toBe(false);
    expect(isObligationPaydown(executed)).toBe(true);
  });

  it('16: a planned DEBT_PAYMENT row is payable and is a paydown', () => {
    const planned = {
      status: 'PENDING' as const,
      obligation_id: 'ob-1',
      flow_type: 'DEBT_PAYMENT' as const,
    };
    expect(canMarkAsPaid(planned)).toBe(true);
    expect(isObligationPaydown(planned)).toBe(true);
  });

  it('17: only rows carrying an obligation_id are paydowns', () => {
    expect(isObligationPaydown({ status: 'PENDING' })).toBe(false);
    expect(isObligationPaydown({ status: 'PENDING', obligation_id: null })).toBe(false);
    expect(isObligationPaydown({ status: 'PENDING', obligation_id: 'ob-1' })).toBe(true);
  });

  it('18: defaultFlowType never auto-classifies an obligation row as DEBT_PAYMENT', () => {
    expect(defaultFlowType('INCOME', null)).toBe('OPERATING_INCOME');
    expect(defaultFlowType('INCOME', 'ob-1')).toBe('OPERATING_INCOME');
    expect(defaultFlowType('EXPENSE', null)).toBe('EXPENSE');
    // Auto-backfill is forbidden until an obligation pattern is proven.
    expect(defaultFlowType('EXPENSE', 'ob-1')).toBe('EXPENSE');
  });
});

describe('loan installment schedule (phase 2B)', () => {
  it('19: a divisible total splits evenly', () => {
    expect(splitInstallments(12_000_000, 12)).toEqual(Array(12).fill(1_000_000));
  });

  it('20: an indivisible total sums exactly, remainder on the first installments', () => {
    const parts = splitInstallments(10_000_000, 3);
    expect(parts).toEqual([3_333_334, 3_333_333, 3_333_333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_000_000);
  });

  it('21: a single installment is the whole total', () => {
    expect(splitInstallments(7_500_000, 1)).toEqual([7_500_000]);
  });

  it('22: invalid input yields no schedule instead of a broken one', () => {
    expect(splitInstallments(0, 12)).toEqual([]);
    expect(splitInstallments(1_000_000, 0)).toEqual([]);
    expect(splitInstallments(1_000_000, -3)).toEqual([]);
    expect(splitInstallments(1_000_000, 601)).toEqual([]);
    // Would create a zero-amount installment, which the table forbids.
    expect(splitInstallments(5, 10)).toEqual([]);
  });

  it('23: a schedule never contains a zero-amount row', () => {
    for (const parts of [splitInstallments(14_000_000, 12), splitInstallments(999_999, 7)]) {
      expect(parts.every((p) => p > 0)).toBe(true);
    }
  });

  it('24: an installment is open until settled or cancelled', () => {
    expect(isInstallmentOpen({ status: 'OPEN' })).toBe(true);
    expect(isInstallmentOpen({ status: 'PARTIAL' })).toBe(true);
    expect(isInstallmentOpen({ status: 'OVERDUE' })).toBe(true);
    expect(isInstallmentOpen({ status: 'SETTLED' })).toBe(false);
    expect(isInstallmentOpen({ status: 'CANCELLED' })).toBe(false);
  });
});
