// Kitasaku Phase 5C: the year-over-year analysis behind "Insight & Aset 2026".
//
// Pure module. It imports only `./format` and `./zero-based` (both import-free),
// so Vitest can load it — nothing here may transitively reach `react-native`.
//
// Why a module and not screen logic: the design's screen has seven sections
// that all read the SAME twelve months. Income, expenses, allocations, funding
// gap and asset movement are five views of one dataset, and computing them
// independently in the screen is how the "Sumber Dana vs Alokasi" chart ends up
// disagreeing with the "Plan vs Actual" chart about October. Every section here
// reads one `YearBucket[]`, built once.
//
// Honesty rules this module enforces:
//   * A month with no cycle is not "Rp 0 of spending" — it is `hasCycle: false`,
//     and the screen must not draw a bar for it. Zero and "we have no data" are
//     different claims and the chart must not conflate them.
//   * Asset movement is *allocations*, because the ledger has no assets table.
//     `assetAdditions` is what the family set aside, not a market value, and it
//     is labelled that way on screen.
//   * The "reason" text under a MoM row is not derivable from the data, so this
//     module does not invent one.

import { formatRupiahShort } from './format';
import { MONTHS_ID, defaultFlowType } from './zero-based';
import type { AllocationType, FlowType } from './zero-based';

/**
 * Spelled-out month names, for sentences and selector labels. Kept here rather
 * than derived with `Intl` because Hermes is not guaranteed to ship the
 * Indonesian locale data.
 */
export const MONTHS_ID_FULL = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** `10` -> `Oktober`. Out-of-range months return an empty string, not junk. */
export function monthFullName(month: number): string {
  return MONTHS_ID_FULL[month - 1] ?? '';
}

/** `(10, 2026)` -> `Oktober 2026`, for the month selector and tooltips. */
export function monthYearLabel(month: number, year: number): string {
  const name = monthFullName(month);
  return name ? `${name} ${year}` : '';
}

/** Allocation types that count as "putting money aside" rather than spending. */
export const ASSET_ALLOCATION_TYPES: AllocationType[] = [
  'ASSET', 'SAVINGS', 'INVESTMENT', 'EMERGENCY_FUND',
];

export function isAssetAllocationType(t: AllocationType): boolean {
  return ASSET_ALLOCATION_TYPES.includes(t);
}

export interface InsightCycle {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
}

export interface InsightTxn {
  cycle_id: string | null;
  direction: 'INCOME' | 'EXPENSE';
  flow_type?: FlowType | null;
  obligation_id?: string | null;
  category_id?: string | null;
  planned_amount: number;
  actual_amount: number;
  status: 'PENDING' | 'PAID';
}

export interface InsightAllocation {
  cycle_id: string | null;
  allocation_type: AllocationType;
  amount: number;
  category_id?: string | null;
}

export interface YearBucket {
  month: number;
  /** `Jan` … `Des`, matching the design's month labels. */
  label: string;
  cycleIds: string[];
  /** False when the family had no cycle in this month. Not the same as Rp 0. */
  hasCycle: boolean;

  plannedIncome: number;
  actualIncome: number;
  financingInflow: number;
  assetRelease: number;
  /** Planned source funds. The funding gap is computed against this. */
  sourceTotal: number;
  /** Realised source funds. Only `netCashflow` reads this. */
  actualSourceTotal: number;

  plannedExpense: number;
  actualExpense: number;

  plannedDebtPayment: number;
  actualDebtPayment: number;

  /** Realised cash into asset types, from ASSET_ALLOCATION transactions. */
  actualAssetAllocation: number;
  allocationByType: Record<AllocationType, number>;
  plannedAllocationTotal: number;
  assetAdditions: number;

  fundingGap: number;
  unallocated: number;

  /** Source funds minus outflow; realised where anything was realised. */
  netCashflow: number;
  /** Actual expense per category id, for the month-over-month section. */
  expenseByCategory: Record<string, number>;
  /**
   * Realised debt payment keyed by obligation id.
   *
   * The liability section filters its timeline by obligation TYPE, and the only
   * way to attribute a payment to a type is to keep it per obligation. Summing
   * first and filtering later is impossible — the type is a property of the
   * obligation, not of the money.
   */
  debtPaymentByObligation: Record<string, number>;
}

const EMPTY_BY_TYPE = (): Record<AllocationType, number> => ({
  EXPENSE: 0, DEBT_PAYMENT: 0, ASSET: 0, SAVINGS: 0,
  INVESTMENT: 0, EMERGENCY_FUND: 0, OTHER: 0,
});

function num(v: number | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** `2026-10-25` -> 2026. Null when the string is not a date. */
export function yearOf(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return year;
}

/** `2026-10-25` -> 10. Null when the string is not a date. */
export function monthOf(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return month;
}

/**
 * Which calendar month a cycle belongs to. Cycles are payday-to-payday
 * (25 Oct – 24 Nov), so a cycle straddles two months. The design's charts put
 * "Siklus Nov 2026" on the Nov column, so a cycle is placed by its **end**
 * date — the month it is named for — not its start. Using the start date would
 * file every cycle one month early and shift the whole year by one column.
 */
export function cycleMonth(c: InsightCycle): number | null {
  return monthOf(c.end_date) ?? monthOf(c.start_date);
}

export function cyclesInYear(cycles: InsightCycle[], year: number): InsightCycle[] {
  return cycles.filter((c) => {
    const end = yearOf(c.end_date);
    const start = yearOf(c.start_date);
    return end === year || start === year;
  });
}

function emptyBucket(month: number): YearBucket {
  return {
    month,
    label: MONTHS_ID[month - 1],
    cycleIds: [],
    hasCycle: false,
    plannedIncome: 0,
    actualIncome: 0,
    financingInflow: 0,
    assetRelease: 0,
    sourceTotal: 0,
    actualSourceTotal: 0,
    plannedExpense: 0,
    actualExpense: 0,
    plannedDebtPayment: 0,
    actualDebtPayment: 0,
    actualAssetAllocation: 0,
    allocationByType: EMPTY_BY_TYPE(),
    plannedAllocationTotal: 0,
    assetAdditions: 0,
    fundingGap: 0,
    unallocated: 0,
    netCashflow: 0,
    expenseByCategory: {},
    debtPaymentByObligation: {},
  };
}

/**
 * The one builder every section reads. Twelve buckets, always — a month with no
 * cycle stays in the array with `hasCycle: false` so the chart keeps its x-axis
 * aligned and the reader can see the gap.
 *
 * `year` filters both cycles and rows: a transaction belonging to a cycle
 * outside the year is skipped even if it was created inside it, because the
 * design groups by cycle, not by the wall clock.
 */
export function buildYearBuckets(args: {
  cycles: InsightCycle[];
  txns: InsightTxn[];
  allocations: InsightAllocation[];
  year: number;
  /**
   * Restrict the EXPENSE rows to one category, for the expenses section's
   * "Tagihan / Keperluan Keluarga / Primary" chips.
   *
   * A filter parameter rather than a post-hoc subtraction: filtering a built
   * bucket cannot work, because the realised per-category map has no *planned*
   * counterpart to compare against. Rebuilding with the filter keeps plan and
   * actual on the same subset, which is the only way the variance means
   * anything.
   */
  expenseCategoryId?: string | null;
}): YearBucket[] {
  const buckets = Array.from({ length: 12 }, (_, i) => emptyBucket(i + 1));

  const yearCycles = cyclesInYear(args.cycles, args.year);
  const monthByCycle = new Map<string, number>();
  for (const c of yearCycles) {
    const month = cycleMonth(c);
    if (month === null) continue;
    monthByCycle.set(c.id, month);
    buckets[month - 1].cycleIds.push(c.id);
    buckets[month - 1].hasCycle = true;
  }

  for (const t of args.txns) {
    if (!t.cycle_id) continue;
    const month = monthByCycle.get(t.cycle_id);
    if (month === undefined) continue;
    const b = buckets[month - 1];

    const flow = t.flow_type ?? defaultFlowType(t.direction, t.obligation_id ?? null);
    const planned = num(t.planned_amount);
    const actual = t.status === 'PAID' ? num(t.actual_amount) : 0;

    if (flow === 'OPERATING_INCOME') {
      b.plannedIncome += planned;
      b.actualIncome += actual;
      b.actualSourceTotal += actual > 0 ? actual : planned;
    } else if (flow === 'FINANCING_INFLOW') {
      b.financingInflow += planned;
      // Money that arrived, not money that was spent: financing inflow has no
      // separate realised column, so the planned amount is what was received.
      b.actualSourceTotal += planned;
    } else if (flow === 'ASSET_RELEASE') {
      b.assetRelease += planned;
      b.actualSourceTotal += planned;
    } else if (flow === 'EXPENSE') {
      // A category-filtered build keeps only that category's rows; plan and
      // actual must be dropped together or the variance becomes nonsense.
      if (args.expenseCategoryId && t.category_id !== args.expenseCategoryId) continue;
      b.plannedExpense += planned;
      b.actualExpense += actual;
      if (actual > 0 && t.category_id) {
        b.expenseByCategory[t.category_id] =
          (b.expenseByCategory[t.category_id] ?? 0) + actual;
      }
    } else if (flow === 'DEBT_PAYMENT') {
      b.plannedDebtPayment += planned;
      b.actualDebtPayment += actual;
      if (actual > 0 && t.obligation_id) {
        b.debtPaymentByObligation[t.obligation_id] =
          (b.debtPaymentByObligation[t.obligation_id] ?? 0) + actual;
      }
    } else if (flow === 'ASSET_ALLOCATION') {
      // Classified by `flow_type`, never by `direction` — the Phase 1 rule at
      // the head of lib/zero-based.ts. An asset allocation is cash leaving the
      // account to become a position, so `direction` is only a cash-sign hint
      // that a row can carry wrong; branching on it here would silently drop
      // the row from the asset trend instead of counting it.
      b.actualAssetAllocation += actual;
    }
  }

  for (const a of args.allocations) {
    if (!a.cycle_id) continue;
    const month = monthByCycle.get(a.cycle_id);
    if (month === undefined) continue;
    const b = buckets[month - 1];
    const amount = Math.max(0, num(a.amount));
    b.allocationByType[a.allocation_type] += amount;
    b.plannedAllocationTotal += amount;
    if (isAssetAllocationType(a.allocation_type)) b.assetAdditions += amount;
  }

  for (const b of buckets) {
    b.sourceTotal = b.plannedIncome + b.financingInflow + b.assetRelease;
    // Required allocation is the planned total, never the transaction sum — the
    // anti-double-count rule from Phase 1. Transaction flow_type classifies
    // ledger rows; only cycle_allocations define what the month committed to.
    b.fundingGap = Math.max(b.plannedAllocationTotal - b.sourceTotal, 0);
    b.unallocated = Math.max(b.sourceTotal - b.plannedAllocationTotal, 0);

    // Realised where anything has been realised, planned otherwise: a closed
    // month should show what happened, a future month what is expected.
    //
    // Both sides must be on the SAME basis. An earlier version compared
    // planned source funds against realised outflow, which made a month that
    // earned 10jt and spent 7jt report a 3jt surplus while a month that planned
    // the same numbers reported 4jt — the two were not the same claim. The
    // realised inflow figure rides along in `actualSourceTotal` so the
    // comparison is apples to apples either way.
    const hasRealised = b.actualExpense > 0 || b.actualDebtPayment > 0 || b.actualIncome > 0;
    b.netCashflow = hasRealised
      ? b.actualSourceTotal - (b.actualExpense + b.actualDebtPayment)
      : b.sourceTotal - (b.plannedExpense + b.plannedDebtPayment);
  }

  return buckets;
}

// ============ Annual totals and the summary grid ============

export interface AnnualTotals {
  plannedIncome: number;
  actualIncome: number;
  financingInflow: number;
  assetRelease: number;
  sourceTotal: number;
  plannedExpense: number;
  actualExpense: number;
  debtPayment: number;
  assetAdditions: number;
  /** Months whose planned allocation was fully covered by source funds. */
  coveredMonths: number;
  /** Months whose required allocation exceeded source funds. */
  gapMonths: number;
  monthsWithCycle: number;
  /** `Rp 13,7jt` over: actual expense minus planned expense. */
  expenseVariance: number;
  bestIncomeMonth: { month: number; value: number } | null;
  lowestIncomeMonth: { month: number; value: number } | null;
  avgIncome: number;
  avgExpense: number;
}

export function annualTotals(buckets: YearBucket[]): AnnualTotals {
  const active = buckets.filter((b) => b.hasCycle);
  let plannedIncome = 0, actualIncome = 0, financingInflow = 0, assetRelease = 0;
  let plannedExpense = 0, actualExpense = 0, debtPayment = 0, assetAdditions = 0;
  let coveredMonths = 0, gapMonths = 0;

  for (const b of buckets) {
    plannedIncome += b.plannedIncome;
    actualIncome += b.actualIncome;
    financingInflow += b.financingInflow;
    assetRelease += b.assetRelease;
    plannedExpense += b.plannedExpense;
    actualExpense += b.actualExpense;
    debtPayment += b.actualDebtPayment;
    assetAdditions += b.assetAdditions;
    if (b.hasCycle) {
      if (b.fundingGap > 0) gapMonths += 1;
      else coveredMonths += 1;
    }
  }

  // "Best month" is about income actually received, so it ranks on the realised
  // figure and ignores months with no cycle — an empty month is not a low-income
  // month, it is a month we know nothing about.
  let best: { month: number; value: number } | null = null;
  let lowest: { month: number; value: number } | null = null;
  for (const b of active) {
    const v = b.actualIncome > 0 ? b.actualIncome : b.plannedIncome;
    if (v <= 0) continue;
    if (!best || v > best.value) best = { month: b.month, value: v };
    if (!lowest || v < lowest.value) lowest = { month: b.month, value: v };
  }

  const incomeMonths = active.filter((b) => b.actualIncome > 0 || b.plannedIncome > 0).length;
  const expenseMonths = active.filter((b) => b.actualExpense > 0).length;

  return {
    plannedIncome,
    actualIncome,
    financingInflow,
    assetRelease,
    sourceTotal: plannedIncome + financingInflow + assetRelease,
    plannedExpense,
    actualExpense,
    debtPayment,
    assetAdditions,
    coveredMonths,
    gapMonths,
    monthsWithCycle: active.length,
    expenseVariance: actualExpense - plannedExpense,
    bestIncomeMonth: best,
    lowestIncomeMonth: lowest,
    avgIncome: incomeMonths > 0 ? Math.round((actualIncome || plannedIncome) / incomeMonths) : 0,
    avgExpense: expenseMonths > 0 ? Math.round(actualExpense / expenseMonths) : 0,
  };
}

/**
 * Running total of asset allocations, month by month. The design's "Akumulasi"
 * view. The first month's value is its own addition, not a carried-in balance —
 * the ledger has no opening balance to carry.
 */
export function accumulateAssets(buckets: YearBucket[]): number[] {
  let running = 0;
  return buckets.map((b) => {
    running += b.assetAdditions;
    return running;
  });
}

export function assetSummary(buckets: YearBucket[]) {
  const series = accumulateAssets(buckets);
  const total = series.length > 0 ? series[series.length - 1] : 0;
  const firstMonth = buckets.find((b) => b.hasCycle);
  const firstIdx = firstMonth ? firstMonth.month - 1 : 0;
  const opening = series[firstIdx] ?? 0;
  const growth = total - opening;

  // Largest contributor by allocation type across the year, so "Dana Darurat
  // (+Rp 14,6jt)" is a real rank and not a hardcoded name.
  const byType = EMPTY_BY_TYPE();
  for (const b of buckets) {
    for (const t of ASSET_ALLOCATION_TYPES) byType[t] += b.allocationByType[t];
  }
  let topType: AllocationType | null = null;
  for (const t of ASSET_ALLOCATION_TYPES) {
    if (byType[t] <= 0) continue;
    if (topType === null || byType[t] > byType[topType]) topType = t;
  }

  // What the family PLANNED to set aside this year. The app stores no target
  // balance, so the design's "Total rencana aset" is read as the sum of the
  // year's asset allocations rather than an invented round number.
  const plannedByType = EMPTY_BY_TYPE();
  let plannedTotal = 0;
  for (const b of buckets) {
    for (const t of ASSET_ALLOCATION_TYPES) plannedByType[t] += b.allocationByType[t];
  }
  for (const t of ASSET_ALLOCATION_TYPES) plannedTotal += plannedByType[t];

  return {
    series,
    total,
    growth,
    growthPct: opening > 0 ? Math.round((growth / opening) * 100) : null,
    topType,
    topAmount: topType ? byType[topType] : 0,
    byType,
    plannedTotal,
    plannedByType,
  };
}

export type AssetBandKey = 'EMERGENCY_FUND' | 'CHILD' | 'INVESTMENT' | 'LIQUIDITY';

export interface AssetBand {
  key: AssetBandKey;
  label: string;
  value: number;
}

/**
 * The four bands the design's asset legend names. Colour is deliberately NOT
 * here: this module is pure domain and must stay free of presentation tokens,
 * so the screen maps `key` to `Colors.chart*`. The *grouping* is domain,
 * though — which allocation types count as "Dana anak" is a rule, not a colour.
 */
export const ASSET_BANDS: { key: AssetBandKey; label: string; types: AllocationType[] }[] = [
  { key: 'EMERGENCY_FUND', label: 'Dana darurat', types: ['EMERGENCY_FUND'] },
  { key: 'CHILD', label: 'Dana anak', types: ['ASSET'] },
  { key: 'INVESTMENT', label: 'Investasi', types: ['INVESTMENT'] },
  { key: 'LIQUIDITY', label: 'Likuiditas', types: ['SAVINGS'] },
];

/**
 * Which legend band an allocation type belongs to.
 *
 * `assetSummary` reports its largest contributor as an *allocation type*
 * (`SAVINGS`), while the legend is keyed by *band* (`LIQUIDITY`). Without this
 * map the screen would look `SAVINGS` up in a list keyed `LIQUIDITY` and print
 * the raw enum — the contributor card would read "SAVINGS (+Rp 4jt)" on a
 * screen whose legend calls the same money "Likuiditas".
 *
 * Returns null for types that are not asset-ish at all, so a caller cannot
 * accidentally label an EXPENSE allocation as a savings band.
 */
export function bandKeyOfAllocationType(t: AllocationType): AssetBandKey | null {
  for (const band of ASSET_BANDS) {
    if (band.types.includes(t)) return band.key;
  }
  return null;
}

/** The display label for a band key, falling back to the key itself. */
export function bandLabel(key: AssetBandKey | null): string | null {
  if (!key) return null;
  return ASSET_BANDS.find((b) => b.key === key)?.label ?? key;
}

/**
 * The asset stack, month by month, split by band.
 *
 * `cumulative` is the design's "Akumulasi" view: each month carries every prior
 * month's additions, so a bar's height is the balance and its segments are what
 * the balance is made of. `monthly` shows only what that month added.
 *
 * Bands are returned bottom-up in draw order, so a stacked column renders them
 * in sequence and the tallest band lands where the design puts it.
 */
export function assetSeriesByType(
  buckets: YearBucket[],
  mode: 'monthly' | 'cumulative'
): AssetBand[][] {
  const running = EMPTY_BY_TYPE();
  return buckets.map((b) => {
    for (const t of ASSET_ALLOCATION_TYPES) running[t] += b.allocationByType[t];
    const source = mode === 'cumulative' ? running : b.allocationByType;
    return ASSET_BANDS.map((band) => ({
      key: band.key,
      label: band.label,
      value: band.types.reduce((s, t) => s + source[t], 0),
    })).reverse();
  });
}

export const ASSET_TYPE_LABEL: Record<string, string> = {
  ASSET: 'Aset',
  SAVINGS: 'Tabungan',
  INVESTMENT: 'Investasi',
  EMERGENCY_FUND: 'Dana Darurat',
};

// ============ Month over month ============

export interface CategoryMove {
  categoryId: string;
  name: string;
  current: number;
  previous: number;
  delta: number;
  /** Whole percent change; null when the previous month was 0 (a new cost). */
  pct: number | null;
}

export interface MonthComparison {
  month: number;
  previousMonth: number;
  risers: CategoryMove[];
  fallers: CategoryMove[];
}

/**
 * Category-level movement between two months, on realised expense only.
 *
 * A category that appeared for the first time has `pct: null` rather than an
 * infinite percentage — "new this month" is the honest description, and a
 * "+∞%" pill is not.
 */
export function monthOverMonth(
  buckets: YearBucket[],
  month: number,
  categoryNames: Record<string, string>,
  limit = 3
): MonthComparison {
  const current = buckets.find((b) => b.month === month);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previous = buckets.find((b) => b.month === previousMonth);

  const moves: CategoryMove[] = [];
  if (current && previous) {
    const ids = new Set([
      ...Object.keys(current.expenseByCategory),
      ...Object.keys(previous.expenseByCategory),
    ]);
    for (const id of ids) {
      const cur = current.expenseByCategory[id] ?? 0;
      const prev = previous.expenseByCategory[id] ?? 0;
      if (cur === prev) continue;
      moves.push({
        categoryId: id,
        name: categoryNames[id] ?? 'Tanpa kategori',
        current: cur,
        previous: prev,
        delta: cur - prev,
        pct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null,
      });
    }
  }

  const risers = moves.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, limit);
  const fallers = moves.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, limit);
  return { month, previousMonth, risers, fallers };
}

// ============ Plan vs actual ============

export type PvaMetric = 'income' | 'expenses' | 'investments' | 'assets';

export interface PvaPoint {
  month: number;
  label: string;
  planned: number;
  actual: number;
  /** actual - planned. Positive is over plan for expenses, under for income. */
  variance: number;
  /** Whether the variance is the good direction for this metric. */
  favourable: boolean;
}

/**
 * Planned vs actual per month for one metric.
 *
 * The direction of "good" flips per metric: spending under plan is good, income
 * over plan is good. Encoding it here means the chart's green/red never has to
 * guess, and the semantic colours stay consistent across all four tabs.
 *
 * Investasi and Aset both compare a *planned* allocation against the same
 * realised `ASSET_ALLOCATION` cash figure, because the ledger records that money
 * moved without recording which bucket it landed in. The screen says so rather
 * than splitting one number into two fake ones.
 */
export function planVsActual(buckets: YearBucket[], metric: PvaMetric): PvaPoint[] {
  return buckets.map((b) => {
    let planned = 0;
    let actual = 0;
    let goodDirection: 1 | -1 = 1;

    switch (metric) {
      case 'income':
        planned = b.plannedIncome;
        actual = b.actualIncome;
        goodDirection = 1;
        break;
      case 'expenses':
        planned = b.plannedExpense;
        actual = b.actualExpense;
        goodDirection = -1;
        break;
      case 'investments':
        planned = b.allocationByType.INVESTMENT;
        actual = b.actualAssetAllocation;
        goodDirection = 1;
        break;
      default:
        planned =
          b.allocationByType.ASSET +
          b.allocationByType.SAVINGS +
          b.allocationByType.EMERGENCY_FUND;
        actual = b.actualAssetAllocation;
        goodDirection = 1;
        break;
    }

    const variance = actual - planned;
    const favourable = variance === 0 ? true : (variance > 0) === (goodDirection === 1);
    return { month: b.month, label: b.label, planned, actual, variance, favourable };
  });
}

// ============ Liability trend ============

/**
 * Outstanding liability at the end of each month, reconstructed backwards from
 * today's balance by adding back the principal paid since.
 *
 * This is a reconstruction, not a stored history: the app has no
 * obligations-at-close table. Walking forward from zero would be wrong (it would
 * miss everything borrowed before the year started), so it walks back from the
 * one number we trust. Months before the first financing inflow clamp to 0 —
 * a liability that did not exist yet is not "negative debt".
 */
export function liabilitySeries(
  buckets: YearBucket[],
  currentOutstanding: number,
  /**
   * Restrict the reconstruction to these obligations. The liability section's
   * type pills need "the balance of loans" and "the balance of reimburse"
   * separately, and the payments that built each are only distinguishable by
   * which obligation they paid.
   */
  obligationIds?: ReadonlySet<string>
): number[] {
  const paidIn = (b: YearBucket): number => {
    if (!obligationIds) return b.actualDebtPayment;
    let sum = 0;
    for (const [id, amt] of Object.entries(b.debtPaymentByObligation)) {
      if (obligationIds.has(id)) sum += amt;
    }
    return sum;
  };

  const out = new Array(buckets.length).fill(0);
  let running = Math.max(0, currentOutstanding);
  for (let i = buckets.length - 1; i >= 0; i -= 1) {
    out[i] = running;
    running += paidIn(buckets[i]);
  }
  // Zero out everything before the family first had any liability, so the
  // chart shows a debt-free stretch rather than a phantom balance.
  const firstLiability = buckets.findIndex((b) => b.financingInflow > 0);
  const cutoff = firstLiability >= 0 ? firstLiability : 0;
  for (let i = 0; i < cutoff; i += 1) out[i] = 0;
  return out;
}

// ============ The executive summary ============

export type InsightKind = 'income' | 'overspend' | 'financing' | 'debt' | 'asset';

export interface TrendInsight {
  kind: InsightKind;
  title: string;
  body: string;
}

/**
 * The five insight sentences, computed rather than written.
 *
 * The design shows five hand-written paragraphs about a specific family's
 * numbers. Shipping those verbatim would print another family's income on this
 * family's screen, so each is generated from the data and simply omitted when
 * there is nothing to say. A four-item summary is better than a fabricated
 * fifth.
 */
export function buildTrendInsights(args: {
  buckets: YearBucket[];
  annual: AnnualTotals;
  assets: ReturnType<typeof assetSummary>;
  currentOutstanding: number;
}): TrendInsight[] {
  const { buckets, annual, assets, currentOutstanding } = args;
  const out: TrendInsight[] = [];

  // 1. Income stability.
  const best = annual.bestIncomeMonth;
  if (best && annual.avgIncome > 0) {
    out.push({
      kind: 'income',
      title: 'Income Operasional Paling Stabil',
      body:
        `Rata-rata pemasukan operasional ${formatRupiahShort(annual.avgIncome)}/bln, ` +
        `dengan penerimaan tertinggi di ${MONTHS_ID[best.month - 1]} ` +
        `(${formatRupiahShort(best.value)}).`,
    });
  }

  // 2. Overspend — a streak of months where realised spending beat the plan.
  const over = buckets.filter((b) => b.hasCycle && b.actualExpense > b.plannedExpense && b.plannedExpense > 0);
  if (over.length > 0 && annual.expenseVariance > 0) {
    const worst = over.reduce((a, b) => (b.actualExpense - b.plannedExpense > a.actualExpense - a.plannedExpense ? b : a));
    out.push({
      kind: 'overspend',
      title: 'Overspend Pengeluaran',
      body:
        `Pengeluaran aktual melebihi rencana di ${over.length} bulan, ` +
        `terbesar ${MONTHS_ID[worst.month - 1]} (${formatRupiahShort(worst.actualExpense - worst.plannedExpense)} di atas rencana).`,
    });
  }

  // 3. The role of financing inflow.
  if (annual.financingInflow > 0) {
    out.push({
      kind: 'financing',
      title: 'Peran Pemasukan Pendanaan',
      body:
        `Pemasukan pendanaan ${formatRupiahShort(annual.financingInflow)} menopang likuiditas kas keluarga, ` +
        `tetapi tidak menambah income operasional dan menyisakan kewajiban ${formatRupiahShort(currentOutstanding)}.`,
    });
  }

  // 4. Debt paydown actually executed.
  if (annual.debtPayment > 0) {
    out.push({
      kind: 'debt',
      title: 'Realisasi Pembayaran Utang',
      body:
        `Pembayaran pokok ${formatRupiahShort(annual.debtPayment)} berhasil dieksekusi sepanjang ${buckets[0]?.label ?? ''}` +
        `–${buckets[11]?.label ?? ''}, menurunkan sisa kewajiban menjadi ${formatRupiahShort(currentOutstanding)}.`,
    });
  }

  // 5. Asset accumulation.
  if (assets.total > 0) {
    const contributor = assets.topType
      ? `, terbesar dari ${ASSET_TYPE_LABEL[assets.topType] ?? assets.topType} (${formatRupiahShort(assets.topAmount)})`
      : '';
    out.push({
      kind: 'asset',
      title: 'Akumulasi Aset Tumbuh',
      body:
        assets.growthPct !== null
          ? `Akumulasi aset likuid bertumbuh ${assets.growthPct}% (${formatRupiahShort(assets.growth)}) mencapai ${formatRupiahShort(assets.total)}${contributor}.`
          : `Akumulasi aset likuid mencapai ${formatRupiahShort(assets.total)}${contributor}.`,
    });
  }

  return out;
}

// ============ Chart scaling ============

/**
 * A rounded-up axis maximum so bars do not touch the top edge. Rounds to a
 * "nice" step (1/2/5 × 10^n) because an axis labelled `Rp 36.881.995` is
 * unreadable and the exact ceiling is not information.
 */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Bar height as a percentage of the axis, clamped to 0–100. */
export function barPct(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/**
 * The last `count` months ending at the latest month that has data.
 *
 * Anchored to the last active month rather than to December: on a mid-year
 * screen, "6 Bulan" showing July-December would be five empty slots and one
 * real bar. When nothing has data yet the window falls back to the calendar
 * tail so the chart keeps its shape.
 */
export function windowEndingAt(buckets: YearBucket[], count: 6 | 12): YearBucket[] {
  if (count >= buckets.length) return buckets;
  const last = latestActiveMonth(buckets);
  const end = last ?? buckets.length;
  const start = Math.max(0, end - count);
  return buckets.slice(start, end);
}

/** The month a year-selector should default to: the latest month with data. */
export function latestActiveMonth(buckets: YearBucket[]): number | null {
  for (let i = buckets.length - 1; i >= 0; i -= 1) {
    if (buckets[i].hasCycle) return buckets[i].month;
  }
  return null;
}
