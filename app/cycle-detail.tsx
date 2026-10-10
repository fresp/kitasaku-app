import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import ArrowDown from 'lucide-react-native/icons/arrow-down';
import Eye from 'lucide-react-native/icons/eye';
import EyeOff from 'lucide-react-native/icons/eye-off';
import MoreVertical from 'lucide-react-native/icons/ellipsis-vertical';
import Calendar from 'lucide-react-native/icons/calendar';

import { Colors } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { categoryIconName } from '../lib/category-icon';
import { BrandIcon } from '../components/ui/BrandIcon';
import { useAuth } from '../lib/auth-context';
import {
  calcCashflow,
  useActiveCycle,
  useCancelCycle,
  useCategories,
  useHomeCashAccounts,
  useHomeCashBalance,
  useHouseholdCycles,
  useTransactionLedger,
  useTransactions,
} from '../lib/queries';
import type { Cycle, Txn } from '../lib/queries';
import {
  budgetFillPct,
  budgetHealthStatus,
  budgetPctLabel,
  formatShortDate,
} from '../lib/zero-based';

type ActiveTab = 'ringkasan' | 'anggaran' | 'transaksi';

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

function formatLongDateID(iso: string | null | undefined): string {
  if (!iso) return 'Belum bertanggal';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return 'Belum bertanggal';
  const day = parseInt(m[3], 10);
  const monthIdx = parseInt(m[2], 10) - 1;
  const month = FULL_MONTHS_ID[monthIdx] ?? '';
  const year = m[1];
  return `${day} ${month} ${year}`;
}

function formatCycleTitle(cycle: Cycle): string {
  const m = /^(\d{4})-(\d{2})/.exec(cycle.start_date);
  if (m) {
    const monthIdx = parseInt(m[2], 10) - 1;
    const month = FULL_MONTHS_ID[monthIdx] ?? '';
    return `${month} ${m[1]}`;
  }
  return cycle.name;
}

function getCategoryColor(name: string, type?: string) {
  const n = (name || '').toLowerCase();
  if (n.includes('makan') || n.includes('kuliner') || n.includes('jajan') || n.includes('food')) {
    return { bg: '#FEE2E2', iconColor: '#DC2626' };
  }
  if (n.includes('rumah') || n.includes('dapur') || n.includes('kebersihan')) {
    return { bg: '#DCFCE7', iconColor: '#16A34A' };
  }
  if (n.includes('transport') || n.includes('bensin') || n.includes('ojek') || n.includes('mobil')) {
    return { bg: '#FFEDD5', iconColor: '#EA580C' };
  }
  if (n.includes('tagihan') || n.includes('wifi') || n.includes('pulsa') || n.includes('listrik')) {
    return { bg: '#DBEAFE', iconColor: '#2563EB' };
  }
  if (n.includes('didik') || n.includes('sekolah') || n.includes('kursus') || n.includes('buku')) {
    return { bg: '#F3E8FF', iconColor: '#9333EA' };
  }
  if (n.includes('sehat') || n.includes('obat') || n.includes('dokter') || n.includes('klinik')) {
    return { bg: '#CCFBF1', iconColor: '#0D9488' };
  }
  if (n.includes('belanja') || n.includes('baju') || n.includes('pakaian')) {
    return { bg: '#FEF3C7', iconColor: '#D97706' };
  }
  if (n.includes('hiburan') || n.includes('game') || n.includes('nonton') || n.includes('libur')) {
    return { bg: '#EDE9FE', iconColor: '#7C3AED' };
  }
  if (n.includes('invest') || n.includes('saham') || n.includes('reksa') || n.includes('tabung')) {
    return { bg: '#D1FAE5', iconColor: '#059669' };
  }
  if (type === 'INCOME' || n.includes('gaji') || n.includes('pemasukan') || n.includes('bonus')) {
    return { bg: '#ECFDF5', iconColor: '#10B981' };
  }
  return { bg: '#F1F5F9', iconColor: '#64748B' };
}

export default function CycleDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ cycleId?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;

  const [activeTab, setActiveTab] = useState<ActiveTab>('ringkasan');
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(params.cycleId ?? null);

  const activeCycleQ = useActiveCycle(householdId);
  const cyclesQ = useHouseholdCycles(householdId);
  const cycles = useMemo(() => cyclesQ.data ?? [], [cyclesQ.data]);

  // Determine current active or selected cycle
  const currentCycle = useMemo(() => {
    if (selectedCycleId) {
      const match = cycles.find((c) => c.id === selectedCycleId);
      if (match) return match;
    }
    if (params.cycleId) {
      const match = cycles.find((c) => c.id === params.cycleId);
      if (match) return match;
    }
    return activeCycleQ.data ?? cycles[0] ?? null;
  }, [selectedCycleId, params.cycleId, cycles, activeCycleQ.data]);

  const currentIdx = useMemo(() => {
    if (!currentCycle) return -1;
    return cycles.findIndex((c) => c.id === currentCycle.id);
  }, [cycles, currentCycle]);

  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx >= 0 && currentIdx < cycles.length - 1;

  const handlePrevCycle = () => {
    if (hasPrev) {
      setSelectedCycleId(cycles[currentIdx - 1].id);
    }
  };

  const handleNextCycle = () => {
    if (hasNext) {
      setSelectedCycleId(cycles[currentIdx + 1].id);
    }
  };

  const cycleId = currentCycle?.id;

  const catsQ = useCategories(householdId);
  const homeAccountsQ = useHomeCashAccounts(householdId);
  const txnsQ = useTransactions(householdId, cycleId);
  const ledgerQ = useTransactionLedger(householdId, cycleId, 'actual');

  const displayAccount = useMemo(() => {
    return (
      homeAccountsQ.data?.find((a) => a.id === currentCycle?.primary_account_id) ??
      homeAccountsQ.data?.[0] ??
      null
    );
  }, [homeAccountsQ.data, currentCycle?.primary_account_id]);

  const homeCashQ = useHomeCashBalance(
    householdId,
    currentCycle,
    txnsQ.data ?? [],
    displayAccount?.id
  );

  const txns = useMemo(() => txnsQ.data ?? [], [txnsQ.data]);
  const flow = useMemo(() => calcCashflow(txns, displayAccount?.id), [txns, displayAccount?.id]);
  const balances = homeCashQ.data;
  const openingStated = balances?.openingStated ?? null;

  const actualCash = openingStated === null ? flow.actualCash : openingStated + flow.actualCash;
  const projectedRemaining =
    openingStated === null ? flow.projectedRemaining : openingStated + flow.projectedRemaining;

  const incomeTotal = flow.income + flow.transferIn;
  const expenseTotal = flow.expense + flow.transferOut;

  // Category Budget Aggregation
  const categoryBudgetRows = useMemo(() => {
    const cats = (catsQ.data ?? []).filter((c) => c.type === 'EXPENSE');
    const actualTxns = ledgerQ.data ?? [];
    const spentByCat = new Map<string, number>();

    for (const t of actualTxns) {
      if (t.direction !== 'EXPENSE' || t.status !== 'PAID' || !t.category_id) continue;
      spentByCat.set(t.category_id, (spentByCat.get(t.category_id) ?? 0) + t.actual_amount);
    }

    return cats.map((c) => {
      const spent = spentByCat.get(c.id) ?? 0;
      const budget = c.monthly_budget ?? 0;
      const health = budgetHealthStatus(spent, budget);
      const colorScheme = getCategoryColor(c.name, c.type);
      return {
        id: c.id,
        name: c.name,
        icon: c.icon ?? null,
        spent,
        budget,
        health,
        fillPct: budgetFillPct(health),
        colorScheme,
      };
    });
  }, [catsQ.data, ledgerQ.data]);

  const totalBudget = categoryBudgetRows.reduce((sum, r) => sum + r.budget, 0);
  const totalSpent = categoryBudgetRows.reduce((sum, r) => sum + r.spent, 0);
  // Stated uncapped: clamping here made the "> 100 ? red" branches below dead
  // code, so a cycle 51% past its plan rendered as a full green bar at 100%.
  const overallBudgetPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  // The bar is a different number from the text: a track cannot overflow.
  const overallBarPct = Math.min(100, overallBudgetPct);

  // Grouped Transactions
  const groupedTransactions = useMemo(() => {
    const groups: { dateHeader: string; items: Txn[] }[] = [];
    const map = new Map<string, Txn[]>();

    for (const t of txns) {
      const dateKey = t.release_date ?? t.created_at?.slice(0, 10) ?? 'unknown';
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(t);
    }

    const sortedKeys = Array.from(map.keys()).sort((a, b) => b.localeCompare(a));
    for (const key of sortedKeys) {
      groups.push({
        dateHeader: formatLongDateID(key),
        items: map.get(key)!,
      });
    }

    return groups;
  }, [txns]);

  const cancelCycleMutation = useCancelCycle();

  const handleCancelCycle = () => {
    setMenuOpen(false);
    if (!householdId || !currentCycle) return;
    Alert.alert(
      'Batalkan Siklus',
      `Yakin ingin membatalkan "${currentCycle.name}"? Tindakan ini tidak dapat dibatalkan.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Batalkan Siklus',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelCycleMutation.mutateAsync({
                householdId,
                cycleId: currentCycle.id,
              });
              router.back();
            } catch (e: any) {
              Alert.alert('Gagal', e?.message || 'Tidak dapat membatalkan siklus.');
            }
          },
        },
      ]
    );
  };

  const handleRefresh = async () => {
    await Promise.all([
      activeCycleQ.refetch(),
      cyclesQ.refetch(),
      txnsQ.refetch(),
      ledgerQ.refetch(),
      catsQ.refetch(),
      homeAccountsQ.refetch(),
    ]);
  };

  if (!currentCycle) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.headerBtn}>
            <ChevronLeft size={22} color="#0B1527" />
          </Pressable>
          <Text style={styles.headerTitle}>Detail Siklus</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Calendar size={48} color="#94A3B8" />
          <Text style={styles.emptyTitle}>Siklus Tidak Ditemukan</Text>
          <Text style={styles.emptySubtitle}>
            Belum ada siklus aktif yang dipilih. Silakan kembali ke riwayat siklus.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const isCurrent =
    currentCycle.is_active ||
    (today >= currentCycle.start_date && today <= currentCycle.end_date && !currentCycle.closed_at);

  const diffDays = Math.max(
    0,
    Math.ceil(
      (new Date(`${currentCycle.end_date}T23:59:59Z`).getTime() -
        new Date(`${today}T00:00:00Z`).getTime()) /
        (1000 * 60 * 60 * 24)
    )
  );

  const startStr = formatShortDate(currentCycle.start_date) ?? '';
  const endStr = formatShortDate(currentCycle.end_date) ?? '';
  const dateRangeStr = `${startStr} - ${endStr}${isCurrent ? ` · ${diffDays} hari lagi` : ''}`;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* Top Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.headerBtn}>
          <ChevronLeft size={22} color="#0B1527" />
        </Pressable>

        {/* Center Cycle Switcher */}
        <View style={styles.cycleSwitcherContainer}>
          <View style={styles.cycleSwitcherRow}>
            <Pressable
              onPress={handlePrevCycle}
              disabled={!hasPrev}
              hitSlop={8}
              style={[styles.arrowBtn, !hasPrev && styles.arrowBtnDisabled]}
            >
              <ChevronLeft size={16} color={hasPrev ? '#0B1527' : '#CBD5E1'} />
            </Pressable>
            <Text style={styles.cycleTitle} numberOfLines={1}>
              {formatCycleTitle(currentCycle)}
            </Text>
            <Pressable
              onPress={handleNextCycle}
              disabled={!hasNext}
              hitSlop={8}
              style={[styles.arrowBtn, !hasNext && styles.arrowBtnDisabled]}
            >
              <ChevronRight size={16} color={hasNext ? '#0B1527' : '#CBD5E1'} />
            </Pressable>
          </View>
          <Text style={styles.dateSubRange}>{dateRangeStr}</Text>
        </View>

        <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} style={styles.headerBtn}>
          <MoreVertical size={20} color="#0B1527" />
        </Pressable>
      </View>

      {/* Tab Segment Controls */}
      <View style={styles.tabBar}>
        {(['ringkasan', 'anggaran', 'transaksi'] as const).map((tabKey) => {
          const isActive = activeTab === tabKey;
          const label =
            tabKey === 'ringkasan'
              ? 'Ringkasan'
              : tabKey === 'anggaran'
              ? 'Anggaran'
              : 'Transaksi';
          return (
            <Pressable
              key={tabKey}
              onPress={() => setActiveTab(tabKey)}
              style={[styles.tabButton, isActive && styles.tabButtonActive]}
            >
              <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={txnsQ.isFetching || cyclesQ.isFetching}
            onRefresh={handleRefresh}
            tintColor={Colors.brandPrimary}
          />
        }
      >
        {/* TAB 1: RINGKASAN */}
        {activeTab === 'ringkasan' && (
          <View style={{ gap: 14 }}>
            {/* Saldo Kas Siklus Hero Card */}
            <View style={styles.heroCard}>
              <View style={styles.heroHeader}>
                <Text style={styles.heroLabel}>Saldo Kas Siklus</Text>
                <Pressable onPress={() => setBalanceHidden(!balanceHidden)} hitSlop={8}>
                  {balanceHidden ? (
                    <EyeOff size={16} color="#64748B" />
                  ) : (
                    <Eye size={16} color="#64748B" />
                  )}
                </Pressable>
              </View>
              <Text style={styles.heroAmount}>
                {balanceHidden ? '••••••••' : formatRupiah(actualCash)}
              </Text>

              <View style={styles.estimateRow}>
                <Text style={styles.estimateLabel}>
                  Estimasi sisa akhir{' '}
                  <Text style={styles.estimateValue}>
                    {balanceHidden ? '••••••••' : formatRupiah(projectedRemaining)}
                  </Text>
                </Text>
              </View>

              {/* Inflow vs Outflow Dual Cards */}
              <View style={styles.flowRow}>
                <View style={[styles.flowCard, { backgroundColor: '#F0FDF4', borderColor: '#DCFCE7' }]}>
                  <View style={styles.cardHeaderSmall}>
                    <View style={[styles.flowIconBadge, { backgroundColor: '#10B981' }]}>
                      <ArrowUp size={12} color="#FFFFFF" strokeWidth={2.5} />
                    </View>
                    <Text style={styles.flowLabel}>Pemasukan</Text>
                  </View>
                  <Text style={styles.flowAmount}>
                    {balanceHidden ? '••••••••' : formatRupiah(incomeTotal)}
                  </Text>
                </View>

                <View style={[styles.flowCard, { backgroundColor: '#FEF2F2', borderColor: '#FEE2E2' }]}>
                  <View style={styles.cardHeaderSmall}>
                    <View style={[styles.flowIconBadge, { backgroundColor: '#EF4444' }]}>
                      <ArrowDown size={12} color="#FFFFFF" strokeWidth={2.5} />
                    </View>
                    <Text style={styles.flowLabel}>Pengeluaran</Text>
                  </View>
                  <Text style={styles.flowAmount}>
                    {balanceHidden ? '••••••••' : formatRupiah(expenseTotal)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Anggaran Progress Overview */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitleSmall}>Alokasi Anggaran</Text>
                <Text style={styles.budgetBigAmount}>{formatRupiah(totalBudget)}</Text>
              </View>
              <View style={styles.budgetMetaRow}>
                <Text style={styles.budgetSpentText}>
                  {formatRupiah(totalSpent)} terpakai
                </Text>
                <Text style={styles.budgetPctText}>{overallBudgetPct}%</Text>
              </View>
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${overallBarPct}%`,
                      backgroundColor: overallBudgetPct > 100 ? '#EF4444' : '#10B981',
                    },
                  ]}
                />
              </View>
            </View>

            {/* Top Categories */}
            <View style={styles.card}>
              <Text style={styles.cardTitleSmall}>Kategori Pengeluaran Terbesar</Text>
              {categoryBudgetRows
                .filter((r) => r.spent > 0)
                .sort((a, b) => b.spent - a.spent)
                .slice(0, 4)
                .map((cat, idx, arr) => {
                  const isLast = idx === arr.length - 1;
                  return (
                    <View
                      key={cat.id}
                      style={[styles.budgetRow, !isLast && styles.budgetRowBordered]}
                    >
                      <View style={[styles.catIconSquircle, { backgroundColor: cat.colorScheme.bg }]}>
                        <BrandIcon
                          name={categoryIconName({ name: cat.name, type: 'EXPENSE', icon: cat.icon })}
                          size={18}
                        />
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={styles.catName} numberOfLines={1}>
                            {cat.name}
                          </Text>
                          <Text style={styles.catSpent}>{formatRupiah(cat.spent)}</Text>
                        </View>
                        <View style={styles.progressBarTrack}>
                          <View
                            style={[
                              styles.progressBarFill,
                              {
                                width: `${Math.min(100, cat.fillPct)}%`,
                                backgroundColor: cat.health.ratioPct > 100 ? '#EF4444' : '#10B981',
                              },
                            ]}
                          />
                        </View>
                      </View>
                    </View>
                  );
                })}
            </View>
          </View>
        )}

        {/* TAB 2: ANGGARAN */}
        {activeTab === 'anggaran' && (
          <View style={{ gap: 14 }}>
            {/* Total Anggaran Hero Card */}
            <View style={styles.card}>
              <Text style={styles.cardLabelGray}>Total Anggaran</Text>
              <Text style={styles.budgetHeroAmount}>{formatRupiah(totalBudget)}</Text>
              <View style={styles.budgetMetaRow}>
                <Text style={styles.budgetSpentText}>
                  {formatRupiah(totalSpent)} terpakai
                </Text>
                <Text style={styles.budgetPctText}>{overallBudgetPct}%</Text>
              </View>
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${overallBarPct}%`,
                      backgroundColor: overallBudgetPct > 100 ? '#EF4444' : '#10B981',
                    },
                  ]}
                />
              </View>
            </View>

            {/* Category Budgets */}
            <View style={styles.card}>
              <Text style={styles.cardTitleSmall}>Kategori Anggaran</Text>
              {categoryBudgetRows.length === 0 ? (
                <Text style={styles.emptyText}>Belum ada anggaran per kategori.</Text>
              ) : (
                categoryBudgetRows.map((cat, idx) => {
                  const isLast = idx === categoryBudgetRows.length - 1;
                  return (
                    <View
                      key={cat.id}
                      style={[styles.budgetRow, !isLast && styles.budgetRowBordered]}
                    >
                      <View style={[styles.catIconSquircle, { backgroundColor: cat.colorScheme.bg }]}>
                        <BrandIcon
                          name={categoryIconName({ name: cat.name, type: 'EXPENSE', icon: cat.icon })}
                          size={18}
                        />
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={styles.catName} numberOfLines={1}>{cat.name}</Text>
                          <Text style={styles.catSpent}>{formatRupiah(cat.spent)}</Text>
                        </View>
                        <View style={styles.progressBarTrack}>
                          <View
                            style={[
                              styles.progressBarFill,
                              {
                                width: `${Math.min(100, cat.fillPct)}%`,
                                backgroundColor: cat.health.ratioPct > 100 ? '#EF4444' : '#10B981',
                              },
                            ]}
                          />
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={styles.catSubtext}>
                            Budget: {formatRupiah(cat.budget)}
                          </Text>
                          <Text
                            style={[
                              styles.catPctBadge,
                              { color: cat.health.ratioPct > 100 ? '#EF4444' : '#10B981' },
                            ]}
                          >
                            {budgetPctLabel(cat.health)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </View>
        )}

        {/* TAB 3: TRANSAKSI */}
        {activeTab === 'transaksi' && (
          <View style={{ gap: 14 }}>
            {groupedTransactions.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.emptyText}>Belum ada transaksi di siklus ini.</Text>
              </View>
            ) : (
              groupedTransactions.map((group) => (
                <View key={group.dateHeader} style={styles.card}>
                  <Text style={styles.dateGroupHeader}>{group.dateHeader}</Text>
                  {group.items.map((txn, idx) => {
                    const isLast = idx === group.items.length - 1;
                    const isIncome = txn.direction === 'INCOME';
                    const category = catsQ.data?.find((c) => c.id === txn.category_id);
                    const colorScheme = getCategoryColor(category?.name ?? txn.name, txn.direction);

                    return (
                      <Pressable
                        key={txn.id}
                        style={[styles.txnRow, !isLast && styles.budgetRowBordered]}
                        onPress={() =>
                          router.push({
                            pathname: '/transaction-edit',
                            params: { id: txn.id },
                          })
                        }
                      >
                        <View style={[styles.catIconSquircle, { backgroundColor: colorScheme.bg }]}>
                          <BrandIcon
                            name={categoryIconName({
                              name: category?.name ?? txn.name,
                              type: txn.direction as any,
                              icon: category?.icon,
                            })}
                            size={18}
                          />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.txnName} numberOfLines={1}>
                            {txn.name}
                          </Text>
                          <Text style={styles.txnCat}>
                            {category?.name ?? 'Umum'} · {txn.status === 'PAID' ? 'Lunas' : 'Menunggu'}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.txnAmount,
                            { color: isIncome ? '#059669' : '#0B1527' },
                          ]}
                        >
                          {isIncome ? '+' : '-'} {formatRupiah(txn.actual_amount || txn.planned_amount)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Options Menu Modal */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle}>Pilihan Siklus</Text>
            {!currentCycle.closed_at && !currentCycle.cancelled_at && (
              <Pressable style={styles.menuItemDanger} onPress={handleCancelCycle}>
                <Text style={styles.menuItemDangerText}>Batalkan Siklus Anggaran</Text>
              </Pressable>
            )}
            <Pressable style={styles.menuItemCancel} onPress={() => setMenuOpen(false)}>
              <Text style={styles.menuItemCancelText}>Tutup</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
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
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cycleSwitcherContainer: {
    alignItems: 'center',
    gap: 2,
  },
  cycleSwitcherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  arrowBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowBtnDisabled: {
    opacity: 0.3,
  },
  cycleTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0B1527',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0B1527',
  },
  dateSubRange: {
    fontSize: 11.5,
    color: '#64748B',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    marginHorizontal: 20,
    marginTop: 6,
    marginBottom: 12,
    padding: 4,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabButtonActive: {
    backgroundColor: '#0B1527',
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 14,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  heroAmount: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0B1527',
    letterSpacing: -0.5,
  },
  estimateRow: {
    marginTop: -4,
  },
  estimateLabel: {
    fontSize: 12.5,
    color: '#64748B',
  },
  estimateValue: {
    fontWeight: '700',
    color: '#0B1527',
  },
  flowRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  flowCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  cardHeaderSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flowIconBadge: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  flowAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0B1527',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 12,
  },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitleSmall: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0B1527',
  },
  cardLabelGray: {
    fontSize: 13,
    color: '#64748B',
  },
  budgetBigAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0B1527',
  },
  budgetHeroAmount: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0B1527',
    letterSpacing: -0.5,
  },
  budgetMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: -4,
  },
  budgetSpentText: {
    fontSize: 12.5,
    color: '#64748B',
  },
  budgetPctText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0B1527',
  },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  budgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  budgetRowBordered: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  catIconSquircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catName: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0B1527',
  },
  catSpent: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B1527',
  },
  catSubtext: {
    fontSize: 11.5,
    color: '#64748B',
  },
  catPctBadge: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  dateGroupHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: -4,
  },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  txnName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0B1527',
  },
  txnCat: {
    fontSize: 12,
    color: '#64748B',
  },
  txnAmount: {
    fontSize: 13.5,
    fontWeight: '700',
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
  emptyText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    paddingVertical: 12,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 21, 39, 0.45)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1527',
    marginBottom: 4,
  },
  menuItemDanger: {
    backgroundColor: '#FEF2F2',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  menuItemDangerText: {
    color: '#EF4444',
    fontWeight: '600',
    fontSize: 14,
  },
  menuItemCancel: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  menuItemCancelText: {
    color: '#0B1527',
    fontWeight: '600',
    fontSize: 14,
  },
});
