import { describe, expect, it } from 'vitest';
import {
  cleanAccountNumber,
  COMMON_BANK_NAMES,
  formatAccountNumberDisplay,
  formatBankBadge,
  formatBeneficiaryForClipboard,
  formatBeneficiaryHolder,
  POPULAR_BANKS,
  validateBeneficiary,
} from '../beneficiary';

describe('Beneficiary helpers and formatting rules (Flow K)', () => {
  describe('cleanAccountNumber', () => {
    it('removes spaces and dashes from account numbers', () => {
      expect(cleanAccountNumber('1234 5678 9012')).toBe('123456789012');
      expect(cleanAccountNumber('123-456-789-012')).toBe('123456789012');
      expect(cleanAccountNumber(' 0812-3456 7890 ')).toBe('081234567890');
    });

    it('handles null, undefined, or empty strings', () => {
      expect(cleanAccountNumber(null)).toBe('');
      expect(cleanAccountNumber(undefined)).toBe('');
      expect(cleanAccountNumber('')).toBe('');
      expect(cleanAccountNumber('   ')).toBe('');
      expect(cleanAccountNumber('---')).toBe('');
    });
  });

  describe('validateBeneficiary', () => {
    it('validates a complete, valid beneficiary', () => {
      const res = validateBeneficiary({
        name: 'Pak Joko (Kontrakan)',
        bank_name: 'BCA',
        account_number: '1234567890',
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual({});
    });

    it('rejects short names (< 2 chars)', () => {
      const res = validateBeneficiary({
        name: 'A',
        bank_name: 'BCA',
        account_number: '1234567890',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.name).toBe('Label nama penerima minimal 2 huruf.');
    });

    it('rejects empty or short bank names', () => {
      const res = validateBeneficiary({
        name: 'Yayasan Al-Azhar',
        bank_name: '',
        account_number: '1234567890',
      });
      expect(res.valid).toBe(false);
      expect(res.errors.bank_name).toBe('Pilih atau isi nama bank / e-wallet tujuan.');
    });

    it('rejects empty, short, or excessively long account numbers', () => {
      const emptyRes = validateBeneficiary({
        name: 'Toko Bangunan',
        bank_name: 'BRI',
        account_number: '',
      });
      expect(emptyRes.valid).toBe(false);
      expect(emptyRes.errors.account_number).toBe('Nomor rekening wajib diisi.');

      const shortRes = validateBeneficiary({
        name: 'Toko Bangunan',
        bank_name: 'BRI',
        account_number: '123',
      });
      expect(shortRes.valid).toBe(false);
      expect(shortRes.errors.account_number).toBe('Nomor rekening minimal 4 digit.');

      const longRes = validateBeneficiary({
        name: 'Toko Bangunan',
        bank_name: 'BRI',
        account_number: '1'.repeat(35),
      });
      expect(longRes.valid).toBe(false);
      expect(longRes.errors.account_number).toBe('Nomor rekening maksimal 34 karakter.');
    });
  });

  describe('formatBeneficiaryForClipboard', () => {
    it('formats transfer text with bank, cleaned account number, and holder name', () => {
      const text = formatBeneficiaryForClipboard({
        bank_name: 'BCA',
        account_number: '1234-5678-90',
        account_holder_name: 'Joko Susilo',
      });
      expect(text).toBe('BCA 1234567890 a.n. Joko Susilo');
    });

    it('omits holder name when not provided', () => {
      const text = formatBeneficiaryForClipboard({
        bank_name: 'Mandiri',
        account_number: '1400 0123 48821',
        account_holder_name: null,
      });
      expect(text).toBe('Mandiri 1400012348821');
    });
  });

  describe('formatBankBadge', () => {
    it('returns uppercase bank name', () => {
      expect(formatBankBadge('bca')).toBe('BCA');
      expect(formatBankBadge('Mandiri')).toBe('MANDIRI');
      expect(formatBankBadge('GoPay')).toBe('GOPAY');
    });

    it('returns fallback BANK when empty or null', () => {
      expect(formatBankBadge(null)).toBe('BANK');
      expect(formatBankBadge('')).toBe('BANK');
    });
  });

  describe('formatAccountNumberDisplay', () => {
    it('chunks numeric account numbers into blocks of 4 digits', () => {
      expect(formatAccountNumberDisplay('123456789012')).toBe('1234 5678 9012');
      expect(formatAccountNumberDisplay('1234567890')).toBe('1234 5678 90');
    });

    it('preserves short or alphanumeric numbers without erroneous chunks', () => {
      expect(formatAccountNumberDisplay('1234')).toBe('1234');
      expect(formatAccountNumberDisplay('VA-ABCD-1234')).toBe('VAABCD1234');
    });

    it('returns dash for null or empty input', () => {
      expect(formatAccountNumberDisplay(null)).toBe('—');
      expect(formatAccountNumberDisplay('')).toBe('—');
    });
  });

  describe('formatBeneficiaryHolder', () => {
    it('formats a.n. account holder name', () => {
      expect(formatBeneficiaryHolder('Pak Joko', 'Kontrakan')).toBe('a.n. Pak Joko');
    });

    it('falls back to label when holder name is missing', () => {
      expect(formatBeneficiaryHolder(null, 'Yayasan Al-Azhar')).toBe('a.n. Yayasan Al-Azhar');
      expect(formatBeneficiaryHolder('', 'Pak Joko')).toBe('a.n. Pak Joko');
    });

    it('returns null if both are missing', () => {
      expect(formatBeneficiaryHolder(null, null)).toBeNull();
      expect(formatBeneficiaryHolder('', '')).toBeNull();
    });
  });

  describe('popular bank constants', () => {
    it('contains common Indonesian banks', () => {
      expect(COMMON_BANK_NAMES).toContain('BCA');
      expect(COMMON_BANK_NAMES).toContain('Mandiri');
      expect(COMMON_BANK_NAMES).toContain('GoPay');
      expect(POPULAR_BANKS.length).toBeGreaterThan(5);
    });
  });
});
