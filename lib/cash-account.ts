import { isZeroBasedCashAccount } from './account';

export interface CashAccountCandidate {
  household_id: string;
  type: string;
  is_active: boolean;
}

/** Returns whether this account can be used for a new cash allocation. */
export function isEligibleCashAccountForHousehold(
  account: CashAccountCandidate | null | undefined,
  householdId: string,
): boolean {
  return !!account
    && account.household_id === householdId
    && account.is_active !== false
    && isZeroBasedCashAccount(account);
}

/** Throws a user-facing error when an executed cash movement lacks a valid account. */
export function assertEligibleCashAccountForHousehold(
  account: CashAccountCandidate | null | undefined,
  householdId: string,
): void {
  if (!isEligibleCashAccountForHousehold(account, householdId)) {
    throw new Error('Pilih rekening bank atau e-wallet aktif milik household ini.');
  }
}

/**
 * Since migration 029 a cycle traces transactions from every account, so
 * confirming an ordinary expense only needs an active account of this
 * household — credit card and cash included. Which accounts count toward the
 * cycle's figures is decided when reading, not here.
 */
export function assertActiveAccountForHousehold(
  account: Pick<CashAccountCandidate, 'household_id' | 'is_active'> | null | undefined,
  householdId: string,
): void {
  if (!account || account.household_id !== householdId || account.is_active === false) {
    throw new Error('Pilih akun aktif milik household ini.');
  }
}
