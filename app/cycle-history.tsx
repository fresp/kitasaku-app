import { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Calendar from 'lucide-react-native/icons/calendar';
import Wallet from 'lucide-react-native/icons/wallet';

import { Colors } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useActiveCycle,
  useCycleYears,
  useHouseholdCycles,
  useYearInsight,
} from '../lib/queries';
import type { Cycle } from '../lib/queries';

const FULL_MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

function formatCycleTitle(cycle: Cycle): string {
  const m = /^(\d{4})-(\d{2})/.exec(cycle.start_date);
  if (m) {
    const monthIdx = parseInt(m[2], 10) - 1;
    const month = FULL_MONTHS_ID[monthIdx] ?? '';
    return `${month} ${m[1]}`;
  }
  return cycle.name;
}

export default function CycleHistoryScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const [refreshing, setRefreshing] = useState(false);

  const activeCycleQ = useActiveCycle(householdId);
  const cyclesQ = useHouseholdCycles(householdId);
  const yearsQ = useCycleYears(householdId);
  const activeYear = yearsQ.data?.[0] ?? new Date().getFullYear();
  const yearInsightQ = useYearInsight(householdId, activeYear);

  const cycles = useMemo(() => cyclesQ.data ?? [], [cyclesQ.data]);

  // Realised money per cycle, plus what is still only planned.
  //
  // This loop used to count every row it found: a CANCELLED transaction still
  // added to the total, and a PENDING plan was added at its planned amount as
  // if it had been spent. `useYearInsight` does not filter status in the
  // query, and `buildYearBuckets` drops cancelled rows in code — this loop was
  // the one place that did not, which is why this screen reported a larger
  // figure than every other screen for the same cycle.
  //
  // Pending is kept, but as its own number. A plan is a commitment, not an
  // outflow, and summing the two under one label is what made "Pengeluaran"
  // unreconcilable against the ledger.
  const cycleMetrics = useMemo(() => {
    const map: Record<
      string,
      { income: number; expense: number; pendingExpense: number }
    > = {};
    for (const t of yearInsightQ.data?.txns ?? []) {
      if (!t.cycle_id) continue;
      if (t.status === 'CANCELLED') continue;
      if (!map[t.cycle_id]) {
        map[t.cycle_id] = { income: 0, expense: 0, pendingExpense: 0 };
      }
      if (t.status === 'PENDING') {
        if (t.direction === 'EXPENSE') {
          map[t.cycle_id].pendingExpense += t.planned_amount;
        }
        continue;
      }
      if (t.direction === 'INCOME') {
        map[t.cycle_id].income += t.actual_amount;
      } else if (t.direction === 'EXPENSE') {
        map[t.cycle_id].expense += t.actual_amount;
      }
    }
    return map;
  }, [yearInsightQ.data?.txns]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        activeCycleQ.refetch(),
        cyclesQ.refetch(),
        yearInsightQ.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* Top Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Kembali"
          hitSlop={8}
          style={styles.headerBtn}
        >
          <ChevronLeft size={22} color="#0B1527" />
        </Pressable>
        <Text style={styles.headerTitle}>Riwayat Siklus</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing || cyclesQ.isFetching}
            onRefresh={handleRefresh}
            tintColor={Colors.brandPrimary}
          />
        }
      >
        {cycles.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Calendar size={48} color="#94A3B8" />
            <Text style={styles.emptyTitle}>Belum Ada Siklus Anggaran</Text>
            <Text style={styles.emptySubtitle}>
              Mulai buat siklus pertama Anda untuk mengelola pemasukan dan pengeluaran keluarga secara teratur.
            </Text>
          </View>
        ) : (
          cycles.map((cycle) => {
            const isCurrent =
              cycle.is_active ||
              (today >= cycle.start_date && today <= cycle.end_date && !cycle.closed_at);

            const metrics = cycleMetrics[cycle.id];
            const income = metrics?.income ?? 0;
            const expense = metrics?.expense ?? 0;
            const pendingExpense = metrics?.pendingExpense ?? 0;
            const remaining = income - expense;

            let statusText = 'Selesai';
            let statusColor = '#64748B';

            if (cycle.cancelled_at) {
              statusText = 'Dibatalkan';
              statusColor = '#EF4444';
            } else if (isCurrent) {
              const diffDays = Math.max(
                0,
                Math.ceil(
                  (new Date(`${cycle.end_date}T23:59:59Z`).getTime() -
                    new Date(`${today}T00:00:00Z`).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              );
              statusText = `Berjalan · ${diffDays} hari lagi`;
              statusColor = '#2563EB';
            }

            return (
              <Pressable
                key={cycle.id}
                style={styles.cycleCard}
                onPress={() =>
                  router.push({
                    pathname: '/cycle-detail',
                    params: { cycleId: cycle.id },
                  })
                }
              >
                {/* Header Row */}
                <View style={styles.cycleCardHeader}>
                  <View style={styles.cycleIconSquircle}>
                    <Calendar size={18} color="#0B1527" strokeWidth={1.8} />
                  </View>
                  <Text style={styles.cycleTitle} numberOfLines={1}>
                    {formatCycleTitle(cycle)}
                  </Text>
                  <ChevronRight size={18} color="#94A3B8" />
                </View>

                {/* Amounts Breakdown */}
                <View style={styles.metricsContainer}>
                  <View style={styles.metricRow}>
                    <Text style={styles.metricLabel}>Pemasukan</Text>
                    <Text style={styles.metricValue}>{formatRupiah(income)}</Text>
                  </View>
                  <View style={styles.metricRow}>
                    <Text style={styles.metricLabel}>Pengeluaran</Text>
                    <Text style={styles.metricValue}>{formatRupiah(expense)}</Text>
                  </View>
                  {pendingExpense > 0 && (
                    <View style={styles.metricRow}>
                      <Text style={styles.metricLabel}>Rencana belum dibayar</Text>
                      <Text style={styles.metricPending}>
                        {formatRupiah(pendingExpense)}
                      </Text>
                    </View>
                  )}

                  {/* Balance Row */}
                  <View style={styles.balanceRow}>
                    <View style={styles.balanceIconBadge}>
                      <Wallet size={12} color="#10B981" />
                    </View>
                    <Text style={styles.balanceValue}>
                      {formatRupiah(Math.max(0, remaining))}
                    </Text>
                  </View>
                </View>

                {/* Status Footer */}
                <View style={styles.statusRow}>
                  <Text style={[styles.statusText, { color: statusColor }]}>
                    {statusText}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0B1527',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 12,
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1527',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  cycleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
  },
  cycleCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cycleIconSquircle: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cycleTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1527',
  },
  metricsContainer: {
    gap: 6,
    paddingVertical: 4,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  metricValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0B1527',
  },
  metricPending: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B45309',
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  balanceIconBadge: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#10B981',
  },
  statusRow: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
