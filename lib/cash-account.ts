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
