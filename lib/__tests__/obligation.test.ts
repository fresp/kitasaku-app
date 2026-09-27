import { describe, expect, it } from 'vitest';
import {
  counterpartyLabel,
  daysBetween,
  installmentProgressLabel,
  isRepaymentMode,
  loanBreakdownText,
  loanState,
  longDateFullLabel,
  longDateLabel,
  matchesObligationFilter,
  nextOpenInstallment,
  normalizeObligationType,
  obligationBacklog,
  obligationBadge,
  obligationFilterCounts,
  obligationTypeLabel,
  overdueNote,
  paidAmount,
  principalInterestText,
  progressPct,
  repaymentModeLabel,
  repaymentModeOf,
  shortDateLabel,
} from '../obligation';

// Continues the numbering from profile.test.ts (which stops at 49).

const TODAY = '2026-10-28';

describe('obligation types and filters (phase 5b)', () => {
  it('50: legacy DEBT/REIMBURSE aliases normalize to their modern names', () => {
    expect(normalizeObligationType('DEBT')).toBe('LOAN');
    expect(normalizeObligationType('REIMBURSE')).toBe('REIMBURSEMENT');
    expect(normalizeObligationType('loan')).toBe('LOAN');
    expect(normalizeObligationType('  BILL ')).toBe('BILL');
  });

  it('51: an unknown or empty type reads as a bill, never as a blank badge', () => {
    expect(normalizeObligationType(null)).toBe('BILL');
    expect(normalizeObligationType('')).toBe('BILL');
    expect(normalizeObligationType('SOMETHING_ELSE')).toBe('BILL');
  });

  it('52: type labels use the design copy', () => {
    expect(obligationTypeLabel('LOAN')).toBe('Pinjaman');
    expect(obligationTypeLabel('REIMBURSEMENT')).toBe('Reimburse');
    expect(obligationTypeLabel('INSTALLMENT')).toBe('Cicilan');
    expect(obligationTypeLabel('BILL')).toBe('Tagihan');
    expect(obligationTypeLabel('DEBT')).toBe('Pinjaman');
  });

  it('53: the "Semua" tab matches everything, the rest match one type', () => {
    expect(matchesObligationFilter('LOAN', 'all')).toBe(true);
    expect(matchesObligationFilter(null, 'all')).toBe(true);
    expect(matchesObligationFilter('DEBT', 'loan')).toBe(true);
    expect(matchesObligationFilter('LOAN', 'reimburse')).toBe(false);
    expect(matchesObligationFilter('REIMBURSE', 'reimburse')).toBe(true);
    expect(matchesObligationFilter('BILL', 'installment')).toBe(false);
  });
});

describe('obligation dates (phase 5b)', () => {
  it('54: daysBetween counts whole days and is timezone-proof', () => {
    expect(daysBetween('2026-10-25', '2026-10-28')).toBe(3);
    expect(daysBetween('2026-10-28', '2026-10-28')).toBe(0);
    expect(daysBetween('2026-10-30', '2026-10-28')).toBe(-2);
    // A DST-free UTC parse: crossing a month boundary must not lose a day.
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1);
  });

  it('55: an unparseable or missing date yields null, not NaN', () => {
    expect(daysBetween(null, '2026-10-28')).toBeNull();
    expect(daysBetween('2026-10-25', undefined)).toBeNull();
    expect(daysBetween('nonsense', '2026-10-28')).toBeNull();
  });

  it('56: date labels use the Indonesian month names', () => {
    expect(longDateLabel('2026-10-25')).toBe('25 Okt 2026');
    expect(shortDateLabel('2026-10-25')).toBe('25 Okt');
    expect(longDateLabel(null)).toBeNull();
  });

  it('57: a rolled-over date is rejected, not silently shifted into next year', () => {
    // `Date.UTC(2026, 12, 1)` is 1 Jan 2027 — a typo must not become a date.
    expect(shortDateLabel('2026-13-01')).toBeNull();
    expect(longDateLabel('2026-13-01')).toBeNull();
    expect(shortDateLabel('2026-02-31')).toBeNull();
    expect(daysBetween('2026-02-31', '2026-03-01')).toBeNull();
  });
});

describe('loan state (phase 5b)', () => {
  it('58: paid amount is floored at 0 and capped at the total', () => {
    expect(paidAmount(10_000_000, 8_000_000)).toBe(2_000_000);
    expect(paidAmount(10_000_000, 0)).toBe(10_000_000);
    // A data glitch where remaining exceeds total must not report a negative.
    expect(paidAmount(10_000_000, 12_000_000)).toBe(0);
    expect(paidAmount(0, 0)).toBe(0);
  });

  it('59: progress is a whole percent, and 0% for a zero total', () => {
    expect(progressPct(10_000_000, 8_000_000)).toBe(20);
    expect(progressPct(10_000_000, 0)).toBe(100);
    expect(progressPct(0, 0)).toBe(0);
  });

  it('60: nothing paid and not due yet is OPEN, not RUNNING', () => {
    expect(loanState({ status: 'OPEN', total_amount: 10_000_000, remaining_amount: 10_000_000, due_date: '2026-11-25' }, TODAY)).toBe('OPEN');
  });

  it('61: partially paid reads as RUNNING', () => {
    expect(loanState({ status: 'PARTIAL', total_amount: 10_000_000, remaining_amount: 8_000_000, due_date: '2026-11-25' }, TODAY)).toBe('RUNNING');
  });

  it('62: a past due date beats a partially-paid status — the naive bug', () => {
    // 20% paid AND three days late. The card must not say "Berjalan • 20%".
    expect(loanState({ status: 'PARTIAL', total_amount: 10_000_000, remaining_amount: 8_000_000, due_date: '2026-10-25' }, TODAY)).toBe('OVERDUE');
  });

  it('63: the due date is compared by date, so due today is not yet late', () => {
    expect(loanState({ status: 'OPEN', total_amount: 10_000_000, remaining_amount: 10_000_000, due_date: TODAY }, TODAY)).toBe('OPEN');
  });

  it('64: a stored OVERDUE wins even with a future date', () => {
    expect(loanState({ status: 'OVERDUE', total_amount: 10_000_000, remaining_amount: 8_000_000, due_date: '2026-12-01' }, TODAY)).toBe('OVERDUE');
  });

  it('65: settled and cancelled win over everything, including a late date', () => {
    expect(loanState({ status: 'SETTLED', total_amount: 10_000_000, remaining_amount: 0, due_date: '2026-01-01' }, TODAY)).toBe('SETTLED');
    expect(loanState({ status: 'CANCELLED', total_amount: 10_000_000, remaining_amount: 5_000_000, due_date: '2026-01-01' }, TODAY)).toBe('CANCELLED');
  });

  it('66: a zero remaining with no status is settled by arithmetic', () => {
    expect(loanState({ status: 'OPEN', total_amount: 10_000_000, remaining_amount: 0 }, TODAY)).toBe('SETTLED');
  });

  it('67: badges carry the design copy and tone per state', () => {
    expect(obligationBadge('SETTLED', 100)).toEqual({ label: 'Lunas • 100%', tone: 'paid' });
    expect(obligationBadge('RUNNING', 20)).toEqual({ label: 'Berjalan • 20%', tone: 'alert' });
    expect(obligationBadge('OVERDUE', 20)).toEqual({ label: 'Jatuh Tempo!', tone: 'pending' });
    expect(obligationBadge('OPEN', 0)).toEqual({ label: 'Belum dibayar', tone: 'pending' });
  });

  it('68: the overdue note names the lateness, and never says "0 hari"', () => {
    expect(overdueNote('2026-10-25', TODAY)).toBe('Terlambat 3 hari • Segera bayar');
    expect(overdueNote(TODAY, TODAY)).toBe('Jatuh tempo hari ini • Segera bayar');
    expect(overdueNote(null, TODAY)).toBe('Segera bayar sebelum jatuh tempo berikutnya.');
  });
});

describe('obligation copy (phase 5b)', () => {
  it('69: the preposition follows the direction of the money', () => {
    expect(counterpartyLabel('LOAN', 'Pihak Eksternal')).toBe('Pemberi: Pihak Eksternal');
    expect(counterpartyLabel('DEBT', 'Bank BRI')).toBe('Pemberi: Bank BRI');
    expect(counterpartyLabel('BILL', 'Bengkel AHASS')).toBe('Kepada: Bengkel AHASS');
    expect(counterpartyLabel('REIMBURSEMENT', 'Istri Andra')).toBe('Kepada: Istri Andra');
    expect(counterpartyLabel('LOAN', null)).toBeNull();
    expect(counterpartyLabel('LOAN', '   ')).toBeNull();
  });

  it('70: the loan breakdown names total, paid, and remaining', () => {
    expect(loanBreakdownText({ total_amount: 10_000_000, remaining_amount: 8_000_000 }))
      .toBe('Total Rp 10.000.000 • Sudah dibayar Rp 2.000.000 • Sisa Rp 8.000.000');
  });

  it('71: principal is the total minus interest, so the debt is not overstated', () => {
    expect(principalInterestText({ total_amount: 12_000_000, remaining_amount: 10_000_000, interest_fee_amount: 2_000_000 }))
      .toBe('Pokok: Rp 10.000.000 · Bunga: Rp 2.000.000 · Sisa: Rp 10.000.000');
    expect(principalInterestText({ total_amount: 2_000_000, remaining_amount: 500_000, interest_fee_amount: 0 }))
      .toBe('Pokok: Rp 2.000.000 · Bunga: Rp 0 · Sisa: Rp 500.000');
  });

  it('72: installment progress counts settled rows, and is null with no schedule', () => {
    expect(installmentProgressLabel([])).toBeNull();
    expect(installmentProgressLabel([
      { status: 'SETTLED' }, { status: 'SETTLED' }, { status: 'OPEN' },
    ])).toBe('2 dari 3 cicilan');
    expect(installmentProgressLabel([
      { status: 'CANCELLED' }, { status: 'OPEN' },
    ])).toBe('1 dari 2 cicilan');
  });
});

describe('next open installment (phase 5b)', () => {
  it('73: picks the earliest dated row still owed', () => {
    const next = nextOpenInstallment([
      { id: 'b', status: 'OPEN', due_date: '2026-12-25' },
      { id: 'a', status: 'OPEN', due_date: '2026-11-25' },
      { id: 'c', status: 'SETTLED', due_date: '2026-10-25' },
    ]);
    expect(next?.id).toBe('a');
  });

  it('74: an undated backlog row sorts after every dated one', () => {
    const next = nextOpenInstallment([
      { id: 'backlog', status: 'OPEN', due_date: null },
      { id: 'dated', status: 'OPEN', due_date: '2027-01-25' },
    ]);
    expect(next?.id).toBe('dated');
  });

  it('75: returns null when nothing is still owed', () => {
    expect(nextOpenInstallment([])).toBeNull();
    expect(nextOpenInstallment([{ status: 'SETTLED' }, { status: 'CANCELLED' }])).toBeNull();
  });
});

describe('repayment mode (phase 5b)', () => {
  it('76: a stored mode always wins and is not marked derived', () => {
    expect(repaymentModeOf({ repayment_mode: 'LUMP_NEXT_MONTH', installment_count: 5 }))
      .toEqual({ mode: 'LUMP_NEXT_MONTH', derived: false });
    expect(repaymentModeOf({ repayment_mode: 'MANUAL' }))
      .toEqual({ mode: 'MANUAL', derived: false });
  });

  it('77: an unstored mode is inferred from the schedule and flagged derived', () => {
    expect(repaymentModeOf({ installment_count: 5 })).toEqual({ mode: 'INSTALLMENT', derived: true });
    expect(repaymentModeOf({ installment_count: null })).toEqual({ mode: 'MANUAL', derived: true });
    // One installment is a single payment, not a schedule.
    expect(repaymentModeOf({ installment_count: 1 })).toEqual({ mode: 'MANUAL', derived: true });
  });

  it('78: an unrecognized stored value is treated as unstored, never echoed', () => {
    expect(repaymentModeOf({ repayment_mode: 'YOLO' })).toEqual({ mode: 'MANUAL', derived: true });
    expect(isRepaymentMode('YOLO')).toBe(false);
    expect(isRepaymentMode('INSTALLMENT')).toBe(true);
    expect(isRepaymentMode(null)).toBe(false);
  });

  it('79: mode labels come from the design card', () => {
    expect(repaymentModeLabel('LUMP_NEXT_MONTH')).toBe('Lunas bln depan');
    expect(repaymentModeLabel('INSTALLMENT')).toBe('Cicil per siklus');
    expect(repaymentModeLabel('MANUAL')).toBe('Manual');
    expect(repaymentModeLabel(null)).toBeNull();
  });
});

describe('backlog overview (phase 5b)', () => {
  const rows = [
    { type: 'LOAN', status: 'OPEN', remaining_amount: 10_000_000 },
    { type: 'REIMBURSEMENT', status: 'PARTIAL', remaining_amount: 500_000 },
    { type: 'BILL', status: 'SETTLED', remaining_amount: 0 },
    { type: 'INSTALLMENT', status: 'OVERDUE', remaining_amount: 1_000_000 },
  ];

  it('80: only open rows with a remaining balance are counted', () => {
    const b = obligationBacklog(rows);
    expect(b.total).toBe(11_500_000);
    expect(b.activeCount).toBe(3);
    expect(b.loanTotal).toBe(10_000_000);
    expect(b.reimburseTotal).toBe(500_000);
  });

  it('81: the eyebrow and sub-line match the design, and degrade when empty', () => {
    expect(obligationBacklog(rows).eyebrow).toBe('TOTAL KEWAJIBAN TERBUKA • 3 AKTIF');
    expect(obligationBacklog(rows).sub).toBe('Rp 10.000.000 pinjaman • Rp 500.000 reimburse');
    const empty = obligationBacklog([]);
    expect(empty.total).toBe(0);
    expect(empty.eyebrow).toBe('TOTAL KEWAJIBAN TERBUKA • 0 AKTIF');
    expect(empty.sub).toBe('Kewajiban independen di luar rutinitas bulanan');
  });

  it('82: filter counts skip settled rows and agree with the overview', () => {
    const counts = obligationFilterCounts(rows);
    expect(counts.all).toBe(3);
    expect(counts.loan).toBe(1);
    expect(counts.reimburse).toBe(1);
    expect(counts.installment).toBe(1);
    expect(counts.bill).toBe(0);
  });
});

describe('long date labels for prose (phase 5b)', () => {
  it('83: the full month name is spelled out for sentences', () => {
    // "Diterima 25 September 2026" needs the whole word; "25 Sep" reads as a
    // card chip, not a receipt line.
    expect(longDateFullLabel('2026-09-25')).toBe('25 September 2026');
    expect(longDateFullLabel('2026-01-01')).toBe('1 Januari 2026');
    expect(longDateFullLabel('2026-12-31')).toBe('31 Desember 2026');
    // Mei is not "May" and Agu is not "Aug" — the abbreviations must not leak
    // into the long form.
    expect(longDateFullLabel('2026-05-10')).toBe('10 Mei 2026');
    expect(longDateFullLabel('2026-08-10')).toBe('10 Agustus 2026');
  });

  it('84: a malformed date yields null in the long form too', () => {
    expect(longDateFullLabel(null)).toBeNull();
    expect(longDateFullLabel('')).toBeNull();
    expect(longDateFullLabel('2026-13-01')).toBeNull();
    expect(longDateFullLabel('2026-02-31')).toBeNull();
    expect(longDateFullLabel('25/09/2026')).toBeNull();
  });
});
