/**
 * Deterministic installment schedule calculations shared by the form preview
 * and the database-facing financing mutation.
 *
 * All amounts are integer rupiah. Fixed installments split the principal into
 * equal total payments; floating installments split principal evenly and add
 * monthly interest to the principal outstanding at the start of each period.
 * The final principal row absorbs the division remainder so the schedule
 * always repays exactly the requested principal.
 */

export type InstallmentMode = 'FIXED_INSTALLMENT' | 'FLOATING_INTEREST';

export interface InstallmentScheduleInput {
  principalAmount: number;
  tenor: number;
  monthlyInterestRateBps?: number;
  mode: InstallmentMode;
}

export interface InstallmentScheduleRow {
  installmentNumber: number;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  remainingPrincipal: number;
}

const MAX_TENOR = 600;
const BPS = 10_000;

function integer(value: number): number {
  return Math.floor(value);
}

/**
 * Build a schedule without floating-point money drift.
 *
 * Interest is rounded half-up to the nearest rupiah from the outstanding
 * principal at the beginning of each period. The last principal amount is the
 * exact remaining balance, which makes the principal sum invariant.
 */
export function calculateInstallmentSchedule(
  input: InstallmentScheduleInput,
): InstallmentScheduleRow[] {
  const principal = integer(input.principalAmount);
  const tenor = integer(input.tenor);
  const rateBps = integer(input.monthlyInterestRateBps ?? 0);

  if (!Number.isSafeInteger(principal) || principal <= 0) return [];
  if (!Number.isSafeInteger(tenor) || tenor < 1 || tenor > MAX_TENOR) return [];
  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 100_000) return [];

  const fixedPrincipal = Math.floor(principal / tenor);
  if (fixedPrincipal < 1 && tenor > 1) return [];

  const rows: InstallmentScheduleRow[] = [];
  let remaining = principal;
  for (let number = 1; number <= tenor; number += 1) {
    const principalAmount = number === tenor ? remaining : fixedPrincipal;
    const interestAmount = input.mode === 'FLOATING_INTEREST'
      ? Math.floor((remaining * rateBps + BPS / 2) / BPS)
      : 0;
    const totalAmount = principalAmount + interestAmount;
    remaining -= principalAmount;

    rows.push({
      installmentNumber: number,
      principalAmount,
      interestAmount,
      totalAmount,
      remainingPrincipal: remaining,
    });
  }

  return rows;
}

export function scheduleTotal(rows: InstallmentScheduleRow[]): number {
  return rows.reduce((total, row) => total + row.totalAmount, 0);
}

export function schedulePrincipal(rows: InstallmentScheduleRow[]): number {
  return rows.reduce((total, row) => total + row.principalAmount, 0);
}

export function scheduleInterest(rows: InstallmentScheduleRow[]): number {
  return rows.reduce((total, row) => total + row.interestAmount, 0);
}
