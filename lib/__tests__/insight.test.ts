import { describe, it, expect } from 'vitest';
import {
  accumulateAssets,
  annualTotals,
  assetSeriesByType,
  assetSummary,
  ASSET_BANDS,
  bandKeyOfAllocationType,
  bandLabel,
  barPct,
  buildTrendInsights,
  buildYearBuckets,
  cycleMonth,
  cyclesInYear,
  isAssetAllocationType,
  latestActiveMonth,
  liabilitySeries,
  monthFullName,
  monthOf,
  monthOverMonth,
  monthYearLabel,
  niceMax,
  planVsActual,
  windowEndingAt,
  yearOf,
} from '../insight';
import type { InsightAllocation, InsightCycle, InsightTxn } from '../insight';

// A cycle is placed on its END month (payday-to-payday cycles are named for the
// month they close in), so "Siklus Nov" runs 25 Oct – 24 Nov and belongs in Nov.
const CYCLE_JAN: InsightCycle = { id: 'c-jan', name: 'Siklus Jan 2026', start_date: '2025-12-25', end_date: '2026-01-24' };
const CYCLE_FEB: InsightCycle = { id: 'c-feb', name: 'Siklus Feb 2026', start_date: '2026-01-25', end_date: '2026-02-24' };
const CYCLE_MAR: InsightCycle = { id: 'c-mar', name: 'Siklus Mar 2026', start_date: '2026-02-25', end_date: '2026-03-24' };
const CYCLE_2025: InsightCycle = { id: 'c-2025', name: 'Siklus Des 2025', start_date: '2025-11-25', end_date: '2025-12-24' };

function txn(p: Partial<InsightTxn> & { cycle_id: string }): InsightTxn {
  return {
    direction: 'EXPENSE',
    planned_amount: 0,
    actual_amount: 0,
    status: 'PENDING',
    ...p,
  } as InsightTxn;
}

describe('insight windowing (phase 5c)', () => {
  it('85: yearOf and monthOf read ISO dates and reject impossible ones', () => {
    expect(yearOf('2026-10-25')).toBe(2026);
    expect(monthOf('2026-10-25')).toBe(10);
    expect(yearOf('2026-13-01')).toBeNull();
    expect(monthOf('2026-13-01')).toBeNull();
    expect(yearOf('25/10/2026')).toBeNull();
    expect(yearOf(null)).toBeNull();
    expect(yearOf(undefined)).toBeNull();
  });

  it('86: a cycle belongs to the month it ends in, not the month it starts', () => {
    // The whole year would shift one column left if this used start_date: a
    // 25 Oct – 24 Nov cycle named "Siklus Nov" would be filed under Oktober.
    expect(cycleMonth(CYCLE_JAN)).toBe(1);
    expect(cycleMonth({ id: 'x', name: 'Siklus Nov 2026', start_date: '2026-10-25', end_date: '2026-11-24' })).toBe(11);
  });

  it('87: a cycle straddling new year still lands in the right month', () => {
    const c = { id: 'x', name: 'Siklus Jan 2027', start_date: '2026-12-25', end_date: '2027-01-24' };
    expect(cycleMonth(c)).toBe(1);
    // It starts in 2026 and ends in 2027, so it is visible from either year.
    expect(cyclesInYear([c], 2026).map((x) => x.id)).toEqual(['x']);
    expect(cyclesInYear([c], 2027).map((x) => x.id)).toEqual(['x']);
  });

  it('88: cyclesInYear excludes cycles from other years entirely', () => {
    expect(cyclesInYear([CYCLE_JAN, CYCLE_FEB, CYCLE_2025], 2026).map((c) => c.id)).toEqual([
      'c-jan', 'c-feb',
    ]);
  });
});

describe('year buckets (phase 5c)', () => {
  it('89: every bucket always exists, and an uncycled month is not a zero month', () => {
    const buckets = buildYearBuckets({ cycles: [CYCLE_JAN], txns: [], allocations: [], year: 2026 });
    expect(buckets).toHaveLength(12);
    expect(buckets[0].hasCycle).toBe(true);
    // Februari has no cycle: `hasCycle: false` says "we know nothing", which is
    // a different claim from the Rp 0 a real month with no rows would show.
    expect(buckets[1].hasCycle).toBe(false);
    expect(buckets[1].cycleIds).toEqual([]);
    expect(latestActiveMonth(buckets)).toBe(1);
  });

  it('90: flow_type decides which column a row lands in', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN],
      txns: [
        txn({ cycle_id: 'c-jan', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 10_000_000, actual_amount: 10_000_000, status: 'PAID' }),
        txn({ cycle_id: 'c-jan', direction: 'INCOME', flow_type: 'FINANCING_INFLOW', planned_amount: 5_000_000, status: 'PENDING' }),
        txn({ cycle_id: 'c-jan', direction: 'INCOME', flow_type: 'ASSET_RELEASE', planned_amount: 2_000_000, status: 'PENDING' }),
        txn({ cycle_id: 'c-jan', flow_type: 'EXPENSE', planned_amount: 3_000_000, actual_amount: 3_500_000, status: 'PAID' }),
        txn({ cycle_id: 'c-jan', flow_type: 'DEBT_PAYMENT', planned_amount: 1_000_000, actual_amount: 1_000_000, status: 'PAID' }),
        txn({ cycle_id: 'c-jan', direction: 'INCOME', flow_type: 'ASSET_ALLOCATION', actual_amount: 4_000_000, status: 'PAID' }),
      ],
      allocations: [],
      year: 2026,
    });
    const jan = buckets[0];
    expect(jan.actualIncome).toBe(10_000_000);
    expect(jan.financingInflow).toBe(5_000_000);
    expect(jan.assetRelease).toBe(2_000_000);
    expect(jan.sourceTotal).toBe(17_000_000);
    expect(jan.actualExpense).toBe(3_500_000);
    expect(jan.plannedExpense).toBe(3_000_000);
    expect(jan.actualDebtPayment).toBe(1_000_000);
    expect(jan.actualAssetAllocation).toBe(4_000_000);
  });

  it('91: a PENDING row contributes to plan but never to actual', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN],
      txns: [txn({ cycle_id: 'c-jan', flow_type: 'EXPENSE', planned_amount: 2_000_000, actual_amount: 2_000_000, status: 'PENDING' })],
      allocations: [],
      year: 2026,
    });
    expect(buckets[0].plannedExpense).toBe(2_000_000);
    expect(buckets[0].actualExpense).toBe(0);
  });

  it('92: a row without flow_type falls back to the direction default', () => {
    // Legacy rows predate flow_type. INCOME defaults to operating income;
    // EXPENSE stays EXPENSE even with an obligation_id, which is the Phase 1
    // rule — auto-classifying to DEBT_PAYMENT is forbidden.
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN],
      txns: [
        txn({ cycle_id: 'c-jan', direction: 'INCOME', planned_amount: 8_000_000, status: 'PENDING' }),
        txn({ cycle_id: 'c-jan', direction: 'EXPENSE', obligation_id: 'o1', planned_amount: 1_000_000, status: 'PENDING' }),
      ],
      allocations: [],
      year: 2026,
    });
    expect(buckets[0].plannedIncome).toBe(8_000_000);
    expect(buckets[0].financingInflow).toBe(0);
    expect(buckets[0].plannedExpense).toBe(1_000_000);
    expect(buckets[0].plannedDebtPayment).toBe(0);
  });

  it('93: rows whose cycle is outside the year are dropped', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN, CYCLE_2025],
      txns: [
        txn({ cycle_id: 'c-2025', flow_type: 'EXPENSE', planned_amount: 9_999_999, status: 'PENDING' }),
        txn({ cycle_id: 'c-jan', flow_type: 'EXPENSE', planned_amount: 1_000_000, status: 'PENDING' }),
      ],
      allocations: [],
      year: 2026,
    });
    expect(buckets.reduce((s, b) => s + b.plannedExpense, 0)).toBe(1_000_000);
  });

  it('94: the funding gap comes from allocations, never from the transaction sum', () => {
    // 10jt of source funds, 14jt of allocations -> 4jt gap. The 20jt of EXPENSE
    // transactions are deliberately larger than both: if the required
    // allocation were read off the transactions the gap would be 10jt, which is
    // the double-count bug the anti-double-count rule exists to prevent.
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN],
      txns: [
        txn({ cycle_id: 'c-jan', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 10_000_000, status: 'PENDING' }),
        txn({ cycle_id: 'c-jan', flow_type: 'EXPENSE', planned_amount: 20_000_000, status: 'PENDING' }),
      ],
      allocations: [{ cycle_id: 'c-jan', allocation_type: 'EXPENSE', amount: 9_000_000 }, { cycle_id: 'c-jan', allocation_type: 'DEBT_PAYMENT', amount: 5_000_000 }],
      year: 2026,
    });
    expect(buckets[0].plannedAllocationTotal).toBe(14_000_000);
    expect(buckets[0].fundingGap).toBe(4_000_000);
    expect(buckets[0].unallocated).toBe(0);
  });

  it('95: a funded month has no gap and reports what is left over', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_FEB],
      txns: [txn({ cycle_id: 'c-feb', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 12_000_000, status: 'PENDING' })],
      allocations: [{ cycle_id: 'c-feb', allocation_type: 'EXPENSE', amount: 9_000_000 }],
      year: 2026,
    });
    expect(buckets[1].fundingGap).toBe(0);
    expect(buckets[1].unallocated).toBe(3_000_000);
  });

  it('96: a negative allocation is clamped instead of reducing the total', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_FEB],
      txns: [],
      allocations: [
        { cycle_id: 'c-feb', allocation_type: 'EXPENSE', amount: 5_000_000 },
        { cycle_id: 'c-feb', allocation_type: 'EXPENSE', amount: -2_000_000 },
      ],
      year: 2026,
    });
    expect(buckets[1].plannedAllocationTotal).toBe(5_000_000);
  });

  it('97: net cashflow uses what happened once anything happened', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_FEB, CYCLE_MAR],
      txns: [
        txn({ cycle_id: 'c-feb', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 10_000_000, actual_amount: 11_000_000, status: 'PAID' }),
        txn({ cycle_id: 'c-feb', flow_type: 'EXPENSE', planned_amount: 6_000_000, actual_amount: 7_000_000, status: 'PAID' }),
        txn({ cycle_id: 'c-mar', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 10_000_000, status: 'PENDING' }),
        txn({ cycle_id: 'c-mar', flow_type: 'EXPENSE', planned_amount: 6_000_000, status: 'PENDING' }),
      ],
      allocations: [],
      year: 2026,
    });
    // February realised: 11 - 7 = 4. March planned: 10 - 6 = 4. If March had
    // used realised figures it would read +10 and look like a windfall.
    expect(buckets[1].netCashflow).toBe(4_000_000);
    expect(buckets[2].netCashflow).toBe(4_000_000);
  });

  it('98: expense is attributed per category for the month-over-month section', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN],
      txns: [
        txn({ cycle_id: 'c-jan', flow_type: 'EXPENSE', category_id: 'cat-a', actual_amount: 1_000_000, status: 'PAID' }),
        txn({ cycle_id: 'c-jan', flow_type: 'EXPENSE', category_id: 'cat-a', actual_amount: 500_000, status: 'PAID' }),
        txn({ cycle_id: 'c-jan', flow_type: 'EXPENSE', category_id: 'cat-b', actual_amount: 2_000_000, status: 'PAID' }),
        // Never paid: must not enter the realised per-category map.
        txn({ cycle_id: 'c-jan', flow_type: 'EXPENSE', category_id: 'cat-c', planned_amount: 9_000_000, status: 'PENDING' }),
      ],
      allocations: [],
      year: 2026,
    });
    expect(buckets[0].expenseByCategory).toEqual({ 'cat-a': 1_500_000, 'cat-b': 2_000_000 });
  });
});

describe('annual totals (phase 5c)', () => {
  const buckets = buildYearBuckets({
    cycles: [CYCLE_JAN, CYCLE_FEB, CYCLE_MAR],
    txns: [
      txn({ cycle_id: 'c-jan', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 20_000_000, actual_amount: 22_000_000, status: 'PAID' }),
      txn({ cycle_id: 'c-jan', flow_type: 'EXPENSE', planned_amount: 18_000_000, actual_amount: 19_000_000, status: 'PAID' }),
      txn({ cycle_id: 'c-feb', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 20_000_000, actual_amount: 25_000_000, status: 'PAID' }),
      txn({ cycle_id: 'c-feb', flow_type: 'EXPENSE', planned_amount: 18_000_000, actual_amount: 25_000_000, status: 'PAID' }),
      txn({ cycle_id: 'c-mar', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 20_000_000, actual_amount: 15_000_000, status: 'PAID' }),
      txn({ cycle_id: 'c-mar', flow_type: 'EXPENSE', planned_amount: 18_000_000, actual_amount: 18_000_000, status: 'PAID' }),
    ],
    allocations: [
      { cycle_id: 'c-jan', allocation_type: 'EXPENSE', amount: 19_000_000 },
      { cycle_id: 'c-feb', allocation_type: 'EXPENSE', amount: 30_000_000 }, // over the 25jt earned: a gap
      { cycle_id: 'c-mar', allocation_type: 'EMERGENCY_FUND', amount: 2_000_000 },
    ],
    year: 2026,
  });
  const annual = annualTotals(buckets);

  it('99: annual totals sum every month, gap months included', () => {
    expect(annual.plannedIncome).toBe(60_000_000);
    expect(annual.actualIncome).toBe(62_000_000);
    expect(annual.actualExpense).toBe(62_000_000);
    expect(annual.plannedExpense).toBe(54_000_000);
    expect(annual.expenseVariance).toBe(8_000_000);
  });

  it('100: covered and gap months are counted separately', () => {
    expect(annual.monthsWithCycle).toBe(3);
    expect(annual.gapMonths).toBe(1);
    expect(annual.coveredMonths).toBe(2);
  });

  it('101: best and lowest income months rank on realised income', () => {
    expect(annual.bestIncomeMonth).toEqual({ month: 2, value: 25_000_000 });
    expect(annual.lowestIncomeMonth).toEqual({ month: 3, value: 15_000_000 });
  });

  it('102: averages divide by months that actually had income, not by twelve', () => {
    // Three months of income out of twelve. Dividing by twelve would report an
    // average of ~5jt and make a healthy family look like it was starving.
    expect(annual.avgIncome).toBe(Math.round(62_000_000 / 3));
    expect(annual.avgExpense).toBe(Math.round(62_000_000 / 3));
  });

  it('103: an empty year totals to zero rather than NaN', () => {
    const empty = annualTotals(buildYearBuckets({ cycles: [], txns: [], allocations: [], year: 2026 }));
    expect(empty.sourceTotal).toBe(0);
    expect(empty.avgIncome).toBe(0);
    expect(empty.bestIncomeMonth).toBeNull();
    expect(empty.gapMonths).toBe(0);
    expect(empty.monthsWithCycle).toBe(0);
  });
});

describe('asset accumulation (phase 5c)', () => {
  it('104: only the four asset-ish allocation types count as putting money aside', () => {
    // The ledger has no assets table, so "asset" means an allocation the family
    // marked as going somewhere other than spending. A DEBT_PAYMENT allocation
    // is not an asset and must not inflate the trend.
    expect(isAssetAllocationType('ASSET')).toBe(true);
    expect(isAssetAllocationType('SAVINGS')).toBe(true);
    expect(isAssetAllocationType('INVESTMENT')).toBe(true);
    expect(isAssetAllocationType('EMERGENCY_FUND')).toBe(true);
    expect(isAssetAllocationType('EXPENSE')).toBe(false);
    expect(isAssetAllocationType('DEBT_PAYMENT')).toBe(false);
    expect(isAssetAllocationType('OTHER')).toBe(false);
  });

  it('105: accumulation is a running total across the year', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN, CYCLE_FEB, CYCLE_MAR],
      txns: [],
      allocations: [
        { cycle_id: 'c-jan', allocation_type: 'EMERGENCY_FUND', amount: 1_000_000 },
        { cycle_id: 'c-jan', allocation_type: 'EXPENSE', amount: 5_000_000 },
        { cycle_id: 'c-feb', allocation_type: 'INVESTMENT', amount: 2_000_000 },
        { cycle_id: 'c-mar', allocation_type: 'SAVINGS', amount: 500_000 },
      ],
      year: 2026,
    });
    expect(buckets[0].assetAdditions).toBe(1_000_000);
    expect(buckets[1].assetAdditions).toBe(2_000_000);
    expect(accumulateAssets(buckets)).toEqual([
      1_000_000, 3_000_000, 3_500_000, 3_500_000, 3_500_000, 3_500_000,
      3_500_000, 3_500_000, 3_500_000, 3_500_000, 3_500_000, 3_500_000,
    ]);
  });

  it('106: asset summary names the largest contributor and the growth', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN, CYCLE_FEB],
      txns: [],
      allocations: [
        { cycle_id: 'c-jan', allocation_type: 'EMERGENCY_FUND', amount: 4_000_000 },
        { cycle_id: 'c-feb', allocation_type: 'INVESTMENT', amount: 1_000_000 },
        { cycle_id: 'c-feb', allocation_type: 'EMERGENCY_FUND', amount: 3_000_000 },
      ],
      year: 2026,
    });
    const s = assetSummary(buckets);
    expect(s.total).toBe(8_000_000);
    // Growth is measured from the first active month's balance, not from zero:
    // there is no opening balance to carry into January.
    expect(s.growth).toBe(4_000_000);
    expect(s.growthPct).toBe(100);
    expect(s.topType).toBe('EMERGENCY_FUND');
    expect(s.topAmount).toBe(7_000_000);
  });

  it('107: a year with no asset allocation reports no contributor instead of a zero one', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN],
      txns: [],
      allocations: [{ cycle_id: 'c-jan', allocation_type: 'EXPENSE', amount: 4_000_000 }],
      year: 2026,
    });
    const s = assetSummary(buckets);
    expect(s.total).toBe(0);
    expect(s.topType).toBeNull();
    expect(s.topAmount).toBe(0);
    expect(s.growthPct).toBeNull();
  });
});

describe('month over month (phase 5c)', () => {
  const names = { 'cat-food': 'Keperluan Keluarga', 'cat-bill': 'Tagihan', 'cat-car': 'Mobil' };
  const buckets = buildYearBuckets({
    cycles: [CYCLE_FEB, CYCLE_MAR],
    txns: [
      txn({ cycle_id: 'c-feb', flow_type: 'EXPENSE', category_id: 'cat-food', actual_amount: 3_000_000, status: 'PAID' }),
      txn({ cycle_id: 'c-feb', flow_type: 'EXPENSE', category_id: 'cat-bill', actual_amount: 2_000_000, status: 'PAID' }),
      txn({ cycle_id: 'c-mar', flow_type: 'EXPENSE', category_id: 'cat-food', actual_amount: 4_500_000, status: 'PAID' }),
      txn({ cycle_id: 'c-mar', flow_type: 'EXPENSE', category_id: 'cat-bill', actual_amount: 1_500_000, status: 'PAID' }),
      // Brand new in March: no February baseline at all.
      txn({ cycle_id: 'c-mar', flow_type: 'EXPENSE', category_id: 'cat-car', actual_amount: 900_000, status: 'PAID' }),
    ],
    allocations: [],
    year: 2026,
  });

  it('108: risers and fallers are ranked by absolute rupiah, not percentage', () => {
    const m = monthOverMonth(buckets, 3, names);
    expect(m.previousMonth).toBe(2);
    expect(m.risers.map((r) => r.categoryId)).toEqual(['cat-food', 'cat-car']);
    expect(m.fallers.map((f) => f.categoryId)).toEqual(['cat-bill']);
    expect(m.risers[0].delta).toBe(1_500_000);
    expect(m.fallers[0].delta).toBe(-500_000);
  });

  it('109: a first-time category reports a null percentage, not infinity', () => {
    const m = monthOverMonth(buckets, 3, names);
    const car = m.risers.find((r) => r.categoryId === 'cat-car');
    // "New this month" is the honest label; a "+∞%" pill is not.
    expect(car?.pct).toBeNull();
    expect(car?.previous).toBe(0);
    expect(m.risers[0].pct).toBe(50);
  });

  it('110: an unknown category id does not render as an empty name', () => {
    const m = monthOverMonth(buckets, 3, { 'cat-food': 'Keperluan Keluarga' });
    expect(m.risers.find((r) => r.categoryId === 'cat-car')?.name).toBe('Tanpa kategori');
  });

  it('111: January compares against December of the same array', () => {
    const wrap = buildYearBuckets({
      cycles: [CYCLE_JAN, { id: 'c-dec', name: 'Siklus Des 2026', start_date: '2026-11-25', end_date: '2026-12-24' }],
      txns: [
        txn({ cycle_id: 'c-jan', flow_type: 'EXPENSE', category_id: 'cat-food', actual_amount: 1_000_000, status: 'PAID' }),
        txn({ cycle_id: 'c-dec', flow_type: 'EXPENSE', category_id: 'cat-food', actual_amount: 4_000_000, status: 'PAID' }),
      ],
      allocations: [],
      year: 2026,
    });
    const m = monthOverMonth(wrap, 1, names);
    expect(m.previousMonth).toBe(12);
    expect(m.fallers[0].delta).toBe(-3_000_000);
  });

  it('112: equal months produce no rows at all', () => {
    const flat = buildYearBuckets({
      cycles: [CYCLE_FEB, CYCLE_MAR],
      txns: [
        txn({ cycle_id: 'c-feb', flow_type: 'EXPENSE', category_id: 'cat-food', actual_amount: 1_000_000, status: 'PAID' }),
        txn({ cycle_id: 'c-mar', flow_type: 'EXPENSE', category_id: 'cat-food', actual_amount: 1_000_000, status: 'PAID' }),
      ],
      allocations: [],
      year: 2026,
    });
    const m = monthOverMonth(flat, 3, names);
    expect(m.risers).toEqual([]);
    expect(m.fallers).toEqual([]);
  });
});

describe('plan vs actual (phase 5c)', () => {
  const buckets = buildYearBuckets({
    cycles: [CYCLE_FEB],
    txns: [
      txn({ cycle_id: 'c-feb', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 20_000_000, actual_amount: 18_000_000, status: 'PAID' }),
      txn({ cycle_id: 'c-feb', flow_type: 'EXPENSE', planned_amount: 10_000_000, actual_amount: 12_000_000, status: 'PAID' }),
      txn({ cycle_id: 'c-feb', direction: 'INCOME', flow_type: 'ASSET_ALLOCATION', actual_amount: 3_000_000, status: 'PAID' }),
    ],
    allocations: [
      { cycle_id: 'c-feb', allocation_type: 'INVESTMENT', amount: 2_000_000 },
      { cycle_id: 'c-feb', allocation_type: 'EMERGENCY_FUND', amount: 4_000_000 },
      { cycle_id: 'c-feb', allocation_type: 'EXPENSE', amount: 10_000_000 },
    ],
    year: 2026,
  });

  it('113: the direction of "good" flips between income and expenses', () => {
    const income = planVsActual(buckets, 'income')[1];
    expect(income.planned).toBe(20_000_000);
    expect(income.actual).toBe(18_000_000);
    // Earned 2jt less than planned: unfavourable.
    expect(income.variance).toBe(-2_000_000);
    expect(income.favourable).toBe(false);

    const expenses = planVsActual(buckets, 'expenses')[1];
    expect(expenses.variance).toBe(2_000_000);
    // Spent 2jt more than planned: also unfavourable, despite a positive number.
    expect(expenses.favourable).toBe(false);
  });

  it('114: a month exactly on plan counts as favourable', () => {
    const onPlan = planVsActual(buckets, 'expenses')[0];
    expect(onPlan.variance).toBe(0);
    expect(onPlan.favourable).toBe(true);
  });

  it('115: investments compare the planned INVESTMENT allocation against realised asset cash', () => {
    const inv = planVsActual(buckets, 'investments')[1];
    expect(inv.planned).toBe(2_000_000);
    expect(inv.actual).toBe(3_000_000);
  });

  it('116: the assets tab groups the three non-investment asset types into one plan', () => {
    const assets = planVsActual(buckets, 'assets')[1];
    // ASSET + SAVINGS + EMERGENCY_FUND = 4jt. INVESTMENT is its own tab, so it
    // must not be counted here as well.
    expect(assets.planned).toBe(4_000_000);
    expect(assets.actual).toBe(3_000_000);
    expect(assets.favourable).toBe(false);
  });
});

describe('liability trend (phase 5c)', () => {
  const buckets = buildYearBuckets({
    cycles: [CYCLE_FEB, CYCLE_MAR],
    txns: [
      txn({ cycle_id: 'c-feb', direction: 'INCOME', flow_type: 'FINANCING_INFLOW', planned_amount: 12_000_000, status: 'PENDING' }),
      txn({ cycle_id: 'c-feb', flow_type: 'DEBT_PAYMENT', planned_amount: 1_000_000, actual_amount: 1_000_000, status: 'PAID' }),
      txn({ cycle_id: 'c-mar', flow_type: 'DEBT_PAYMENT', planned_amount: 1_000_000, actual_amount: 2_000_000, status: 'PAID' }),
    ],
    allocations: [],
    year: 2026,
  });

  it('117: the series walks backwards from today’s balance, adding payments back', () => {
    const series = liabilitySeries(buckets, 9_000_000);
    // March closed at 9jt outstanding. February closed 2jt higher, because
    // March paid 2jt off; January 1jt above that again. Reconstructing forwards
    // from zero would instead claim the family owed nothing until March.
    expect(series[2]).toBe(9_000_000);
    expect(series[1]).toBe(11_000_000);
  });

  it('118: months before any borrowing show zero, not a phantom balance', () => {
    const series = liabilitySeries(buckets, 9_000_000);
    // The first financing inflow is February, so January's reconstructed
    // balance (12jt) is a debt that did not exist yet. It clamps to zero rather
    // than drawing a falling line into a month with no loan.
    expect(series[0]).toBe(0);
    expect(series[3]).toBe(9_000_000);
  });
});

describe('executive summary insights (phase 5c)', () => {
  it('119: insights are generated from the data, never hardcoded prose', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN, CYCLE_FEB],
      txns: [
        txn({ cycle_id: 'c-jan', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 20_000_000, actual_amount: 22_000_000, status: 'PAID' }),
        txn({ cycle_id: 'c-feb', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 20_000_000, actual_amount: 24_000_000, status: 'PAID' }),
        txn({ cycle_id: 'c-feb', flow_type: 'EXPENSE', planned_amount: 10_000_000, actual_amount: 14_000_000, status: 'PAID' }),
        txn({ cycle_id: 'c-feb', direction: 'INCOME', flow_type: 'FINANCING_INFLOW', planned_amount: 6_000_000, status: 'PENDING' }),
        txn({ cycle_id: 'c-feb', flow_type: 'DEBT_PAYMENT', actual_amount: 1_500_000, status: 'PAID' }),
      ],
      allocations: [{ cycle_id: 'c-feb', allocation_type: 'EMERGENCY_FUND', amount: 2_000_000 }],
      year: 2026,
    });
    const annual = annualTotals(buckets);
    const assets = assetSummary(buckets);
    const out = buildTrendInsights({ buckets, annual, assets, currentOutstanding: 9_000_000 });

    expect(out.map((i) => i.kind)).toEqual(['income', 'overspend', 'financing', 'debt', 'asset']);
    // The numbers in the copy are the family's numbers, and the formatting is
    // the app's existing short-rupiah format rather than a second one.
    expect(out[0].body).toContain('Rp 23jt/bln');
    expect(out[1].body).toContain('Rp 4jt');
    expect(out[2].body).toContain('Rp 9jt');
    expect(out[4].body).toContain('Rp 2jt');
  });

  it('120: a quiet year yields fewer insights rather than a fabricated fifth', () => {
    // No cycles at all: nothing is claimed. An empty screen is better than five
    // paragraphs about a family that does not exist.
    const buckets = buildYearBuckets({ cycles: [], txns: [], allocations: [], year: 2026 });
    const out = buildTrendInsights({
      buckets,
      annual: annualTotals(buckets),
      assets: assetSummary(buckets),
      currentOutstanding: 0,
    });
    expect(out).toEqual([]);
  });
});

describe('chart scaling (phase 5c)', () => {
  it('121: niceMax rounds up to a readable axis step', () => {
    expect(niceMax(36_881_995)).toBe(50_000_000);
    expect(niceMax(20_000_000)).toBe(20_000_000);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(0)).toBe(0);
    expect(niceMax(-5)).toBe(0);
    expect(niceMax(NaN)).toBe(0);
  });

  it('122: barPct clamps to the axis so an outlier cannot overflow the chart', () => {
    expect(barPct(5, 10)).toBe(50);
    expect(barPct(15, 10)).toBe(100);
    expect(barPct(-3, 10)).toBe(0);
    expect(barPct(5, 0)).toBe(0);
  });

  it('123: a chart tooltip anchored to a month survives a missing month', () => {
    const buckets = buildYearBuckets({ cycles: [CYCLE_JAN], txns: [], allocations: [], year: 2026 });
    // A selected month with no data must still be findable so the screen can say
    // "Belum ada siklus di bulan ini" instead of crashing on undefined.
    expect(buckets.find((b) => b.month === 7)?.hasCycle).toBe(false);
    expect(buckets.find((b) => b.month === 13)).toBeUndefined();
  });
});

describe('category-filtered buckets (phase 5c)', () => {
  const cycles = [CYCLE_FEB, CYCLE_MAR];
  const txns = [
    txn({ cycle_id: 'c-feb', flow_type: 'EXPENSE', category_id: 'cat-food', planned_amount: 3_000_000, actual_amount: 3_000_000, status: 'PAID' }),
    txn({ cycle_id: 'c-feb', flow_type: 'EXPENSE', category_id: 'cat-bill', planned_amount: 2_000_000, actual_amount: 2_500_000, status: 'PAID' }),
    txn({ cycle_id: 'c-mar', flow_type: 'EXPENSE', category_id: 'cat-food', planned_amount: 3_000_000, actual_amount: 3_200_000, status: 'PAID' }),
    txn({ cycle_id: 'c-mar', flow_type: 'EXPENSE', category_id: 'cat-bill', planned_amount: 2_000_000, actual_amount: 1_800_000, status: 'PAID' }),
  ];

  it('124: a category filter restricts plan and actual together', () => {
    const all = buildYearBuckets({ cycles, txns, allocations: [], year: 2026 });
    expect(all[2].plannedExpense).toBe(5_000_000);
    expect(all[2].actualExpense).toBe(5_000_000);

    const food = buildYearBuckets({
      cycles, txns, allocations: [], year: 2026, expenseCategoryId: 'cat-food',
    });
    // Both sides shrink. Dropping only the actual would leave a category's
    // spending measured against the whole family's plan and every chip would
    // read "under budget" no matter what.
    expect(food[2].plannedExpense).toBe(3_000_000);
    expect(food[2].actualExpense).toBe(3_200_000);
    expect(food[1].actualExpense).toBe(3_000_000);
  });

  it('125: filtering to one category does not disturb the income side', () => {
    const withIncome = [
      ...txns,
      txn({ cycle_id: 'c-mar', direction: 'INCOME', flow_type: 'OPERATING_INCOME', planned_amount: 20_000_000, status: 'PENDING' }),
    ];
    const food = buildYearBuckets({
      cycles, txns: withIncome, allocations: [], year: 2026, expenseCategoryId: 'cat-food',
    });
    // The chip says "expenses", so income must be untouched by it.
    expect(food[2].plannedIncome).toBe(20_000_000);
  });

  it('126: a filter matching nothing leaves the month at zero, not negative', () => {
    const none = buildYearBuckets({
      cycles, txns, allocations: [], year: 2026, expenseCategoryId: 'cat-missing',
    });
    expect(none[2].plannedExpense).toBe(0);
    expect(none[2].actualExpense).toBe(0);
    expect(none[2].netCashflow).toBe(0);
  });
});

describe('rolling window (phase 5c)', () => {
  const buckets = buildYearBuckets({
    cycles: [CYCLE_FEB, CYCLE_MAR],
    txns: [],
    allocations: [],
    year: 2026,
  });

  it('127: the 6-month window ends at the last active month, not at December', () => {
    // March is the last cycle. Anchoring to December would give Jul-Des: five
    // empty columns and one real bar.
    const w = windowEndingAt(buckets, 6);
    expect(w[w.length - 1].month).toBe(3);
  });

  it('128: the window is a contiguous slice ending on the active month', () => {
    const w = windowEndingAt(buckets, 6);
    for (let i = 1; i < w.length; i += 1) {
      expect(w[i].month).toBe(w[i - 1].month + 1);
    }
    // Fewer than six months of data means fewer than six columns: padding the
    // window back to January would claim five months the chart cannot speak to.
    expect(w).toHaveLength(3);
    expect(w[0].month).toBe(1);
  });

  it('128b: a full year truncates to the last six months', () => {
    const full = buildYearBuckets({
      cycles: [
        CYCLE_JAN, CYCLE_FEB, CYCLE_MAR,
        { id: 'c-apr', name: 'Siklus Apr', start_date: '2026-03-25', end_date: '2026-04-24' },
        { id: 'c-mei', name: 'Siklus Mei', start_date: '2026-04-25', end_date: '2026-05-24' },
        { id: 'c-jun', name: 'Siklus Jun', start_date: '2026-05-25', end_date: '2026-06-24' },
        { id: 'c-jul', name: 'Siklus Jul', start_date: '2026-06-25', end_date: '2026-07-24' },
        { id: 'c-agu', name: 'Siklus Agu', start_date: '2026-07-25', end_date: '2026-08-24' },
        { id: 'c-sep', name: 'Siklus Sep', start_date: '2026-08-25', end_date: '2026-09-24' },
      ],
      txns: [],
      allocations: [],
      year: 2026,
    });
    const w = windowEndingAt(full, 6);
    expect(w).toHaveLength(6);
    expect(w[0].month).toBe(4);
    expect(w[5].month).toBe(9);
  });

  it('129: a 12-month window is the whole year untouched', () => {
    expect(windowEndingAt(buckets, 12)).toHaveLength(12);
  });

  it('130: an empty year still yields a window of the right length', () => {
    const empty = buildYearBuckets({ cycles: [], txns: [], allocations: [], year: 2026 });
    expect(windowEndingAt(empty, 6)).toHaveLength(6);
  });
});

describe('asset bands (phase 5c)', () => {
  it('131: allocation types map onto the four legend bands', () => {
    // The summary reports the largest contributor as an allocation TYPE while
    // the legend is keyed by BAND. Looking SAVINGS up among CHILD/LIQUIDITY
    // would print the raw enum on a screen that calls it "Likuiditas".
    expect(bandKeyOfAllocationType('SAVINGS')).toBe('LIQUIDITY');
    expect(bandKeyOfAllocationType('ASSET')).toBe('CHILD');
    expect(bandKeyOfAllocationType('INVESTMENT')).toBe('INVESTMENT');
    expect(bandKeyOfAllocationType('EMERGENCY_FUND')).toBe('EMERGENCY_FUND');
    // Not an asset at all.
    expect(bandKeyOfAllocationType('EXPENSE')).toBeNull();
    expect(bandKeyOfAllocationType('DEBT_PAYMENT')).toBeNull();
  });

  it('132: every band has a label and every asset type lands in one', () => {
    for (const band of ASSET_BANDS) {
      expect(bandLabel(band.key)).toBe(band.label);
    }
    expect(bandLabel(null)).toBeNull();
    // No asset type may fall between the bands, or its money would silently
    // vanish from the stack.
    for (const t of ['ASSET', 'SAVINGS', 'INVESTMENT', 'EMERGENCY_FUND'] as const) {
      expect(bandKeyOfAllocationType(t)).not.toBeNull();
    }
  });

  it('133: monthly and cumulative stacks differ only by carrying the total', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN, CYCLE_FEB],
      txns: [],
      allocations: [
        { cycle_id: 'c-jan', allocation_type: 'EMERGENCY_FUND', amount: 1_000_000 },
        { cycle_id: 'c-feb', allocation_type: 'EMERGENCY_FUND', amount: 2_000_000 },
      ],
      year: 2026,
    });
    const monthly = assetSeriesByType(buckets, 'monthly');
    const cumulative = assetSeriesByType(buckets, 'cumulative');
    const total = (bands: { value: number }[]) => bands.reduce((s, b) => s + b.value, 0);
    expect(total(monthly[0])).toBe(1_000_000);
    expect(total(monthly[1])).toBe(2_000_000);
    expect(total(cumulative[0])).toBe(1_000_000);
    expect(total(cumulative[1])).toBe(3_000_000);
  });

  it('134: the stack is ordered for bottom-up drawing', () => {
    const buckets = buildYearBuckets({
      cycles: [CYCLE_JAN],
      txns: [],
      allocations: [
        { cycle_id: 'c-jan', allocation_type: 'EMERGENCY_FUND', amount: 4_000_000 },
        { cycle_id: 'c-jan', allocation_type: 'SAVINGS', amount: 1_000_000 },
      ],
      year: 2026,
    });
    const bands = assetSeriesByType(buckets, 'cumulative')[0];
    // Liquidity at the base, emergency fund on top, matching the legend order
    // read downwards.
    expect(bands[0].key).toBe('LIQUIDITY');
    expect(bands[bands.length - 1].key).toBe('EMERGENCY_FUND');
  });
});

describe('month names (phase 5c)', () => {
  it('135: full month names are spelled out and out-of-range months are empty', () => {
    expect(monthFullName(1)).toBe('Januari');
    expect(monthFullName(8)).toBe('Agustus');
    expect(monthFullName(10)).toBe('Oktober');
    expect(monthFullName(12)).toBe('Desember');
    expect(monthFullName(0)).toBe('');
    expect(monthFullName(13)).toBe('');
  });

  it('136: a month-year label never prints "undefined"', () => {
    expect(monthYearLabel(10, 2026)).toBe('Oktober 2026');
    expect(monthYearLabel(13, 2026)).toBe('');
  });
});

describe('liability type filtering (phase 5c)', () => {
  const buckets = buildYearBuckets({
    cycles: [CYCLE_FEB, CYCLE_MAR],
    txns: [
      txn({ cycle_id: 'c-feb', direction: 'INCOME', flow_type: 'FINANCING_INFLOW', planned_amount: 10_000_000, status: 'PENDING' }),
      txn({ cycle_id: 'c-feb', flow_type: 'DEBT_PAYMENT', obligation_id: 'loan-1', actual_amount: 1_000_000, status: 'PAID' }),
      txn({ cycle_id: 'c-mar', flow_type: 'DEBT_PAYMENT', obligation_id: 'bill-1', actual_amount: 500_000, status: 'PAID' }),
      txn({ cycle_id: 'c-mar', flow_type: 'DEBT_PAYMENT', obligation_id: 'loan-1', actual_amount: 1_000_000, status: 'PAID' }),
    ],
    allocations: [],
    year: 2026,
  });

  it('137: payments are attributed to the obligation that was paid', () => {
    expect(buckets[1].debtPaymentByObligation).toEqual({ 'loan-1': 1_000_000 });
    expect(buckets[2].debtPaymentByObligation).toEqual({ 'bill-1': 500_000, 'loan-1': 1_000_000 });
  });

  it('138: filtering to one obligation type reconstructs only its balance', () => {
    // Only the loan's payments walk back; the bill's 500rb must not raise the
    // loan's historical balance, or the loan chart shows a debt the loan never
    // had.
    const loansOnly = liabilitySeries(buckets, 8_000_000, new Set(['loan-1']));
    expect(loansOnly[2]).toBe(8_000_000);
    expect(loansOnly[1]).toBe(9_000_000);

    const unfiltered = liabilitySeries(buckets, 8_000_000);
    // Unfiltered, February closes at 9.5jt because March's bill payment is
    // added back too.
    expect(unfiltered[1]).toBe(9_500_000);
  });

  it('139: a type with no payments holds a flat balance', () => {
    const none = liabilitySeries(buckets, 0, new Set(['does-not-exist']));
    expect(none.every((v) => v === 0)).toBe(true);
  });
});
