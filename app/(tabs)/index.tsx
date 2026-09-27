import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Plus from 'lucide-react-native/icons/plus';
import Calendar from 'lucide-react-native/icons/calendar';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { activeCycle as mockCycle, pendingTransactions } from '../../lib/mockData';
import { useAuth } from '../../lib/auth-context';
import { calcCashflow, useActiveCycle, useTransactions, useZeroBasedSummary } from '../../lib/queries';
import { memberInitials } from '../../lib/profile';
import { AllocationHeroCard } from '../../components/ui/AllocationHeroCard';
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
  // Planned mode: the hero answers "is this month's plan sound?" while there
  // are still decisions to make. Actual mode would report zero allocatable
  // funds on day one of the cycle, which is true but useless for planning.
  const summaryQ = useZeroBasedSummary(householdId, cycleId, 'planned');
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
  const pendingCount = live ? flow.pendingCount : mockCycle.pendingCount;
  const paidCount = live ? flow.paidCount : mockCycle.paidCount;

  const hasSummary = !!summaryQ.data;

  // Same glyph rule as My Profile and the roster, so the person who sees "AN"
  // in the corner sees the same two letters on the profile screen they land on.
  const avatarInitial = memberInitials(
    membership?.display_name ?? household?.name ?? 'Keluarga'
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing || txnsQ.isFetching || summaryQ.isFetching}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([cycleQ.refetch(), txnsQ.refetch(), summaryQ.refetch()]);
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
          {/* The avatar is the way into My Profile — the design's nav has a
              My Profile tab, but tapping your own face is the reflex, and this
              used to jump to the one-off post-signup invite screen. */}
          <Pressable onPress={() => router.push('/(tabs)/profile')} style={styles.avatar}>
            <Text style={styles.avatarText}>{avatarInitial}</Text>
          </Pressable>
        </View>

        {/* A cycle whose required allocation exceeds its source funds cannot be
            planned against, so the pill opens the Funding Gap explanation
            instead of the blank "open a cycle" form — landing someone on a form
            when the answer is "you are short Rp 5jt" hides the actual problem. */}
        <Pressable
          onPress={() =>
            summaryQ.data?.status === 'FUNDING_GAP'
              ? router.push('/funding-gap')
              : router.push('/new-cycle')
          }
          style={styles.cyclePill}
        >
          <View style={styles.cycleLeft}>
            <Calendar size={16} color={Colors.textSecondary} />
            <View>
              <Text style={styles.cycleTitle}>{cycleName}</Text>
              <Text style={styles.cycleRange}>
                {live ? `${cycleQ.data!.start_date} – ${cycleQ.data!.end_date}` : mockCycle.dayLabel} • Payday-to-Payday
              </Text>
            </View>
          </View>
          <ChevronRight size={16} color={Colors.textMuted} />
        </Pressable>

        {!householdId && (
          <Pressable onPress={() => router.push('/(auth)/setup-choice')} style={styles.offline}>
            <Text style={styles.offlineText}>
              Mode offline (mock) — ketuk untuk login & sinkron dengan pasangan →
            </Text>
          </Pressable>
        )}

        {hasSummary ? (
          <AllocationHeroCard
            summary={summaryQ.data!}
            cycleName={cycleName}
            onPressDetail={() => router.push('/allocation')}
          />
        ) : (
          <View style={styles.heroPlaceholder}>
            <Text style={styles.heroPlaceholderText}>
              {householdId && cycleId
                ? 'Menghitung alokasi siklus…'
                : 'Login untuk melihat alokasi zero-based siklus ini.'}
            </Text>
          </View>
        )}

        <View style={styles.aksi}>
          <Text style={styles.aksiTitle}>Aksi siklus ini</Text>
          <AksiRow label="Tambah transaksi" onPress={() => router.push('/quick-add')} />
          <AksiRow label="Catat pemasukan" onPress={() => router.push('/quick-add')} />
          <AksiRow label="Alokasikan dana" onPress={() => router.push('/allocation')} />
          <AksiRow label="Catat pinjaman" onPress={() => router.push('/quick-add')} />
          <AksiRow label="Kelola tanggungan" onPress={() => router.push('/(tabs)/obligations')} />
        </View>

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

function AksiRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.aksiRow}>
      <Text style={styles.aksiDot}>•</Text>
      <Text style={styles.aksiLabel}>{label}</Text>
      <ChevronRight size={14} color={Colors.textMuted} />
    </Pressable>
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
    backgroundColor: Colors.subtle, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  cycleLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cycleTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: FontSize.body },
  cycleRange: { color: Colors.textSecondary, fontSize: FontSize.caption, marginTop: 1 },
  offline: { backgroundColor: Colors.alertBg, borderRadius: Radius.md, padding: 10 },
  offlineText: { color: Colors.alertText, fontSize: FontSize.body, fontWeight: '600' },
  heroPlaceholder: {
    backgroundColor: Colors.subtle, borderRadius: Radius.xl, padding: 24,
  },
  heroPlaceholderText: { color: Colors.textMuted, fontSize: FontSize.body, textAlign: 'center' },
  aksi: { backgroundColor: Colors.surface, borderRadius: Radius.md, padding: 12, gap: 4 },
  aksiTitle: {
    color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700',
    letterSpacing: 0.8, marginBottom: 2,
  },
  aksiRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  aksiDot: { color: Colors.brandPrimary, fontSize: FontSize.body },
  aksiLabel: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '600' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  listTitle: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },
  sort: { color: Colors.textMuted, fontSize: FontSize.caption },
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
