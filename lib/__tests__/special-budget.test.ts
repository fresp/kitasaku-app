import { describe, expect, it } from 'vitest';
import {
  closeOptions,
  cyclePortion,
  daysPastEnd,
  isTaggableTxn,
  localISODate,
  quickAddBudgets,
  specialBudgetAttention,
  specialBudgetFigures,
  specialBudgetStatus,
  validateSpecialBudgetInput,
  type SpecialBudget,
  type SpecialBudgetAllocationRow,
  type SpecialBudgetTxnRow,
} from '../special-budget';

function budget(over: Partial<SpecialBudget> = {}): SpecialBudget {
  return {
    id: 'b1', household_id: 'h1', name: 'Lebaran 2026',
    start_date: '2026-03-08', end_date: '2026-03-31',
    closed_at: null, closed_by: null, close_destination: null, closed_remaining: null,
    created_by: null, created_at: '2026-03-01T00:00:00Z',
    ...over,
  };
}

function txn(over: Partial<SpecialBudgetTxnRow> = {}): SpecialBudgetTxnRow {
  return {
    special_budget_id: 'b1', direction: 'EXPENSE', flow_type: 'EXPENSE',
    obligation_id: null, status: 'PAID', actual_amount: 0, cancelled_at: null,
    ...over,
  };
}

describe('specialBudgetStatus', () => {
  it('is upcoming before the start date and running on both boundary days', () => {
    const b = budget();
    expect(specialBudgetStatus(b, '2026-03-07')).toBe('UPCOMING');
    expect(specialBudgetStatus(b, '2026-03-08')).toBe('RUNNING');
    expect(specialBudgetStatus(b, '2026-03-31')).toBe('RUNNING');
  });

  it('is ended-but-open after the end date until it is closed', () => {
    expect(specialBudgetStatus(budget(), '2026-04-01')).toBe('ENDED_OPEN');
    expect(specialBudgetStatus(budget({ closed_at: '2026-04-03T00:00:00Z' }), '2026-04-01')).toBe('CLOSED');
  });

  it('counts the days past the end date, never negative', () => {
    expect(daysPastEnd(budget(), '2026-03-20')).toBe(0);
    expect(daysPastEnd(budget(), '2026-03-31')).toBe(0);
    expect(daysPastEnd(budget(), '2026-04-03')).toBe(3);
  });
});

describe('specialBudgetFigures', () => {
  const lebaranTxns: SpecialBudgetTxnRow[] = [
    txn({ direction: 'INCOME', flow_type: 'OPERATING_INCOME', actual_amount: 10_462_287 }),
    txn({ direction: 'INCOME', flow_type: 'OPERATING_INCOME', actual_amount: 9_533_920 }),
    txn({ actual_amount: 753_100 }),
    txn({ actual_amount: 2_180_000 }),
  ];

  it('sums funds in, spending and remaining from tagged executed rows', () => {
    const f = specialBudgetFigures('b1', lebaranTxns, []);
    expect(f.fundsIn).toBe(19_996_207);
    expect(f.fromIncome).toBe(19_996_207);
    expect(f.spent).toBe(2_933_100);
    expect(f.movedOut).toBe(0);
    expect(f.remaining).toBe(17_063_107);
  });

  it('ignores pending, cancelled and other-budget rows', () => {
    const f = specialBudgetFigures('b1', [
      ...lebaranTxns,
      txn({ status: 'PENDING', actual_amount: 999 }),
      txn({ cancelled_at: '2026-03-20T00:00:00Z', actual_amount: 999 }),
      txn({ status: 'CANCELLED', actual_amount: 999 }),
      txn({ special_budget_id: 'b2', actual_amount: 999 }),
      txn({ special_budget_id: null, actual_amount: 999 }),
    ], []);
    expect(f.spent).toBe(2_933_100);
  });

  it('counts live cycle funding as funds in and asset moves as moved out', () => {
    const allocs: SpecialBudgetAllocationRow[] = [
      { special_budget_id: 'b1', amount: 1_500_000, cancelled_at: null },
      { special_budget_id: 'b1', amount: 700_000, cancelled_at: '2026-03-02T00:00:00Z' },
      { special_budget_id: 'b2', amount: 400_000, cancelled_at: null },
    ];
    const f = specialBudgetFigures('b1', [
      txn({ actual_amount: 1_000_000 }),
      txn({ direction: 'EXPENSE', flow_type: 'ASSET_ALLOCATION', actual_amount: 300_000 }),
      txn({ direction: 'INCOME', flow_type: 'ASSET_RELEASE', actual_amount: 200_000 }),
      txn({ direction: 'INCOME', flow_type: 'FINANCING_INFLOW', actual_amount: 100_000 }),
    ], allocs);
    expect(f.fromCycle).toBe(1_500_000);
    expect(f.fromAssets).toBe(200_000);
    expect(f.fromFinancing).toBe(100_000);
    expect(f.fundsIn).toBe(1_800_000);
    expect(f.movedOut).toBe(300_000);
    expect(f.remaining).toBe(500_000);
  });

  it('goes negative when spending outruns the money that came in', () => {
    const f = specialBudgetFigures('b1', [
      txn({ direction: 'INCOME', flow_type: 'OPERATING_INCOME', actual_amount: 1_000_000 }),
      txn({ actual_amount: 1_250_000 }),
    ], []);
    expect(f.remaining).toBe(-250_000);
  });

  it('falls back to the legacy classification when flow_type is missing', () => {
    const f = specialBudgetFigures('b1', [
      txn({ direction: 'INCOME', flow_type: null, actual_amount: 500 }),
      txn({ direction: 'EXPENSE', flow_type: null, actual_amount: 200 }),
    ], []);
    expect(f.fromIncome).toBe(500);
    expect(f.spent).toBe(200);
  });
});

describe('cyclePortion', () => {
  it('takes only positive remainders of open budgets out of the balance', () => {
    expect(cyclePortion(31_402_118, [10_770_187, 6_500_000])).toEqual({
      cycle: 14_131_931,
      budgets: 17_270_187,
    });
  });

  it('never adds a deficit back: that money already left the account', () => {
    expect(cyclePortion(30_000_000, [-2_000_000])).toEqual({ cycle: 30_000_000, budgets: 0 });
    expect(cyclePortion(30_000_000, [5_000_000, -2_000_000])).toEqual({ cycle: 25_000_000, budgets: 5_000_000 });
  });
});

describe('quickAddBudgets', () => {
  it('offers only budgets running on the transaction date, ending soonest first', () => {
    const list = [
      budget({ id: 'reno', name: 'Renovasi dapur', start_date: '2026-02-01', end_date: '2026-04-30' }),
      budget({ id: 'leb', end_date: '2026-03-31' }),
      budget({ id: 'next', start_date: '2027-02-27', end_date: '2027-03-21' }),
      budget({ id: 'closed', closed_at: '2026-03-15T00:00:00Z' }),
    ];
    expect(quickAddBudgets(list, '2026-03-13').map((b) => b.id)).toEqual(['leb', 'reno']);
    expect(quickAddBudgets(list, '2026-04-12').map((b) => b.id)).toEqual(['reno']);
  });
});

describe('closeOptions', () => {
  it('needs no choice when nothing is left, and two places otherwise', () => {
    expect(closeOptions(0)).toEqual(['NONE']);
    expect(closeOptions(10_770_187)).toEqual(['CYCLE', 'ASSET']);
    expect(closeOptions(-250_000)).toEqual(['CYCLE', 'ASSET']);
  });
});

describe('validateSpecialBudgetInput', () => {
  it('accepts a named budget with ordered dates', () => {
    expect(validateSpecialBudgetInput({ name: ' Liburan Bandung ', startDate: '2026-06-20', endDate: '2026-06-23' })).toBeNull();
    expect(validateSpecialBudgetInput({ name: 'Satu hari', startDate: '2026-06-20', endDate: '2026-06-20' })).toBeNull();
  });

  it('rejects an empty or long name, bad dates and an end before the start', () => {
    expect(validateSpecialBudgetInput({ name: '  ', startDate: '2026-06-20', endDate: '2026-06-23' }))
      .toBe('Nama anggaran khusus wajib diisi.');
    expect(validateSpecialBudgetInput({ name: 'x'.repeat(61), startDate: '2026-06-20', endDate: '2026-06-23' }))
      .toBe('Nama anggaran khusus maksimal 60 karakter.');
    expect(validateSpecialBudgetInput({ name: 'Liburan', startDate: '20-06-2026', endDate: '2026-06-23' }))
      .toBe('Tanggal mulai dan selesai wajib diisi.');
    expect(validateSpecialBudgetInput({ name: 'Liburan', startDate: '2026-06-23', endDate: '2026-06-20' }))
      .toBe('Tanggal selesai tidak boleh sebelum tanggal mulai.');
  });
});

describe('isTaggableTxn', () => {
  const ok = {
    flow_type: 'EXPENSE' as const, direction: 'EXPENSE' as const, status: 'PAID' as const,
    account_type: 'BANK', recurring_template_id: null, obligation_id: null, cancelled_at: null,
  };

  it('mirrors the database guard for executed cash-account rows', () => {
    expect(isTaggableTxn(ok)).toBe(true);
    expect(isTaggableTxn({ ...ok, account_type: 'E_WALLET', flow_type: 'OPERATING_INCOME', direction: 'INCOME' })).toBe(true);
  });

  it('refuses pending, cancelled, card, recurring, debt and transfer rows', () => {
    expect(isTaggableTxn({ ...ok, status: 'PENDING' })).toBe(false);
    expect(isTaggableTxn({ ...ok, cancelled_at: '2026-03-01T00:00:00Z' })).toBe(false);
    expect(isTaggableTxn({ ...ok, account_type: 'CREDIT_CARD' })).toBe(false);
    expect(isTaggableTxn({ ...ok, account_type: 'CASH' })).toBe(false);
    expect(isTaggableTxn({ ...ok, recurring_template_id: 't1' })).toBe(false);
    expect(isTaggableTxn({ ...ok, flow_type: 'DEBT_PAYMENT', obligation_id: 'o1' })).toBe(false);
    expect(isTaggableTxn({ ...ok, flow_type: 'TRANSFER' })).toBe(false);
  });
});

describe('localISODate', () => {
  it('keeps the local calendar day instead of shifting to UTC', () => {
    expect(localISODate(new Date(2026, 2, 10, 0, 5))).toBe('2026-03-10');
    expect(localISODate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});

describe('specialBudgetAttention', () => {
  it('lists deficits first, then ended budgets still open, and skips closed or healthy ones', () => {
    const list = [
      budget({ id: 'leb', end_date: '2026-03-31' }),
      budget({ id: 'reno', name: 'Renovasi', start_date: '2026-02-01', end_date: '2026-04-30' }),
      budget({ id: 'ok', start_date: '2026-04-01', end_date: '2026-04-30' }),
      budget({ id: 'done', end_date: '2026-03-01', closed_at: '2026-03-05T00:00:00Z' }),
    ];
    const figures = {
      leb: { remaining: 10_770_187 } as never,
      reno: { remaining: -250_000 } as never,
      ok: { remaining: 100 } as never,
      done: { remaining: -5 } as never,
    };
    const rows = specialBudgetAttention(list, figures, '2026-04-03');
    expect(rows.map((r) => [r.budget.id, r.kind, r.daysPast])).toEqual([
      ['reno', 'DEFICIT', 0],
      ['leb', 'ENDED', 3],
    ]);
  });
});
