import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { requireSupabase } from './supabase';
import { listHouseholdMembers, updateHousehold, updateMyMemberProfile } from './household';
import { isRepaymentMode } from './obligation';
import type { RepaymentMode } from './obligation';
import type { InstallmentMode } from './installments';
import type { Beneficiary } from './beneficiary';
import { cleanAccountNumber } from './beneficiary';
import {
  normalizeAccountNumber,
  sortAccounts,
  validateAccountNumber,
} from './account';
import {
  accountZeroBased,
  calculateZeroBasedSummary,
  canMarkAsPaid,
  defaultFlowType,
  isObligationPaydown,
  ledgerDisplayAmount,
  reconciliationPreview,
  resolveModeAmount,
} from './zero-based';
import type {
  AccountZeroBasedTransaction,
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
export type { Beneficiary } from './beneficiary';

export interface Cycle {
  id: string;
  household_id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  primary_account_id: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
  sweep_completed_at?: string | null;
  sweep_skipped?: boolean;
}

export interface CycleReconciliation {
  id: string;
  household_id: string;
  cycle_id: string;
  account_id: string;
  opening_stated: number | null;
  closing_stated: number;
  recorded_net: number;
  delta: number;
  adjustment_txn_id: string | null;
  noted_at: string;
  noted_by: string | null;
  accounts?: { name: string; type: string } | null;
}

export type CategorySystemRole = 'DEBT_PAYMENT' | 'FINANCING_INFLOW' | 'UNTRACKED';
export interface Category {
  id: string; household_id: string; name: string; monthly_budget: number; type: string;
  is_system?: boolean; system_role?: CategorySystemRole | null;
  /**
   * The icon the family picked in Kelola Kategori (migration 009), or null when
   * they have not picked one. Never read directly by a screen: pass it to
   * `categoryIconName`, which falls back to a name-derived icon when this is
   * null or names something the shipped pack does not have.
   */
  icon?: string | null;
}
export interface Account {
  id: string;
  household_id: string;
  name: string;
  type: string;
  account_number?: string | null;
  account_holder_name?: string | null;
  is_active?: boolean;
  sort_order?: number;
  icon?: string | null;
}
export type TransactionStatus = 'PENDING' | 'PAID' | 'CANCELLED';
export type CancellationReason = 'WRONG_INPUT' | 'DUPLICATE' | 'NOT_HAPPENED' | 'OTHER';

export const CANCELLATION_REASONS: { value: CancellationReason; label: string }[] = [
  { value: 'WRONG_INPUT', label: 'Salah input' },
  { value: 'DUPLICATE', label: 'Duplikat' },
  { value: 'NOT_HAPPENED', label: 'Tidak jadi' },
  { value: 'OTHER', label: 'Lainnya' },
];

export interface Txn {
  id: string; household_id: string; cycle_id: string | null;
  recurring_template_id: string | null; obligation_id: string | null;
  name: string; category_id: string | null; account_id: string | null;
  direction: 'INCOME' | 'EXPENSE'; flow_type?: FlowType | null; planned_amount: number; actual_amount: number;
  counter_account_id?: string | null; asset_id?: string | null;
  release_date: string | null; status: TransactionStatus;
  cancelled_at?: string | null; cancelled_by?: string | null;
  cancellation_reason?: CancellationReason | null; cancellation_note?: string | null;
  created_by: string | null; executed_by: string | null;
  recipient: string | null; is_final_payment: boolean; created_at: string;
  // joined
  categories?: { name: string; icon?: string | null } | null;
  accounts?: { name: string } | null;
}
export interface Obligation {
  id: string; household_id: string; title: string; type: string; recipient: string | null;
  total_amount: number; remaining_amount: number; status: string; created_at: string; notes: string | null;
  source_transaction_id?: string | null; repayment_method?: string | null;
  planned_installment_amount?: number | null; installment_count?: number | null;
  current_installment?: number | null; start_date?: string | null; due_date?: string | null;
  interest_fee_amount?: number | null;
  interest_mode?: InstallmentMode | null;
  interest_rate_bps?: number | null;
  principal_amount?: number | null;
  /**
   * Plan shape (migration 008): LUMP_NEXT_MONTH | INSTALLMENT | MANUAL.
   * `null`/undefined means nobody has chosen — see `repaymentModeOf` in
   * lib/obligation.ts, which derives a *display* default and says it did.
   */
  repayment_mode?: string | null;
  /**
   * Counterparty beneficiary reference (migration 011 / Flow K).
   * External destination account for paying this obligation/bill.
   */
  beneficiary_id?: string | null;
  beneficiary?: Beneficiary | null;
}
export interface Template {
  id: string; household_id: string; name: string; category_id: string | null;
  account_id: string | null; direction: 'INCOME' | 'EXPENSE'; default_amount: number;
  status: 'ACTIVE' | 'COMPLETED'; notes: string | null;
  /** Day of month the bill is due; null = no known due day (migration 006). */
  due_day?: number | null;
  categories?: { name: string; icon?: string | null } | null; accounts?: { name: string } | null;
}
export interface ObligationInstallment {
  id: string; household_id: string; obligation_id: string; cycle_id: string | null;
  planned_amount: number; due_date: string | null;
  principal_amount?: number | null;
  interest_amount?: number | null;
  remaining_principal?: number | null;
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
  // Insight & Aset reads the same transactions and allocations through a
  // different key. It used to be the one money screen a mutation could not
  // refresh, so its charts kept yesterday's asset position while every other
  // screen updated.
  qc.invalidateQueries({ queryKey: ['year-insight'] });
  qc.invalidateQueries({ queryKey: ['assets'] });
  qc.invalidateQueries({ queryKey: ['asset-valuations'] });
  qc.invalidateQueries({ queryKey: ['asset-movements'] });
  qc.invalidateQueries({ queryKey: ['audit-txns'] });
  qc.invalidateQueries({ queryKey: ['reconciliation'] });
  qc.invalidateQueries({ queryKey: ['cycle-sweep'] });
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
        .select('*, categories(name, icon), accounts!transactions_account_id_fkey(name)')
        .eq('household_id', householdId!).eq('cycle_id', cycleId!)
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Txn[];
    },
  });
}

/** Explicit audit stream for transactions that are not assigned to a cycle. */
export function useNonCycleTransactions(householdId: string | undefined) {
  return useQuery({
    queryKey: ['audit-txns', householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<Txn[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('transactions')
        .select('*, categories(name, icon), accounts!transactions_account_id_fkey(name)')
        .eq('household_id', householdId!)
        .is('cycle_id', null)
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

export function useBankAccounts(householdId: string | undefined) {
  return useQuery({
    queryKey: ['bank-accounts', householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<Account[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb
        .from('accounts')
        .select('*')
        .eq('household_id', householdId!)
        .eq('type', 'BANK')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });
}

export function useAccounts(
  householdId: string | undefined,
  options?: { includeArchived?: boolean; enabled?: boolean }
) {
  const includeArchived = options?.includeArchived ?? false;
  return useQuery({
    queryKey: ['accs', householdId, includeArchived],
    enabled: (options?.enabled ?? true) && !!householdId,
    queryFn: async (): Promise<Account[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb
        .from('accounts')
        .select('*')
        .eq('household_id', householdId!)
        .order('name');
      if (error) throw error;
      const accounts = (data ?? []) as Account[];
      const sorted = sortAccounts(accounts);
      return includeArchived ? sorted : sorted.filter((a) => a.is_active !== false);
    },
  });
}

export function useObligations(householdId: string | undefined) {
  return useQuery({
    queryKey: ['oblig', householdId], enabled: !!householdId,
    queryFn: async (): Promise<Obligation[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('obligations')
        .select('*, beneficiary:beneficiaries(*)')
        .eq('household_id', householdId!).not('status', 'in', '(SETTLED,CANCELLED)').order('created_at', { ascending: false });
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
        .select('*, categories(name, icon), accounts(name)')
        .eq('household_id', householdId!).order('name');
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });
}

export function useMarkAsPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      txn: Txn;
      actualAmount: number;
      accountId?: string | null;
      isFinal: boolean;
      releaseDate?: string | null;
    }) => {
      // Exactly-once guard: `allocate_debt_payment` inserts its row already PAID
      // and reduced the obligation inside SQL. Re-confirming that row here would
      // decrement `remaining_amount` a second time.
      if (!canMarkAsPaid(args.txn)) {
        throw new Error('Transaksi ini sudah lunas.');
      }
      if (!(args.actualAmount > 0)) {
        throw new Error('Nominal pembayaran harus lebih dari Rp 0.');
      }
      const releaseDate = args.releaseDate ?? todayISO();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
        throw new Error('Tanggal transaksi harus menggunakan format YYYY-MM-DD.');
      }
      if (releaseDate > todayISO()) {
        throw new Error('Tanggal transaksi tidak boleh di masa depan.');
      }
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      if (args.txn.status === 'CANCELLED') {
        throw new Error('Transaksi yang sudah dibatalkan tidak dapat dibayar.');
      }
      if (isObligationPaydown(args.txn) && args.txn.obligation_id) {
        const { data: ob, error: obErr } = await sb.from('obligations')
          .select('status').eq('id', args.txn.obligation_id).maybeSingle();
        if (obErr) throw obErr;
        if (ob?.status === 'CANCELLED') {
          throw new Error('Tanggungan yang sudah dibatalkan tidak dapat dibayar.');
        }
      }
      const { error: uErr } = await sb.from('transactions').update({
        status: 'PAID', actual_amount: args.actualAmount,
        release_date: releaseDate, executed_by: user?.id ?? null,
        account_id: args.accountId ?? args.txn.account_id,
        is_final_payment: args.isFinal,
      }).eq('id', args.txn.id).eq('status', 'PENDING');
      if (uErr) throw uErr;
      if (uErr) throw uErr;
      if (args.isFinal && args.txn.recurring_template_id) {
        const { error } = await sb.from('recurring_templates').update({ status: 'COMPLETED' }).eq('id', args.txn.recurring_template_id);
        if (error) throw error;
      }
      if (isObligationPaydown(args.txn)) {
        const { data: ob, error: obErr } = await sb.from('obligations').select('*').eq('id', args.txn.obligation_id!).maybeSingle();
        if (obErr) throw obErr;
        if (ob) {
          if ((ob as Obligation).status === 'CANCELLED') {
            throw new Error('Tanggungan yang sudah dibatalkan tidak dapat dibayar.');
          }
          const remaining = Math.max(0, (ob as Obligation).remaining_amount - args.actualAmount);
          const { error: updateErr } = await sb.from('obligations').update({
            remaining_amount: remaining,
            status: remaining <= 0 ? 'SETTLED' : 'PARTIAL',
          }).eq('id', args.txn.obligation_id!).neq('status', 'CANCELLED');
          if (updateErr) throw updateErr;
        }
      }
    },
    onSuccess: () => {
      invalidateMoneyKeys(qc);
      qc.invalidateQueries({ queryKey: ['tmpl'] });
    },
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      name: string;
      amount: number;
      releaseDate: string;
      categoryId: string | null;
      accountId: string | null;
      status: 'PENDING' | 'PAID';
    }): Promise<Txn> => {
      if (args.name.trim().length < 3) throw new Error('Nama transaksi minimal 3 huruf.');
      if (!(args.amount > 0)) throw new Error('Nominal harus lebih dari Rp 0.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.releaseDate)) {
        throw new Error('Tanggal transaksi harus menggunakan format YYYY-MM-DD.');
      }
      if (args.releaseDate > todayISO()) {
        throw new Error('Tanggal transaksi tidak boleh di masa depan.');
      }
      const sb = requireSupabase();
      const patch: Record<string, string | number | null> = {
        name: args.name.trim(),
        planned_amount: args.amount,
        category_id: args.categoryId,
        account_id: args.accountId,
      };
      if (args.status === 'PAID') {
        patch.actual_amount = args.amount;
        patch.release_date = args.releaseDate;
      } else {
        // Editing a plan must not make it look executed or move cash.
        patch.release_date = null;
      }
      const { data, error } = await sb.from('transactions').update(patch)
        .eq('id', args.id).select('*').single();
      if (error) throw error;
      return data as Txn;
    },
    onSuccess: () => invalidateMoneyKeys(qc),
  });
}

export function useCancelPendingTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string;
      transactionId: string;
      reason: CancellationReason;
      note?: string | null;
    }) => {
      const reason = args.reason;
      const note = args.note?.trim() || null;
      if (!CANCELLATION_REASONS.some((item) => item.value === reason)) {
        throw new Error('Alasan pembatalan tidak dikenal.');
      }
      if (note && note.length > 500) {
        throw new Error('Catatan pembatalan maksimal 500 karakter.');
      }
      const sb = requireSupabase();
      const { error } = await sb.rpc('cancel_pending_transaction', {
        p_household_id: args.householdId,
        p_transaction_id: args.transactionId,
        p_reason: reason,
        p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateMoneyKeys(qc),
  });
}

export function useCancelObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string;
      obligationId: string;
      reason: CancellationReason;
      note?: string | null;
    }) => {
      const reason = args.reason;
      const note = args.note?.trim() || null;
      if (!CANCELLATION_REASONS.some((item) => item.value === reason)) {
        throw new Error('Alasan pembatalan tidak dikenal.');
      }
      if (note && note.length > 500) {
        throw new Error('Catatan pembatalan maksimal 500 karakter.');
      }
      const sb = requireSupabase();
      const { error } = await sb.rpc('cancel_obligation', {
        p_household_id: args.householdId,
        p_obligation_id: args.obligationId,
        p_reason: reason,
        p_note: note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateMoneyKeys(qc);
      qc.invalidateQueries({ queryKey: ['installments'] });
    },
  });
}

export function useQuickAdd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; cycleId?: string | null; name: string; amount: number;
      direction: 'INCOME' | 'EXPENSE'; categoryId: string | null; accountId: string | null;
      makeRecurring: boolean; releaseDate?: string | null;
    }) => {
      if (args.releaseDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(args.releaseDate)) {
        throw new Error('Tanggal transaksi harus menggunakan format YYYY-MM-DD.');
      }
      if (args.releaseDate != null && args.releaseDate > todayISO()) {
        throw new Error('Tanggal transaksi tidak boleh di masa depan.');
      }
      if (!(args.amount > 0)) throw new Error('Nominal harus lebih dari Rp 0.');
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const { data: txn, error } = await sb.from('transactions').insert({
        household_id: args.householdId, cycle_id: args.cycleId ?? null, name: args.name,
        direction: args.direction, flow_type: args.direction === 'INCOME' ? 'OPERATING_INCOME' : 'EXPENSE',
        planned_amount: args.amount, actual_amount: args.amount,
        status: 'PAID', release_date: args.releaseDate ?? todayISO(),
        category_id: args.categoryId, account_id: args.accountId,
        created_by: user?.id ?? null, executed_by: user?.id ?? null,
      }).select('*').single();
      if (error) throw error;
      if (args.makeRecurring) {
        if (!args.cycleId) throw new Error('Transaksi di luar siklus tidak dapat dijadikan transaksi rutin.');
        const { data: t, error: templateErr } = await sb.from('recurring_templates').insert({
          household_id: args.householdId, name: args.name,
          category_id: args.categoryId, account_id: args.accountId,
          direction: args.direction, default_amount: args.amount, status: 'ACTIVE',
        }).select('*').single();
        if (templateErr) throw templateErr;
        if (t) {
          const { error: linkErr } = await sb.from('transactions').update({ recurring_template_id: (t as Template).id }).eq('id', (txn as Txn).id);
          if (linkErr) throw linkErr;
        }
      }
      return txn as Txn;
    },
    onSuccess: () => {
      invalidateMoneyKeys(qc);
      qc.invalidateQueries({ queryKey: ['tmpl'] });
    },
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; cycleId?: string | null; name: string; amount: number;
      fromAccountId: string; toAccountId: string;
    }): Promise<Txn> => {
      if (!(args.amount > 0)) throw new Error('Nominal relokasi harus lebih dari Rp 0.');
      if (args.fromAccountId === args.toAccountId) throw new Error('Akun asal dan tujuan harus berbeda.');
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const { data, error } = await sb.from('transactions').insert({
        household_id: args.householdId,
        cycle_id: args.cycleId ?? null,
        name: args.name.trim(),
        direction: 'EXPENSE',
        flow_type: 'TRANSFER',
        planned_amount: args.amount,
        actual_amount: args.amount,
        status: 'PAID',
        release_date: todayISO(),
        account_id: args.fromAccountId,
        counter_account_id: args.toAccountId,
        created_by: user?.id ?? null,
        executed_by: user?.id ?? null,
      }).select('*').single();
      if (error) throw error;
      return data as Txn;
    },
    onSuccess: () => invalidateMoneyKeys(qc),
  });
}

export function useCreateAssetAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; cycleId?: string | null; name: string; amount: number;
      accountId: string; assetId: string; categoryId: string | null;
    }): Promise<Txn> => {
      if (!(args.amount > 0)) throw new Error('Nominal alokasi aset harus lebih dari Rp 0.');
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const { data, error } = await sb.from('transactions').insert({
        household_id: args.householdId,
        cycle_id: args.cycleId ?? null,
        name: args.name.trim(),
        direction: 'EXPENSE',
        flow_type: 'ASSET_ALLOCATION',
        planned_amount: args.amount,
        actual_amount: args.amount,
        status: 'PAID',
        release_date: todayISO(),
        category_id: args.categoryId,
        account_id: args.accountId,
        asset_id: args.assetId,
        created_by: user?.id ?? null,
        executed_by: user?.id ?? null,
      }).select('*').single();
      if (error) throw error;
      return data as Txn;
    },
    onSuccess: () => invalidateMoneyKeys(qc),
  });
}

export function useCreateAssetRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; cycleId?: string | null; name: string; amount: number;
      accountId: string; assetId: string; categoryId: string | null;
    }): Promise<Txn> => {
      if (!(args.amount > 0)) throw new Error('Nominal pencairan aset harus lebih dari Rp 0.');
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const { data, error } = await sb.from('transactions').insert({
        household_id: args.householdId,
        cycle_id: args.cycleId ?? null,
        name: args.name.trim(),
        direction: 'INCOME',
        flow_type: 'ASSET_RELEASE',
        planned_amount: args.amount,
        actual_amount: args.amount,
        status: 'PAID',
        release_date: todayISO(),
        category_id: args.categoryId,
        account_id: args.accountId,
        asset_id: args.assetId,
        created_by: user?.id ?? null,
        executed_by: user?.id ?? null,
      }).select('*').single();
      if (error) throw error;
      return data as Txn;
    },
    onSuccess: () => invalidateMoneyKeys(qc),
  });
}

export function useAssets(householdId: string | undefined) {
  return useQuery({
    queryKey: ['assets', householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<Asset[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('assets').select('*').eq('household_id', householdId!).eq('is_active', true).order('name');
      if (error) throw error;
      return (data ?? []) as Asset[];
    },
  });
}

export interface Asset {
  id: string;
  household_id: string;
  name: string;
  band: string;
  is_active: boolean;
  created_at: string;
}

export interface AssetValuation {
  id: string;
  household_id: string;
  asset_id: string;
  stated_value: number;
  valued_at: string;
  noted_by: string | null;
  created_at: string;
}

export function useAssetValuations(householdId: string | undefined, assetId?: string) {
  return useQuery({
    queryKey: ['asset-valuations', householdId, assetId],
    enabled: !!householdId,
    queryFn: async (): Promise<AssetValuation[]> => {
      const sb = requireSupabase();
      let query = sb.from('asset_valuations').select('*').eq('household_id', householdId!).order('valued_at', { ascending: false });
      if (assetId) query = query.eq('asset_id', assetId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as AssetValuation[];
    },
  });
}

export interface AssetMovement {
  asset_id: string;
  flow_type: FlowType;
  actual_amount: number;
  status: TransactionStatus;
}

/** All asset-linked cash movements, kept separate from cycle insight rows. */
export function useAssetMovements(householdId: string | undefined) {
  return useQuery({
    queryKey: ['asset-movements', householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<AssetMovement[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('transactions')
        .select('asset_id, flow_type, actual_amount, status')
        .eq('household_id', householdId!)
        .not('asset_id', 'is', null)
        .in('flow_type', ['ASSET_ALLOCATION', 'ASSET_RELEASE']);
      if (error) throw error;
      return (data ?? []) as AssetMovement[];
    },
  });
}

export function useCreateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string; name: string; band: string }): Promise<Asset> => {
      if (args.name.trim().length < 2) throw new Error('Nama aset minimal 2 huruf.');
      const sb = requireSupabase();
      const { data, error } = await sb.from('assets').insert({ household_id: args.householdId, name: args.name.trim(), band: args.band, is_active: true }).select('*').single();
      if (error) throw error;
      return data as Asset;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

export function useRecordAssetValuation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string; assetId: string; statedValue: number; valuedAt: string }): Promise<AssetValuation> => {
      if (args.statedValue < 0) throw new Error('Nilai aset tidak boleh negatif.');
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const { data, error } = await sb.from('asset_valuations').insert({ household_id: args.householdId, asset_id: args.assetId, stated_value: args.statedValue, valued_at: args.valuedAt, noted_by: user?.id ?? null }).select('*').single();
      if (error) throw error;
      return data as AssetValuation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['asset-valuations'] });
      qc.invalidateQueries({ queryKey: ['year-insight'] });
    },
  });
}

export function useAccountZeroBasedSummary(
  householdId: string | undefined,
  cycleId: string | undefined,
  accountId: string | undefined,
  mode: SummaryMode = 'planned',
) {
  return useQuery({
    queryKey: ['zero-summary', 'account', householdId, cycleId, accountId, mode],
    enabled: !!householdId && !!cycleId && !!accountId,
    queryFn: async () => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('transactions')
        .select('account_id, counter_account_id, flow_type, direction, planned_amount, actual_amount, status, obligation_id')
        .eq('household_id', householdId!).eq('cycle_id', cycleId!);
      if (error) throw error;
      return accountZeroBased({ accountId: accountId!, transactions: (data ?? []) as AccountZeroBasedTransaction[], mode });
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
      if (!obligation) throw new Error('Tanggungan tidak ditemukan.');
      if (obligation.status === 'CANCELLED') {
        throw new Error('Tanggungan yang sudah dibatalkan tidak dapat dialokasikan.');
      }
      if (args.amount > obligation.remaining_amount) {
        throw new Error('Nominal alokasi melebihi sisa tanggungan.');
      }
      const title = obligation.title;
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

/**
 * Opens a cycle: the moment a plan becomes binding, so everything the plan
 * commits to is materialised here — not later, not implicitly.
 *
 * Two things are written per commitment, and they answer different questions:
 *
 *   - a `transactions` row in `PENDING`, which is what the ledger lists and what
 *     the family pays off. Cloned routine positions and carried-over obligations
 *     alike. `release_date` stays null until it is actually executed.
 *   - a `cycle_allocations` row, which is the commitment itself. Phase 1's
 *     anti-double-count rule says the allocation total comes from these rows
 *     alone, and Phase 2 adds that committing money *is* the allocation — so
 *     writing only the transaction would leave "Total Alokasi" at Rp 0 while
 *     the screen that opened the cycle insisted the money was committed.
 *
 * An obligation also gets `flow_type: 'DEBT_PAYMENT'` and its `obligation_id`,
 * which is what makes `useMarkAsPaid` reduce `remaining_amount` exactly once
 * when the row is paid (see docs/phase-2-payment-paths.md).
 *
 * Note on atomicity: this is three round trips (cycle, transactions,
 * allocations), so a failure between them can leave a cycle with rows but no
 * allocations. The existing `create_financing_with_obligation` /
 * `allocate_debt_payment` RPCs exist precisely to avoid that pattern; folding
 * cycle creation into an RPC is the follow-up, tracked in the release audit.
 */
export function useUpdateCyclePrimaryAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string; cycleId: string; accountId: string | null }) => {
      const sb = requireSupabase();
      if (args.accountId) {
        const { data, error } = await sb.from('accounts').select('id, type, is_active')
          .eq('id', args.accountId).eq('household_id', args.householdId).maybeSingle();
        if (error) throw error;
        if (!data || data.type !== 'BANK' || data.is_active === false) {
          throw new Error('Rekening utama harus berupa rekening BANK yang aktif.');
        }
      }
      const { data, error } = await sb.from('cycles')
        .update({ primary_account_id: args.accountId })
        .eq('id', args.cycleId).eq('household_id', args.householdId)
        .select('*').single();
      if (error) throw error;
      return data as Cycle;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cycle'] });
      qc.invalidateQueries({ queryKey: ['reconciliation'] });
      qc.invalidateQueries({ queryKey: ['audit-txns'] });
    },
  });
}

export interface ReconciliationBlockingIssue {
  kind: 'PENDING' | 'NULL_ACCOUNT' | 'OUTSIDE_CYCLE_PRIMARY';
  count: number;
}

export interface CycleReconciliationPreview {
  cycle: Cycle;
  reconciliation: CycleReconciliation | null;
  primaryAccount: Account | null;
  preview: ReturnType<typeof reconciliationPreview>;
  issues: ReconciliationBlockingIssue[];
}

export function useCycleReconciliation(householdId: string | undefined, cycleId: string | undefined) {
  return useQuery({
    queryKey: ['reconciliation', householdId, cycleId],
    enabled: !!householdId && !!cycleId,
    queryFn: async (): Promise<CycleReconciliation | null> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('cycle_reconciliations')
        .select('*, accounts(name, type)')
        .eq('household_id', householdId!).eq('cycle_id', cycleId!)
        .maybeSingle();
      if (error) throw error;
      return (data as CycleReconciliation | null) ?? null;
    },
  });
}

/**
 * Reads the active cycle's primary account and only the rows relevant to its
 * closing movement. Non-cycle rows remain available as audit data, but are
 * surfaced separately because they cannot be silently assigned to this cycle.
 */
export function useCycleReconciliationPreview(
  householdId: string | undefined,
  cycleId: string | undefined,
  closingStated: number | null,
) {
  return useQuery({
    queryKey: ['reconciliation-preview', householdId, cycleId, closingStated],
    enabled: !!householdId && !!cycleId,
    queryFn: async (): Promise<CycleReconciliationPreview> => {
      const sb = requireSupabase();
      const { data: cycleData, error: cycleErr } = await sb.from('cycles')
        .select('*').eq('household_id', householdId!).eq('id', cycleId!).single();
      if (cycleErr) throw cycleErr;
      const cycle = cycleData as Cycle;
      if (!cycle.primary_account_id) {
        throw new Error('Siklus ini belum memiliki akun primer BANK.');
      }

      const [{ data: accountData, error: accountErr }, { data: txnData, error: txnErr }, { count: outsideCount, error: outsideErr }, { data: priorCycleData, error: priorCycleErr }] = await Promise.all([
        sb.from('accounts').select('*').eq('id', cycle.primary_account_id).eq('household_id', householdId!).single(),
        sb.from('transactions')
          .select('account_id, counter_account_id, direction, flow_type, planned_amount, actual_amount, status, obligation_id')
          .eq('household_id', householdId!).eq('cycle_id', cycleId!),
        sb.from('transactions').select('id', { count: 'exact', head: true })
          .eq('household_id', householdId!).is('cycle_id', null)
          .or(`account_id.eq.${cycle.primary_account_id},counter_account_id.eq.${cycle.primary_account_id}`),
        sb.from('cycles').select('id')
          .eq('household_id', householdId!).lt('end_date', cycle.start_date)
          .order('end_date', { ascending: false }).limit(1),
      ]);
      if (accountErr) throw accountErr;
      if (txnErr) throw txnErr;
      if (outsideErr) throw outsideErr;
      if (priorCycleErr) throw priorCycleErr;

      const primaryAccount = accountData as Account;
      const priorCycleId = (priorCycleData ?? [])[0]?.id;
      let openingStated: number | null = null;
      if (priorCycleId) {
        const { data: priorReconciliation, error: priorReconciliationErr } = await sb
          .from('cycle_reconciliations').select('closing_stated')
          .eq('household_id', householdId!).eq('cycle_id', priorCycleId).maybeSingle();
        if (priorReconciliationErr) throw priorReconciliationErr;
        openingStated = (priorReconciliation as { closing_stated?: number } | null)?.closing_stated ?? null;
      }
      const preview = reconciliationPreview({
        accountId: cycle.primary_account_id,
        openingStated,
        closingStated,
        transactions: (txnData ?? []) as Txn[],
        outsideCyclePrimaryCount: outsideCount ?? 0,
      });
      const issues: ReconciliationBlockingIssue[] = [];
      if (preview.pendingCount > 0) issues.push({ kind: 'PENDING', count: preview.pendingCount });
      if (preview.nullAccountCount > 0) issues.push({ kind: 'NULL_ACCOUNT', count: preview.nullAccountCount });
      if (preview.outsideCyclePrimaryCount > 0) {
        issues.push({ kind: 'OUTSIDE_CYCLE_PRIMARY', count: preview.outsideCyclePrimaryCount });
      }
      return { cycle, reconciliation: null, primaryAccount, preview, issues };
    },
  });
}

export interface CycleCloseResult {
  reconciliation_id: string;
  adjustment_txn_id: string | null;
  swept_amount: number;
  swept_account_count: number;
  sweep_skipped: boolean;
}

export function useFinalizeCycleReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string;
      cycleId: string;
      accountId: string;
      openingStated: number | null;
      closingStated: number;
      recordedNet: number;
      delta: number;
      categoryId: string | null;
      sweepRequested: boolean;
    }): Promise<CycleCloseResult> => {
      if (!(args.closingStated >= 0)) throw new Error('Saldo akhir tidak boleh negatif.');
      const sb = requireSupabase();
      const { data, error } = await sb.rpc('close_cycle_reconciliation', {
        p_household_id: args.householdId,
        p_cycle_id: args.cycleId,
        p_account_id: args.accountId,
        p_opening_stated: args.openingStated,
        p_closing_stated: args.closingStated,
        p_recorded_net: args.recordedNet,
        p_delta: args.delta,
        p_category_id: args.categoryId,
        p_sweep_requested: args.sweepRequested,
      });
      if (error) {
        if (error.message.includes('already') || error.message.includes('ditutup')) {
          throw new Error('Siklus ini sudah ditutup.');
        }
        throw error;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.reconciliation_id) throw new Error('Penutupan siklus tidak mengembalikan hasil.');
      return row as CycleCloseResult;
    },
    onSuccess: () => {
      invalidateMoneyKeys(qc);
      qc.invalidateQueries({ queryKey: ['reconciliation-preview'] });
      qc.invalidateQueries({ queryKey: ['cycle'] });
    },
  });
}

export function useRecordCycleReconciliation() {
  // Compatibility alias for callers that still use the old name. New writes
  // always close atomically through useFinalizeCycleReconciliation.
  return useFinalizeCycleReconciliation();
}

// Kept as a compatibility alias for callers that only need the mutation name.
export const useCreateReconciliationAdjustment = useRecordCycleReconciliation;

/*
 * The reconciliation RPC writes the snapshot, adjustment transaction, and
 * OTHER allocation in one database transaction. Keeping this mutation atomic
 * prevents a failed second request from leaving an orphaned adjustment.
 */


export function useCreateCycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string; name: string; start: string; end: string;
      primaryAccountId: string | null;
      incomeAmount: number; incomeAccountId: string | null; incomeCategoryId: string | null;
      items: { templateId: string; name: string; amount: number; categoryId: string | null; accountId: string | null; direction: 'INCOME' | 'EXPENSE' }[];
      /** Open obligations carried into this cycle, at their remaining amount. */
      obligations: { obligationId: string; title: string; amount: number; categoryId: string | null; accountId: string | null }[];
    }) => {
      const sb = requireSupabase();
      const { data: { user } } = await sb.auth.getUser();
      await sb.from('cycles').update({ is_active: false }).eq('household_id', args.householdId).eq('is_active', true);
      const { data: cycle, error: cErr } = await sb.from('cycles').insert({
        household_id: args.householdId, name: args.name,
        start_date: args.start, end_date: args.end, is_active: true,
        primary_account_id: args.primaryAccountId,
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

      // Carried-over obligations. Only outflows: an obligation is something the
      // family owes, so it can never be a PENDING inflow.
      for (const ob of args.obligations) {
        if (!(ob.amount > 0)) continue;
        rows.push({
          household_id: args.householdId, cycle_id: cid,
          recurring_template_id: null, obligation_id: ob.obligationId, name: ob.title,
          direction: 'EXPENSE' as const, flow_type: 'DEBT_PAYMENT' as const,
          planned_amount: ob.amount, actual_amount: ob.amount,
          status: 'PENDING' as const, release_date: null,
          category_id: ob.categoryId, account_id: ob.accountId,
          created_by: user?.id ?? null,
        });
      }

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

      // The commitment side. Income is a *source*, never an allocation, so it
      // deliberately has no row here.
      const allocations: Record<string, string | number | null>[] = [];
      for (const it of args.items) {
        if (it.direction !== 'EXPENSE' || !(it.amount > 0)) continue;
        allocations.push({
          household_id: args.householdId, cycle_id: cid,
          allocation_type: 'EXPENSE', amount: it.amount,
          category_id: it.categoryId, account_id: it.accountId,
          obligation_id: null, created_by: user?.id ?? null,
        });
      }
      for (const ob of args.obligations) {
        if (!(ob.amount > 0)) continue;
        allocations.push({
          household_id: args.householdId, cycle_id: cid,
          allocation_type: 'DEBT_PAYMENT', amount: ob.amount,
          obligation_id: ob.obligationId, account_id: ob.accountId,
          category_id: ob.categoryId, created_by: user?.id ?? null,
        });
      }
      if (allocations.length > 0) {
        const { error: aErr } = await sb.from('cycle_allocations').insert(allocations);
        if (aErr) throw aErr;
      }

      return cycle as Cycle;
    },
    onSuccess: () => {
      invalidateMoneyKeys(qc);
      qc.invalidateQueries({ queryKey: ['cycle'] });
      // A new cycle can be the first in a brand-new year. Insight & Aset's year
      // selector is built from this list, so without it the year the family
      // just opened a cycle in would be missing from the dropdown.
      qc.invalidateQueries({ queryKey: ['cycle-years'] });
    },
  });
}

export interface InlineBeneficiaryInput {
  name: string;
  bankName: string;
  accountNumber: string;
  accountHolderName?: string | null;
}

export interface CreateObligationArgs {
  householdId: string;
  title: string;
  type: string;
  total: number;
  recipient?: string;
  dueDate?: string | null;
  categoryId?: string | null;
  beneficiaryId?: string | null;
  inlineBeneficiary?: InlineBeneficiaryInput | null;
}

/**
 * Creates an obligation in the canonical `OPEN` state. `UNPAID` is only kept
 * as a legacy read alias (migration 004) — new rows must not write it, or the
 * "is this still owed?" checks would need two spellings.
 * Supports attaching a saved beneficiary or creating one inline (Flow K).
 */
export function useCreateObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateObligationArgs) => {
      if (!(args.total > 0)) throw new Error('Total tanggungan harus lebih dari Rp 0.');
      const sb = requireSupabase();
      let beneficiaryId = args.beneficiaryId ?? null;
      let recipient = args.recipient ?? null;

      if (!beneficiaryId && args.inlineBeneficiary) {
        const { data: bData, error: bErr } = await sb
          .from('beneficiaries')
          .insert({
            household_id: args.householdId,
            name: args.inlineBeneficiary.name.trim(),
            bank_name: args.inlineBeneficiary.bankName.trim(),
            account_number: cleanAccountNumber(args.inlineBeneficiary.accountNumber),
            account_holder_name: args.inlineBeneficiary.accountHolderName?.trim() || null,
          })
          .select('*')
          .single();
        if (bErr) throw bErr;
        if (bData) {
          const created = bData as Beneficiary;
          beneficiaryId = created.id;
          if (!recipient) {
            recipient = created.name;
          }
        }
      }

      const { error } = await sb.from('obligations').insert({
        household_id: args.householdId,
        title: args.title,
        type: args.type,
        total_amount: args.total,
        remaining_amount: args.total,
        status: 'OPEN',
        recipient,
        due_date: args.dueDate ?? null,
        beneficiary_id: beneficiaryId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateMoneyKeys(qc);
      qc.invalidateQueries({ queryKey: ['beneficiaries'] });
    },
  });
}

export interface Cashflow {
  actualCash: number;
  projectedRemaining: number;
  /** Every row not yet executed. Counts both directions — this is the ledger total. */
  pendingCount: number;
  paidCount: number;
  /**
   * PENDING **outflow** rows: the ones that still owe money and therefore
   * belong in Home's "N transaksi belum dibayar" alert. Counting every PENDING
   * row there made an un-cleared salary ("Gaji Bulanan", pending until payday)
   * read as a bill the family had not paid.
   */
  unpaidExpenseCount: number;
  /** PENDING inflow rows — money expected but not landed yet ("menunggu cair"). */
  pendingIncomeCount: number;
}

export function calcCashflow(txns: Txn[]): Cashflow {
  let cashIn = 0, cashOut = 0, pendingOut = 0, pendingCount = 0, paidCount = 0;
  let unpaidExpenseCount = 0, pendingIncomeCount = 0;
  for (const t of txns) {
    if (t.status === 'PAID') {
      paidCount += 1;
      if (t.direction === 'INCOME') cashIn += t.actual_amount;
      else cashOut += t.actual_amount;
    } else if (t.status === 'PENDING') {
      pendingCount += 1;
      if (t.direction === 'EXPENSE') {
        pendingOut += t.planned_amount;
        unpaidExpenseCount += 1;
      } else {
        pendingOut -= t.planned_amount;
        pendingIncomeCount += 1;
      }
    }
  }
  const actualCash = cashIn - cashOut;
  return {
    actualCash,
    projectedRemaining: actualCash - pendingOut,
    pendingCount,
    paidCount,
    unpaidExpenseCount,
    pendingIncomeCount,
  };
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
  cancelled_at?: string | null; cancelled_by?: string | null; cancellation_reason?: string | null;
  categories?: { name: string; icon?: string | null } | null;
  obligations?: { title: string } | null;
  accounts?: { name: string } | null;
}

export interface LedgerRow extends Txn {
  flowType: FlowType;
  /**
   * Mode-resolved: what moved. 0 for a PENDING row in `actual` mode, which is
   * what every projection wants and what no ledger row should print.
   */
  amount: number;
  /**
   * What the ledger prints. Equals `amount` once a row is executed; falls back
   * to the plan for a row that has not moved yet, so an unpaid bill reads as
   * "Rp 4.800.000 · Belum dieksekusi" rather than "Rp 0".
   */
  displayAmount: number;
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

function aggregateAllocations(rows: Pick<CycleAllocation, 'allocation_type' | 'amount' | 'cancelled_at'>[]) {
  const byType: Record<AllocationType, number> = {
    EXPENSE: 0, DEBT_PAYMENT: 0, ASSET: 0, SAVINGS: 0,
    INVESTMENT: 0, EMERGENCY_FUND: 0, OTHER: 0,
  };
  for (const r of rows) {
    if (r.cancelled_at) continue;
    byType[r.allocation_type] += Math.max(0, r.amount);
  }
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
        .select('*, categories(name, icon), obligations(title), accounts(name)')
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
          .select('allocation_type, amount, cancelled_at')
          .eq('household_id', householdId!).eq('cycle_id', cycleId!),
      ]);
      if (txnsRes.error) throw txnsRes.error;
      if (allocsRes.error) throw allocsRes.error;
      const txnRows = (txnsRes.data ?? []).filter((row) => (row as Txn).status !== 'CANCELLED') as Txn[];
      const allocRows = (allocsRes.data ?? []) as Pick<CycleAllocation, 'allocation_type' | 'amount' | 'cancelled_at'>[];
      const source = aggregateSourceFunds(txnRows, mode);
      // Required allocation is always the planned total, regardless of
      // mode; mode only affects the source-funds side. Cancelled commitments
      // remain queryable for audit but are no longer required funding.
      const requiredAllocation = allocRows.reduce(
        (s, r) => s + (r.cancelled_at ? 0 : Math.max(0, r.amount)),
        0,
      );
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

/**
 * Everything the Insight & Aset screen needs for one calendar year, in one
 * query.
 *
 * Three separate `useX(householdId, cycleId)` hooks cannot serve this screen:
 * it charts twelve months at once, so it would need one query per month and
 * would show twelve independent loading states. Worse, the six sections all
 * read the SAME rows — five queries for one dataset is five chances for the
 * charts to disagree with each other.
 *
 * The year filter is on the cycle, not on `created_at`: a transaction belongs
 * to the month of the cycle it was budgeted in, and a row created in January
 * for a December cycle is December's money.
 *
 * `year` is passed in rather than read from the clock so the caller owns the
 * "which year am I looking at" decision and the hook stays pure-ish and
 * cacheable per year.
 */
export function useYearInsight(householdId: string | undefined, year: number) {
  return useQuery({
    queryKey: ['year-insight', householdId, year],
    enabled: !!householdId,
    queryFn: async (): Promise<{
      cycles: Cycle[];
      txns: Txn[];
      allocations: CycleAllocation[];
    }> => {
      const sb = requireSupabase();
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      // A cycle straddles two months, so a cycle ending 24 Jan belongs to
      // January but starts in December of the year before. Overlap, not
      // containment, is the right filter: `start_date <= yearEnd AND
      // end_date >= yearStart` keeps the cycle that crosses New Year in both
      // years, which is exactly what `cyclesInYear` in lib/insight.ts expects.
      const { data: cycleData, error: cycleErr } = await sb
        .from('cycles')
        .select('*')
        .eq('household_id', householdId!)
        .lte('start_date', yearEnd)
        .gte('end_date', yearStart)
        .order('end_date', { ascending: true });
      if (cycleErr) throw cycleErr;

      const cycles = (cycleData ?? []) as Cycle[];
      if (cycles.length === 0) return { cycles, txns: [], allocations: [] };

      const cycleIds = cycles.map((c) => c.id);
      const [txnRes, allocRes] = await Promise.all([
        sb.from('transactions')
          .select('*, categories(name, icon), accounts!transactions_account_id_fkey(name)')
          .eq('household_id', householdId!)
          .in('cycle_id', cycleIds)
          .limit(2000),
        sb.from('cycle_allocations')
          .select('*, categories(name, icon), obligations(title), accounts(name)')
          .eq('household_id', householdId!)
          .in('cycle_id', cycleIds)
          .limit(2000),
      ]);
      if (txnRes.error) throw txnRes.error;
      if (allocRes.error) throw allocRes.error;

      return {
        cycles,
        txns: (txnRes.data ?? []) as Txn[],
        allocations: (allocRes.data ?? []) as CycleAllocation[],
      };
    },
  });
}

/**
 * Every year the household has a cycle in, newest first.
 *
 * A `min`/`max` on the dates would be wrong here: a family with cycles in 2024
 * and 2026 but not 2025 has three years on the selector's axis and only two
 * with data, so the screen must know which years exist rather than assume the
 * range is contiguous. Selecting only the two date columns keeps this cheap
 * enough to run alongside the year query.
 */
export function useCycleYears(householdId: string | undefined) {
  return useQuery({
    queryKey: ['cycle-years', householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<number[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb
        .from('cycles')
        .select('start_date, end_date')
        .eq('household_id', householdId!);
      if (error) throw error;
      const set = new Set<number>();
      for (const c of (data ?? []) as { start_date: string; end_date: string }[]) {
        // A cycle straddling New Year belongs to both years; `cyclesInYear`
        // accepts either, so the selector must offer both.
        const end = Number((c.end_date ?? '').slice(0, 4));
        const start = Number((c.start_date ?? '').slice(0, 4));
        if (end >= 1900) set.add(end);
        if (start >= 1900) set.add(start);
      }
      const thisYear = new Date().getFullYear();
      if (set.size === 0) set.add(thisYear);
      return [...set].sort((a, b) => b - a);
    },
  });
}

export function useObligationSummaries(householdId: string | undefined) {
  const q = useObligations(householdId);
  const data: ObligationSummary[] | undefined = q.data?.filter((o) => o.status !== 'CANCELLED').map((o) => {
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
    displayAmount: ledgerDisplayAmount(t),
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
      interestMode?: InstallmentMode | null;
      monthlyInterestRateBps?: number;
      /**
       * Plan shape. Written after the financing RPC because
       * `create_financing_with_obligation` does not take it, and only when the
       * caller passes one — a null here leaves the column NULL, which is the
       * honest "nobody chose yet" state `repaymentModeOf` derives a display
       * default from. Never guessed on the family's behalf.
       */
      repaymentMode?: RepaymentMode | null;
      releaseDate?: string | null;
    }) => {
      if (args.releaseDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(args.releaseDate)) {
        throw new Error('Tanggal transaksi harus menggunakan format YYYY-MM-DD.');
      }
      if (args.releaseDate != null && args.releaseDate > todayISO()) {
        throw new Error('Tanggal transaksi tidak boleh di masa depan.');
      }
      if (!(args.amount > 0)) throw new Error('Nominal pembiayaan harus lebih dari 0.');
      if ((args.interestFeeAmount ?? 0) < 0) throw new Error('Bunga/biaya tidak boleh negatif.');
      if ((args.monthlyInterestRateBps ?? 0) < 0) throw new Error('Bunga bulanan tidak boleh negatif.');
      if (args.interestMode && args.interestMode !== 'FIXED_INSTALLMENT' && args.interestMode !== 'FLOATING_INTEREST') {
        throw new Error('Mode bunga tidak dikenal.');
      }
      if (args.interestMode === 'FLOATING_INTEREST' && args.installmentCount == null) {
        throw new Error('Tenor wajib diisi untuk bunga mengambang.');
      }
      if (args.installmentCount != null && (args.installmentCount < 1 || args.installmentCount > 600)) {
        throw new Error('Jumlah angsuran harus antara 1 dan 600.');
      }
      if (args.repaymentMode != null && !isRepaymentMode(args.repaymentMode)) {
        throw new Error('Mode pembayaran tidak dikenal.');
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
        p_release_date: args.releaseDate ?? null,
        p_interest_mode: args.interestMode ?? null,
        p_interest_rate_bps: args.monthlyInterestRateBps ?? 0,
      });
      if (error) throw error;
      const rows = data as {
        transaction_id: string; obligation_id: string;
        installment_count: number | null; total_repayment: number;
      }[];

      // Separate RPC, and deliberately after the money rows exist, because
      // `create_financing_with_obligation` has no repayment_mode parameter. A
      // failure here is logged rather than thrown: the loan was in fact
      // created, so reporting failure would invite a retry that creates a
      // second one. The obligation simply keeps repayment_mode NULL — the same
      // "nobody chose yet" state migration 008 models — and Detail Pinjaman
      // still lets the family set it from its Mode Pembayaran card.
      const obligationId = rows[0]?.obligation_id;
      if (args.repaymentMode != null && obligationId) {
        const { error: modeErr } = await sb.rpc('set_obligation_repayment_mode', {
          p_household_id: args.householdId,
          p_obligation_id: obligationId,
          p_mode: args.repaymentMode,
        });
        if (modeErr) {
          console.warn('Pinjaman tersimpan tetapi mode pembayaran gagal diset:', modeErr.message);
        }
      }
      return rows;
    },
    onSuccess: () => {
      invalidateMoneyKeys(qc);
      qc.invalidateQueries({ queryKey: ['installments'] });
    },
  });
}

/** Installments of one obligation, ordered by due date (nulls last = backlog). */
export function useObligationInstallments(
  householdId: string | undefined,
  obligationId: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['installments', householdId, obligationId],
    enabled: (options?.enabled ?? true) && !!householdId && !!obligationId,
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
        .select('*, categories(name, icon), accounts!transactions_account_id_fkey(name)')
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
  householdId: string | undefined,
  obligationId: string | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['obl-payments', householdId, obligationId],
    enabled: (options?.enabled ?? true) && !!householdId && !!obligationId,
    queryFn: async (): Promise<Txn[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('transactions')
        .select('*, categories(name, icon), accounts!transactions_account_id_fkey(name)')
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

/**
 * Creates the first schedule for an existing obligation. The RPC is deliberately
 * append-only: once a schedule or payment exists, it refuses to rewrite history.
 */
export function useConfigureObligationInstallments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      householdId: string;
      obligationId: string;
      cycleId: string | null;
      principal: number;
      flatInterest?: number;
      count: number;
      startDate?: string | null;
      interestMode: InstallmentMode;
      monthlyInterestRateBps?: number;
    }) => {
      if (!(args.principal > 0)) throw new Error('Pokok harus lebih dari Rp 0.');
      if (!(args.count >= 1 && args.count <= 600)) throw new Error('Tenor harus antara 1 dan 600 siklus.');
      if ((args.flatInterest ?? 0) < 0 || (args.monthlyInterestRateBps ?? 0) < 0) {
        throw new Error('Bunga tidak boleh negatif.');
      }
      if (args.interestMode !== 'FIXED_INSTALLMENT' && args.interestMode !== 'FLOATING_INTEREST') {
        throw new Error('Mode cicilan tidak dikenal.');
      }
      const sb = requireSupabase();
      const { error } = await sb.rpc('configure_obligation_installments', {
        p_household_id: args.householdId,
        p_obligation_id: args.obligationId,
        p_cycle_id: args.cycleId,
        p_principal: args.principal,
        p_flat_interest: args.flatInterest ?? 0,
        p_count: args.count,
        p_start_date: args.startDate ?? null,
        p_interest_mode: args.interestMode,
        p_interest_rate_bps: args.monthlyInterestRateBps ?? 0,
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
  /** The picker's choice. Omitted or null = derive the icon from the name. */
  icon?: string | null;
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
        icon: args.icon ?? null,
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
      // Explicitly assignable to null so the family can clear a pick and go back
      // to the name-derived icon. `?? null` in the create path is stricter on
      // purpose: a new category never starts with a stale choice.
      if (args.icon !== undefined) patch.icon = args.icon;
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
    mutationFn: (args: {
      id: string;
      name?: string;
      paydayDay?: number | null;
      sweepPolicy?: 'REQUIRED' | 'OFFERED';
    }) => updateHousehold(args),
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

// ============ Flow J: Managed Account mutations & helpers ============

export interface AccountInput {
  name: string;
  type: string;
  accountNumber?: string | null;
  accountHolderName?: string | null;
  icon?: string | null;
  sortOrder?: number;
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string } & AccountInput) => {
      const name = args.name.trim();
      if (name.length < 2) throw new Error('Nama akun minimal 2 huruf.');
      const numErr = validateAccountNumber(args.accountNumber);
      if (numErr) throw new Error(numErr);
      const normalizedNum = normalizeAccountNumber(args.accountNumber);
      const sb = requireSupabase();
      const { data, error } = await sb.from('accounts').insert({
        household_id: args.householdId,
        name,
        type: args.type,
        account_number: normalizedNum,
        account_holder_name: args.accountHolderName?.trim() || null,
        icon: args.icon?.trim() || null,
        sort_order: args.sortOrder ?? 0,
        is_active: true,
      }).select('*').single();
      if (error) {
        if (error.code === '23505') {
          throw new Error('Nomor akun ini sudah terdaftar di keluarga kamu.');
        }
        throw error;
      }
      return data as Account;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accs'] }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string } & Partial<AccountInput> & { isActive?: boolean }) => {
      if (args.name !== undefined && args.name.trim().length < 2) {
        throw new Error('Nama akun minimal 2 huruf.');
      }
      if (args.accountNumber !== undefined) {
        const numErr = validateAccountNumber(args.accountNumber);
        if (numErr) throw new Error(numErr);
      }
      const sb = requireSupabase();
      const patch: Record<string, string | number | boolean | null> = {};
      if (args.name !== undefined) patch.name = args.name.trim();
      if (args.type !== undefined) patch.type = args.type;
      if (args.accountNumber !== undefined) {
        patch.account_number = normalizeAccountNumber(args.accountNumber);
      }
      if (args.accountHolderName !== undefined) {
        patch.account_holder_name = args.accountHolderName?.trim() || null;
      }
      if (args.icon !== undefined) {
        patch.icon = args.icon?.trim() || null;
      }
      if (args.sortOrder !== undefined) {
        patch.sort_order = args.sortOrder;
      }
      if (args.isActive !== undefined) {
        patch.is_active = args.isActive;
      }
      if (Object.keys(patch).length === 0) return null;
      const { data, error } = await sb.from('accounts')
        .update(patch).eq('id', args.id).select('*').single();
      if (error) {
        if (error.code === '23505') {
          throw new Error('Nomor akun ini sudah terdaftar di keluarga kamu.');
        }
        throw error;
      }
      return data as Account;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accs'] });
      invalidateMoneyKeys(qc);
    },
  });
}

export function useArchiveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string }) => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('accounts')
        .update({ is_active: false }).eq('id', args.id).select('*').single();
      if (error) throw error;
      return data as Account;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accs'] });
      invalidateMoneyKeys(qc);
    },
  });
}

export function useReactivateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string }) => {
      const sb = requireSupabase();
      const { data, error } = await sb.from('accounts')
        .update({ is_active: true }).eq('id', args.id).select('*').single();
      if (error) throw error;
      return data as Account;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accs'] });
      invalidateMoneyKeys(qc);
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string }) => {
      const sb = requireSupabase();
      const { error } = await sb.from('accounts').delete().eq('id', args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accs'] });
      invalidateMoneyKeys(qc);
    },
  });
}

/**
 * Checks whether an account is referenced by any transaction or recurring template.
 * If referenced, deleting would violate foreign key constraints (or nullify allocations),
 * so only archiving is allowed.
 */
export function useAccountUsage(accountId: string | undefined) {
  return useQuery({
    queryKey: ['acc-usage', accountId],
    enabled: !!accountId,
    queryFn: async (): Promise<{ isUsed: boolean; txnCount: number; templateCount: number }> => {
      if (!accountId) return { isUsed: false, txnCount: 0, templateCount: 0 };
      const sb = requireSupabase();
      const [{ count: txnCount, error: txnErr }, { count: tmplCount, error: tmplErr }] = await Promise.all([
        sb.from('transactions').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
        sb.from('recurring_templates').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      ]);
      if (txnErr) throw txnErr;
      if (tmplErr) throw tmplErr;
      const total = (txnCount ?? 0) + (tmplCount ?? 0);
      return {
        isUsed: total > 0,
        txnCount: txnCount ?? 0,
        templateCount: tmplCount ?? 0,
      };
    },
  });
}

export function useReorderAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accounts: { id: string; sort_order: number }[]) => {
      const sb = requireSupabase();
      await Promise.all(
        accounts.map((a) =>
          sb.from('accounts').update({ sort_order: a.sort_order }).eq('id', a.id)
        )
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accs'] }),
  });
}

// ============ Flow K: Counterparty Beneficiaries queries & mutations ============

export interface BeneficiaryInput {
  name: string;
  bankName: string;
  accountNumber: string;
  accountHolderName?: string | null;
}

export function useBeneficiaries(householdId: string | undefined) {
  return useQuery({
    queryKey: ['beneficiaries', householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<Beneficiary[]> => {
      const sb = requireSupabase();
      const { data, error } = await sb
        .from('beneficiaries')
        .select('*')
        .eq('household_id', householdId!)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Beneficiary[];
    },
  });
}

export function useCreateBeneficiary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { householdId: string } & BeneficiaryInput): Promise<Beneficiary> => {
      const sb = requireSupabase();
      const { data, error } = await sb
        .from('beneficiaries')
        .insert({
          household_id: args.householdId,
          name: args.name.trim(),
          bank_name: args.bankName.trim(),
          account_number: cleanAccountNumber(args.accountNumber),
          account_holder_name: args.accountHolderName?.trim() || null,
        })
        .select('*')
        .single();
      if (error) throw error;
      return data as Beneficiary;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['beneficiaries'] });
    },
  });
}

export function useUpdateBeneficiary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string } & Partial<BeneficiaryInput>): Promise<Beneficiary> => {
      const sb = requireSupabase();
      const patch: Record<string, string | null> = {
        updated_at: new Date().toISOString(),
      };
      if (args.name !== undefined) patch.name = args.name.trim();
      if (args.bankName !== undefined) patch.bank_name = args.bankName.trim();
      if (args.accountNumber !== undefined) patch.account_number = cleanAccountNumber(args.accountNumber);
      if (args.accountHolderName !== undefined) {
        patch.account_holder_name = args.accountHolderName?.trim() || null;
      }
      const { data, error } = await sb
        .from('beneficiaries')
        .update(patch)
        .eq('id', args.id)
        .select('*')
        .single();
      if (error) throw error;
      return data as Beneficiary;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['beneficiaries'] });
      qc.invalidateQueries({ queryKey: ['oblig'] });
    },
  });
}


