import { useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Plus from 'lucide-react-native/icons/plus';
import Calendar from 'lucide-react-native/icons/calendar';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ArrowDown from 'lucide-react-native/icons/arrow-down';
import ArrowLeftRight from 'lucide-react-native/icons/arrow-left-right';
import Eye from 'lucide-react-native/icons/eye';
import X from 'lucide-react-native/icons/x';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { useAuth } from '../../lib/auth-context';
import { calcCashflow, useActiveCycle, useBankAccounts, useCycleReconciliation, useHomeCashAccounts, useHomeCashBalance, useTransactions, useZeroBasedSummary } from '../../lib/queries';
import { formatShortDate } from '../../lib/zero-based';
import { cycleRangeLabel, memberInitials } from '../../lib/profile';
import { formatRupiah } from '../../lib/format';
import { categoryIconName } from '../../lib/category-icon';
import { BrandIcon } from '../../components/ui/BrandIcon';
import { QueryError } from '../../components/ui/QueryError';
import type { Txn } from '../../lib/queries';
import type { RowItem } from '../../components/ui/TransactionRow';

type HomeRow = Omit<RowItem, 'status'> & {
  status: Txn['status'];

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
  const [fabOpen, setFabOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const closeFab = () => setFabOpen(false);
  const openQuickAdd = (kind: 'out' | 'in') => {
    closeFab();
    router.push({ pathname: '/quick-add', params: { kind } });
  };
  const openTransfer = () => {
    closeFab();
    router.push('/transfer');
  };


  const cycleQ = useActiveCycle(householdId);
  const cycleId = cycleQ.data?.id;
  const bankAccountsQ = useBankAccounts(householdId);
  const homeAccountsQ = useHomeCashAccounts(householdId);
  const primaryAccount = bankAccountsQ.data?.find((account) => account.id === cycleQ.data?.primary_account_id);
  const displayAccount = homeAccountsQ.data?.find((account) => account.id === selectedAccountId)
    ?? homeAccountsQ.data?.find((account) => account.id === cycleQ.data?.primary_account_id)
    ?? homeAccountsQ.data?.[0];
  const selectedAccount = displayAccount ?? null;
  const txnsQ = useTransactions(householdId, cycleId);
  // The summary is still used by the cycle selector to route a funding gap to
  // its explanation screen. The Home hero itself is intentionally lighter:
  // it answers the cash question first, while allocation detail lives in its
  // own screen.
  const summaryQ = useZeroBasedSummary(householdId, cycleId, 'planned');
  const reconciliationQ = useCycleReconciliation(householdId, cycleId);
  const homeCashQ = useHomeCashBalance(householdId, cycleQ.data, txnsQ.data ?? [], selectedAccount?.id);

  // This screen used to fall back to `lib/mockData` whenever a live query had
  // not resolved — which is not a rare state but the *normal* one just after
  // sign-in, before a cycle exists. The family saw another family's rupiah
  // amounts presented as their own. There is no longer anything to fall back
  // to: a failed read shows an error, and a missing cycle shows the honest
  // empty state below.
  const failed = txnsQ.isError || cycleQ.isError || summaryQ.isError || reconciliationQ.isError || homeCashQ.isError || homeAccountsQ.isError;
  const retryAll = () => {
    cycleQ.refetch();
    txnsQ.refetch();
    summaryQ.refetch();
    reconciliationQ.refetch();
    homeCashQ.refetch();
    homeAccountsQ.refetch();
  };
  const loadingCash = !!cycleId && (!!txnsQ.isLoading || homeCashQ.isLoading);
  const refreshHome = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        cycleQ.refetch(),
        txnsQ.refetch(),
        summaryQ.refetch(),
        reconciliationQ.refetch(),
        homeCashQ.refetch(),
        homeAccountsQ.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const txns = useMemo(() => txnsQ.data ?? [], [txnsQ.data]);
  const balances = homeCashQ.data;
  const flow = useMemo(() => calcCashflow(txns, selectedAccount?.id), [txns, selectedAccount?.id]);
  const openingStated = balances?.openingStated ?? null;
  const selectedActualBalance = openingStated === null ? null : openingStated + flow.actualCash;
  const selectedProjectedBalance = openingStated === null ? null : openingStated + flow.projectedRemaining;
  const selectAccount = (accountId: string) => setSelectedAccountId(accountId);

  // The home feed is a glance, not a second ledger. Three rows keep the next
  // action visible without making the first screen feel like a report.
  const homeRows = useMemo<HomeRow[]>(() => txns.filter((txn) => txn.status !== 'CANCELLED').map(toRow).slice(0, 3), [txns]);

  const cycleName = cycleQ.data?.name ?? 'Belum ada siklus aktif';
  // The alert counts unpaid *expenses*. `pendingCount` also counts an
  // un-cleared salary, and "Gaji Bulanan belum dibayar" is not a sentence this
  // screen should say.
  const unpaidCount = flow.unpaidExpenseCount;
  const numbersUnavailable = failed || (householdId !== undefined && (!cycleQ.data || txnsQ.isLoading || homeAccountsQ.isLoading));
  const movementUnavailable = numbersUnavailable || loadingCash || txnsQ.isError;
  const income = movementUnavailable ? null : flow.income + flow.transferIn;
  const expense = movementUnavailable ? null : flow.expense + flow.transferOut;
  const actualCash = movementUnavailable ? null : selectedActualBalance;
  const projectedRemaining = movementUnavailable ? null : selectedProjectedBalance;
  const unanchoredMovement = movementUnavailable ? null : flow.actualCash;
  const amountLabel = (value: number | null) => value === null ? '—' : signedRupiah(value);

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
            refreshing={refreshing || txnsQ.isFetching || summaryQ.isFetching || homeCashQ.isFetching || homeAccountsQ.isFetching}
            onRefresh={refreshHome}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
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
          <Calendar size={15} color={Colors.textSecondary} />
          <Text style={styles.cycleTitle}>{cycleName}</Text>
          <Text style={styles.cycleRange}>{rangeLabel ?? 'Siklus belum dibuka'}</Text>
          <ChevronRight size={16} color={Colors.textMuted} />
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
          <QueryError onRetry={retryAll} retrying={txnsQ.isFetching || cycleQ.isFetching || homeCashQ.isFetching} />
        )}
        {!failed && loadingCash && householdId && (
          <Text style={styles.empty}>Memuat saldo dan pergerakan siklus…</Text>
        )}
        {!failed && homeCashQ.isFetching && homeCashQ.data && householdId && (
          <Text style={styles.empty}>Memperbarui saldo…</Text>
        )}

        <View style={styles.hero}>
          <View style={styles.heroLabelRow}>
            <Text style={styles.heroLabel}>{actualCash === null ? 'PERGERAKAN AKUN' : 'SALDO AKUN TERCATAT'}</Text>
            <Eye size={15} color="#AEBCCD" />
          </View>
          <View style={styles.primarySetup}>
            <Text style={styles.accountCaption}>Pilih akun untuk melihat pergerakan siklus · tidak mengubah rekening primer</Text>
            {homeAccountsQ.isLoading ? <Text style={styles.accountChoiceText}>Memuat akun…</Text> : homeAccountsQ.data?.length ? (
              <View style={styles.accountChoices}>
                {homeAccountsQ.data.map((account) => (
                  <Pressable
                    key={account.id}
                    onPress={() => selectAccount(account.id)}
                    style={[styles.accountChoice, account.id === selectedAccount?.id && styles.accountChoiceActive]}
                    accessibilityRole="button"
                    accessibilityLabel={`Lihat pergerakan akun ${account.name}`}
                    accessibilityState={{ selected: account.id === selectedAccount?.id }}
                  >
                    <Text style={styles.accountChoiceText}>{account.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Pressable onPress={() => router.push('/manage-accounts')}>
                <Text style={styles.accountChoiceText}>Tambah rekening kas</Text>
              </Pressable>
            )}
            {selectedAccount && <Text style={styles.accountCaption}>{selectedAccount.name} · {selectedAccount.type}{selectedAccount.id === primaryAccount?.id ? ' · acuan rekonsiliasi' : ''}</Text>}
          </View>
          <Text style={styles.heroAmount}>
            {selectedAccount ? actualCash === null ? amountLabel(unanchoredMovement) : amountLabel(actualCash) : '—'}
          </Text>
          <Text style={styles.heroHelper}>
            {!selectedAccount ? 'Belum ada akun kas aktif' : actualCash === null
              ? unanchoredMovement === null
                ? 'Pergerakan siklus belum tersedia'
                : `Sisa siklus (pergerakan bersih, bukan saldo) · saldo awal akun belum diketahui`
              : `Saldo berdasar jangkar tercatat · estimasi akhir siklus ${amountLabel(projectedRemaining)}`}
          </Text>
          <View style={styles.heroRule} />
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.incomeValue}>{income === null ? '—' : formatRupiah(flow.income + flow.transferIn)}</Text>
              <Text style={styles.statLabel}>Masuk · termasuk transfer</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.expenseValue}>{expense === null ? '—' : `− ${formatRupiah(flow.expense + flow.transferOut)}`}</Text>
              <Text style={styles.statLabel}>Keluar · termasuk transfer</Text>
            </View>
          </View>
        </View>

        {unpaidCount > 0 && (
          <View>
            <SectionHeader title="Perlu perhatian" />
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

        <SectionHeader title="Aktivitas terbaru" onPress={() => router.push('/(tabs)/history')} compact />

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

        <Modal
          visible={fabOpen}
          transparent
          animationType="fade"
          onRequestClose={closeFab}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeFab}>
            <Pressable style={styles.menuSheet} onPress={(event) => event.stopPropagation()}>
              <View style={styles.sheetHandle} />
              <View style={styles.menuHeader}>
                <Text style={styles.menuHeaderText}>Tambah aktivitas</Text>
                <Pressable onPress={closeFab} hitSlop={10} accessibilityLabel="Tutup menu tambah aktivitas">
                  <X size={20} color={Colors.textPrimary} />
                </Pressable>
              </View>
              <View style={styles.inlineMenu}>
                <Pressable onPress={() => openQuickAdd('out')} style={styles.menuRow}>
                  <View style={[styles.menuIcon, styles.menuIconBlue]}><Plus size={17} color={Colors.white} /></View>
                  <View style={styles.menuCopy}>
                    <Text style={styles.menuTitle}>Tambah transaksi</Text>
                    <Text style={styles.menuSubtitle}>Catat pengeluaran, transfer, dll</Text>
                  </View>
                  <ChevronRight size={16} color={Colors.textMuted} />
                </Pressable>
                <Pressable onPress={() => openQuickAdd('in')} style={styles.menuRow}>
                  <View style={[styles.menuIcon, styles.menuIconGreen]}><ArrowDown size={17} color={Colors.white} /></View>
                  <View style={styles.menuCopy}>
                    <Text style={styles.menuTitle}>Catat pemasukan</Text>
                    <Text style={styles.menuSubtitle}>Gaji, refund, hasil jual, dll</Text>
                  </View>
                  <ChevronRight size={16} color={Colors.textMuted} />
                </Pressable>
                <Pressable onPress={openTransfer} style={styles.menuRow}>
                  <View style={[styles.menuIcon, styles.menuIconPurple]}><ArrowLeftRight size={17} color={Colors.white} /></View>
                  <View style={styles.menuCopy}>
                    <Text style={styles.menuTitle}>Relokasi</Text>
                    <Text style={styles.menuSubtitle}>Pindahkan antar akun/kategori</Text>
                  </View>
                  <ChevronRight size={16} color={Colors.textMuted} />
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fabOpen ? 'Tutup menu tambah aktivitas' : 'Buka menu tambah aktivitas'}
        onPress={() => setFabOpen((open) => !open)}
        style={[styles.fab, fabOpen && styles.fabOpen]}
      >
        {fabOpen ? <X size={23} color={Colors.white} /> : <Plus size={23} color={Colors.white} />}
      </Pressable>
    </SafeAreaView>
  );
}

function SectionHeader({
  title,
  onPress,
  compact = false,
}: {
  title: string;
  onPress?: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.sectionHeader, compact && styles.sectionHeaderCompact]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {onPress && (
        <Pressable onPress={onPress} hitSlop={8}>
          <Text style={styles.sectionLink}>Lihat semua</Text>
        </Pressable>
      )}
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
    minHeight: 40, paddingVertical: 8, paddingHorizontal: 2, flexDirection: 'row',
    alignItems: 'center', gap: 7,
  },
  cycleTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: FontSize.caption },
  cycleRange: { color: Colors.textSecondary, fontSize: FontSize.caption, flex: 1 },
  offline: { backgroundColor: Colors.alertBg, borderWidth: 1, borderColor: '#F7DFA9', borderRadius: Radius.md, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  offlineText: { color: Colors.alertText, fontSize: FontSize.caption, fontWeight: '600', flex: 1 },
  reconcileBanner: { backgroundColor: Colors.alertBg, borderWidth: 1, borderColor: '#F7DFA9', borderRadius: Radius.md, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9 },
  reconcileIcon: { width: 24, height: 24, borderRadius: 7, backgroundColor: '#FFEFC7', alignItems: 'center', justifyContent: 'center' },
  reconcileTitle: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '700' },
  reconcileSub: { color: '#93651F', fontSize: 10, marginTop: 2 },
  hero: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.lg, padding: 16 },
  heroLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 },
  heroLabel: { color: '#AEBCCD', fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.7 },
  accountCaption: { color: '#AEBCCD', fontSize: FontSize.caption, marginBottom: 4 },
  primarySetup: { gap: 8, marginBottom: 6 },
  accountChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  accountChoice: { borderWidth: 1, borderColor: '#526276', borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  accountChoiceActive: { backgroundColor: '#526276', borderColor: '#AEBCCD' },
  accountChoiceText: { color: Colors.white, fontSize: FontSize.caption, fontWeight: '600' },
  heroAmount: { color: Colors.white, fontSize: FontSize.heroNumeral, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  heroHelper: { color: '#AEBCCD', fontSize: FontSize.caption, marginTop: 3 },
  heroRule: { height: 1, backgroundColor: '#2E3E51', marginVertical: 14 },
  statsRow: { flexDirection: 'row', gap: 22 },
  stat: { flex: 1 },
  incomeValue: { color: '#9DD9C2', fontSize: FontSize.currencyLarge, fontWeight: '700', fontVariant: ['tabular-nums'] },
  expenseValue: { color: Colors.white, fontSize: FontSize.currencyLarge, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { color: '#AEBCCD', fontSize: FontSize.caption, marginTop: 2 },
  primaryAction: { minHeight: 44, borderRadius: 10, backgroundColor: Colors.brandPrimary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 10 },
  primaryActionText: { color: Colors.white, fontSize: FontSize.caption, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: Colors.overlayScrim, justifyContent: 'flex-end' },
  menuSheet: { backgroundColor: Colors.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: 16, paddingBottom: 28, gap: 12 },
  sheetHandle: { alignSelf: 'center', width: 44, height: 4, borderRadius: Radius.pill, backgroundColor: Colors.borderStrong, marginBottom: 2 },
  menuHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingVertical: 2 },
  menuHeaderText: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700' },
  inlineMenu: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, overflow: 'hidden' },
  menuRow: { minHeight: 68, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: '#EEF2F5' },
  menuIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuIconBlue: { backgroundColor: '#2F80ED' },
  menuIconGreen: { backgroundColor: '#19B887' },
  menuIconPurple: { backgroundColor: '#8067D9' },
  menuCopy: { flex: 1 },
  menuTitle: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },
  menuSubtitle: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 1 },
  sectionHeaderCompact: { marginTop: -2 },
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
  fabOpen: { backgroundColor: Colors.textSecondary },
});
