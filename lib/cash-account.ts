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
 * Cycle-bound rows (planned transactions, recurring templates) may only use
 * BANK / E_WALLET. Returns the accounts among `accountIds` that break that
 * rule; an empty id or one not in `accounts` is not reported here (the DB
 * guard in migration 028 stays the authority).
 */
export function findNonCycleAccounts<T extends { id: string; type: string }>(
  accountIds: (string | null | undefined)[],
  accounts: T[],
): T[] {
  const ids = new Set(accountIds.filter((id): id is string => !!id));
  return accounts.filter((account) => ids.has(account.id) && !isZeroBasedCashAccount(account));
}
