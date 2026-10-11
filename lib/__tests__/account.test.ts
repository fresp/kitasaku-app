import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ICON_CHOICES,
  accountSubline,
  isHomeCashAccount,
  maskAccountNumber,
  normalizeAccountNumber,
  resolveAccountIcon,
  splitPlannedExpense,
  sortAccounts,
  validateAccountNumber,
  defaultAccountId,
  cyclePrimaryAccountId,
} from '../account';

describe('account helpers and presentation rules (Flow J)', () => {
  it('includes active-cash types for Home movement browsing, but not credit cards', () => {
    expect(isHomeCashAccount({ type: 'BANK' })).toBe(true);
    expect(isHomeCashAccount({ type: 'E_WALLET' })).toBe(true);
    expect(isHomeCashAccount({ type: 'CASH' })).toBe(true);
    expect(isHomeCashAccount({ type: 'CREDIT_CARD' })).toBe(false);
  });
  it('masks account numbers', () => {
    expect(maskAccountNumber('1400012348821')).toBe('•• 8821');
    expect(maskAccountNumber(null, 'Belum ada')).toBe('Belum ada');
    expect(maskAccountNumber(null)).toBe('');
  });
  it('builds account sublines', () => {
    expect(accountSubline({ type: 'BANK', account_number: '1400012348821' })).toBe('•• 8821');
    expect(accountSubline({ type: 'CASH', account_number: null })).toBe('Tunai');
  });
  it('normalizes and validates account numbers', () => {
    expect(normalizeAccountNumber('1234 5678-9012')).toBe('123456789012');
    expect(normalizeAccountNumber('---')).toBeNull();
    expect(validateAccountNumber('123')).toBe('Nomor akun minimal 4 digit.');
    expect(validateAccountNumber('1234')).toBeNull();
    expect(validateAccountNumber('1'.repeat(35))).toBe('Nomor akun maksimal 34 karakter.');
  });
  it('resolves explicit and default icons', () => {
    expect(resolveAccountIcon('BANK', 'smartphone')).toBe('smartphone');
    expect(resolveAccountIcon('BANK', null)).toBe('landmark');
    expect(resolveAccountIcon('CASH', null)).toBe('banknote');
    expect(ACCOUNT_ICON_CHOICES).toEqual(['landmark', 'credit-card', 'wallet', 'banknote', 'piggy-bank', 'smartphone']);
  });
  it('sorts by configured order, then name', () => {
    expect(sortAccounts([
      { name: 'Zeta', sort_order: 0 }, { name: 'Alpha', sort_order: 0 }, { name: 'First', sort_order: 1 },
    ]).map((account) => account.name)).toEqual(['Alpha', 'Zeta', 'First']);
  });
  it('chooses only an active BANK as cycle primary', () => {
    expect(defaultAccountId([
      { id: 'card', type: 'CREDIT_CARD' }, { id: 'bank', type: 'BANK', is_active: true },
    ])).toBe('bank');
    expect(defaultAccountId([{ id: 'cash', type: 'CASH' }])).toBeNull();
    expect(cyclePrimaryAccountId([
      { id: 'prior', type: 'BANK', is_active: true }, { id: 'next', type: 'BANK', is_active: true },
    ], 'prior')).toBe('prior');
  });
});

describe('splitPlannedExpense', () => {
  const amountOf = (r: { amount: number }) => r.amount;

  it('sorts a position by the pocket its money leaves', () => {
    const rows = [
      { amount: 1_000_000, account_id: 'bank-1', accounts: { type: 'BANK' } },
      { amount: 300_000, account_id: 'wallet', accounts: { type: 'E_WALLET' } },
      { amount: 220_000, account_id: 'cc', accounts: { type: 'CREDIT_CARD' } },
    ];
    const split = splitPlannedExpense(rows, 'bank-1', amountOf);
    expect(split.amounts).toEqual({ primary: 1_000_000, otherCash: 300_000, card: 220_000 });
    expect(split.counts).toEqual({ primary: 1, otherCash: 1, card: 1 });
    // The breakdown must always reconcile to the figure shown above it.
    expect(split.total).toBe(1_520_000);
    expect(split.amounts.primary + split.amounts.otherCash + split.amounts.card).toBe(split.total);
  });

  it('counts an unjoined or account-less row as cash, never as a card', () => {
    const rows = [
      { amount: 500_000, account_id: null },
      { amount: 400_000, account_id: 'unknown', accounts: null },
      { amount: 100_000, account_id: 'unknown-2', accounts: [] as { type?: string | null }[] },
    ];
    const split = splitPlannedExpense(rows, 'bank-1', amountOf);
    expect(split.amounts.card).toBe(0);
    expect(split.amounts.otherCash).toBe(1_000_000);
  });

  it('puts the primary account first even when it is a card', () => {
    // A household can set any account as the cycle's primary; the reconciliation
    // anchor wins over the cash test, or the breakdown would disagree with the
    // account the cycle is actually closed against.
    const rows = [{ amount: 250_000, account_id: 'cc', accounts: { type: 'CREDIT_CARD' } }];
    expect(splitPlannedExpense(rows, 'cc', amountOf).amounts).toEqual({
      primary: 250_000, otherCash: 0, card: 0,
    });
  });

  it('has no primary group when the cycle has no primary account', () => {
    const rows = [{ amount: 250_000, account_id: 'bank-1', accounts: { type: 'BANK' } }];
    const split = splitPlannedExpense(rows, null, amountOf);
    expect(split.amounts).toEqual({ primary: 0, otherCash: 250_000, card: 0 });
  });
});
