import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Plus from 'lucide-react-native/icons/plus';
import Calendar from 'lucide-react-native/icons/calendar';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { useAuth } from '../../lib/auth-context';
import { calcCashflow, useActiveCycle, useCycleReconciliation, useTransactions, useZeroBasedSummary } from '../../lib/queries';
import { formatShortDate } from '../../lib/zero-based';
import { cycleRangeLabel, memberInitials } from '../../lib/profile';
import { formatRupiah } from '../../lib/format';
import { categoryIconName } from '../../lib/category-icon';
import { BrandIcon } from '../../components/ui/BrandIcon';
import { QueryError } from '../../components/ui/QueryError';
import type { Txn } from '../../lib/queries';
import type { RowItem } from '../../components/ui/TransactionRow';

type HomeRow = RowItem & {
  direction?: Txn['direction'];
  /** The picker's choice, so both lists agree on the icon. */
  categoryIcon?: string | null;
  categoryType?: Txn['direction'];
};

function toRow(t: Txn): HomeRow {
  const planned = t.planned_amount ?? t.actual_amount ?? 0;
  const amount = t.status === 'PAID' ? (t.actual_amount ?? planned) : planned;
  return {
    id: t.id,
    name: t.name,
    category: t.categories?.name ?? 'Lainnya',
    // Carried through so the row renders the same icon Riwayat does for this
    // transaction, rather than re-deriving one from the name alone.
    categoryIcon: t.categories?.icon ?? null,
    categoryType: t.direction,
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
    direction: t.direction,
  };
}

function signedRupiah(value: number): string {
  return value < 0 ? `−${formatRupiah(Math.abs(value))}` : formatRupiah(value);
}

export default function HomeScreen() {
  const router = useRouter();
  const { household, membership } = useAuth();
  const householdId = household?.id;
  const [refreshing, setRefreshing] = useState(false);

  const cycleQ = useActiveCycle(householdId);
  const cycleId = cycleQ.data?.id;
  const txnsQ = useTransactions(householdId, cycleId);
  // The summary is still used by the cycle selector to route a funding gap to
  // its explanation screen. The Home hero itself is intentionally lighter:
  // it answers the cash question first, while allocation detail lives in its
  // own screen.
  const summaryQ = useZeroBasedSummary(householdId, cycleId, 'planned');
  const reconciliationQ = useCycleReconciliation(householdId, cycleId);

  // This screen used to fall back to `lib/mockData` whenever a live query had
  // not resolved — which is not a rare state but the *normal* one just after
  // sign-in, before a cycle exists. The family saw another family's rupiah
  // amounts presented as their own. There is no longer anything to fall back
  // to: a failed read shows an error, and a missing cycle shows the honest
  // empty state below.
  const failed = txnsQ.isError || cycleQ.isError || summaryQ.isError || reconciliationQ.isError;
  const retryAll = () => {
    cycleQ.refetch();
    txnsQ.refetch();
    summaryQ.refetch();
  };

  const txns = useMemo(() => txnsQ.data ?? [], [txnsQ.data]);
  const flow = useMemo(() => calcCashflow(txns), [txns]);
  const liveTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const txn of txns) {
      if (txn.status !== 'PAID') continue;
      if (txn.direction === 'INCOME') income += txn.actual_amount;
      else expense += txn.actual_amount;
    }
    return { income, expense };
  }, [txns]);

  const homeRows = useMemo<HomeRow[]>(() => txns.map(toRow).slice(0, 4), [txns]);

  const cycleName = cycleQ.data?.name ?? 'Belum ada siklus aktif';
  // The alert counts unpaid *expenses*. `pendingCount` also counts an
  // un-cleared salary, and "Gaji Bulanan belum dibayar" is not a sentence this
  // screen should say.
  const unpaidCount = flow.unpaidExpenseCount;
  const pendingCount = flow.pendingCount;
  const paidCount = flow.paidCount;
  const income = liveTotals.income;
  const expense = liveTotals.expense;
  const actualCash = failed ? 0 : flow.actualCash;
  const projectedRemaining = failed ? 0 : flow.projectedRemaining;

  const todayISO = new Date().toISOString().slice(0, 10);
  const rangeLabel = cycleRangeLabel(cycleQ.data?.start_date, cycleQ.data?.end_date, todayISO);

  // The attention alert and its section link both mean "show me what is still
  // unpaid", so both carry the filter into Riwayat rather than dropping the user
  // into the unfiltered ledger to hunt for the rows themselves.
  const openUnpaid = () => router.push({ pathname: '/(tabs)/history', params: { status: 'PENDING' } });

  // Falls back through the two names the family actually chose: the member's
  // display name, then the household's. 'Keluarga' is the last resort so a
  // freshly-joined account is never greeted with someone else's name.
  const displayName = membership?.display_name?.trim() || household?.name?.trim() || 'Keluarga';
  const avatarInitial = memberInitials(membership?.display_name ?? household?.name ?? 'Keluarga');

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
          <View style={styles.headerLeft}>
            <BrandIcon name="context-home" size={34} label="" />
            <View>
              <Text style={styles.roomLabel}>Ruang keluarga</Text>
              <Text style={styles.title}>Halo, {displayName}</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Buka profil"
            onPress={() => router.push('/(tabs)/profile')}
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>{avatarInitial}</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() =>
            summaryQ.data?.status === 'FUNDING_GAP'
              ? router.push('/funding-gap')
              : router.push('/new-cycle')
          }
          style={styles.cyclePill}
        >
          <View style={styles.cycleLeft}>
            <View style={styles.calendarIcon}>
              <Calendar size={14} color={Colors.textSecondary} />
            </View>
            <View style={styles.cycleCopy}>
              <Text style={styles.cycleTitle}>{cycleName}</Text>
              <Text style={styles.cycleRange}>
                {rangeLabel ?? 'Siklus belum dibuka'} • Payday-to-Payday
              </Text>
            </View>
          </View>
          <ChevronRight size={17} color={Colors.textMuted} />
        </Pressable>

        {cycleQ.data?.primary_account_id && !reconciliationQ.data && (
          <Pressable onPress={() => router.push('/reconciliation')} style={styles.reconcileBanner}>
            <View style={styles.reconcileIcon}><Calendar size={14} color={Colors.alertText} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reconcileTitle}>Cek saldo akun primer</Text>
              <Text style={styles.reconcileSub}>
                Tutup siklus dengan mencocokkan saldo {formatShortDate(cycleQ.data.end_date) ?? 'akhir periode'}.
              </Text>
            </View>
            <ChevronRight size={16} color={Colors.alertText} />
          </Pressable>
        )}

        {!householdId && (
          <Pressable onPress={() => router.push('/(auth)/setup-choice')} style={styles.offline}>
            <Text style={styles.offlineText}>Mode offline — ketuk untuk login &amp; sinkron dengan pasangan</Text>
            <ChevronRight size={15} color={Colors.alertText} />
          </Pressable>
        )}

        {/* Shown above the hero on purpose: if the read failed, every number
            below it is a zero that means "unknown", not "nothing". */}
        {failed && householdId && (
          <QueryError onRetry={retryAll} retrying={txnsQ.isFetching || cycleQ.isFetching} />
        )}

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>SALDO KAS RIIL</Text>
          <Text style={styles.heroAmount}>{signedRupiah(actualCash)}</Text>
          <Text style={styles.heroHelper}>Pemasukan cair dikurangi pengeluaran riil</Text>
          <View style={styles.heroRule} />
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.incomeValue}>{formatRupiah(income)}</Text>
              <Text style={styles.statLabel}>Pemasukan</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.expenseValue}>− {formatRupiah(expense)}</Text>
              <Text style={styles.statLabel}>Pengeluaran</Text>
            </View>
          </View>
          <Pressable onPress={() => router.push('/allocation')} style={styles.heroFooter}>
            <Text style={styles.heroFooterLabel}>Estimasi sisa akhir</Text>
            <Text style={styles.heroFooterValue}>{signedRupiah(projectedRemaining)} ›</Text>
          </Pressable>
        </View>

        <View style={styles.quickActions}>
          <Pressable
            onPress={() => router.push({ pathname: '/quick-add', params: { kind: 'out' } })}
            style={styles.primaryAction}
          >
            <Plus size={15} color={Colors.white} />
            <Text style={styles.primaryActionText}>Tambah transaksi</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: '/quick-add', params: { kind: 'in' } })}
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryActionText}>Catat pemasukan</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/transfer')}
            style={styles.secondaryAction}
          >
            <Text style={styles.secondaryActionText}>Relokasi</Text>
          </Pressable>
        </View>

        {unpaidCount > 0 && (
          <View>
            <SectionHeader title="Perlu perhatian" onPress={openUnpaid} />
            <Pressable onPress={openUnpaid} style={styles.attention}>
              <View style={styles.attentionIcon}><Text style={styles.attentionIconText}>!</Text></View>
              <View style={styles.attentionCopy}>
                {/* `unpaidCount` counts unpaid *expenses*, and the design calls
                    those "tagihan" — "transaksi" made the alert read as if the
                    whole ledger were unsettled. */}
                <Text style={styles.attentionTitle}>{unpaidCount} tagihan belum dibayar</Text>
                <Text style={styles.attentionSubtitle} numberOfLines={1}>
                  Terdekat · {homeRows.find((row) => row.status === 'PENDING' && row.direction === 'EXPENSE')?.name ?? 'Periksa daftar transaksi'}
                </Text>
              </View>
              <ChevronRight size={16} color={Colors.alertText} />
            </Pressable>
          </View>
        )}

        <SectionHeader title="Aktivitas terbaru" onPress={() => router.push('/(tabs)/history')} />

        {txnsQ.isLoading && householdId ? (
          <Text style={styles.empty}>Memuat aktivitas keluarga…</Text>
        ) : failed && householdId ? (
          // Deliberately not the empty state: that would claim the cycle is
          // empty when the truth is we could not read it.
          <Text style={styles.empty}>Aktivitas belum bisa dimuat.</Text>
        ) : homeRows.length === 0 ? (
          <View style={styles.emptyBox}>
            <BrandIcon name="empty-belum-ada-transaksi" size={72} label="" />
            <Text style={styles.empty}>
              {cycleId ? 'Belum ada aktivitas di siklus ini.' : 'Belum ada siklus aktif.'}
            </Text>
            <Pressable
              onPress={() =>
                cycleId
                  ? router.push({ pathname: '/quick-add', params: { kind: 'out' } })
                  : router.push('/new-cycle')
              }
            >
              <Text style={styles.emptyLink}>
                {cycleId ? '+ Catat transaksi pertama' : 'Buka siklus pertama'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.activityList}>
            {homeRows.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                onPress={() =>
                  item.status === 'PENDING'
                    ? router.push({ pathname: '/payment-confirm', params: { id: item.id } })
                    : router.push('/(tabs)/history')
                }
              />
            ))}
          </View>
        )}

        <Pressable onPress={() => router.push('/(tabs)/history')} style={styles.allLink}>
          <Text style={styles.allLinkText}>Lihat semua transaksi ({pendingCount + paidCount})</Text>
          <ChevronRight size={14} color={Colors.textSecondary} />
        </Pressable>
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tambah transaksi"
        onPress={() => router.push({ pathname: '/quick-add', params: { kind: 'out' } })}
        style={styles.fab}
      >
        <Plus size={23} color={Colors.white} />
      </Pressable>
    </SafeAreaView>
  );
}

function SectionHeader({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Pressable onPress={onPress} hitSlop={8}>
        <Text style={styles.sectionLink}>Lihat semua</Text>
      </Pressable>
    </View>
  );
}

function ActivityRow({ item, onPress }: { item: HomeRow; onPress: () => void }) {
  const isIncome = item.direction === 'INCOME';
  const isPaid = item.status === 'PAID';
  const status = isPaid ? 'Lunas' : 'Belum dibayar';
  const amount = `${isIncome ? '+' : '−'} ${formatRupiah(item.amount)}`;

  return (
    <Pressable onPress={onPress} style={styles.activityRow}>
      <View style={styles.activityIcon}>
        <BrandIcon
          name={categoryIconName({
            name: item.category,
            type: item.categoryType ?? 'EXPENSE',
            icon: item.categoryIcon,
          })}
          size={19}
          label=""
        />
      </View>
      <View style={styles.activityMain}>
        <Text style={styles.activityName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.activityMeta} numberOfLines={1}>
          {item.category} · {item.account} · {status}
        </Text>
      </View>
      <View style={styles.activityAmount}>
        <Text style={[styles.amountText, isIncome && styles.incomeText]} numberOfLines={1}>{amount}</Text>
        <Text style={[styles.amountStatus, isPaid && styles.paidStatus]}>{isPaid ? 'Lunas' : 'Rencana'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 14, paddingBottom: 104 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  roomLabel: { color: Colors.textSecondary, fontSize: FontSize.caption, marginBottom: 2 },
  title: { color: Colors.textPrimary, fontSize: 21, fontWeight: '700', letterSpacing: -0.4 },
  avatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#DCEBE5',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: Colors.textPrimary, fontWeight: '700', fontSize: 13 },
  cyclePill: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle,
    paddingVertical: 9, paddingHorizontal: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  cycleLeft: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  calendarIcon: { width: 26, height: 26, borderRadius: 8, backgroundColor: Colors.subtle, alignItems: 'center', justifyContent: 'center' },
  cycleCopy: { flex: 1 },
  cycleTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: FontSize.body },
  cycleRange: { color: Colors.textSecondary, fontSize: 10, marginTop: 1 },
  offline: { backgroundColor: Colors.alertBg, borderWidth: 1, borderColor: '#F7DFA9', borderRadius: Radius.md, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  offlineText: { color: Colors.alertText, fontSize: FontSize.caption, fontWeight: '600', flex: 1 },
  reconcileBanner: { backgroundColor: Colors.alertBg, borderWidth: 1, borderColor: '#F7DFA9', borderRadius: Radius.md, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  reconcileIcon: { width: 24, height: 24, borderRadius: 7, backgroundColor: '#FFEFC7', alignItems: 'center', justifyContent: 'center' },
  reconcileTitle: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '700' },
  reconcileSub: { color: '#93651F', fontSize: 10, marginTop: 2 },
  hero: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.lg, padding: 16 },
  heroLabel: { color: '#AEBCCD', fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.7, marginBottom: 7 },
  heroAmount: { color: Colors.white, fontSize: FontSize.heroNumeral, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  heroHelper: { color: '#AEBCCD', fontSize: FontSize.caption, marginTop: 3 },
  heroRule: { height: 1, backgroundColor: '#2E3E51', marginVertical: 14 },
  statsRow: { flexDirection: 'row', gap: 22 },
  stat: { flex: 1 },
  incomeValue: { color: '#9DD9C2', fontSize: FontSize.currencyLarge, fontWeight: '700', fontVariant: ['tabular-nums'] },
  expenseValue: { color: Colors.white, fontSize: FontSize.currencyLarge, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { color: '#AEBCCD', fontSize: FontSize.caption, marginTop: 2 },
  heroFooter: { marginTop: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroFooterLabel: { color: '#C8D5E0', fontSize: FontSize.caption },
  heroFooterValue: { color: '#9DD9C2', fontSize: FontSize.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
  quickActions: { flexDirection: 'row', gap: 8 },
  primaryAction: { flex: 1, minHeight: 38, borderRadius: 10, backgroundColor: Colors.brandPrimary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 10 },
  primaryActionText: { color: Colors.white, fontSize: FontSize.caption, fontWeight: '700' },
  secondaryAction: { minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: Colors.borderSubtle, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryActionText: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 1 },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700', letterSpacing: -0.2 },
  sectionLink: { color: Colors.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },
  attention: { backgroundColor: Colors.alertBg, borderWidth: 1, borderColor: '#F7DFA9', borderRadius: Radius.md, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  attentionIcon: { width: 23, height: 23, borderRadius: 7, backgroundColor: '#FFEFC7', alignItems: 'center', justifyContent: 'center' },
  attentionIconText: { color: Colors.alertText, fontWeight: '800', fontSize: FontSize.body },
  attentionCopy: { flex: 1 },
  attentionTitle: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '700' },
  attentionSubtitle: { color: '#93651F', fontSize: 10, marginTop: 2 },
  activityList: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, overflow: 'hidden' },
  activityRow: { minHeight: 62, paddingHorizontal: 11, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#EEF2F5' },
  activityIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: Colors.subtle, alignItems: 'center', justifyContent: 'center' },
  activityGlyph: { color: Colors.textSecondary, fontSize: 12, fontWeight: '800' },
  activityMain: { flex: 1, minWidth: 0 },
  activityName: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '700' },
  activityMeta: { color: Colors.textMuted, fontSize: 9.5, marginTop: 3 },
  activityAmount: { alignItems: 'flex-end', maxWidth: 122 },
  amountText: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '700', fontVariant: ['tabular-nums'] },
  incomeText: { color: Colors.paidText },
  amountStatus: { color: Colors.textMuted, fontSize: 9, marginTop: 3 },
  paidStatus: { color: Colors.paidText },
  empty: { color: Colors.textMuted, fontSize: FontSize.body, textAlign: 'center', paddingVertical: 12 },
  emptyBox: { gap: 8, paddingVertical: 14 },
  emptyLink: { color: Colors.textPrimary, fontWeight: '600', textAlign: 'center', fontSize: FontSize.body },
  allLink: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 3, paddingVertical: 2 },
  allLinkText: { color: Colors.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },
  fab: { position: 'absolute', right: 16, bottom: 20, width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.brandPrimary, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 6 },
});
