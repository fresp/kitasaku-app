import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ICON_CHOICES,
  accountSubline,
  maskAccountNumber,
  normalizeAccountNumber,
  resolveAccountIcon,
  sortAccounts,
  validateAccountNumber,
  defaultAccountId,
} from '../account';

describe('account helpers and presentation rules (Flow J)', () => {
  describe('maskAccountNumber', () => {
    it('masks full account number to last 4 digits with non-breaking space', () => {
      const masked = maskAccountNumber('1400012348821');
      expect(masked).toBe('•• 8821');
      // Verify non-breaking space
      expect(masked.charCodeAt(2)).toBe(0x00a0);
    });

    it('strips dashes and spaces before taking last 4 digits', () => {
      expect(maskAccountNumber('1400-0123-48821')).toBe('•• 8821');
      expect(maskAccountNumber('1400 0123 48821')).toBe('•• 8821');
    });

    it('handles short 4-digit number', () => {
      expect(maskAccountNumber('4402')).toBe('•• 4402');
    });

    it('returns fallback string when account number is empty or null', () => {
      expect(maskAccountNumber(null, 'Belum ada')).toBe('Belum ada');
      expect(maskAccountNumber(undefined, 'Belum ada')).toBe('Belum ada');
      expect(maskAccountNumber('', 'Belum ada')).toBe('Belum ada');
      expect(maskAccountNumber('   ', 'Belum ada')).toBe('Belum ada');
      expect(maskAccountNumber(null)).toBe('');
    });
  });

  describe('accountSubline', () => {
    it('returns masked number when account number is present', () => {
      expect(accountSubline({ type: 'BANK', account_number: '1400012348821' })).toBe('•• 8821');
      expect(accountSubline({ type: 'CREDIT_CARD', account_number: '5520123456784402' })).toBe('•• 4402');
      expect(accountSubline({ type: 'E_WALLET', account_number: '081234567788' })).toBe('•• 7788');
    });

    it('returns account type label when account number is empty, null, or whitespace', () => {
      expect(accountSubline({ type: 'BANK', account_number: null })).toBe('Rekening bank');
      expect(accountSubline({ type: 'CREDIT_CARD', account_number: '' })).toBe('Kartu kredit');
      expect(accountSubline({ type: 'E_WALLET', account_number: undefined })).toBe('E-wallet');
      expect(accountSubline({ type: 'CASH', account_number: null })).toBe('Tunai');
      expect(accountSubline({ type: 'CASH', account_number: '   ' })).toBe('Tunai');
    });

    it('falls back to raw type name if unknown type has no number', () => {
      expect(accountSubline({ type: 'CUSTOM_TYPE', account_number: null })).toBe('CUSTOM_TYPE');
    });
  });

  describe('normalizeAccountNumber', () => {
    it('strips all whitespace and dashes', () => {
      expect(normalizeAccountNumber('1234 5678 9012')).toBe('123456789012');
      expect(normalizeAccountNumber('1234-5678-9012')).toBe('123456789012');
      expect(normalizeAccountNumber('  1234 - 5678 - 9012  ')).toBe('123456789012');
    });

    it('returns null for empty or nullish strings', () => {
      expect(normalizeAccountNumber(null)).toBeNull();
      expect(normalizeAccountNumber(undefined)).toBeNull();
      expect(normalizeAccountNumber('')).toBeNull();
      expect(normalizeAccountNumber('   ')).toBeNull();
      expect(normalizeAccountNumber('---')).toBeNull();
    });
  });

  describe('validateAccountNumber', () => {
    it('returns null for empty or nullish strings (optional field)', () => {
      expect(validateAccountNumber(null)).toBeNull();
      expect(validateAccountNumber(undefined)).toBeNull();
      expect(validateAccountNumber('')).toBeNull();
      expect(validateAccountNumber('   ')).toBeNull();
    });

    it('returns error when normalized digits are fewer than 4', () => {
      expect(validateAccountNumber('12')).toBe('Nomor akun minimal 4 digit.');
      expect(validateAccountNumber('123')).toBe('Nomor akun minimal 4 digit.');
      expect(validateAccountNumber('1-2-3')).toBe('Nomor akun minimal 4 digit.');
    });

    it('returns error when normalized digits exceed 34 characters', () => {
      const longNum = '1'.repeat(35);
      expect(validateAccountNumber(longNum)).toBe('Nomor akun maksimal 34 karakter.');
    });

    it('returns null for valid lengths between 4 and 34 characters', () => {
      expect(validateAccountNumber('1234')).toBeNull();
      expect(validateAccountNumber('1400012348821')).toBeNull();
      expect(validateAccountNumber('1'.repeat(34))).toBeNull();
    });
  });

  describe('resolveAccountIcon', () => {
    it('uses explicit icon if set and non-empty', () => {
      expect(resolveAccountIcon('BANK', 'smartphone')).toBe('smartphone');
      expect(resolveAccountIcon('CASH', 'piggy-bank')).toBe('piggy-bank');
      expect(resolveAccountIcon('E_WALLET', 'credit-card')).toBe('credit-card');
    });

    it('falls back to type-derived default icon when explicit icon is null or empty', () => {
      expect(resolveAccountIcon('BANK', null)).toBe('landmark');
      expect(resolveAccountIcon('BANK', '')).toBe('landmark');
      expect(resolveAccountIcon('BANK', '   ')).toBe('landmark');
      expect(resolveAccountIcon('CREDIT_CARD', null)).toBe('credit-card');
      expect(resolveAccountIcon('E_WALLET', null)).toBe('wallet');
      expect(resolveAccountIcon('CASH', null)).toBe('banknote');
    });

    it('falls back to wallet for unknown types without explicit icon', () => {
      expect(resolveAccountIcon('OTHER', null)).toBe('wallet');
    });

    it('contains all 6 expected icons in ACCOUNT_ICON_CHOICES', () => {
      expect(ACCOUNT_ICON_CHOICES).toEqual([
        'landmark',
        'credit-card',
        'wallet',
        'banknote',
        'piggy-bank',
        'smartphone',
      ]);
    });
  });

  describe('sortAccounts', () => {
    it('orders by sort_order ascending, breaking ties by name', () => {
      const input = [
        { name: 'ShopeePay', sort_order: 3 },
        { name: 'Mandiri', sort_order: 1 },
        { name: 'Tunai', sort_order: 4 },
        { name: 'CC Mandiri', sort_order: 2 },
      ];
      const sorted = sortAccounts(input);
      expect(sorted.map((a) => a.name)).toEqual([
        'Mandiri',
        'CC Mandiri',
        'ShopeePay',
        'Tunai',
      ]);
    });

    it('breaks ties alphabetically by name', () => {
      const input = [
        { name: 'Zeta Bank', sort_order: 0 },
        { name: 'BCA', sort_order: 0 },
        { name: 'Mandiri', sort_order: 0 },
      ];
      const sorted = sortAccounts(input);
      expect(sorted.map((a) => a.name)).toEqual(['BCA', 'Mandiri', 'Zeta Bank']);
    });

    it('treats undefined sort_order as 0', () => {
      const input = [
        { name: 'Second', sort_order: 2 },
        { name: 'Alpha', sort_order: undefined },
        { name: 'First', sort_order: 1 },
      ];
      const sorted = sortAccounts(input);
      expect(sorted.map((a) => a.name)).toEqual(['Alpha', 'First', 'Second']);
    });
  });

  describe('defaultAccountId', () => {
    // The four accounts lib/seed.ts writes, in the order it writes them. The
    // sort_order values mirror migration 010's backfill.
    const seeded = [
      { id: 'bank', name: 'Mandiri', type: 'BANK', sort_order: 1 },
      { id: 'card', name: 'CC Mandiri', type: 'CREDIT_CARD', sort_order: 2 },
      { id: 'wallet', name: 'ShopeePay', type: 'E_WALLET', sort_order: 3 },
      { id: 'cash', name: 'Tunai', type: 'CASH', sort_order: 4 },
    ];

    it('picks the bank from a seeded household, not the first row', () => {
      expect(defaultAccountId(sortAccounts(seeded))).toBe('bank');
    });

    it('picks the bank even when it does not sort first', () => {
      // A family that dragged its card to the top: the bank is still the
      // account a cycle reconciles against, so it is still the honest default.
      const reordered = [
        { id: 'card', name: 'CC Mandiri', type: 'CREDIT_CARD', sort_order: 1 },
        { id: 'bank', name: 'Mandiri', type: 'BANK', sort_order: 2 },
      ];
      expect(defaultAccountId(sortAccounts(reordered))).toBe('bank');
    });

    it('regression: the untied seed handed income rows a credit card', () => {
      // Without sort_order every row ties at 0 and the alphabetical tie-break
      // decides, which puts 'CC Mandiri' before 'Mandiri'. This is the bug that
      // made a salary look like it arrived on a card.
      const untied = seeded.map(({ sort_order, ...rest }) => rest);
      const sorted = sortAccounts(untied);
      expect(sorted[0].name).toBe('CC Mandiri');
      // defaultAccountId still rescues it: the bank is chosen by type, not
      // position, so the fix holds even if a row loses its sort_order.
      expect(defaultAccountId(sorted)).toBe('bank');
    });

    it('falls back to the first account when there is no bank', () => {
      const noBank = [
        { id: 'wallet', name: 'ShopeePay', type: 'E_WALLET', sort_order: 1 },
        { id: 'cash', name: 'Tunai', type: 'CASH', sort_order: 2 },
      ];
      expect(defaultAccountId(sortAccounts(noBank))).toBe('wallet');
    });

    it('returns null when there are no accounts at all', () => {
      expect(defaultAccountId([])).toBeNull();
    });
  });
});
