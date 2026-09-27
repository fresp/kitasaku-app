import { cycleWindowFrom, type CycleWindow } from './profile';
import { requireSupabase } from './supabase';

/**
 * The payday a brand-new household is seeded on when it has not told us one
 * yet. `cycleWindowFrom` clamps it per month, so "tanggal 25" in a 28-day
 * February still lands on a real date.
 */
const SEED_PAYDAY_DAY = 25;

/**
 * The cycle `seedHouseholdDefaults` will create, so a screen can tell the
 * family what is about to be made without hard-coding a month that will be
 * stale by the next signup. `setup-choice.tsx` is the only caller.
 */
export function seedCycleWindow(
  todayISO: string = new Date().toISOString().slice(0, 10)
): CycleWindow | null {
  return cycleWindowFrom(SEED_PAYDAY_DAY, todayISO);
}

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
  { name: 'Bonus', type: 'INCOME', monthly_budget: 0 },
  { name: 'Side Hustle', type: 'INCOME', monthly_budget: 0 },
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
    // Derived, not literal. A hard-coded window means every family that signs
    // up after those dates gets a first cycle that is already over — the cycle
    // strip reads "Hari ke-137" on day one. Seeding does not know the
    // household's real payday (the row is created after this runs), so it seeds
    // on the design's own default of tanggal 25 and lets the family correct it
    // on Ruang Keluarga.
    const window = cycleWindowFrom(SEED_PAYDAY_DAY, new Date().toISOString().slice(0, 10));
    if (window) {
      const { error } = await sb.from('cycles').insert({
        household_id: householdId,
        name: window.name,
        start_date: window.start,
        end_date: window.end,
        is_active: true,
      });
      if (error) throw error;
    }
  }
}
