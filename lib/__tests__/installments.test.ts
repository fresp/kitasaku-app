import { describe, expect, it } from 'vitest';
import {
  calculateInstallmentSchedule,
  scheduleInterest,
  schedulePrincipal,
  scheduleTotal,
} from '../installments';

describe('calculateInstallmentSchedule', () => {
  it('creates equal fixed installments with the final principal residual', () => {
    const rows = calculateInstallmentSchedule({
      principalAmount: 10_000,
      tenor: 3,
      mode: 'FIXED_INSTALLMENT',
    });

    expect(rows.map((row) => row.totalAmount)).toEqual([3_333, 3_333, 3_334]);
    expect(schedulePrincipal(rows)).toBe(10_000);
    expect(scheduleInterest(rows)).toBe(0);
    expect(scheduleTotal(rows)).toBe(10_000);
    expect(rows.at(-1)?.remainingPrincipal).toBe(0);
  });

  it('keeps floating zero-interest schedules identical to fixed schedules', () => {
    const rows = calculateInstallmentSchedule({
      principalAmount: 1_000_000,
      tenor: 4,
      monthlyInterestRateBps: 0,
      mode: 'FLOATING_INTEREST',
    });

    expect(rows.every((row) => row.interestAmount === 0)).toBe(true);
    expect(rows.map((row) => row.principalAmount)).toEqual([250_000, 250_000, 250_000, 250_000]);
    expect(scheduleTotal(rows)).toBe(1_000_000);
  });

  it('charges floating interest on the opening remaining principal', () => {
    const rows = calculateInstallmentSchedule({
      principalAmount: 1_000_000,
      tenor: 3,
      monthlyInterestRateBps: 1_000,
      mode: 'FLOATING_INTEREST',
    });

    expect(rows.map((row) => row.interestAmount)).toEqual([100_000, 66_667, 33_333]);
    expect(rows.map((row) => row.totalAmount)).toEqual([433_333, 400_000, 366_667]);
    expect(schedulePrincipal(rows)).toBe(1_000_000);
    expect(scheduleInterest(rows)).toBe(200_000);
  });

  it('returns no schedule for invalid or overlong input', () => {
    expect(calculateInstallmentSchedule({ principalAmount: 0, tenor: 3, mode: 'FIXED_INSTALLMENT' })).toEqual([]);
    expect(calculateInstallmentSchedule({ principalAmount: 100, tenor: 0, mode: 'FIXED_INSTALLMENT' })).toEqual([]);
    expect(calculateInstallmentSchedule({ principalAmount: 100, tenor: 601, mode: 'FIXED_INSTALLMENT' })).toEqual([]);
    expect(calculateInstallmentSchedule({ principalAmount: 100, tenor: 3, monthlyInterestRateBps: -1, mode: 'FLOATING_INTEREST' })).toEqual([]);
  });
});
