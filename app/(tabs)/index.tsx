import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Plus from 'lucide-react-native/icons/plus';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiahShort } from '../../lib/format';
import { activeCycle as mockCycle, pendingTransactions } from '../../lib/mockData';
import { useAuth } from '../../lib/auth-context';
import { calcCashflow, useActiveCycle, useTransactions } from '../../lib/queries';
import { HeroSplitCard } from '../../components/ui/HeroSplitCard';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import { TransactionRow, type RowItem } from '../../components/ui/TransactionRow';

function toRow(t: any): RowItem {
  const planned = t.planned_amount ?? t.actual_amount ?? 0;
  const amount = t.status === 'PAID' ? (t.actual_amount ?? planned) : planned;
  return {
    id: t.id,
    name: t.name,
    category: t.categories?.name ?? 'Lainnya',
    account: t.accounts?.name ?? '—',
    amount,
    dueLabel: t.release_date
      ? `Dibayar ${t.release_date}`
      : t.direction === 'INCOME'
        ? 'Pemasukan • menunggu cair'
        : 'Belum dibayar • siklus ini',
    status: t.status,
    deltaKind: 'neutral',
    deltaText: t.obligation_id ? 'Tanggungan' : t.recurring_template_id ? 'Rutin' : 'Ad-hoc',
    obligationId: t.obligation_id ?? null,
    flowType: t.flow_type ?? null,
  };
}

export default function HomeScreen() {
  const router = useRouter();
  const { household, membership } = useAuth();
  const householdId = household?.id;
  const [tab, setTab] = useState('pending');
  const [refreshing, setRefreshing] = useState(false);

  const cycleQ = useActiveCycle(householdId);
  const cycleId = cycleQ.data?.id;
  const txnsQ = useTransactions(householdId, cycleId);
  // Realtime is mounted once in app/(tabs)/_layout.tsx so it stays alive on every tab.

  const live = !!householdId && !!cycleId && !!txnsQ.data;
  const txns = useMemo(() => (live ? txnsQ.data! : []), [live, txnsQ.data]);
  const flow = useMemo(() => calcCashflow(txns), [txns]);

  const rows: RowItem[] = useMemo(() => {
    if (live) {
      const mapped = txns.map(toRow);
      if (tab === 'pending') return mapped.filter((r) => r.status === 'PENDING');
      if (tab === 'paid') return mapped.filter((r) => r.status === 'PAID');
      return mapped;
    }
    return pendingTransactions as unknown as RowItem[];
  }, [live, txns, tab]);

  const cycleName = live ? (cycleQ.data!.name ?? 'Siklus Aktif') : mockCycle.name;
  const cycleRange = live
    ? `${cycleQ.data!.start_date} – ${cycleQ.data!.end_date}`
    : mockCycle.dayLabel;
  const actualCash = live ? flow.actualCash : mockCycle.actualCash;
  const projected = live ? flow.projectedRemaining : mockCycle.projectedRemaining;
  const pendingCount = live ? flow.pendingCount : mockCycle.pendingCount;
  const paidCount = live ? flow.paidCount : mockCycle.paidCount;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing || txnsQ.isFetching}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([cycleQ.refetch(), txnsQ.refetch()]);
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>
              {(household?.name ?? 'KELUARGA ANDRA').toUpperCase()} • ACTION CENTER
            </Text>
            <Text style={styles.title}>
              Halo{membership?.role === 'OWNER' ? ', Owner' : ''}
            </Text>
          </View>
          <Pressable onPress={() => router.push('/(auth)/invite')} style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(household?.name ?? 'A').slice(0, 1).toUpperCase()}
            </Text>
          </Pressable>
        </View>

        <Pressable onPress={() => router.push('/new-cycle')} style={styles.cyclePill}>
          <View>
            <Text style={styles.cycleTitle}>{cycleName}</Text>
            <Text style={styles.cycleRange}>{cycleRange} • Payday-to-Payday</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        {!householdId && (
          <Pressable onPress={() => router.push('/(auth)/setup-choice')} style={styles.offline}>
            <Text style={styles.offlineText}>
              Mode offline (mock) — ketuk untuk login & sinkron dengan pasangan →
            </Text>
          </Pressable>
        )}

        <HeroSplitCard
          actualCash={actualCash}
          projectedRemaining={projected}
          projectedSub={`Setelah ${pendingCount} tanggungan`}
          footLeft={`● Terproyeksi ${projected >= 0 ? 'aman' : 'minus'} • Buffer ${formatRupiahShort(Math.abs(projected))}`}
        />

        <SegmentedTabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'pending', label: 'Belum Bayar', count: pendingCount },
            { key: 'paid', label: 'Sudah Bayar', count: paidCount },
            { key: 'all', label: 'Semua', count: pendingCount + paidCount },
          ]}
        />

        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>
            {tab === 'pending' ? 'Perlu dibayar minggu ini' : tab === 'paid' ? 'Sudah lunas' : 'Semua transaksi siklus'}
          </Text>
          <Text style={styles.sort}>Jatuh tempo ↓</Text>
        </View>

        {txnsQ.isLoading && live === false && householdId ? (
          <Text style={styles.empty}>Memuat data keluarga…</Text>
        ) : rows.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.empty}>
              {tab === 'pending'
                ? 'Semua kewajiban lunas. Nikmati ketenangannya 🎉'
                : 'Belum ada transaksi di tab ini.'}
            </Text>
            <Pressable onPress={() => router.push('/quick-add')}>
              <Text style={styles.emptyLink}>+ Catat transaksi ad-hoc</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
            {rows.map((t) => (
              <TransactionRow
                key={t.id}
                item={t}
                onPay={(item) =>
                  router.push({ pathname: '/payment-confirm', params: { id: item.id } })
                }
              />
            ))}
          </View>
        )}

        <Pressable onPress={() => router.push('/templates')} style={styles.tplLink}>
          <Text style={styles.tplLinkText}>Kelola Template Rutin →</Text>
        </Pressable>
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/quick-add')}
        style={styles.fab}
      >
        <Plus size={24} color={Colors.white} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 16, gap: 12, paddingBottom: 96 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '600', letterSpacing: 0.6 },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '600', marginTop: 2 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.subtle,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: Colors.textPrimary, fontWeight: '700', fontSize: 16 },
  cyclePill: {
    backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  cycleTitle: { color: Colors.textPrimary, fontWeight: '600', fontSize: 15 },
  cycleRange: { color: Colors.textSecondary, fontSize: FontSize.body, marginTop: 2 },
  chevron: { color: Colors.textMuted, fontSize: 22 },
  offline: { backgroundColor: Colors.alertBg, borderRadius: Radius.md, padding: 10 },
  offlineText: { color: Colors.alertText, fontSize: FontSize.body, fontWeight: '600' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  listTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
  sort: { color: Colors.textMuted, fontSize: FontSize.body },
  list: { gap: 10 },
  empty: { color: Colors.textMuted, fontSize: FontSize.body, textAlign: 'center' },
  emptyBox: { gap: 8, paddingVertical: 16 },
  emptyLink: { color: Colors.textPrimary, fontWeight: '600', textAlign: 'center' },
  tplLink: { paddingVertical: 8 },
  tplLinkText: { color: Colors.textPrimary, fontWeight: '600', textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
});
