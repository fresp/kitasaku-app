import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireSupabase } from './supabase';
import {
  calculateZeroBasedSummary,
  defaultFlowType,
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
export interface Category { id: string; household_id: string; name: string; monthly_budget: number; type: string; }
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
}
export interface Template {
  id: string; household_id: string; name: string; category_id: string | null;
  account_id: string | null; direction: 'INCOME' | 'EXPENSE'; default_amount: number;
  status: 'ACTIVE' | 'COMPLETED'; notes: string | null;
  categories?: { name: string } | null; accounts?: { name: string } | null;
}

function todayISO(): string { return new Date().toISOString().slice(0, 10); }

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
      if (args.txn.obligation_id) {
        const { data: ob } = await sb.from('obligations').select('*').eq('id', args.txn.obligation_id).maybeSingle();
        if (ob) {
          const remaining = Math.max(0, (ob as Obligation).remaining_amount - args.actualAmount);
          await sb.from('obligations').update({
            remaining_amount: remaining,
            status: remaining <= 0 ? 'SETTLED' : 'PARTIAL',
          }).eq('id', args.txn.obligation_id);
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['txns'] }); qc.invalidateQueries({ queryKey: ['oblig'] }); qc.invalidateQueries({ queryKey: ['tmpl'] }); },
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['txns'] }); qc.invalidateQueries({ queryKey: ['tmpl'] }); },
  });
}

export function useAllocateObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; cycleId: string; obligationId: string;
      amount: number; categoryId: string | null; accountId: string | null;
    }) => {
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const { data: ob } = await sb.from('obligations').select('*').eq('id', args.obligationId).maybeSingle();
      const title = (ob as Obligation | null)?.title ?? 'Alokasi tanggungan';
      const { error } = await sb.from('transactions').insert({
        household_id: args.householdId, cycle_id: args.cycleId,
        obligation_id: args.obligationId, name: title,
        direction: 'EXPENSE', flow_type: 'EXPENSE', planned_amount: args.amount, actual_amount: args.amount,
        status: 'PENDING', release_date: null,
        category_id: args.categoryId, account_id: args.accountId,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['txns'] }); },
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cycle'] }); qc.invalidateQueries({ queryKey: ['txns'] }); },
  });
}

export function useCreateObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string; title: string; type: string; total: number; recipient?: string }) => {
      const sb = requireSupabase();
      const { error } = await sb.from('obligations').insert({
        household_id: args.householdId, title: args.title, type: args.type,
        total_amount: args.total, remaining_amount: args.total, status: 'UNPAID',
        recipient: args.recipient ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['oblig'] }); },
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

export function useCreateFinancingLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; cycleId: string; amount: number; name: string;
      obligationTitle: string; obligationType: 'BILL' | 'LOAN' | 'REIMBURSEMENT' | 'INSTALLMENT';
      accountId?: string | null; dueDate?: string | null;
    }) => {
      if (!(args.amount > 0)) throw new Error('Nominal pembiayaan harus lebih dari 0.');
      const sb = requireSupabase();
      const { data, error } = await sb.rpc('create_financing_with_obligation', {
        p_household_id: args.householdId, p_cycle_id: args.cycleId, p_amount: args.amount,
        p_name: args.name, p_obligation_title: args.obligationTitle,
        p_obligation_type: args.obligationType, p_account_id: args.accountId ?? null,
        p_due_date: args.dueDate ?? null,
      });
      if (error) throw error;
      return data as { transaction_id: string; obligation_id: string }[];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['txns'] });
      qc.invalidateQueries({ queryKey: ['oblig'] });
      qc.invalidateQueries({ queryKey: ['source-funds'] });
      qc.invalidateQueries({ queryKey: ['zero-summary'] });
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['txns'] });
      qc.invalidateQueries({ queryKey: ['oblig'] });
      qc.invalidateQueries({ queryKey: ['alloc'] });
      qc.invalidateQueries({ queryKey: ['zero-summary'] });
      qc.invalidateQueries({ queryKey: ['source-funds'] });
    },
  });
}
