import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireSupabase } from './supabase';

export interface Cycle { id: string; household_id: string; name: string; start_date: string; end_date: string; is_active: boolean; }
export interface Category { id: string; household_id: string; name: string; monthly_budget: number; type: string; }
export interface Account { id: string; household_id: string; name: string; type: string; }
export interface Txn {
  id: string; household_id: string; cycle_id: string | null;
  recurring_template_id: string | null; obligation_id: string | null;
  name: string; category_id: string | null; account_id: string | null;
  direction: 'INCOME' | 'EXPENSE'; planned_amount: number; actual_amount: number;
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
        direction: args.direction, planned_amount: args.amount, actual_amount: args.amount,
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
        direction: 'EXPENSE', planned_amount: args.amount, actual_amount: args.amount,
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
      const rows: any[] = args.items.map((it) => ({
        household_id: args.householdId, cycle_id: cid,
        recurring_template_id: it.templateId, name: it.name,
        direction: it.direction, planned_amount: it.amount, actual_amount: it.amount,
        status: 'PENDING', release_date: null,
        category_id: it.categoryId, account_id: it.accountId,
        created_by: user?.id ?? null,
      }));
      if (args.incomeAmount > 0) {
        rows.push({
          household_id: args.householdId, cycle_id: cid,
          recurring_template_id: null, name: 'Gaji Bulanan',
          direction: 'INCOME' as const, planned_amount: args.incomeAmount, actual_amount: args.incomeAmount,
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

export function calcCashflow(txns: Txn[]): { kasRiil: number; estimasiSisa: number; pendingCount: number; paidCount: number } {
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
  const kasRiil = cashIn - cashOut;
  return { kasRiil, estimasiSisa: kasRiil - pendingOut, pendingCount, paidCount };
}
