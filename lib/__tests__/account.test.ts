import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ICON_CHOICES,
  accountSubline,
  isHomeCashAccount,
  maskAccountNumber,
  normalizeAccountNumber,
  resolveAccountIcon,
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
