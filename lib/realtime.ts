import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

// One channel per household: any change to a transaction/obligation/template/cycle
// on the partner's device immediately invalidates the cache on this device → the UI
// refreshes automatically.
export function useHouseholdRealtime(householdId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!supabase || !householdId) return;

    // Tear down any stale channels left behind for this household
    const existingChannels = supabase.getChannels().filter(
      (c) => c.topic.startsWith(`realtime:household:${householdId}`)
    );
    existingChannels.forEach((c) => {
      supabase?.removeChannel(c);
    });

    // Use a unique channel name per effect lifecycle to avoid a collision on
    // Fast Refresh or a React 18/19 remount, which caused the error:
    // "cannot add 'postgres_changes' callbacks ... after 'subscribe()'"
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const channel = supabase
      .channel(`household:${householdId}:${uniqueSuffix}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['txns'] });
          qc.invalidateQueries({ queryKey: ['audit-txns'] });
          qc.invalidateQueries({ queryKey: ['reconciliation'] });
          // Insight & Aset charts the same rows for a whole year under its own
          // key; without this the partner's edits leave its charts stale.
          qc.invalidateQueries({ queryKey: ['year-insight'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'obligations', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['oblig'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'recurring_templates', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['tmpl'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cycles', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['cycle'] });
          qc.invalidateQueries({ queryKey: ['cycles'] });
          qc.invalidateQueries({ queryKey: ['cancelled-cycles'] });
          qc.invalidateQueries({ queryKey: ['home-cash-balance'] });
          qc.invalidateQueries({ queryKey: ['zero-summary'] });
          qc.invalidateQueries({ queryKey: ['reconciliation-preview'] });
          qc.invalidateQueries({ queryKey: ['account-snapshots'] });
          qc.invalidateQueries({ queryKey: ['installments'] });
          qc.invalidateQueries({ queryKey: ['reconciliation'] });
          qc.invalidateQueries({ queryKey: ['audit-txns'] });
          // Insight & Aset reads the cycle list directly (which cycles exist,
          // and their dates), and lists the years to offer in its selector. A
          // cycle the partner opens in a new year must appear on both.
          qc.invalidateQueries({ queryKey: ['year-insight'] });
          qc.invalidateQueries({ queryKey: ['cycle-years'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'categories', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['cats'] });
          // Renaming or deleting a category changes the joined name on every
          // transaction and allocation row, so those views are stale too.
          qc.invalidateQueries({ queryKey: ['txns'] });
          qc.invalidateQueries({ queryKey: ['alloc'] });
          qc.invalidateQueries({ queryKey: ['year-insight'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'accounts', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['accs'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'assets', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['assets'] });
          qc.invalidateQueries({ queryKey: ['asset-valuations'] });
          qc.invalidateQueries({ queryKey: ['year-insight'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'asset_valuations', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['assets'] });
          qc.invalidateQueries({ queryKey: ['asset-valuations'] });
          qc.invalidateQueries({ queryKey: ['year-insight'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cycle_reconciliations', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['reconciliation'] });
          qc.invalidateQueries({ queryKey: ['cycle'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cycle_allocations', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['alloc'] });
          qc.invalidateQueries({ queryKey: ['zero-summary'] });
          qc.invalidateQueries({ queryKey: ['oblig'] });
          // The asset trend and the funding-gap chart are built from these rows.
          qc.invalidateQueries({ queryKey: ['year-insight'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'obligation_installments', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['alloc'] });
          qc.invalidateQueries({ queryKey: ['zero-summary'] });
          qc.invalidateQueries({ queryKey: ['oblig'] });
          qc.invalidateQueries({ queryKey: ['installments'] });
        }
      )
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
  }, [householdId, qc]);
}
