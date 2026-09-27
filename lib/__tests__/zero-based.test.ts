import { describe, expect, it } from 'vitest';
import {
  budgetFillPct,
  budgetHealthStatus,
  calculateFundingGap,
  calculateSourceFunds,
  calculateUnallocatedFunds,
  calculateZeroBasedSummary,
  canMarkAsPaid,
  defaultFlowType,
  filterLedger,
  formatShortDate,
  isInstallmentOpen,
  isObligationPaydown,
  ledgerDayLabel,
  ledgerDisplayAmount,
  normalizeAmount,
  resolveModeAmount,
  splitInstallments,
  summarizeLedger,
  templateDueLabel,
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

describe('budget health (phase 4)', () => {
  it('25: spending over the pagu is OVER and reports how far past', () => {
    const h = budgetHealthStatus(3_630_000, 1_800_000);
    expect(h.status).toBe('OVER');
    expect(h.overAmount).toBe(1_830_000);
    expect(h.remainingAmount).toBe(0);
    expect(h.label).toBe('MELEBIHI RENCANA');
    expect(h.tone).toBe('pending');
    expect(h.ratioPct).toBe(202);
  });

  it('26: exactly at the pagu is not OVER, but the boundary is WATCH', () => {
    // Equal is not over — overAmount stays 0. It is still WATCH rather than
    // SAFE: the whole pagu is consumed, which is what the >80% band means.
    // This matches the pre-Phase-4 inline check (`ratio > 1 ? over : ratio > 0.8
    // ? watch : safe`) so the refactor does not silently change a verdict.
    const h = budgetHealthStatus(1_500_000, 1_500_000);
    expect(h.status).toBe('WATCH');
    expect(h.overAmount).toBe(0);
    expect(h.remainingAmount).toBe(0);
    expect(h.ratioPct).toBe(100);
  });

  it('27: above 80% is WATCH with the remaining pagu', () => {
    const h = budgetHealthStatus(1_250_000, 1_500_000);
    expect(h.status).toBe('WATCH');
    expect(h.overAmount).toBe(0);
    expect(h.remainingAmount).toBe(250_000);
    expect(h.label).toBe('CEK RINCIAN');
    expect(h.tone).toBe('alert');
  });

  it('28: no pagu is its own state, not "safe" and not "over"', () => {
    const spent = budgetHealthStatus(500_000, 0);
    expect(spent.status).toBe('NO_BUDGET');
    expect(spent.label).toBe('TANPA PAGU');
    expect(spent.overAmount).toBe(0);
    const untouched = budgetHealthStatus(0, 0);
    expect(untouched.status).toBe('SAFE');
    expect(untouched.label).toBe('ANGGARAN AMAN');
  });

  it('29: fill percent is clamped to 2..100 and full for no-pagu rows', () => {
    expect(budgetFillPct(budgetHealthStatus(3_630_000, 1_800_000))).toBe(100);
    expect(budgetFillPct(budgetHealthStatus(1_000, 1_800_000))).toBe(2);
    expect(budgetFillPct(budgetHealthStatus(900_000, 1_000_000))).toBe(90);
    expect(budgetFillPct(budgetHealthStatus(500_000, 0))).toBe(100);
  });

  it('30: null inputs never produce NaN', () => {
    const h = budgetHealthStatus(null, undefined);
    expect(h.status).toBe('SAFE');
    expect(h.ratioPct).toBe(0);
  });
});

describe('ledger grouping and filtering (phase 4)', () => {
  const ROWS = [
    { name: 'Kopi Kenangan FX', direction: 'EXPENSE' as const, account_id: 'bca', accountName: 'BCA', categoryName: 'Jajan' },
    { name: 'Token Listrik 500rb', direction: 'EXPENSE' as const, account_id: 'mandiri', accountName: 'Mandiri', categoryName: 'Tagihan' },
    { name: 'Gaji September', direction: 'INCOME' as const, account_id: 'mandiri', accountName: 'Mandiri Payroll', categoryName: 'Gaji & Pemasukan' },
  ];

  it('31: an empty filter keeps every row', () => {
    expect(filterLedger(ROWS, {})).toHaveLength(3);
    expect(filterLedger(ROWS, { query: '   ' })).toHaveLength(3);
  });

  it('32: search matches the merchant and the category, not just the name', () => {
    expect(filterLedger(ROWS, { query: 'kenangan' })).toHaveLength(1);
    expect(filterLedger(ROWS, { query: 'bca' })).toHaveLength(1);
    expect(filterLedger(ROWS, { query: 'jajan' })).toHaveLength(1);
    expect(filterLedger(ROWS, { query: 'mandiri' })).toHaveLength(2);
    expect(filterLedger(ROWS, { query: 'tidak ada' })).toHaveLength(0);
  });

  it('33: direction and account chips compose with the query', () => {
    expect(filterLedger(ROWS, { direction: 'INCOME' })).toHaveLength(1);
    expect(filterLedger(ROWS, { direction: 'EXPENSE' })).toHaveLength(2);
    expect(filterLedger(ROWS, { accountId: 'mandiri' })).toHaveLength(2);
    expect(filterLedger(ROWS, { accountId: 'mandiri', direction: 'INCOME' })).toHaveLength(1);
  });

  it('34: ledger totals separate the two directions', () => {
    const totals = summarizeLedger([
      { direction: 'EXPENSE' as const, amount: 65_000 },
      { direction: 'EXPENSE' as const, amount: 500_000 },
      { direction: 'INCOME' as const, amount: 15_844_000 },
    ]);
    expect(totals.expense).toBe(565_000);
    expect(totals.income).toBe(15_844_000);
    expect(totals.expenseCount).toBe(2);
    expect(totals.incomeCount).toBe(1);
  });

  it('35: day headings name today and yesterday, then fall back to a date', () => {
    const today = '2026-09-25';
    expect(ledgerDayLabel('2026-09-25', today)).toBe('Hari Ini · 25 Sep');
    expect(ledgerDayLabel('2026-09-24', today)).toBe('Kemarin · 24 Sep');
    expect(ledgerDayLabel('2026-09-20', today)).toBe('20 Sep 2026');
    expect(ledgerDayLabel(null, today)).toBe('Belum bertanggal');
  });

  it('37: the ledger prints the plan for a row that has not moved yet', () => {
    const pending = { planned_amount: 4_800_000, actual_amount: 4_800_000, status: 'PENDING' as const };
    const paid = { planned_amount: 4_800_000, actual_amount: 4_650_000, status: 'PAID' as const };
    expect(ledgerDisplayAmount(pending)).toBe(4_800_000);
    expect(ledgerDisplayAmount(paid)).toBe(4_650_000);
  });

  it('38: a settled row with no recorded actual falls back to its plan, not to zero', () => {
    // Both pay paths reject actual = 0, so a 0 here means the column was never
    // written. Printing Rp 0 would understate a line that really did settle.
    const settled = { planned_amount: 1_100_000, actual_amount: 0, status: 'PAID' as const };
    expect(ledgerDisplayAmount(settled)).toBe(1_100_000);
    expect(ledgerDisplayAmount({ planned_amount: null, actual_amount: null, status: 'PENDING' as const })).toBe(0);
  });

  it('39: the status filter narrows to one side and ignores rows without a status', () => {
    const rows = [
      { name: 'Tagihan Rumah', direction: 'EXPENSE' as const, status: 'PENDING' as const },
      { name: 'Listrik PLN', direction: 'EXPENSE' as const, status: 'PAID' as const },
      { name: 'Gaji Bulanan', direction: 'INCOME' as const, status: 'PENDING' as const },
    ];
    expect(filterLedger(rows, { status: 'PENDING' })).toHaveLength(2);
    expect(filterLedger(rows, { status: 'PAID' })).toHaveLength(1);
    expect(filterLedger(rows, {})).toHaveLength(3);
    // A row whose status is unknown stays visible rather than being dropped.
    expect(filterLedger([{ name: 'X', direction: 'EXPENSE' as const }], { status: 'PAID' })).toHaveLength(1);
  });

  it('36: short dates and template due days refuse garbage instead of printing it', () => {
    expect(formatShortDate('2026-10-02')).toBe('2 Okt');
    expect(formatShortDate('')).toBeNull();
    expect(formatShortDate('02/10/2026')).toBeNull();
    expect(templateDueLabel(5)).toBe('Tgl 5');
    expect(templateDueLabel(null)).toBeNull();
    expect(templateDueLabel(0)).toBeNull();
    expect(templateDueLabel(32)).toBeNull();
  });
});
