import { describe, expect, it } from 'vitest';
import { assertEligibleCashAccountForHousehold, isEligibleCashAccountForHousehold } from '../cash-account';

const householdId = 'household-a';
const bank = { household_id: householdId, type: 'BANK', is_active: true };

describe('cash account validation', () => {
  it('accepts active bank and e-wallet accounts in the same household', () => {
    expect(isEligibleCashAccountForHousehold(bank, householdId)).toBe(true);
    expect(isEligibleCashAccountForHousehold({ ...bank, type: 'E_WALLET' }, householdId)).toBe(true);
  });

  it('rejects a missing account, another household, a non-cash type, and an inactive account', () => {
    expect(isEligibleCashAccountForHousehold(null, householdId)).toBe(false);
    expect(isEligibleCashAccountForHousehold({ ...bank, household_id: 'household-b' }, householdId)).toBe(false);
    expect(isEligibleCashAccountForHousehold({ ...bank, type: 'CASH' }, householdId)).toBe(false);
    expect(isEligibleCashAccountForHousehold({ ...bank, type: 'CREDIT_CARD' }, householdId)).toBe(false);
    expect(isEligibleCashAccountForHousehold({ ...bank, is_active: false }, householdId)).toBe(false);
  });

  it('throws a clear error for an account that cannot carry cash allocation', () => {
    expect(() => assertEligibleCashAccountForHousehold(null, householdId))
      .toThrow('Pilih rekening bank atau e-wallet aktif milik household ini.');
  });
});
