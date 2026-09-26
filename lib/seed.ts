import { requireSupabase } from './supabase';

const DEFAULT_CATEGORIES = [
  { name: 'Keperluan Keluarga', type: 'EXPENSE', monthly_budget: 1800000 },
  { name: 'Jajan Keluarga', type: 'EXPENSE', monthly_budget: 1000000 },
  { name: 'Keperluan Suami', type: 'EXPENSE', monthly_budget: 1500000 },
  { name: 'Keperluan Istri', type: 'EXPENSE', monthly_budget: 1500000 },
  { name: 'Primary', type: 'EXPENSE', monthly_budget: 6000000 },
  { name: 'Sekolah Ryu', type: 'EXPENSE', monthly_budget: 1500000 },
  { name: 'Rumah Tangga', type: 'EXPENSE', monthly_budget: 5000000 },
  { name: 'Utilitas', type: 'EXPENSE', monthly_budget: 1000000 },
  { name: 'Gaji & Pemasukan', type: 'INCOME', monthly_budget: 0 },
];

const DEFAULT_ACCOUNTS = [
  { name: 'Mandiri', type: 'BANK' },
  { name: 'CC Mandiri', type: 'CREDIT_CARD' },
  { name: 'ShopeePay', type: 'E_WALLET' },
  { name: 'Tunai', type: 'CASH' },
];

export async function seedHouseholdDefaults(householdId: string): Promise<void> {
  const sb = requireSupabase();

  const { data: existingCats } = await sb
    .from('categories')
    .select('id')
    .eq('household_id', householdId)
    .limit(1);
  if (!existingCats || existingCats.length === 0) {
    const { error } = await sb.from('categories').insert(
      DEFAULT_CATEGORIES.map((c) => ({ ...c, household_id: householdId }))
    );
    if (error) throw error;
  }

  const { data: existingAccs } = await sb
    .from('accounts')
    .select('id')
    .eq('household_id', householdId)
    .limit(1);
  if (!existingAccs || existingAccs.length === 0) {
    const { error } = await sb.from('accounts').insert(
      DEFAULT_ACCOUNTS.map((a) => ({ ...a, household_id: householdId }))
    );
    if (error) throw error;
  }

  const { data: existingCycles } = await sb
    .from('cycles')
    .select('id')
    .eq('household_id', householdId)
    .limit(1);
  if (!existingCycles || existingCycles.length === 0) {
    const { error } = await sb.from('cycles').insert({
      household_id: householdId,
      name: 'Siklus Okt 2026',
      start_date: '2026-09-25',
      end_date: '2026-10-24',
      is_active: true,
    });
    if (error) throw error;
  }
}
