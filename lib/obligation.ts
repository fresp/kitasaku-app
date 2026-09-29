// Kitasaku Phase 5B: loan and obligation presentation rules.
//
// Pure module. It imports only `./format` (which is itself import-free), so
// Vitest can load it — nothing here may transitively reach `react-native`.
//
// Why this exists at all: `Screen 3 - Tanggungan` renders FOUR different loan
// cards depending on state, and `Screen - Detail Pinjaman` renders a fifth
// view of the same row. Four screens deciding for themselves what "overdue"
// means is how a card ends up saying "Berjalan • 20%" on a loan that blew
// through its due date a week ago. Every one of those judgements is here.

import { formatRupiah } from './format';
import { MONTHS_ID } from './zero-based';

export type ObligationType =
  | 'BILL' | 'LOAN' | 'REIMBURSEMENT' | 'INSTALLMENT' | 'DEBT' | 'REIMBURSE';

export type ObligationStatus =
  | 'OPEN' | 'UNPAID' | 'PARTIAL' | 'OVERDUE' | 'SETTLED' | 'CANCELLED';

/** The design's filter row, in its order. */
export type ObligationFilter = 'all' | 'loan' | 'reimburse' | 'installment' | 'bill';

export type RepaymentMode = 'LUMP_NEXT_MONTH' | 'INSTALLMENT' | 'MANUAL';

/**
 * Design copy, verbatim from the "Mode Pembayaran" card. The labels are the
 * whole UI of that card, so they live next to the type rather than in the
 * screen — a second copy is how one screen says "Lunas bln depan" while
 * another says "Bayar penuh bulan depan".
 */
export const REPAYMENT_MODES: { value: RepaymentMode; label: string; hint: string }[] = [
  {
    value: 'LUMP_NEXT_MONTH',
    label: 'Lunas bln depan',
    hint: 'Dilunasi penuh di siklus berikutnya, sekali bayar.',
  },
  {
    value: 'INSTALLMENT',
    label: 'Cicil per siklus',
    hint: 'Dibagi ke jadwal cicilan yang tetap sampai lunas.',
  },
  {
    value: 'MANUAL',
    label: 'Manual',
    hint: 'Nominal ditentukan setiap kali membayar.',
  },
];

export function repaymentModeLabel(mode: RepaymentMode | null | undefined): string | null {
  if (!mode) return null;
  return REPAYMENT_MODES.find((m) => m.value === mode)?.label ?? null;
}

export function isRepaymentMode(v: unknown): v is RepaymentMode {
  return v === 'LUMP_NEXT_MONTH' || v === 'INSTALLMENT' || v === 'MANUAL';
}

// ============ Types and filters ============

/**
 * `DEBT` and `REIMBURSE` are the legacy aliases migration 004 left in the
 * check constraint. Normalizing here means the filter tabs, the type badge and
 * the counterparty copy all treat an old row exactly like a new one — rather
 * than showing "DEBT" as a badge for one family and "Pinjaman" for another.
 */
export function normalizeObligationType(type: string | null | undefined): ObligationType {
  const t = (type ?? '').trim().toUpperCase();
  if (t === 'DEBT') return 'LOAN';
  if (t === 'REIMBURSE') return 'REIMBURSEMENT';
  if (t === 'LOAN' || t === 'REIMBURSEMENT' || t === 'INSTALLMENT' || t === 'BILL') return t;
  return 'BILL';
}

/** Design's type badge: 'Pinjaman' / 'Reimburse' / 'Cicilan' / 'Tagihan'. */
export function obligationTypeLabel(type: string | null | undefined): string {
  switch (normalizeObligationType(type)) {
    case 'LOAN': return 'Pinjaman';
    case 'REIMBURSEMENT': return 'Reimburse';
    case 'INSTALLMENT': return 'Cicilan';
    default: return 'Tagihan';
  }
}

export function obligationFilterOf(type: string | null | undefined): Exclude<ObligationFilter, 'all'> {
  switch (normalizeObligationType(type)) {
    case 'LOAN': return 'loan';
    case 'REIMBURSEMENT': return 'reimburse';
    case 'INSTALLMENT': return 'installment';
    default: return 'bill';
  }
}

export function matchesObligationFilter(
  type: string | null | undefined,
  filter: ObligationFilter
): boolean {
  return filter === 'all' || obligationFilterOf(type) === filter;
}

export function isSettled(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toUpperCase();
  return s === 'SETTLED' || s === 'CANCELLED';
}

// ============ Dates ============

/**
 * Whole days from `fromISO` to `toISO`, both `YYYY-MM-DD`. Parsed in UTC so a
 * device in Jakarta (UTC+7) and one in UTC agree on how many days late a bill
 * is; a local-midnight parse would produce an off-by-one for half the planet.
 * Returns null when either side is missing or unparseable.
 */
export function daysBetween(
  fromISO: string | null | undefined,
  toISO: string | null | undefined
): number | null {
  const a = parseDateOnly(fromISO);
  const b = parseDateOnly(toISO);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

function parseDateOnly(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Range-check before building the timestamp. `Date.UTC` ROLLS OVER rather
  // than rejecting, so `2026-13-01` would come back as 1 Jan 2027 and render
  // as a plausible-looking due date — a typo silently becoming a real date is
  // worse than showing nothing.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const t = Date.UTC(year, month - 1, day);
  if (Number.isNaN(t)) return null;
  // Reject a day the month does not have (31 Feb -> 3 Mar): the round trip must
  // land on the same calendar day we asked for.
  const d = new Date(t);
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return t;
}

/** `2026-10-25` -> `25 Okt 2026`. The design's "Jatuh tempo: 25 Okt 2026". */
export function longDateLabel(iso: string | null | undefined): string | null {
  const t = parseDateOnly(iso);
  if (t === null) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS_ID[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `2026-10-25` -> `25 Okt`. Short form for a card's due line. */
export function shortDateLabel(iso: string | null | undefined): string | null {
  const t = parseDateOnly(iso);
  if (t === null) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS_ID[d.getUTCMonth()]}`;
}

/**
 * Spelled-out month names. `MONTHS_ID` is the three-letter form used on cards
 * and chart axes; a sentence like "Diterima 25 September 2026" needs the full
 * word, and `Intl` in Hermes is not guaranteed to have the Indonesian locale
 * data, so the names are spelled out here rather than localized at runtime.
 */
const MONTHS_ID_LONG = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** `2026-09-25` -> `25 September 2026`. For prose, not for dense rows. */
export function longDateFullLabel(iso: string | null | undefined): string | null {
  const t = parseDateOnly(iso);
  if (t === null) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS_ID_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ============ Loan state ============

export type LoanState = 'OPEN' | 'RUNNING' | 'OVERDUE' | 'SETTLED' | 'CANCELLED';

export interface LoanStateInput {
  status?: string | null;
  total_amount?: number | null;
  remaining_amount?: number | null;
  due_date?: string | null;
}

/** Paid-to-date, floored at 0, capped at the total. */
export function paidAmount(total: number | null | undefined, remaining: number | null | undefined): number {
  const t = Math.max(0, Number(total) || 0);
  const r = Math.max(0, Number(remaining) || 0);
  return Math.max(0, Math.min(t, t - r));
}

/** Progress in whole percent, 0–100. A 0-total obligation is 0%, never NaN. */
export function progressPct(total: number | null | undefined, remaining: number | null | undefined): number {
  const t = Math.max(0, Number(total) || 0);
  if (t <= 0) return 0;
  return Math.round((paidAmount(total, remaining) / t) * 100);
}

/**
 * Which of the design's four cards this obligation gets.
 *
 * Order is deliberate. `SETTLED`/`CANCELLED` win outright — there is nothing to
 * chase. **`OVERDUE` is checked before `RUNNING`**, which is the case the naive
 * implementation gets wrong: a loan 20% paid and three days past its due date
 * is not "Berjalan • 20%", it is late, and "Segera bayar" is the only useful
 * thing to say about it.
 *
 * The overdue verdict is derived from the DATE, not just the stored status.
 * Nothing sweeps `OPEN` -> `OVERDUE` on a schedule, so trusting the status
 * alone would leave a bill silent on the day after it was due — exactly when it
 * matters. A stored `OVERDUE` with a future date is still treated as overdue:
 * someone marked it on purpose.
 *
 * `todayISO` is a parameter so this stays pure; the caller decides what today is.
 */
export function loanState(o: LoanStateInput, todayISO: string): LoanState {
  const status = (o.status ?? '').trim().toUpperCase();
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'SETTLED') return 'SETTLED';

  const remaining = Math.max(0, Number(o.remaining_amount) || 0);
  if (remaining <= 0) return 'SETTLED';

  if (status === 'OVERDUE') return 'OVERDUE';
  const late = daysBetween(o.due_date, todayISO);
  if (late !== null && late > 0) return 'OVERDUE';

  const paid = paidAmount(o.total_amount, o.remaining_amount);
  return paid > 0 ? 'RUNNING' : 'OPEN';
}

export interface ObligationBadge {
  label: string;
  tone: 'pending' | 'paid' | 'alert' | 'default';
}

/** The badge on the card header, matching the design's four states. */
export function obligationBadge(state: LoanState, pct: number): ObligationBadge {
  switch (state) {
    case 'SETTLED': return { label: `Lunas • ${pct}%`, tone: 'paid' };
    case 'CANCELLED': return { label: 'Dibatalkan', tone: 'default' };
    case 'OVERDUE': return { label: 'Jatuh Tempo!', tone: 'pending' };
    case 'RUNNING': return { label: `Berjalan • ${pct}%`, tone: 'alert' };
    default: return { label: 'Belum dibayar', tone: 'pending' };
  }
}

/**
 * The sub-line under a late card: "Terlambat 3 hari • Segera bayar". Null when
 * there is nothing concrete to say, so the caller falls back rather than
 * printing "Terlambat 0 hari".
 */
export function overdueNote(dueISO: string | null | undefined, todayISO: string): string | null {
  const late = daysBetween(dueISO, todayISO);
  if (late === null) return 'Segera bayar sebelum jatuh tempo berikutnya.';
  if (late <= 0) return 'Jatuh tempo hari ini • Segera bayar';
  return `Terlambat ${late} hari • Segera bayar`;
}

// ============ Copy ============

/**
 * "Pemberi: Pihak Eksternal" for money we owe a lender, "Kepada: Bengkel AHASS"
 * for a bill or a reimbursement. The preposition is the whole point: getting it
 * backwards on a loan card tells the family they are owed money they owe.
 */
export function counterpartyLabel(
  type: string | null | undefined,
  recipient: string | null | undefined
): string | null {
  const who = (recipient ?? '').trim();
  if (!who) return null;
  return normalizeObligationType(type) === 'LOAN' ? `Pemberi: ${who}` : `Kepada: ${who}`;
}

/** Design's "Total Rp 10.000.000 • Sudah dibayar Rp 2.000.000 • Sisa Rp 8.000.000". */
export function loanBreakdownText(o: {
  total_amount?: number | null;
  remaining_amount?: number | null;
}): string {
  const total = Math.max(0, Number(o.total_amount) || 0);
  const remaining = Math.max(0, Number(o.remaining_amount) || 0);
  return `Total ${formatRupiah(total)} • Sudah dibayar ${formatRupiah(paidAmount(total, remaining))} • Sisa ${formatRupiah(remaining)}`;
}

/**
 * The "already paid" cue under the progress bar. Design copy is
 * "Sudah dibayar: Rp 1.500.000 (75%) · Mandiri · 26 Sep" for a payment that
 * happened, and "Sudah dibayar: Rp 0 (0%) · Belum ada pembayaran" for one that
 * did not — the second half of the sentence is the whole message, so it is not
 * dropped for being obvious.
 *
 * Takes the latest payment only: this is a one-line cue, not a ledger, and the
 * Detail Pinjaman screen is where the full history lives.
 */
export function paidCue(
  history: { date?: string | null; amount?: number | null; account?: string | null }[],
  pct: number
): string {
  if (history.length === 0) return 'Sudah dibayar: Rp 0 (0%) · Belum ada pembayaran';
  const total = history.reduce((s, h) => s + Math.max(0, Number(h.amount) || 0), 0);
  const latest = history[0];
  const bits = [`${formatRupiah(total)} (${pct}%)`];
  const account = (latest.account ?? '').trim();
  if (account) bits.push(account);
  const date = shortDateLabel(latest.date);
  if (date) bits.push(date);
  return `Sudah dibayar: ${bits.join(' · ')}`;
}

/** Design's "Pokok: Rp 2.000.000 · Bunga: Rp 0 · Sisa: Rp 500.000". */
export function principalInterestText(o: {
  total_amount?: number | null;
  remaining_amount?: number | null;
  interest_fee_amount?: number | null;
}): string {
  const total = Math.max(0, Number(o.total_amount) || 0);
  const remaining = Math.max(0, Number(o.remaining_amount) || 0);
  const interest = Math.max(0, Number(o.interest_fee_amount) || 0);
  // The stored total already includes interest (Phase 2B), so "pokok" is what
  // is left after taking it back out — announcing the full total as principal
  // would overstate the debt by exactly the interest.
  const principal = Math.max(0, total - interest);
  return `Pokok: ${formatRupiah(principal)} · Bunga: ${formatRupiah(interest)} · Sisa: ${formatRupiah(remaining)}`;
}

export interface PlanInfo {
  /** "Rencana: Rp 2.000.000 / siklus", or a plan with no fixed amount. */
  plan: string;
  /** "Jatuh tempo: 25 Okt 2026" — the whole string, since it is coloured apart. */
  due: string | null;
  /** "Bunga: Rp 0". */
  interest: string;
}

/**
 * Design's Plan Info Row: "Rencana: Rp 2.000.000 / siklus" • "Jatuh tempo: 25
 * Okt 2026" • "Bunga: Rp 0".
 *
 * The plan column reports what the family CHOSE (`repayment_mode`), not what the
 * numbers imply, because the two can disagree: a loan with `installment_count`
 * of 1 and no chosen mode derives as MANUAL, and printing "Rp X / siklus" for it
 * would invent a schedule nobody set. When a mode is INTEREST-bearing the
 * interest is named here as well, so the row totals what the loan really costs.
 */
export function planInfo(o: {
  repayment_mode?: string | null;
  installment_count?: number | null;
  planned_installment_amount?: number | null;
  total_amount?: number | null;
  due_date?: string | null;
  interest_fee_amount?: number | null;
}): PlanInfo {
  const interest = Math.max(0, Number(o.interest_fee_amount) || 0);
  const total = Math.max(0, Number(o.total_amount) || 0);
  const count = Number(o.installment_count) || 0;
  const perCycle = Number(o.planned_installment_amount) || 0;
  const { mode } = repaymentModeOf(o);

  const plan =
    mode === 'INSTALLMENT'
      ? perCycle > 0
        ? `Rencana: ${formatRupiah(perCycle)} / siklus${count > 1 ? ` (${count}x)` : ''}`
        : 'Rencana: cicilan per siklus'
      : mode === 'LUMP_NEXT_MONTH'
        ? `Rencana: Lunas ${formatRupiah(total)} di siklus berikutnya`
        : 'Rencana: Manual, nominal ditentukan saat bayar';

  const due = longDateLabel(o.due_date);

  return {
    plan,
    due: due ? `Jatuh tempo: ${due}` : null,
    interest: `Bunga: ${formatRupiah(interest)}`,
  };
}

/** "2 dari 5 cicilan" — null when the obligation has no schedule. */
export function installmentProgressLabel(
  installments: { status: ObligationStatus | string; paid_amount?: number | null; planned_amount?: number | null }[]
): string | null {
  if (installments.length === 0) return null;
  const done = installments.filter(
    (i) => i.status === 'SETTLED'
      || i.status === 'CANCELLED'
      || (i.paid_amount != null
        && i.planned_amount != null
        && Number(i.planned_amount) > 0
        && Number(i.paid_amount) >= Number(i.planned_amount))
  ).length;
  return `${done} dari ${installments.length} cicilan`;
}

export interface InstallmentLike {
  id?: string;
  status: ObligationStatus | string;
  due_date?: string | null;
  planned_amount?: number | null;
  paid_amount?: number | null;
}

/**
 * First installment still owed, by due date with undated rows last. Undated
 * rows sort last because a dated one is a real commitment and an undated one is
 * a "someday" — surfacing the vague one first would hide the deadline.
 */
export function nextOpenInstallment<T extends InstallmentLike>(installments: T[]): T | null {
  const open = installments.filter((i) => !isSettled(i.status));
  if (open.length === 0) return null;
  const dated = open.filter((i) => !!i.due_date).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));
  return dated[0] ?? open[0] ?? null;
}

/**
 * Which installment the family is on, 1-based — derived from the money that
 * actually moves, never from the stored counters.
 *
 * Two columns look like they hold this answer and do not. `current_installment`
 * is written once as `1` when the loan is created (005:116) and has no UPDATE
 * anywhere, so reading it pins every loan at "Cicilan ke-1 dari N" forever.
 * `obligation_installments.status` is likewise only ever INSERTed as `'OPEN'`
 * (005:218), with no trigger to settle a row — so counting `SETTLED` rows, the
 * obvious alternative, is always zero. Both are systematic wrong answers on the
 * screen a family uses to decide the cycle's allocation.
 *
 * `remaining_amount` is the one field every payment path decrements — both
 * `useMarkAsPaid` (lib/queries.ts) and the `allocate_debt_payment` RPC
 * (004:437) — so the paid-to-date it yields is the only input here that
 * changes over time. `planned_installment_amount` is the equal per-installment
 * split the schedule was generated from (005:114, computed as total / count),
 * so dividing one by the other counts how many installments the money has
 * covered. A partial payment inside an installment floors to that same
 * installment, which is the honest reading.
 *
 * Returns null when there is no schedule to number — a single payment or a
 * manual plan — so the caller drops the label rather than inventing an
 * ordinal. The result is capped at `installment_count` so a rounding overshoot
 * on the final installment cannot print "ke-6 dari 5".
 */
export function currentInstallmentNumber(o: {
  total_amount?: number | null;
  remaining_amount?: number | null;
  planned_installment_amount?: number | null;
  installment_count?: number | null;
}): number | null {
  const count = Math.floor(Number(o.installment_count) || 0);
  const perCycle = Number(o.planned_installment_amount) || 0;
  if (count <= 1 || perCycle <= 0) return null;
  const paid = paidAmount(o.total_amount, o.remaining_amount);
  return Math.min(count, Math.floor(paid / perCycle) + 1);
}

// ============ Repayment mode ============

export interface RepaymentModeInput {
  repayment_mode?: string | null;
  installment_count?: number | null;
}

export interface RepaymentModeChoice {
  mode: RepaymentMode;
  /** True when nothing was ever stored and this was inferred. */
  derived: boolean;
}

/**
 * The mode to SHOW. A stored value always wins — someone tapped it.
 *
 * With nothing stored, this infers a *display* default and flags it as
 * `derived`, so the screen can say the plan is a guess rather than pretend
 * someone chose it. The inference is narrow on purpose: an existing schedule
 * means INSTALLMENT (there is literally a split sitting in the database), and
 * anything else is MANUAL. It never guesses LUMP_NEXT_MONTH, because "we will
 * clear this next cycle" is a decision, not a default — and defaulting to it
 * would make an unpaid loan look like it had a plan.
 */
export function repaymentModeOf(o: RepaymentModeInput): RepaymentModeChoice {
  if (isRepaymentMode(o.repayment_mode)) {
    return { mode: o.repayment_mode, derived: false };
  }
  const count = Number(o.installment_count) || 0;
  return { mode: count > 1 ? 'INSTALLMENT' : 'MANUAL', derived: true };
}

// ============ Backlog overview ============

export interface BacklogInput {
  type?: string | null;
  status?: string | null;
  remaining_amount?: number | null;
}

export interface ObligationBacklog {
  total: number;
  activeCount: number;
  loanTotal: number;
  reimburseTotal: number;
  /** Design's eyebrow: "TOTAL KEWAJIBAN TERBUKA • 2 AKTIF". */
  eyebrow: string;
  /** Design's sub-line: "Rp 10.000.000 pinjaman • Rp 500.000 reimburse". */
  sub: string;
}

/**
 * The dark overview card. Only open rows count — a settled obligation is not
 * part of what the family still owes, and including it would inflate the number
 * the whole screen is about.
 */
export function obligationBacklog(rows: BacklogInput[]): ObligationBacklog {
  const open = rows.filter((r) => !isSettled(r.status) && (Number(r.remaining_amount) || 0) > 0);
  let total = 0;
  let loanTotal = 0;
  let reimburseTotal = 0;
  for (const r of open) {
    const amount = Math.max(0, Number(r.remaining_amount) || 0);
    total += amount;
    const filter = obligationFilterOf(r.type);
    if (filter === 'loan') loanTotal += amount;
    else if (filter === 'reimburse') reimburseTotal += amount;
  }
  const parts: string[] = [];
  if (loanTotal > 0) parts.push(`${formatRupiah(loanTotal)} pinjaman`);
  if (reimburseTotal > 0) parts.push(`${formatRupiah(reimburseTotal)} reimburse`);
  return {
    total,
    activeCount: open.length,
    loanTotal,
    reimburseTotal,
    eyebrow: `TOTAL KEWAJIBAN TERBUKA • ${open.length} AKTIF`,
    sub: parts.length > 0 ? parts.join(' • ') : 'Kewajiban independen di luar rutinitas bulanan',
  };
}

/** Counts per filter tab, for the "(3)" suffix. Settled rows are excluded. */
export function obligationFilterCounts(rows: BacklogInput[]): Record<ObligationFilter, number> {
  const counts: Record<ObligationFilter, number> = {
    all: 0, loan: 0, reimburse: 0, installment: 0, bill: 0,
  };
  for (const r of rows) {
    if (isSettled(r.status) || (Number(r.remaining_amount) || 0) <= 0) continue;
    counts.all += 1;
    counts[obligationFilterOf(r.type)] += 1;
  }
  return counts;
}
