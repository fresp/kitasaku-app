// Beneficiary helpers and presentation rules for Flow K — Counterparty Beneficiaries
//
// Pure module. It imports no React Native packages so it can be tested directly with Vitest.
//
// Context & Architecture:
//   Internal asset accounts (`public.accounts`) represent household payment sources
//   (e.g., Mandiri, CC, ShopeePay, Cash) and must NEVER store external destination accounts.
//   Counterparty beneficiaries (e.g., school tuition, landlord rent, monthly laundry,
//   repair shop) belong strictly to deferred obligations (`public.obligations`).

export interface Beneficiary {
  id: string;
  household_id: string;
  name: string;
  bank_name: string;
  account_number: string;
  account_holder_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BankOption {
  code: string;
  name: string;
  isPopular?: boolean;
}

export const POPULAR_BANKS: BankOption[] = [
  { code: 'BCA', name: 'Bank Central Asia (BCA)', isPopular: true },
  { code: 'Mandiri', name: 'Bank Mandiri', isPopular: true },
  { code: 'BRI', name: 'Bank Rakyat Indonesia (BRI)', isPopular: true },
  { code: 'BNI', name: 'Bank Negara Indonesia (BNI)', isPopular: true },
  { code: 'BSI', name: 'Bank Syariah Indonesia (BSI)', isPopular: true },
  { code: 'CIMB', name: 'CIMB Niaga', isPopular: true },
  { code: 'Permata', name: 'Bank Permata', isPopular: false },
  { code: 'Danamon', name: 'Bank Danamon', isPopular: false },
  { code: 'BTPN', name: 'Bank BTPN / Jenius', isPopular: false },
  { code: 'Jago', name: 'Bank Jago', isPopular: true },
  { code: 'Seabank', name: 'SeaBank Indonesia', isPopular: true },
  { code: 'GoPay', name: 'GoPay', isPopular: true },
  { code: 'OVO', name: 'OVO', isPopular: true },
  { code: 'DANA', name: 'DANA', isPopular: true },
  { code: 'ShopeePay', name: 'ShopeePay', isPopular: true },
];

export const COMMON_BANK_NAMES: string[] = [
  'BCA',
  'Mandiri',
  'BRI',
  'BNI',
  'BSI',
  'CIMB',
  'Jago',
  'Seabank',
  'GoPay',
  'OVO',
  'DANA',
  'ShopeePay',
];

/**
 * Normalizes an account number by removing all whitespace and dashes.
 * Returns empty string if raw is null or undefined.
 */
export function cleanAccountNumber(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/[\s-]/g, '').trim();
}

export interface BeneficiaryValidationResult {
  valid: boolean;
  errors: {
    name?: string;
    bank_name?: string;
    account_number?: string;
  };
}

/**
 * Validates beneficiary fields for saving to database.
 */
export function validateBeneficiary(input: {
  name?: string | null;
  bank_name?: string | null;
  account_number?: string | null;
}): BeneficiaryValidationResult {
  const errors: BeneficiaryValidationResult['errors'] = {};

  const name = (input.name ?? '').trim();
  if (name.length < 2) {
    errors.name = 'Label nama penerima minimal 2 huruf.';
  }

  const bankName = (input.bank_name ?? '').trim();
  if (bankName.length < 2) {
    errors.bank_name = 'Pilih atau isi nama bank / e-wallet tujuan.';
  }

  const cleanedNumber = cleanAccountNumber(input.account_number);
  if (!cleanedNumber) {
    errors.account_number = 'Nomor rekening wajib diisi.';
  } else if (cleanedNumber.length < 4) {
    errors.account_number = 'Nomor rekening minimal 4 digit.';
  } else if (cleanedNumber.length > 34) {
    errors.account_number = 'Nomor rekening maksimal 34 karakter.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Formats a beneficiary's transfer details for clipboard copying.
 * Produces clean string e.g. "BCA 1234567890 a.n. Budi Santoso"
 * or just "BCA 1234567890" if account holder name is absent.
 */
export function formatBeneficiaryForClipboard(beneficiary: {
  bank_name: string;
  account_number: string;
  account_holder_name?: string | null;
  name?: string | null;
}): string {
  const bank = (beneficiary.bank_name ?? '').trim();
  const num = cleanAccountNumber(beneficiary.account_number);
  const holder = (beneficiary.account_holder_name ?? '').trim();

  if (holder) {
    return `${bank} ${num} a.n. ${holder}`.trim();
  }
  return `${bank} ${num}`.trim();
}

/**
 * Returns a display badge label for the bank, e.g. "BCA", "MANDIRI", "GOPAY".
 */
export function formatBankBadge(bankName: string | null | undefined): string {
  const b = (bankName ?? '').trim();
  return b.toUpperCase() || 'BANK';
}

/**
 * Formats account number with chunked spaces (every 4 digits) for easier visual scanning,
 * or returns clean string if it contains letters.
 */
export function formatAccountNumberDisplay(raw: string | null | undefined): string {
  const cleaned = cleanAccountNumber(raw);
  if (!cleaned) return '—';
  // If pure digits and length >= 8, chunk in 4s for readability
  if (/^\d+$/.test(cleaned) && cleaned.length >= 8) {
    return cleaned.replace(/(\d{4})(?=\d)/g, '$1 ');
  }
  return cleaned;
}

/**
 * Formats recipient holder line, e.g. "a.n. Yayasan Al-Azhar" or fallback label.
 */
export function formatBeneficiaryHolder(
  accountHolderName?: string | null,
  fallbackLabel?: string | null
): string | null {
  const holder = (accountHolderName ?? '').trim();
  if (holder) {
    return `a.n. ${holder}`;
  }
  const fallback = (fallbackLabel ?? '').trim();
  return fallback ? `a.n. ${fallback}` : null;
}
