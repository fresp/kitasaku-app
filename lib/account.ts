// Account helpers and presentation rules for Flow J - Managed Account
//
// Source of truth: design.pen & migration 010_account_management.sql
// Accounts have:
//   - type: 'BANK' | 'CREDIT_CARD' | 'E_WALLET' | 'CASH'
//   - account_number: full number stored, masked in UI (except in edit form)
//   - account_holder_name: optional owner name
//   - is_active: archive state
//   - sort_order: display order
//   - icon: optional explicit icon, falls back to type-derived default

export type AccountType = 'BANK' | 'CREDIT_CARD' | 'E_WALLET' | 'CASH';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  BANK: 'Rekening bank',
  CREDIT_CARD: 'Kartu kredit',
  E_WALLET: 'E-wallet',
  CASH: 'Tunai',
};

export const ACCOUNT_TYPE_DEFAULT_ICONS: Record<AccountType, string> = {
  BANK: 'landmark',
  CREDIT_CARD: 'credit-card',
  E_WALLET: 'wallet',
  CASH: 'banknote',
};

export const ACCOUNT_ICON_CHOICES = [
  'landmark',
  'credit-card',
  'wallet',
  'banknote',
  'piggy-bank',
  'smartphone',
] as const;

export type AccountIconName = (typeof ACCOUNT_ICON_CHOICES)[number];

/**
 * Returns the effective icon name for an account.
 * If an explicit icon was chosen and is non-empty, use it.
 * Otherwise, fall back to the icon derived from account type.
 */
export function resolveAccountIcon(type: string, icon?: string | null): string {
  if (icon && icon.trim().length > 0) {
    return icon.trim();
  }
  return ACCOUNT_TYPE_DEFAULT_ICONS[type as AccountType] ?? 'wallet';
}

/**
 * Normalizes an account number by removing all whitespace and dashes.
 * Returns null if the resulting string is empty.
 */
export function normalizeAccountNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s-]/g, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Validates an account number against database constraint:
 * Must be null/empty, or between 4 and 34 characters after normalization.
 */
export function validateAccountNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s-]/g, '').trim();
  if (cleaned.length === 0) return null;
  if (cleaned.length < 4) return 'Nomor akun minimal 4 digit.';
  if (cleaned.length > 34) return 'Nomor akun maksimal 34 karakter.';
  return null;
}

/**
 * Formats an account number as a masked string e.g. "•• 8821".
 * Uses non-breaking space ( ) so the bullet pair and the last 4 digits never wrap.
 */
export function maskAccountNumber(
  accountNumber?: string | null,
  fallback = ''
): string {
  const cleaned = accountNumber ? accountNumber.replace(/[\s-]/g, '').trim() : '';
  if (!cleaned) return fallback;
  const last4 = cleaned.slice(-4);
  return `•• ${last4}`;
}

/**
 * Computes the second line for an account row/card:
 * - If account_number exists, shows masked number "•• 8821".
 * - If empty, shows the account type label ("Rekening bank", etc.) so the subline is never empty.
 */
export function accountSubline(account: {
  account_number?: string | null;
  type: string;
}): string {
  if (account.account_number && account.account_number.trim().length > 0) {
    return maskAccountNumber(account.account_number);
  }
  return ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type;
}

/**
 * Sorts accounts:
 * By sort_order ascending, ties broken alphabetically by name.
 */
export function sortAccounts<T extends { sort_order?: number; name: string }>(
  accounts: T[]
): T[] {
  return [...accounts].sort((a, b) => {
    const ordA = a.sort_order ?? 0;
    const ordB = b.sort_order ?? 0;
    if (ordA !== ordB) return ordA - ordB;
    return a.name.localeCompare(b.name, 'id');
  });
}

/**
 * The bank account a cycle should use by default, or null when none exists.
 * A bank is the only account whose balance a cycle reconciles against; falling
 * back to a wallet or card would silently choose an invalid primary account.
 * Expects the list already ordered by `sortAccounts`.
 */
export function defaultAccountId<T extends { id: string; type: string; is_active?: boolean | null }>(
  accounts: T[]
): string | null {
  return accounts.find((a) => a.type === 'BANK' && a.is_active !== false)?.id ?? null;
}

/**
 * Resolves the primary BANK for a new cycle. Keep the prior choice when it is
 * still eligible; otherwise use the first active BANK in the ordered list.
 */
export function cyclePrimaryAccountId<T extends { id: string; type: string; is_active?: boolean | null }>(
  accounts: T[],
  priorPrimaryAccountId?: string | null,
): string | null {
  const prior = accounts.find((account) =>
    account.id === priorPrimaryAccountId && account.type === 'BANK' && account.is_active !== false
  );
  return prior?.id ?? defaultAccountId(accounts);
}

/** Bank accounts and e-wallets are the cash accounts eligible for allocation. */
export function isZeroBasedCashAccount(account: { type: string }): boolean {
  return account.type === 'BANK' || account.type === 'E_WALLET';
}
