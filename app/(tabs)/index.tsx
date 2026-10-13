import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Calendar from 'lucide-react-native/icons/calendar';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import X from 'lucide-react-native/icons/x';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { useAuth } from '../../lib/auth-context';
import {
  calcCashflow,
  nonCashSpend,
  useActiveCycle,
  useBankAccounts,
  useCycleReconciliation,
  useHomeCashAccounts,
  useHomeCashBalance,
  useSpecialBudgetFigures,
  useSpecialBudgets,
  useTransactions,
  useZeroBasedSummary,
} from '../../lib/queries';
import {
  cyclePortion,
  localISODate,
  specialBudgetAttention,
  specialBudgetStatus,
} from '../../lib/special-budget';
import { SpecialBudgetRow } from '../../components/special-budget/SpecialBudgetRow';
import { formatShortDate } from '../../lib/zero-based';
import { cycleRangeLabel, memberInitials } from '../../lib/profile';
import { formatRupiah, unpaidPlansLabel } from '../../lib/format';
import { categoryIconName } from '../../lib/category-icon';
import { BrandIcon } from '../../components/ui/BrandIcon';
import { QueryError } from '../../components/ui/QueryError';
import type { Txn } from '../../lib/queries';
import type { RowItem } from '../../components/ui/TransactionRow';

type HomeRow = Omit<RowItem, 'status'> & {
  status: Txn['status'];
  /** Anggaran Khusus the row belongs to, shown instead of the account. */
  budgetName?: string | null;
  direction?: Txn['direction'];
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
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountPickerOpen, setAccountPickerOpen] = useState<boolean>(false);

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
  const summaryQ = useZeroBasedSummary(householdId, cycleId, 'planned');
  const reconciliationQ = useCycleReconciliation(householdId, cycleId);
  const homeCashQ = useHomeCashBalance(householdId, cycleQ.data, txnsQ.data ?? [], selectedAccount?.id);
  const budgetsQ = useSpecialBudgets(householdId);
  const budgetFiguresQ = useSpecialBudgetFigures(householdId);

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
        budgetsQ.refetch(),
        budgetFiguresQ.refetch(),
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
  const selectAccount = (accountId: string) => {
    setSelectedAccountId(accountId);
    setAccountPickerOpen(false);
  };

  // Six, not three: with Aksi cepat and the stacked banners gone the screen ends
  // halfway down, and the space is better spent on the ledger than on nothing.
  const budgetNameById = useMemo(
    () => new Map((budgetsQ.data ?? []).map((b) => [b.id, b.name])),
    [budgetsQ.data]
  );
  const homeRows = useMemo<HomeRow[]>(
    () => txns
      .filter((txn) => txn.status !== 'CANCELLED')
      .slice(0, 6)
      .map((t) => ({ ...toRow(t), budgetName: t.special_budget_id ? budgetNameById.get(t.special_budget_id) ?? null : null })),
    [txns, budgetNameById]
  );
  // Searched over every transaction, not over the handful Home prints: the rows
  // are ordered by creation, so a plan written when the cycle opened falls
  // outside them and the line read "Periksa daftar transaksi" with a real name
  // available.
  const nextUnpaidName = useMemo(
    () => txns.find((t) => t.status === 'PENDING' && t.direction === 'EXPENSE')?.name ?? null,
    [txns]
  );

  const cycleName = cycleQ.data?.name ?? 'Belum ada siklus aktif';
  const unpaidCount = flow.unpaidExpenseCount;
  // Cycle-wide like unpaidCount, not per selected account: a count and a figure
  // standing side by side must be drawn from the same rows.
  const needsReconcile = !!(cycleQ.data?.primary_account_id && !reconciliationQ.data);
  const unpaidAmount = useMemo(
    () => txns
      .filter((t) => t.status === 'PENDING' && t.direction === 'EXPENSE')
      .reduce((sum, t) => sum + t.planned_amount, 0),
    [txns]
  );
  const numbersUnavailable = failed || (householdId !== undefined && (!cycleQ.data || txnsQ.isLoading || homeAccountsQ.isLoading));
  const movementUnavailable = numbersUnavailable || loadingCash || txnsQ.isError;
  const income = movementUnavailable ? null : flow.income + flow.transferIn;
  const expense = movementUnavailable ? null : flow.expense + flow.transferOut;
  const actualCash = movementUnavailable ? null : selectedActualBalance;
  const projectedRemaining = movementUnavailable ? null : selectedProjectedBalance;
  // Spent from a card or cash: it never moves the balances above, so without a
  // note it reads as a purchase that went missing from Home.
  const cardSpend = useMemo(() => nonCashSpend(txns), [txns]);
  const unanchoredMovement = movementUnavailable ? null : flow.actualCash;
  const amountLabel = (value: number | null) => (value === null ? '—' : signedRupiah(value));

  const todayISO = new Date().toISOString().slice(0, 10);

  // Anggaran Khusus: money they still claim sits in the same accounts, so the
  // cycle's share of the primary balance is the balance minus what open
  // budgets have left (deficits are never added back).
  const localToday = localISODate(new Date());
  const budgetFigures = budgetFiguresQ.data;
  const openBudgets = useMemo(
    () => (budgetsQ.data ?? [])
      .filter((b) => specialBudgetStatus(b, localToday) !== 'CLOSED')
      .sort((a, b) => a.end_date.localeCompare(b.end_date)),
    [budgetsQ.data, localToday]
  );
  const budgetAttention = useMemo(
    () => (budgetFigures ? specialBudgetAttention(openBudgets, budgetFigures, localToday) : []),
    [openBudgets, budgetFigures, localToday]
  );
  const budgetsFailed = budgetsQ.isError || budgetFiguresQ.isError;
  const split =
    actualCash !== null && budgetFigures && selectedAccount?.id === cycleQ.data?.primary_account_id
      ? cyclePortion(actualCash, openBudgets.map((b) => budgetFigures[b.id]?.remaining ?? 0))
      : null;
  const showSplit = !!split && split.budgets > 0;
  const splitPct = split && actualCash && actualCash > 0
    ? Math.max(0, Math.min(100, Math.round((split.budgets / actualCash) * 100)))
    : 100;
  const rangeLabel = cycleRangeLabel(cycleQ.data?.start_date, cycleQ.data?.end_date, todayISO);

  const openUnpaid = () => router.push({ pathname: '/(tabs)/history', params: { status: 'PENDING' } });

  const displayName = membership?.display_name?.trim() || household?.name?.trim() || 'Keluarga';
  const avatarInitial = memberInitials(membership?.display_name ?? household?.name ?? 'Keluarga');

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={
              refreshing ||
              txnsQ.isFetching ||
              summaryQ.isFetching ||
              homeCashQ.isFetching ||
              homeAccountsQ.isFetching
            }
            onRefresh={refreshHome}
            tintColor={Colors.accent}
          />
        }
      >
        {/* Dark Overview Card (01_home composition) */}
        <View style={styles.overview}>
          {/* Topline: Avatar & Greeting */}
          <View style={styles.topline}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Buka profil"
              onPress={() => router.push('/(tabs)/profile')}
              style={styles.avatar}
            >
              <Text style={styles.avatarText}>{avatarInitial}</Text>
            </Pressable>
            <View style={styles.greetCopy}>
              <Text style={styles.roomLabel}>Selamat pagi,</Text>
              <Text style={styles.userName} numberOfLines={1}>
                {displayName}
              </Text>
            </View>
          </View>

          {/* Cycle Block (Compact 1-line style) */}
          <View style={styles.cycleBlock}>
            <View style={styles.cycleSummary}>
              <Pressable
                onPress={() => {
                  if (summaryQ.data?.status === 'FUNDING_GAP') {
                    router.push('/funding-gap');
                  } else if (cycleQ.data) {
                    router.push({ pathname: '/cycle-detail', params: { cycleId: cycleQ.data.id } });
                  } else {
                    router.push('/new-cycle');
                  }
                }}
                style={styles.cyclePill}
              >
                <Text style={styles.cyclePillText}>Siklus berjalan</Text>
                <ChevronRight size={13} color={Colors.accentStrong} />
              </Pressable>
              <Text style={styles.cycleTitle} numberOfLines={1}>
                {cycleName}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                if (cycleQ.data) {
                  router.push({ pathname: '/cycle-detail', params: { cycleId: cycleQ.data.id } });
                } else {
                  router.push('/new-cycle');
                }
              }}
              accessibilityLabel="Detail kalender siklus"
              style={styles.cycleCalendar}
            >
              <Calendar size={18} color={Colors.textOnDark} />
            </Pressable>
          </View>
          <Text style={styles.cycleRange}>{rangeLabel ?? 'Siklus belum dibuka'}</Text>

          {/* Balance Section */}
          <View style={styles.balanceSection}>
            <View style={styles.balanceLabelRow}>
              <Text style={styles.balanceLabel}>
                {actualCash === null ? 'Pergerakan akun' : 'Saldo akun tercatat'}
              </Text>
              <View style={styles.balanceDot} />
            </View>

            {/* Account Selector Pill */}
            <Pressable
              onPress={() => setAccountPickerOpen(true)}
              style={styles.balanceAccountPill}
            >
              <Text style={styles.balanceAccountText} numberOfLines={1}>
                {selectedAccount
                  ? `${selectedAccount.name} · ${selectedAccount.type}${
                      selectedAccount.id === primaryAccount?.id ? ' · acuan rekonsiliasi' : ''
                    }`
                  : 'Pilih akun kas'}
              </Text>
              <ChevronDown size={14} color={Colors.textOnDarkMuted} />
            </Pressable>

            {/* Large Balance Amount */}
            <Text style={styles.balanceAmount}>
              {selectedAccount
                ? actualCash === null
                  ? amountLabel(unanchoredMovement)
                  : amountLabel(actualCash)
                : '—'}
            </Text>

            {/* What is left once this account's unexecuted plans are paid. */}
            {actualCash !== null && projectedRemaining !== null && (
              <View style={styles.estimateBox}>
                <View style={styles.estimateHeadRow}>
                  <Text style={styles.estimateLabel}>
                    {flow.pendingOutflowCount > 0
                      ? `Setelah ${flow.pendingOutflowCount} tagihan dibayar`
                      : 'Tidak ada tagihan tersisa'}
                  </Text>
                  <View style={styles.estimateDot} />
                </View>
                <Text style={styles.estimateValue}>{amountLabel(projectedRemaining)}</Text>
                {flow.pendingOutflowCount > 0 && (
                  <View style={styles.estimateBreakdownRow}>
                    <Text style={styles.estimateBreakdownLabel}>Belum dieksekusi</Text>
                    <Text style={styles.estimateBreakdownValue}>
                      &minus; {formatRupiah(flow.pendingExpense)}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {showSplit && split && (
              <View style={styles.splitBox}>
                <View
                  style={styles.splitTrack}
                  accessibilityRole="image"
                  accessibilityLabel={`Siklus ${formatRupiah(split.cycle)}, anggaran khusus ${formatRupiah(split.budgets)}`}
                >
                  <View style={[styles.splitCycle, { flex: Math.max(0, 100 - splitPct) }]} />
                  <View style={[styles.splitBudget, { flex: splitPct }]} />
                </View>
                <View style={styles.splitLegend}>
                  <Text style={styles.splitText}>
                    <Text style={{ color: Colors.accent }}>● </Text>Siklus {signedRupiah(split.cycle)}
                  </Text>
                  <Text style={styles.splitText}>
                    <Text style={{ color: Colors.purple }}>● </Text>Anggaran khusus {formatRupiah(split.budgets)}
                  </Text>
                </View>
              </View>
            )}

            {/* A card purchase moves no money out of this account — say so,
                otherwise it looks like the spending never registered. */}
            {!movementUnavailable && cardSpend > 0 && (
              <Text style={styles.cardSpendNote}>
                Belum termasuk {formatRupiah(cardSpend)} belanja kartu kredit/tunai — uangnya
                belum keluar dari rekening ini.
              </Text>
            )}

            {/* One line: these are cumulative totals, read far less often than
                the figure above them. */}
            <View style={styles.flowRow}>
              <Text style={styles.flowItem}>
                <Text style={styles.flowUp}>↑ </Text>
                {income === null ? '—' : formatRupiah(flow.income + flow.transferIn)}
              </Text>
              <Text style={styles.flowItem}>
                <Text style={styles.flowDown}>↓ </Text>
                {expense === null ? '—' : formatRupiah(flow.expense + flow.transferOut)}
              </Text>
            </View>
          </View>
        </View>

        {!householdId && (
          <Pressable onPress={() => router.push('/(auth)/setup-choice')} style={styles.offline}>
            <Text style={styles.offlineText}>
              Mode offline — ketuk untuk login &amp; sinkron dengan pasangan
            </Text>
            <ChevronRight size={15} color={Colors.warning} />
          </Pressable>
        )}

        {failed && householdId && (
          <QueryError
            onRetry={retryAll}
            retrying={txnsQ.isFetching || cycleQ.isFetching || homeCashQ.isFetching}
          />
        )}

        {/* Section: Perlu Perhatian — every open item in one list, so two
            yellow blocks no longer stack on top of each other. */}
        {(needsReconcile || unpaidCount > 0 || budgetAttention.length > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Perlu perhatian</Text>
              {unpaidCount > 0 && (
                <Pressable onPress={openUnpaid} hitSlop={8}>
                  <Text style={styles.sectionLink}>Lihat semua</Text>
                </Pressable>
              )}
            </View>
            <View style={styles.attentionList}>
              {needsReconcile && (
                <Pressable
                  onPress={() => router.push('/reconciliation')}
                  style={[styles.attentionRow, unpaidCount > 0 && styles.attentionRowDivided]}
                >
                  <View style={styles.attentionIconBox}>
                    <Calendar size={16} color={Colors.warning} />
                  </View>
                  <View style={styles.attentionCopy}>
                    <Text style={styles.attentionTitle}>Cek saldo akun primer</Text>
                    <Text style={styles.attentionSub} numberOfLines={1}>
                      Tutup siklus dengan mencocokkan saldo{' '}
                      {formatShortDate(cycleQ.data?.end_date) ?? 'akhir periode'}.
                    </Text>
                  </View>
                  <ChevronRight size={18} color={Colors.warning} />
                </Pressable>
              )}
              {unpaidCount > 0 && (
                <Pressable onPress={openUnpaid} style={styles.attentionRow}>
                  <View style={styles.attentionIconBox}>
                    <Text style={styles.attentionIconText}>!</Text>
                  </View>
                  <View style={styles.attentionCopy}>
                    <Text style={styles.attentionTitle}>
                      {unpaidPlansLabel(unpaidCount, unpaidAmount)}
                    </Text>
                    <Text style={styles.attentionSub} numberOfLines={1}>
                      Terdekat · {nextUnpaidName ?? 'Periksa daftar transaksi'}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={Colors.warning} />
                </Pressable>
              )}
              {budgetAttention.map((a, i) => (
                <Pressable
                  key={a.budget.id}
                  onPress={() =>
                    a.kind === 'ENDED'
                      ? router.push({ pathname: '/special-budget-close', params: { id: a.budget.id } })
                      : router.push({ pathname: '/special-budget', params: { id: a.budget.id } })
                  }
                  style={[
                    styles.attentionRow,
                    (needsReconcile || unpaidCount > 0 || i > 0) && styles.attentionRowTopDivided,
                  ]}
                >
                  <View style={styles.attentionIconBox}>
                    <Text style={styles.attentionIconText}>{a.kind === 'DEFICIT' ? '−' : '!'}</Text>
                  </View>
                  <View style={styles.attentionCopy}>
                    <Text style={styles.attentionTitle} numberOfLines={1}>
                      {a.kind === 'DEFICIT'
                        ? `${a.budget.name} minus ${formatRupiah(-a.remaining)}`
                        : a.daysPast === 0
                          ? `${a.budget.name} selesai hari ini`
                          : `${a.budget.name} selesai ${a.daysPast} hari lalu`}
                    </Text>
                    <Text style={styles.attentionSub} numberOfLines={1}>
                      {a.kind === 'DEFICIT'
                        ? 'Kekurangannya sudah memakai dana siklus. Tutup untuk mencatatnya.'
                        : a.remaining > 0
                          ? `Sisa ${formatRupiah(a.remaining)} belum ditentukan tempatnya.`
                          : 'Tutup kalau sudah tidak ada transaksi susulan.'}
                    </Text>
                  </View>
                  <ChevronRight size={18} color={Colors.warning} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Section: Anggaran Khusus — only when the family has one open. */}
        {householdId && (budgetsFailed || openBudgets.length > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Anggaran khusus</Text>
              <Pressable onPress={() => router.push('/special-budgets')} hitSlop={8}>
                <Text style={styles.sectionLink}>Lihat semua</Text>
              </Pressable>
            </View>
            {budgetsFailed ? (
              <QueryError
                onRetry={() => {
                  void budgetsQ.refetch();
                  void budgetFiguresQ.refetch();
                }}
                retrying={budgetsQ.isFetching || budgetFiguresQ.isFetching}
              />
            ) : (
              <View style={styles.budgetCard}>
                {openBudgets.map((b, i) => (
                  <SpecialBudgetRow
                    key={b.id}
                    budget={b}
                    figures={budgetFigures?.[b.id]}
                    todayISO={localToday}
                    onPress={() => router.push({ pathname: '/special-budget', params: { id: b.id } })}
                    isLast={i === openBudgets.length - 1}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {/* Section: Aktivitas Terbaru */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Aktivitas terbaru</Text>
            <Pressable onPress={() => router.push('/(tabs)/history')} hitSlop={8}>
              <Text style={styles.sectionLink}>Lihat semua</Text>
            </Pressable>
          </View>

          {txnsQ.isLoading && householdId ? (
            <Text style={styles.emptyText}>Memuat aktivitas keluarga…</Text>
          ) : failed && householdId ? (
            <Text style={styles.emptyText}>Aktivitas belum bisa dimuat.</Text>
          ) : homeRows.length === 0 ? (
            <View style={styles.emptyBox}>
              <BrandIcon name="empty-belum-ada-transaksi" size={64} label="" />
              <Text style={styles.emptyText}>
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
              {homeRows.map((item, index) => (
                <ActivityRow
                  key={item.id}
                  item={item}
                  isLast={index === homeRows.length - 1}
                  onPress={() =>
                    item.status === 'PENDING'
                      ? router.push({ pathname: '/payment-confirm', params: { id: item.id } })
                      : router.push('/(tabs)/history')
                  }
                />
              ))}
            </View>
          )}
        </View>

        {/* Account Selection Modal */}
        <Modal
          visible={accountPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setAccountPickerOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setAccountPickerOpen(false)}>
            <Pressable style={styles.sheetContent} onPress={(e) => e.stopPropagation()}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Pilih Akun Kas</Text>
                <Pressable
                  onPress={() => setAccountPickerOpen(false)}
                  hitSlop={10}
                  accessibilityLabel="Tutup pemilih akun"
                >
                  <X size={20} color={Colors.textPrimary} />
                </Pressable>
              </View>
              <Text style={styles.sheetSubtitle}>
                Pilih akun kas untuk memantau pergerakan saldo pada layar utama.
              </Text>
              <View style={styles.accountList}>
                {homeAccountsQ.data?.map((account) => {
                  const isSelected = account.id === selectedAccount?.id;
                  const isPrimary = account.id === primaryAccount?.id;
                  return (
                    <Pressable
                      key={account.id}
                      onPress={() => selectAccount(account.id)}
                      style={[styles.accountItem, isSelected && styles.accountItemActive]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.accountItemName, isSelected && styles.accountItemNameActive]}>
                          {account.name}
                        </Text>
                        <Text style={styles.accountItemType}>
                          {account.type}
                          {isPrimary ? ' · Acuan Rekonsiliasi' : ''}
                        </Text>
                      </View>
                      {isSelected && <View style={styles.accountSelectedDot} />}
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={() => {
                  setAccountPickerOpen(false);
                  router.push('/manage-accounts');
                }}
                style={styles.manageAccountsButton}
              >
                <Text style={styles.manageAccountsText}>Kelola Rekening Kas</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActivityRow({
  item,
  isLast,
  onPress,
}: {
  item: HomeRow;
  isLast: boolean;
  onPress: () => void;
}) {
  const isIncome = item.direction === 'INCOME';
  const isPaid = item.status === 'PAID';
  const amountStr = `${isIncome ? '+' : '−'} ${formatRupiah(item.amount)}`;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.activityRow, isLast && styles.activityRowLast]}
    >
      <View style={styles.activityIconBox}>
        <BrandIcon
          name={categoryIconName({
            name: item.category,
            type: item.categoryType ?? 'EXPENSE',
            icon: item.categoryIcon,
          })}
          size={18}
          label=""
        />
      </View>
      <View style={styles.activityCopy}>
        <Text style={styles.activityName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.activityMeta} numberOfLines={1}>
          {item.category} · {item.budgetName ?? item.account}
        </Text>
      </View>
      <View style={styles.activityRight}>
        <Text style={[styles.activityAmount, isIncome && styles.activityAmountIncome]} numberOfLines={1}>
          {amountStr}
        </Text>
        <Text style={styles.activityDate}>{isPaid ? 'Lunas' : 'Belum lunas'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.navy,
  },
  container: {
    backgroundColor: Colors.surface,
    paddingBottom: 110,
    // The safe area behind the scroll view is navy so the hero bleeds into the
    // status bar. Without filling the viewport, a short Home (an empty cycle)
    // ends halfway down and that navy shows below the content.
    flexGrow: 1,
  },

  /* Dark Overview Card */
  overview: {
    backgroundColor: Colors.navy,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 22,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  topline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.navySoft,
    borderWidth: 1,
    borderColor: Colors.avatarBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: Colors.textOnDark,
    fontSize: 13,
    fontWeight: '700',
  },
  greetCopy: {
    flex: 1,
  },
  roomLabel: {
    color: Colors.textOnDarkSecondary,
    fontSize: 11,
  },
  userName: {
    color: Colors.textOnDark,
    fontSize: 15,
    fontWeight: '700',
  },

  /* Cycle Block (Compact 1-line style) */
  cycleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
  },
  cycleSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 48,
  },
  cyclePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentSoft,
  },
  cyclePillText: {
    color: Colors.accentStrong,
    fontSize: 10,
    fontWeight: '700',
  },
  cycleTitle: {
    color: Colors.textOnDark,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  cycleCalendar: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.borderOnDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cycleRange: {
    color: Colors.textOnDarkSecondary,
    fontSize: 11,
    marginTop: 5,
  },

  /* Balance Section */
  balanceSection: {
    marginTop: 22,
  },
  balanceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  balanceLabel: {
    color: Colors.textOnDarkSecondary,
    fontSize: 12,
  },
  balanceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
  },
  balanceAccountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  balanceAccountText: {
    color: Colors.textOnDarkMuted,
    fontSize: 11,
  },
  balanceAmount: {
    color: Colors.textOnDark,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums'],
    marginTop: 3,
  },

  /* Estimate */
  estimateBox: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  estimateHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  estimateLabel: {
    color: Colors.textOnDarkSecondary,
    fontSize: 11,
  },
  estimateValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  estimateValue: {
    color: Colors.textOnDark,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 3,
    fontVariant: ['tabular-nums'],
  },
  estimateBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  estimateBreakdownLabel: {
    color: Colors.textOnDarkMuted,
    fontSize: 11,
  },
  estimateBreakdownValue: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cardSpendNote: {
    color: Colors.textOnDarkMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 10,
  },
  estimateDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
  },

  /* Stats Grid */

  offline: {
    backgroundColor: Colors.alertBg,
    borderWidth: 1,
    borderColor: '#F7DFA9',
    borderRadius: Radius.md,
    padding: 11,
    marginHorizontal: 16,
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  offlineText: {
    color: Colors.warning,
    fontSize: FontSize.caption,
    fontWeight: '600',
    flex: 1,
  },

  /* White Body Sections */
  section: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sectionLink: {
    color: Colors.info,
    fontSize: 11,
    fontWeight: '700',
  },


  /* Attention Alert Card */
  // One bordered card holding every open item, rather than one card each.
  attentionList: {
    borderRadius: 14,
    backgroundColor: Colors.warningSoft,
    borderWidth: 1,
    borderColor: Colors.warningBorder,
    overflow: 'hidden',
  },
  attentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 12,
  },
  attentionRowDivided: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.warningBorder,
  },
  attentionRowTopDivided: {
    borderTopWidth: 1,
    borderTopColor: Colors.warningBorder,
  },
  budgetCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    paddingHorizontal: 14,
    backgroundColor: Colors.surface,
  },
  splitBox: {
    marginTop: 10,
    gap: 6,
  },
  splitTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: Colors.navySoft,
  },
  splitCycle: { backgroundColor: Colors.accent },
  splitBudget: { backgroundColor: Colors.purple },
  splitLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  splitText: {
    color: Colors.textOnDarkSecondary,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  flowRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
  },
  flowItem: {
    color: Colors.textOnDarkSecondary,
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
  },
  flowUp: { color: Colors.positive, fontWeight: '700' },
  flowDown: { color: Colors.negative, fontWeight: '700' },
  attentionIconBox: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: Colors.warningSoftIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attentionIconText: {
    color: Colors.warning,
    fontSize: 16,
    fontWeight: '800',
  },
  attentionCopy: {
    flex: 1,
  },
  attentionTitle: {
    color: Colors.textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  attentionSub: {
    color: Colors.textSecondary,
    fontSize: 9.5,
    marginTop: 2,
  },

  /* Activity List */
  activityList: {
    marginTop: 4,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  activityRowLast: {
    borderBottomWidth: 0,
  },
  activityIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityCopy: {
    flex: 1,
  },
  activityName: {
    color: Colors.textPrimary,
    fontSize: 12.5,
    fontWeight: '700',
  },
  activityMeta: {
    color: Colors.textSecondary,
    fontSize: 10,
    marginTop: 2,
  },
  activityRight: {
    alignItems: 'flex-end',
  },
  activityAmount: {
    color: Colors.textPrimary,
    fontSize: 11.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  activityAmountIncome: {
    color: Colors.paidText,
  },
  activityDate: {
    color: Colors.textMuted,
    fontSize: 9.5,
    marginTop: 2,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: FontSize.body,
    textAlign: 'center',
    paddingVertical: 14,
  },
  emptyBox: {
    gap: 8,
    alignItems: 'center',
    paddingVertical: 16,
  },
  emptyLink: {
    color: Colors.info,
    fontWeight: '600',
    textAlign: 'center',
    fontSize: FontSize.body,
  },

  /* Account Modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlayScrim,
    justifyContent: 'flex-end',
  },
  sheetContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: 18,
    paddingBottom: 34,
    gap: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.borderStrong,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.cardTitle,
    fontWeight: '700',
  },
  sheetSubtitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.caption,
    lineHeight: 16,
  },
  accountList: {
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    overflow: 'hidden',
    marginTop: 4,
  },
  accountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  accountItemActive: {
    backgroundColor: Colors.subtle,
  },
  accountItemName: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  accountItemNameActive: {
    fontWeight: '700',
    color: Colors.info,
  },
  accountItemType: {
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  accountSelectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.info,
  },
  manageAccountsButton: {
    marginTop: 4,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: Radius.md,
    backgroundColor: Colors.subtle,
  },
  manageAccountsText: {
    color: Colors.textPrimary,
    fontSize: FontSize.caption,
    fontWeight: '700',
  },
});
