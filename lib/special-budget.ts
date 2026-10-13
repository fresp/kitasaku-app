// Anggaran Khusus (special budgets) — pure domain module, mirrors migration 032.
//
// A special budget is a lens over ordinary transactions, not a place where
// money lives. Money stays in accounts; balances and reconciliation count every
// row. What changes is which budget a row is read against:
//
//   * a transaction tagged with special_budget_id is excluded from the cycle's
//     zero-based figures and counted here instead;
//   * funding from the cycle is an OTHER cycle_allocations row naming the
//     budget, so the cycle sees an allocation while no cash moves.
//
//   fundsIn   = executed tagged OPERATING_INCOME + FINANCING_INFLOW + ASSET_RELEASE
//             + live cycle allocations naming the budget
//   spent     = executed tagged EXPENSE
//   movedOut  = executed tagged ASSET_ALLOCATION (remaining moved to savings at close)
//   remaining = fundsIn − spent − movedOut
//
// `special_budget_remaining()` in SQL computes the same figure; keep them equal.

import { normalizeAmount, defaultFlowType } from './zero-based';
import type { FlowType } from './zero-based';

export type SpecialBudgetStatus = 'UPCOMING' | 'RUNNING' | 'ENDED_OPEN' | 'CLOSED';
export type SpecialBudgetCloseDestination = 'CYCLE' | 'ASSET' | 'NONE';

export interface SpecialBudget {
  id: string;
  household_id: string;
  name: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  start_date: string;
  /** ISO date (YYYY-MM-DD), inclusive. A planning hint, not a lock. */
  end_date: string;
  /** The only lock: set by close_special_budget(), terminal. */
  closed_at: string | null;
  closed_by: string | null;
  close_destination: SpecialBudgetCloseDestination | null;
  closed_remaining: number | null;
  created_by: string | null;
  created_at: string;
}

export interface SpecialBudgetTxnRow {
  special_budget_id: string | null;
  direction: 'INCOME' | 'EXPENSE';
  flow_type?: FlowType | null;
  obligation_id?: string | null;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  actual_amount: number;
  cancelled_at?: string | null;
}

export interface SpecialBudgetAllocationRow {
  special_budget_id: string | null;
  amount: number;
  cancelled_at?: string | null;
}

export interface SpecialBudgetFigures {
  fromIncome: number;
  fromFinancing: number;
  fromAssets: number;
  fromCycle: number;
  fundsIn: number;
  spent: number;
  movedOut: number;
  /** Negative when spending outran the money that came in. */
  remaining: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * Derived, never stored. `end_date` passing does not close anything: closing
 * is a money decision (where the remainder goes) and late rows are normal — a
 * card bill, the builder's last payment, a receipt typed in a week later.
 */
export function specialBudgetStatus(budget: SpecialBudget, todayISO: string): SpecialBudgetStatus {
  if (budget.closed_at) return 'CLOSED';
  if (todayISO < budget.start_date) return 'UPCOMING';
  if (todayISO > budget.end_date) return 'ENDED_OPEN';
  return 'RUNNING';
}

/** Days since `end_date`, 0 while it has not passed. Drives the Home reminder copy. */
export function daysPastEnd(budget: SpecialBudget, todayISO: string): number {
  return Math.max(0, dayNumber(todayISO) - dayNumber(budget.end_date));
}

function isLive(row: { status: string; cancelled_at?: string | null }): boolean {
  return row.status === 'PAID' && !row.cancelled_at;
}

export function specialBudgetFigures(
  budgetId: string,
  txns: SpecialBudgetTxnRow[],
  allocations: SpecialBudgetAllocationRow[],
): SpecialBudgetFigures {
  let fromIncome = 0, fromFinancing = 0, fromAssets = 0, fromCycle = 0, spent = 0, movedOut = 0;

  for (const t of txns) {
    if (t.special_budget_id !== budgetId || !isLive(t)) continue;
    const amount = normalizeAmount(t.actual_amount);
    const flow = t.flow_type ?? defaultFlowType(t.direction, t.obligation_id ?? null);
    if (flow === 'OPERATING_INCOME') fromIncome += amount;
    else if (flow === 'FINANCING_INFLOW') fromFinancing += amount;
    else if (flow === 'ASSET_RELEASE') fromAssets += amount;
    else if (flow === 'EXPENSE') spent += amount;
    else if (flow === 'ASSET_ALLOCATION') movedOut += amount;
  }
  for (const a of allocations) {
    if (a.special_budget_id !== budgetId || a.cancelled_at) continue;
    fromCycle += normalizeAmount(a.amount);
  }

  const fundsIn = fromIncome + fromFinancing + fromAssets + fromCycle;
  return {
    fromIncome, fromFinancing, fromAssets, fromCycle,
    fundsIn, spent, movedOut,
    remaining: fundsIn - spent - movedOut,
  };
}

/**
 * Splits an account balance into what the cycle may use and what open special
 * budgets still claim. Only positive remainders are claimed: a deficit was
 * already paid out of the account, so adding it back would overstate the cycle.
 * Pass remainders of open (not closed) budgets only.
 */
export function cyclePortion(balance: number, openRemainders: number[]): { cycle: number; budgets: number } {
  const budgets = openRemainders.reduce((s, r) => s + Math.max(0, r), 0);
  return { cycle: balance - budgets, budgets };
}

/**
 * Budgets Quick Add offers as a destination for a row dated `dateISO`. Never a
 * default: the cycle is always preselected, because a long-running budget
 * (a three-month renovation) would otherwise swallow routine spending.
 */
export function quickAddBudgets(budgets: SpecialBudget[], dateISO: string): SpecialBudget[] {
  return budgets
    .filter((b) => specialBudgetStatus(b, dateISO) === 'RUNNING')
    .sort((a, b) => a.end_date.localeCompare(b.end_date) || a.name.localeCompare(b.name));
}

/** Where the remainder can go when closing. Nothing left means nothing to choose. */
export function closeOptions(remaining: number): SpecialBudgetCloseDestination[] {
  return remaining === 0 ? ['NONE'] : ['CYCLE', 'ASSET'];
}

export function validateSpecialBudgetInput(input: {
  name: string; startDate: string; endDate: string;
}): string | null {
  const name = input.name.trim();
  if (!name) return 'Nama anggaran khusus wajib diisi.';
  if (name.length > 60) return 'Nama anggaran khusus maksimal 60 karakter.';
  if (!ISO_DATE.test(input.startDate) || !ISO_DATE.test(input.endDate)) {
    return 'Tanggal mulai dan selesai wajib diisi.';
  }
  if (input.endDate < input.startDate) return 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
  return null;
}

const TAGGABLE_FLOWS: FlowType[] = [
  'OPERATING_INCOME', 'FINANCING_INFLOW', 'ASSET_RELEASE', 'EXPENSE', 'ASSET_ALLOCATION',
];

/**
 * Client mirror of guard_transaction_special_budget() for hiding the picker on
 * rows the database would refuse. The trigger stays the authority.
 */
export function isTaggableTxn(row: {
  flow_type?: FlowType | null;
  direction: 'INCOME' | 'EXPENSE';
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  account_type: string | null | undefined;
  recurring_template_id?: string | null;
  obligation_id?: string | null;
  cancelled_at?: string | null;
}): boolean {
  const flow = row.flow_type ?? defaultFlowType(row.direction, row.obligation_id ?? null);
  return isLive(row)
    && TAGGABLE_FLOWS.includes(flow)
    && (row.account_type === 'BANK' || row.account_type === 'E_WALLET')
    && !row.recurring_template_id
    && !row.obligation_id;
}

/**
 * A Date as the local calendar day. `toISOString()` shifts to UTC, which in
 * Jakarta turns a midnight date picked on the 10th into the 9th.
 */
export function localISODate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export type SpecialBudgetTone = 'default' | 'paid' | 'alert' | 'pending';

export function specialBudgetStatusLabel(status: SpecialBudgetStatus): { label: string; tone: SpecialBudgetTone } {
  switch (status) {
    case 'UPCOMING': return { label: 'Akan datang', tone: 'default' };
    case 'RUNNING': return { label: 'Berjalan', tone: 'paid' };
    case 'ENDED_OPEN': return { label: 'Selesai · belum ditutup', tone: 'alert' };
    default: return { label: 'Ditutup', tone: 'default' };
  }
}

export interface SpecialBudgetAttention {
  budget: SpecialBudget;
  kind: 'ENDED' | 'DEFICIT';
  daysPast: number;
  remaining: number;
}

/**
 * What Home's "Perlu perhatian" shows for special budgets. An ended budget
 * still open needs a close decision; an open budget in deficit is already
 * spending cycle money and must stay visible until it is closed. One row per
 * budget, deficit first because it is the one that misstates the cycle.
 */
export function specialBudgetAttention(
  budgets: SpecialBudget[],
  figures: Record<string, SpecialBudgetFigures | undefined>,
  todayISO: string,
): SpecialBudgetAttention[] {
  const out: SpecialBudgetAttention[] = [];
  for (const b of budgets) {
    const status = specialBudgetStatus(b, todayISO);
    if (status === 'CLOSED') continue;
    const remaining = figures[b.id]?.remaining ?? 0;
    if (remaining < 0) out.push({ budget: b, kind: 'DEFICIT', daysPast: daysPastEnd(b, todayISO), remaining });
    else if (status === 'ENDED_OPEN') out.push({ budget: b, kind: 'ENDED', daysPast: daysPastEnd(b, todayISO), remaining });
  }
  return out.sort((a, b) => (a.kind === b.kind ? b.daysPast - a.daysPast : a.kind === 'DEFICIT' ? -1 : 1));
}
