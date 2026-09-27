import { describe, expect, it } from 'vitest';
import {
  calculateFundingGap,
  calculateSourceFunds,
  calculateUnallocatedFunds,
  calculateZeroBasedSummary,
  normalizeAmount,
  resolveModeAmount,
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
