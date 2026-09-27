import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { requireSupabase } from './supabase';
import { listHouseholdMembers, updateHousehold, updateMyMemberProfile } from './household';
import { isRepaymentMode } from './obligation';
import type { RepaymentMode } from './obligation';
import {
  calculateZeroBasedSummary,
  canMarkAsPaid,
  defaultFlowType,
  isObligationPaydown,
  resolveModeAmount,
} from './zero-based';
import type {
  AllocationType,
  FlowType,
  FundingGapStatus,
  ObligationSummary,
  SourceFundsBreakdown,
  SummaryMode,
  ZeroBasedSummary,
} from './zero-based';
export type {
  AllocationType,
  FlowType,
  FundingGapStatus,
  ObligationSummary,
  SourceFundsBreakdown,
  SummaryMode,
  ZeroBasedSummary,
} from './zero-based';

export interface Cycle { id: string; household_id: string; name: string; start_date: string; end_date: string; is_active: boolean; }
export type CategorySystemRole = 'DEBT_PAYMENT' | 'FINANCING_INFLOW';
export interface Category {
  id: string; household_id: string; name: string; monthly_budget: number; type: string;
  is_system?: boolean; system_role?: CategorySystemRole | null;
}
export interface Account { id: string; household_id: string; name: string; type: string; }
export interface Txn {
  id: string; household_id: string; cycle_id: string | null;
  recurring_template_id: string | null; obligation_id: string | null;
  name: string; category_id: string | null; account_id: string | null;
  direction: 'INCOME' | 'EXPENSE'; flow_type?: FlowType | null; planned_amount: number; actual_amount: number;
  release_date: string | null; status: 'PENDING' | 'PAID';
  created_by: string | null; executed_by: string | null;
  recipient: string | null; is_final_payment: boolean; created_at: string;
  // joined
  categories?: { name: string } | null;
  accounts?: { name: string } | null;
}
export interface Obligation {
  id: string; household_id: string; title: string; type: string; recipient: string | null;
  total_amount: number; remaining_amount: number; status: string; created_at: string; notes: string | null;
  source_transaction_id?: string | null; repayment_method?: string | null;
  planned_installment_amount?: number | null; installment_count?: number | null;
  current_installment?: number | null; start_date?: string | null; due_date?: string | null;
  interest_fee_amount?: number | null;
  /**
   * Plan shape (migration 008): LUMP_NEXT_MONTH | INSTALLMENT | MANUAL.
   * `null`/undefined means nobody has chosen — see `repaymentModeOf` in
   * lib/obligation.ts, which derives a *display* default and says it did.
   */
  repayment_mode?: string | null;
}
export interface Template {
  id: string; household_id: string; name: string; category_id: string | null;
  account_id: string | null; direction: 'INCOME' | 'EXPENSE'; default_amount: number;
  status: 'ACTIVE' | 'COMPLETED'; notes: string | null;
  /** Day of month the bill is due; null = no known due day (migration 006). */
  due_day?: number | null;
  categories?: { name: string } | null; accounts?: { name: string } | null;
}
export interface ObligationInstallment {
  id: string; household_id: string; obligation_id: string; cycle_id: string | null;
  planned_amount: number; due_date: string | null;
  status: 'OPEN' | 'PARTIAL' | 'OVERDUE' | 'SETTLED' | 'CANCELLED';
  paid_amount: number; paid_transaction_id: string | null; created_at: string;
  obligations?: { title: string } | null;
}

export const LOAN_REPAYMENT_METHODS = ['TRANSFER', 'CASH', 'AUTO_DEBIT', 'PAYROLL', 'OTHER'] as const;
export type LoanRepaymentMethod = (typeof LOAN_REPAYMENT_METHODS)[number];

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

/**
 * Every mutation that can move money must invalidate the same set of keys.
 * Phase 1 shipped the zero-based projections but only the new mutations
 * invalidated them, so marking something paid left `['source-funds']` and
 * `['zero-summary']` stale. Route all invalidations through here so a future
 * projection can never be forgotten by one mutation.
 */
function invalidateMoneyKeys(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['txns'] });
  qc.invalidateQueries({ queryKey: ['oblig'] });
  qc.invalidateQueries({ queryKey: ['obl-payments'] });
  qc.invalidateQueries({ queryKey: ['alloc'] });
  qc.invalidateQueries({ queryKey: ['source-funds'] });
  qc.invalidateQueries({ queryKey: ['zero-summary'] });
}

export function useActiveCycle(householdId: string | undefined) {
  return useQuery({
    queryKey: ['cycle', householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<Cycle | null> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('cycles').select('*')
        .eq('household_id', householdId!).order('start_date', { ascending: false }).limit(5);
      if (error) throw error;
      const rows = (data ?? []) as Cycle[];
      return rows.find((c) => c.is_active) ?? rows[0] ?? null;
    },
  });
}

export function useTransactions(householdId: string | undefined, cycleId: string | undefined) {
  return useQuery({
    queryKey: ['txns', householdId, cycleId],
    enabled: !!householdId && !!cycleId,
    queryFn: async (): Promise<Txn[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('transactions')
        .select('*, categories(name), accounts(name)')
        .eq('household_id', householdId!).eq('cycle_id', cycleId!)
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Txn[];
    },
  });
}

export function useCategories(householdId: string | undefined) {
  return useQuery({
    queryKey: ['cats', householdId], enabled: !!householdId,
    queryFn: async (): Promise<Category[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('categories').select('*').eq('household_id', householdId!).order('name');
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });
}

export function useAccounts(householdId: string | undefined) {
  return useQuery({
    queryKey: ['accs', householdId], enabled: !!householdId,
    queryFn: async (): Promise<Account[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('accounts').select('*').eq('household_id', householdId!).order('name');
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });
}

export function useObligations(householdId: string | undefined) {
  return useQuery({
    queryKey: ['oblig', householdId], enabled: !!householdId,
    queryFn: async (): Promise<Obligation[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('obligations').select('*')
        .eq('household_id', householdId!).neq('status', 'SETTLED').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Obligation[];
    },
  });
}

export function useTemplates(householdId: string | undefined) {
  return useQuery({
    queryKey: ['tmpl', householdId], enabled: !!householdId,
    queryFn: async (): Promise<Template[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('recurring_templates')
        .select('*, categories(name), accounts(name)')
        .eq('household_id', householdId!).order('name');
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });
}

export function useMarkAsPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { txn: Txn; actualAmount: number; accountId?: string | null; isFinal: boolean }) => {
      // Exactly-once guard: `allocate_debt_payment` inserts its row already PAID
      // and reduced the obligation inside SQL. Re-confirming that row here would
      // decrement `remaining_amount` a second time.
      if (!canMarkAsPaid(args.txn)) {
        throw new Error('Transaksi ini sudah lunas.');
      }
      if (!(args.actualAmount > 0)) {
        throw new Error('Nominal pembayaran harus lebih dari Rp 0.');
      }
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const { error: uErr } = await sb.from('transactions').update({
        status: 'PAID', actual_amount: args.actualAmount,
        release_date: todayISO(), executed_by: user?.id ?? null,
        account_id: args.accountId ?? args.txn.account_id,
        is_final_payment: args.isFinal,
      }).eq('id', args.txn.id);
      if (uErr) throw uErr;
      if (args.isFinal && args.txn.recurring_template_id) {
        const { error } = await sb.from('recurring_templates').update({ status: 'COMPLETED' }).eq('id', args.txn.recurring_template_id);
        if (error) throw error;
      }
      if (isObligationPaydown(args.txn)) {
        const { data: ob } = await sb.from('obligations').select('*').eq('id', args.txn.obligation_id!).maybeSingle();
        if (ob) {
          const remaining = Math.max(0, (ob as Obligation).remaining_amount - args.actualAmount);
          await sb.from('obligations').update({
            remaining_amount: remaining,
            status: remaining <= 0 ? 'SETTLED' : 'PARTIAL',
          }).eq('id', args.txn.obligation_id!);
        }
      }
    },
    onSuccess: () => {
      invalidateMoneyKeys(qc);
      qc.invalidateQueries({ queryKey: ['tmpl'] });
    },
  });
}

export function useQuickAdd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; cycleId: string; name: string; amount: number;
      direction: 'INCOME' | 'EXPENSE'; categoryId: string | null; accountId: string | null;
      makeRecurring: boolean;
    }) => {
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const { data: txn, error } = await sb.from('transactions').insert({
        household_id: args.householdId, cycle_id: args.cycleId, name: args.name,
        direction: args.direction, flow_type: args.direction === 'INCOME' ? 'OPERATING_INCOME' : 'EXPENSE',
        planned_amount: args.amount, actual_amount: args.amount,
        status: 'PAID', release_date: todayISO(),
        category_id: args.categoryId, account_id: args.accountId,
        created_by: user?.id ?? null, executed_by: user?.id ?? null,
      }).select('*').single();
      if (error) throw error;
      if (args.makeRecurring) {
        const { data: t } = await sb.from('recurring_templates').insert({
          household_id: args.householdId, name: args.name,
          category_id: args.categoryId, account_id: args.accountId,
          direction: args.direction, default_amount: args.amount, status: 'ACTIVE',
        }).select('*').single();
        if (t) {
          await sb.from('transactions').update({ recurring_template_id: (t as Template).id }).eq('id', (txn as Txn).id);
        }
      }
    },
    onSuccess: () => {
      invalidateMoneyKeys(qc);
      qc.invalidateQueries({ queryKey: ['tmpl'] });
    },
  });
}

/**
 * Planning path: pull part of an obligation into this cycle as a PENDING bill.
 * No cash moves yet — execution happens later through `useMarkAsPaid` on the
 * returned row.
 *
 * Two coherence rules, both required so the Home hero is correct in Phase 3:
 *   1. The row is classified `DEBT_PAYMENT`, not `EXPENSE`. Obligation rows are
 *      debt paydown everywhere else too, so the ledger and the
 *      "Pembayaran Kewajiban" slot agree regardless of which path created them.
 *   2. A `cycle_allocations` row is written at PLAN time, because committing
 *      money to an obligation is the allocation. Without it "Total Alokasi"
 *      would under-report until the payment was executed.
 *
 * Consequently `useMarkAsPaid` must NOT write another allocation when it
 * confirms this row — one commitment, one allocation row (see allocate_debt_payment
 * for the one-shot "pay without planning" path, which writes its own).
 */
export function useAllocateObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; cycleId: string; obligationId: string;
      amount: number; categoryId: string | null; accountId: string | null;
    }) => {
      if (!(args.amount > 0)) throw new Error('Nominal alokasi harus lebih dari Rp 0.');
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const { data: ob } = await sb.from('obligations').select('*').eq('id', args.obligationId).maybeSingle();
      const obligation = ob as Obligation | null;
      if (obligation && args.amount > obligation.remaining_amount) {
        throw new Error('Nominal alokasi melebihi sisa tanggungan.');
      }
      const title = obligation?.title ?? 'Alokasi tanggungan';
      const { error } = await sb.from('transactions').insert({
        household_id: args.householdId, cycle_id: args.cycleId,
        obligation_id: args.obligationId, name: title,
        direction: 'EXPENSE', flow_type: 'DEBT_PAYMENT',
        planned_amount: args.amount, actual_amount: args.amount,
        status: 'PENDING', release_date: null,
        category_id: args.categoryId, account_id: args.accountId,
        created_by: user?.id ?? null,
      });
      if (error) throw error;

      const { error: aErr } = await sb.from('cycle_allocations').insert({
        household_id: args.householdId, cycle_id: args.cycleId,
        allocation_type: 'DEBT_PAYMENT', amount: args.amount,
        obligation_id: args.obligationId, account_id: args.accountId,
        category_id: args.categoryId, created_by: user?.id ?? null,
      });
      if (aErr) throw aErr;
    },
    onSuccess: () => invalidateMoneyKeys(qc),
  });
}

export function useCreateCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; name: string; start: string; end: string;
      incomeAmount: number; incomeAccountId: string | null; incomeCategoryId: string | null;
      items: { templateId: string; name: string; amount: number; categoryId: string | null; accountId: string | null; direction: 'INCOME' | 'EXPENSE' }[];
    }) => {
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      await sb.from('cycles').update({ is_active: false }).eq('household_id', args.householdId).eq('is_active', true);
      const { data: cycle, error: cErr } = await sb.from('cycles').insert({
        household_id: args.householdId, name: args.name,
        start_date: args.start, end_date: args.end, is_active: true,
      }).select('*').single();
      if (cErr) throw cErr;
      const cid = (cycle as Cycle).id;
      const rows: Record<string, string | number | null>[] = args.items.map((it) => ({
        household_id: args.householdId, cycle_id: cid,
        recurring_template_id: it.templateId, name: it.name,
        direction: it.direction, flow_type: it.direction === 'INCOME' ? 'OPERATING_INCOME' : 'EXPENSE',
        planned_amount: it.amount, actual_amount: it.amount,
        status: 'PENDING', release_date: null,
        category_id: it.categoryId, account_id: it.accountId,
        created_by: user?.id ?? null,
      }));
      if (args.incomeAmount > 0) {
        rows.push({
          household_id: args.householdId, cycle_id: cid,
          recurring_template_id: null, name: 'Gaji Bulanan',
          direction: 'INCOME' as const, flow_type: 'OPERATING_INCOME' as const,
          planned_amount: args.incomeAmount, actual_amount: args.incomeAmount,
          status: 'PENDING' as const, release_date: null,
          category_id: args.incomeCategoryId, account_id: args.incomeAccountId,
          created_by: user?.id ?? null,
        });
      }
      if (rows.length > 0) {
        const { error: tErr } = await sb.from('transactions').insert(rows);
        if (tErr) throw tErr;
      }
      return cycle as Cycle;
    },
    onSuccess: () => {
      invalidateMoneyKeys(qc);
      qc.invalidateQueries({ queryKey: ['cycle'] });
    },
  });
}

/**
 * Creates an obligation in the canonical `OPEN` state. `UNPAID` is only kept
 * as a legacy read alias (migration 004) — new rows must not write it, or the
 * "is this still owed?" checks would need two spellings.
 */
export function useCreateObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string; title: string; type: string; total: number; recipient?: string }) => {
      if (!(args.total > 0)) throw new Error('Total tanggungan harus lebih dari Rp 0.');
      const sb = requireSupabase();
      const { error } = await sb.from('obligations').insert({
        household_id: args.householdId, title: args.title, type: args.type,
        total_amount: args.total, remaining_amount: args.total, status: 'OPEN',
        recipient: args.recipient ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateMoneyKeys(qc),
  });
}

export function calcCashflow(txns: Txn[]): { actualCash: number; projectedRemaining: number; pendingCount: number; paidCount: number } {
  let cashIn = 0, cashOut = 0, pendingOut = 0, pendingCount = 0, paidCount = 0;
  for (const t of txns) {
    if (t.status === 'PAID') {
      paidCount += 1;
      if (t.direction === 'INCOME') cashIn += t.actual_amount;
      else cashOut += t.actual_amount;
    } else {
      pendingCount += 1;
      if (t.direction === 'EXPENSE') pendingOut += t.planned_amount;
      else pendingOut -= t.planned_amount;
    }
  }
  const actualCash = cashIn - cashOut;
  return { actualCash, projectedRemaining: actualCash - pendingOut, pendingCount, paidCount };
}

// ============ Phase 1: zero-based projection + allocation mutations ============
//
// Anti-double-count: the allocation total comes ONLY from cycle_allocations
// rows. Transaction flow_type outflow values classify ledger rows (consumptive
// expense vs debt payment) but are never summed into the allocation total.

export interface CycleAllocation {
  id: string; household_id: string; cycle_id: string;
  allocation_type: AllocationType; amount: number;
  category_id: string | null; obligation_id: string | null; account_id: string | null;
  note: string | null; created_by: string | null; created_at: string;
  categories?: { name: string } | null;
  obligations?: { title: string } | null;
  accounts?: { name: string } | null;
}

export interface LedgerRow extends Txn {
  flowType: FlowType;
  amount: number;
}

function aggregateSourceFunds(
  rows: Pick<Txn, 'direction' | 'flow_type' | 'obligation_id' | 'planned_amount' | 'actual_amount' | 'status'>[],
  mode: SummaryMode
): SourceFundsBreakdown {
  let operatingIncome = 0, financingInflow = 0, assetRelease = 0;
  for (const t of rows) {
    const flow = t.flow_type ?? defaultFlowType(t.direction, t.obligation_id);
    const amount = resolveModeAmount(t, mode);
    if (flow === 'OPERATING_INCOME') operatingIncome += amount;
    else if (flow === 'FINANCING_INFLOW') financingInflow += amount;
    else if (flow === 'ASSET_RELEASE') assetRelease += amount;
  }
  return { operatingIncome, financingInflow, assetRelease, total: operatingIncome + financingInflow + assetRelease };
}

function aggregateAllocations(rows: Pick<CycleAllocation, 'allocation_type' | 'amount'>[]) {
  const byType: Record<AllocationType, number> = {
    EXPENSE: 0, DEBT_PAYMENT: 0, ASSET: 0, SAVINGS: 0,
    INVESTMENT: 0, EMERGENCY_FUND: 0, OTHER: 0,
  };
  for (const r of rows) byType[r.allocation_type] += Math.max(0, r.amount);
  return {
    expense: byType.EXPENSE, debtPayment: byType.DEBT_PAYMENT, asset: byType.ASSET,
    savings: byType.SAVINGS, investment: byType.INVESTMENT,
    emergencyFund: byType.EMERGENCY_FUND, other: byType.OTHER,
  };
}

export function useCycleSourceFunds(
  householdId: string | undefined, cycleId: string | undefined, mode: SummaryMode = 'planned'
) {
  return useQuery({
    queryKey: ['source-funds', householdId, cycleId, mode],
    enabled: !!householdId && !!cycleId,
    queryFn: async (): Promise<SourceFundsBreakdown> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('transactions')
        .select('direction, flow_type, planned_amount, actual_amount, status, obligation_id')
        .eq('household_id', householdId!).eq('cycle_id', cycleId!);
      if (error) throw error;
      return aggregateSourceFunds((data ?? []) as Txn[], mode);
    },
  });
}

export function useCycleAllocations(householdId: string | undefined, cycleId: string | undefined) {
  return useQuery({
    queryKey: ['alloc', householdId, cycleId],
    enabled: !!householdId && !!cycleId,
    queryFn: async (): Promise<CycleAllocation[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('cycle_allocations')
        .select('*, categories(name), obligations(title), accounts(name)')
        .eq('household_id', householdId!).eq('cycle_id', cycleId!);
      if (error) throw error;
      return (data ?? []) as CycleAllocation[];
    },
  });
}

export function useZeroBasedSummary(
  householdId: string | undefined, cycleId: string | undefined, mode: SummaryMode = 'planned'
) {
  return useQuery({
    queryKey: ['zero-summary', householdId, cycleId, mode],
    enabled: !!householdId && !!cycleId,
    queryFn: async (): Promise<ZeroBasedSummary> => {
      const sb = requireSupabase();
      const [txnsRes, allocsRes] = await Promise.all([
        sb.from('transactions')
          .select('direction, flow_type, planned_amount, actual_amount, status, obligation_id')
          .eq('household_id', householdId!).eq('cycle_id', cycleId!),
        sb.from('cycle_allocations')
          .select('allocation_type, amount')
          .eq('household_id', householdId!).eq('cycle_id', cycleId!),
      ]);
      if (txnsRes.error) throw txnsRes.error;
      if (allocsRes.error) throw allocsRes.error;
      const txnRows = (txnsRes.data ?? []) as Txn[];
      const allocRows = (allocsRes.data ?? []) as Pick<CycleAllocation, 'allocation_type' | 'amount'>[];
      const source = aggregateSourceFunds(txnRows, mode);
      // Required allocation is always the planned total, regardless of
      // mode; mode only affects the source-funds side.
      const requiredAllocation = allocRows.reduce((s, r) => s + Math.max(0, r.amount), 0);
      return calculateZeroBasedSummary({
        source: {
          operatingIncome: source.operatingIncome,
          financingInflow: source.financingInflow,
          assetRelease: source.assetRelease,
        },
        allocations: aggregateAllocations(allocRows),
        requiredAllocation,
      });
    },
  });
}

export const useCycleAllocationSummary = useZeroBasedSummary;

export function useFundingGap(
  householdId: string | undefined, cycleId: string | undefined, mode: SummaryMode = 'planned'
) {
  const summary = useZeroBasedSummary(householdId, cycleId, mode);
  return {
    ...summary,
    data: summary.data
      ? {
          requiredAllocation: summary.data.requiredAllocation,
          fundingGap: summary.data.fundingGap,
          status: summary.data.status as FundingGapStatus,
        }
      : undefined,
  };
}

export function useObligationSummaries(householdId: string | undefined) {
  const q = useObligations(householdId);
  const data: ObligationSummary[] | undefined = q.data?.map((o) => {
    const paidAmount = Math.max(0, o.total_amount - o.remaining_amount);
    return {
      id: o.id, householdId: o.household_id, title: o.title, type: o.type, status: o.status,
      totalAmount: o.total_amount, remainingAmount: o.remaining_amount, paidAmount,
      progressPct: o.total_amount > 0 ? Math.round((paidAmount / o.total_amount) * 100) : 0,
    };
  });
  return { ...q, data };
}

export function useTransactionLedger(
  householdId: string | undefined, cycleId: string | undefined, mode: SummaryMode = 'planned'
) {
  const q = useTransactions(householdId, cycleId);
  const data: LedgerRow[] | undefined = q.data?.map((t) => ({
    ...t,
    flowType: t.flow_type ?? defaultFlowType(t.direction, t.obligation_id),
    amount: resolveModeAmount(t, mode),
  }));
  return { ...q, data };
}

export function useCreateAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; cycleId: string; allocationType: AllocationType; amount: number;
      categoryId?: string | null; obligationId?: string | null; accountId?: string | null; note?: string | null;
    }) => {
      if (!(args.amount > 0)) throw new Error('Nominal alokasi harus lebih dari 0.');
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const { data, error } = await sb.from('cycle_allocations').insert({
        household_id: args.householdId, cycle_id: args.cycleId,
        allocation_type: args.allocationType, amount: args.amount,
        category_id: args.categoryId ?? null, obligation_id: args.obligationId ?? null,
        account_id: args.accountId ?? null, note: args.note ?? null,
        created_by: user?.id ?? null,
      }).select('*').single();
      if (error) throw error;
      return data as CycleAllocation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alloc'] });
      qc.invalidateQueries({ queryKey: ['zero-summary'] });
      qc.invalidateQueries({ queryKey: ['source-funds'] });
    },
  });
}

export function useUpdateAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string; allocationType?: AllocationType; amount?: number;
      categoryId?: string | null; obligationId?: string | null; accountId?: string | null; note?: string | null;
    }) => {
      if (args.amount !== undefined && !(args.amount > 0)) {
        throw new Error('Nominal alokasi harus lebih dari 0.');
      }
      const sb = requireSupabase();
      const patch: Record<string, string | number | null> = {};
      if (args.allocationType !== undefined) patch.allocation_type = args.allocationType;
      if (args.amount !== undefined) patch.amount = args.amount;
      if (args.categoryId !== undefined) patch.category_id = args.categoryId;
      if (args.obligationId !== undefined) patch.obligation_id = args.obligationId;
      if (args.accountId !== undefined) patch.account_id = args.accountId;
      if (args.note !== undefined) patch.note = args.note;
      const { data, error } = await sb.from('cycle_allocations').update(patch).eq('id', args.id).select('*').single();
      if (error) throw error;
      return data as CycleAllocation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alloc'] });
      qc.invalidateQueries({ queryKey: ['zero-summary'] });
      qc.invalidateQueries({ queryKey: ['source-funds'] });
    },
  });
}

export function useDeleteAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string }) => {
      const sb = requireSupabase();
      const { error } = await sb.from('cycle_allocations').delete().eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alloc'] });
      qc.invalidateQueries({ queryKey: ['zero-summary'] });
      qc.invalidateQueries({ queryKey: ['source-funds'] });
    },
  });
}

/**
 * Records a financing inflow together with the obligation that repays it, in
 * one SQL transaction (see migration 005). `interestFeeAmount` is added to the
 * repayment total, so the obligation's `total_amount` is what the family
 * actually owes — principal plus cost of borrowing.
 *
 * `installmentCount` is optional; when given, the RPC also generates the
 * schedule. Validation lives in SQL so a direct RPC call cannot bypass it, and
 * only the obvious client-side cases are mirrored here for faster feedback.
 */
export function useCreateFinancingLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; cycleId: string; amount: number; name: string;
      obligationTitle: string; obligationType: 'BILL' | 'LOAN' | 'REIMBURSEMENT' | 'INSTALLMENT';
      accountId?: string | null; dueDate?: string | null;
      repaymentMethod?: LoanRepaymentMethod | null; installmentCount?: number | null;
      startDate?: string | null; interestFeeAmount?: number;
    }) => {
      if (!(args.amount > 0)) throw new Error('Nominal pembiayaan harus lebih dari 0.');
      if ((args.interestFeeAmount ?? 0) < 0) throw new Error('Bunga/biaya tidak boleh negatif.');
      if (args.installmentCount != null && (args.installmentCount < 1 || args.installmentCount > 600)) {
        throw new Error('Jumlah angsuran harus antara 1 dan 600.');
      }
      const sb = requireSupabase();
      const { data, error } = await sb.rpc('create_financing_with_obligation', {
        p_household_id: args.householdId, p_cycle_id: args.cycleId, p_amount: args.amount,
        p_name: args.name, p_obligation_title: args.obligationTitle,
        p_obligation_type: args.obligationType, p_account_id: args.accountId ?? null,
        p_due_date: args.dueDate ?? null,
        p_repayment_method: args.repaymentMethod ?? null,
        p_installment_count: args.installmentCount ?? null,
        p_start_date: args.startDate ?? null,
        p_interest_fee_amount: args.interestFeeAmount ?? 0,
      });
      if (error) throw error;
      return data as {
        transaction_id: string; obligation_id: string;
        installment_count: number | null; total_repayment: number;
      }[];
    },
    onSuccess: () => {
      invalidateMoneyKeys(qc);
      qc.invalidateQueries({ queryKey: ['installments'] });
    },
  });
}

/** Installments of one obligation, ordered by due date (nulls last = backlog). */
export function useObligationInstallments(
  householdId: string | undefined, obligationId: string | undefined
) {
  return useQuery({
    queryKey: ['installments', householdId, obligationId],
    enabled: !!householdId && !!obligationId,
    queryFn: async (): Promise<ObligationInstallment[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('obligation_installments')
        .select('*')
        .eq('household_id', householdId!).eq('obligation_id', obligationId!)
        .order('due_date', { ascending: true, nullsFirst: true });
      if (error) throw error;
      return (data ?? []) as ObligationInstallment[];
    },
  });
}

/**
 * One transaction by id, with its account and category joined.
 *
 * Used by Detail Pinjaman to name where the loan money landed: the obligation
 * only stores `source_transaction_id`, and the transaction may belong to a
 * cycle that is no longer active, so it cannot be found in the cycle ledger.
 */
export function useTransactionById(householdId: string | undefined, txnId: string | undefined) {
  return useQuery({
    queryKey: ['txn', householdId, txnId],
    enabled: !!householdId && !!txnId,
    queryFn: async (): Promise<Txn | null> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('transactions')
        .select('*, categories(name), accounts(name)')
        .eq('household_id', householdId!).eq('id', txnId!).maybeSingle();
      if (error) throw error;
      return (data as Txn | null) ?? null;
    },
  });
}

/**
 * Every payment ever booked against one obligation, across all cycles.
 *
 * Deliberately not `useTransactions(householdId, cycleId)` filtered down: a
 * loan taken in May and paid through November has payments in cycles that are
 * no longer active, and a cycle-scoped query would render the Riwayat
 * Pembayaran section empty for exactly the loans that have the most history.
 */
export function useObligationPayments(
  householdId: string | undefined, obligationId: string | undefined
) {
  return useQuery({
    queryKey: ['obl-payments', householdId, obligationId],
    enabled: !!householdId && !!obligationId,
    queryFn: async (): Promise<Txn[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('transactions')
        .select('*, categories(name), accounts(name)')
        .eq('household_id', householdId!).eq('obligation_id', obligationId!)
        .eq('status', 'PAID')
        .order('release_date', { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Txn[];
    },
  });
}

/** Every installment in a cycle, for the cycle plan view. */
export function useCycleInstallments(
  householdId: string | undefined, cycleId: string | undefined
) {
  return useQuery({
    queryKey: ['installments', householdId, 'cycle', cycleId],
    enabled: !!householdId && !!cycleId,
    queryFn: async (): Promise<ObligationInstallment[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('obligation_installments')
        .select('*, obligations(title)')
        .eq('household_id', householdId!).eq('cycle_id', cycleId!)
        .order('due_date', { ascending: true, nullsFirst: true });
      if (error) throw error;
      return (data ?? []) as ObligationInstallment[];
    },
  });
}

/** Attaches a backlog installment to a cycle (or detaches it with `cycleId: null`). */
export function useSetInstallmentCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string; installmentId: string; cycleId: string | null }) => {
      const sb = requireSupabase();
      const { error } = await sb.rpc('set_installment_cycle', {
        p_household_id: args.householdId,
        p_installment_id: args.installmentId,
        p_cycle_id: args.cycleId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['installments'] });
      qc.invalidateQueries({ queryKey: ['oblig'] });
    },
  });
}

/** Schedules (or re-reads) an obligation's installments via the SQL splitter. */
export function useScheduleInstallments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; obligationId: string; cycleId: string | null;
      total: number; count: number; startDate?: string | null;
    }) => {
      if (!(args.count >= 1 && args.count <= 600)) throw new Error('Jumlah angsuran harus antara 1 dan 600.');
      if (!(args.total > 0)) throw new Error('Total pembiayaan harus lebih dari 0.');
      const sb = requireSupabase();
      const { error } = await sb.rpc('schedule_obligation_installments', {
        p_household_id: args.householdId,
        p_obligation_id: args.obligationId,
        p_cycle_id: args.cycleId,
        p_total: args.total,
        p_count: args.count,
        p_start_date: args.startDate ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['installments'] });
      qc.invalidateQueries({ queryKey: ['oblig'] });
    },
  });
}

export function useAllocateDebtPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; cycleId: string; obligationId: string;
      amount: number; accountId?: string | null;
    }) => {
      if (!(args.amount > 0)) throw new Error('Nominal pembayaran harus lebih dari 0.');
      const sb = requireSupabase();
      const { data, error } = await sb.rpc('allocate_debt_payment', {
        p_household_id: args.householdId, p_cycle_id: args.cycleId,
        p_obligation_id: args.obligationId, p_amount: args.amount,
        p_account_id: args.accountId ?? null,
      });
      if (error) throw error;
      return data as { transaction_id: string; allocation_id: string }[];
    },
    onSuccess: () => invalidateMoneyKeys(qc),
  });
}

/**
 * Chooses the plan shape for an obligation (migration 008). Moves no money, so
 * it invalidates `['oblig']` only — routing it through `invalidateMoneyKeys`
 * would refetch every projection just to learn that a label changed.
 *
 * `mode: null` clears the choice back to "not chosen", which is a legitimate
 * thing to want after tapping the wrong option.
 */
export function useSetRepaymentMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; obligationId: string; mode: RepaymentMode | null;
    }) => {
      if (args.mode !== null && !isRepaymentMode(args.mode)) {
        throw new Error('Mode pembayaran tidak dikenal.');
      }
      const sb = requireSupabase();
      const { error } = await sb.rpc('set_obligation_repayment_mode', {
        p_household_id: args.householdId,
        p_obligation_id: args.obligationId,
        p_mode: args.mode,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['oblig'] }),
  });
}

// ============ Phase 4: templates and categories ============

export interface TemplateInput {
  name: string; categoryId: string | null; accountId: string | null;
  direction: 'INCOME' | 'EXPENSE'; defaultAmount: number;
  dueDay?: number | null; notes?: string | null;
}

function validateTemplateInput(args: TemplateInput): void {
  if (args.name.trim().length < 3) throw new Error('Nama template minimal 3 huruf.');
  if (!(args.defaultAmount > 0)) throw new Error('Nominal default harus lebih dari Rp 0.');
  if (args.dueDay != null && (args.dueDay < 1 || args.dueDay > 31)) {
    throw new Error('Tanggal jatuh tempo harus antara 1 dan 31.');
  }
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string } & TemplateInput) => {
      validateTemplateInput(args);
      const sb = requireSupabase();
      const { data, error } = await sb.from('recurring_templates').insert({
        household_id: args.householdId,
        name: args.name.trim(),
        category_id: args.categoryId,
        account_id: args.accountId,
        direction: args.direction,
        default_amount: args.defaultAmount,
        due_day: args.dueDay ?? null,
        notes: args.notes ?? null,
        status: 'ACTIVE',
      }).select('*').single();
      if (error) throw error;
      return data as Template;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tmpl'] }),
  });
}

/**
 * Editing a template never rewrites history. Transactions already cloned from
 * it keep the amount they were created with; only future cycles pick up the
 * new default. That is why this updates the template row and nothing else.
 */
export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string } & Partial<TemplateInput>) => {
      if (args.name !== undefined && args.name.trim().length < 3) {
        throw new Error('Nama template minimal 3 huruf.');
      }
      if (args.defaultAmount !== undefined && !(args.defaultAmount > 0)) {
        throw new Error('Nominal default harus lebih dari Rp 0.');
      }
      if (args.dueDay != null && (args.dueDay < 1 || args.dueDay > 31)) {
        throw new Error('Tanggal jatuh tempo harus antara 1 dan 31.');
      }
      const sb = requireSupabase();
      const patch: Record<string, string | number | null> = {};
      if (args.name !== undefined) patch.name = args.name.trim();
      if (args.categoryId !== undefined) patch.category_id = args.categoryId;
      if (args.accountId !== undefined) patch.account_id = args.accountId;
      if (args.direction !== undefined) patch.direction = args.direction;
      if (args.defaultAmount !== undefined) patch.default_amount = args.defaultAmount;
      if (args.dueDay !== undefined) patch.due_day = args.dueDay;
      if (args.notes !== undefined) patch.notes = args.notes;
      if (Object.keys(patch).length === 0) return null;
      const { data, error } = await sb.from('recurring_templates')
        .update(patch).eq('id', args.id).select('*').single();
      if (error) throw error;
      return data as Template;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tmpl'] }),
  });
}

export function useSetTemplateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; status: 'ACTIVE' | 'COMPLETED' }) => {
      const sb = requireSupabase();
      const { error } = await sb.from('recurring_templates')
        .update({ status: args.status }).eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tmpl'] }),
  });
}

export interface CategoryInput {
  name: string; monthlyBudget: number; type: 'EXPENSE' | 'INCOME' | 'INVESTMENT';
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string } & CategoryInput) => {
      const name = args.name.trim();
      if (name.length < 2) throw new Error('Nama kategori minimal 2 huruf.');
      if (args.monthlyBudget < 0) throw new Error('Pagu tidak boleh negatif.');
      const sb = requireSupabase();
      const { data, error } = await sb.from('categories').insert({
        household_id: args.householdId, name,
        monthly_budget: args.monthlyBudget, type: args.type,
        is_system: false, system_role: null,
      }).select('*').single();
      if (error) throw error;
      return data as Category;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cats'] }),
  });
}

/**
 * Renaming a system category is allowed — the family may call the "Pinjaman"
 * slot something else. Deleting one is not: the ledger and the zero-based
 * summary refer to those rows by role, and migration 006 enforces the refusal
 * with a trigger, so this only mirrors the guard for a clearer message.
 */
export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string } & Partial<CategoryInput>) => {
      if (args.name !== undefined && args.name.trim().length < 2) {
        throw new Error('Nama kategori minimal 2 huruf.');
      }
      if (args.monthlyBudget !== undefined && args.monthlyBudget < 0) {
        throw new Error('Pagu tidak boleh negatif.');
      }
      const sb = requireSupabase();
      const patch: Record<string, string | number | null> = {};
      if (args.name !== undefined) patch.name = args.name.trim();
      if (args.monthlyBudget !== undefined) patch.monthly_budget = args.monthlyBudget;
      if (args.type !== undefined) patch.type = args.type;
      if (Object.keys(patch).length === 0) return null;
      const { data, error } = await sb.from('categories')
        .update(patch).eq('id', args.id).select('*').single();
      if (error) throw error;
      return data as Category;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cats'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; isSystem?: boolean }) => {
      if (args.isSystem) throw new Error('Kategori sistem tidak dapat dihapus.');
      const sb = requireSupabase();
      const { error } = await sb.from('categories').delete().eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cats'] });
      // Transactions and allocations keep their rows (ON DELETE SET NULL), but
      // their joined category name disappears — so any view showing them is now
      // stale and must refetch.
      invalidateMoneyKeys(qc);
    },
  });
}

// ============ Phase 5A: household roster and profile ============

/**
 * The family roster for Ruang Keluarga.
 *
 * `partial` is true when migration 007 has not been run: the RPC is missing, so
 * the fallback can only return the caller's own row. The screen says so rather
 * than presenting a roster of one as the whole truth — a silently short list
 * would look like the partner had left the household.
 */
export function useHouseholdMembers(householdId: string | undefined) {
  return useQuery({
    queryKey: ['members', householdId],
    enabled: !!householdId,
    queryFn: () => listHouseholdMembers(householdId!),
  });
}

/**
 * Rename the household / set the payday day. Through `updateHousehold` so the
 * validation and the 007 UPDATE policy are exercised in one place — the
 * household name is the header on every screen that names the family, and a
 * blank one renders as an empty title.
 *
 * Note the household row itself does NOT live in React Query: `AuthProvider`
 * holds it in state and every screen reads it from `useAuth()`. So this
 * mutation cannot refresh the title on its own — the caller must `await
 * refresh()` from `useAuth()` after success, which is what Ruang Keluarga does.
 */
export function useUpdateHousehold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; name?: string; paydayDay?: number | null }) =>
      updateHousehold(args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
}

/**
 * The caller's own display name and notification preference. Scoped to
 * `user_id = auth.uid()` by the 001 policy, so it can never touch the partner's
 * row — the name shown against the partner is whatever they set for themselves.
 */
export function useUpdateMyMemberProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      householdId: string;
      displayName?: string;
      notifyPartnerExpense?: boolean;
    }) => updateMyMemberProfile(args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });
}
