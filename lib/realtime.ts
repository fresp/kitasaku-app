import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

// Satu channel per household: setiap perubahan transaksi/obligasi/template/siklus
// di HP pasangan langsung invalidate cache di HP ini → UI refresh otomatis.
export function useHouseholdRealtime(householdId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!supabase || !householdId) return;

    // Bersihkan channel lama jika ada yang tertinggal untuk household ini
    const existingChannels = supabase.getChannels().filter(
      (c) => c.topic.startsWith(`realtime:household:${householdId}`)
    );
    existingChannels.forEach((c) => {
      supabase?.removeChannel(c);
    });

    // Gunakan nama channel unik per lifecycle effect agar tidak terjadi collision
    // pada Fast Refresh atau React 18/19 remount yang menyebabkan error:
    // "cannot add 'postgres_changes' callbacks ... after 'subscribe()'"
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const channel = supabase
      .channel(`household:${householdId}:${uniqueSuffix}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['txns'] });
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
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'categories', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['cats'] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'accounts', filter: `household_id=eq.${householdId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['accs'] });
        }
      )
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
  }, [householdId, qc]);
}
