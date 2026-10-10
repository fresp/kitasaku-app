import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Search from 'lucide-react-native/icons/search';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Clock from 'lucide-react-native/icons/clock';
import X from 'lucide-react-native/icons/x';
import { Colors, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import { categoryIconName } from '../../lib/category-icon';
import { selectHistoryCycle } from '../../lib/cycle-history';
import { BrandIcon } from '../../components/ui/BrandIcon';
import { QueryError } from '../../components/ui/QueryError';
import { useAuth } from '../../lib/auth-context';
import {
  useAccounts,
  useActiveCycle,
  useCancelCycle,
  useCancelledCycles,
  useHouseholdCycles,
  useTransactionLedger,
} from '../../lib/queries';
import type { LedgerRow } from '../../lib/queries';
import { longDateFullLabel } from '../../lib/obligation';
import {
  formatShortDate,
  ledgerDayLabel,
} from '../../lib/zero-based';
import type { FlowType } from '../../lib/zero-based';

const FLOW_LABELS: Record<FlowType, string> = {
  OPERATING_INCOME: 'Income Operasional',
  FINANCING_INFLOW: 'Pemasukan Pendanaan',
  ASSET_RELEASE: 'Pelepasan Aset',
  EXPENSE: 'Pengeluaran',
  DEBT_PAYMENT: 'Pembayaran Kewajiban',
  ASSET_ALLOCATION: 'Alokasi Aset',
  TRANSFER: 'Transfer Antar Akun',
};

const FLOW_TONES: Record<FlowType, { bg: string; text: string }> = {
  OPERATING_INCOME: { bg: '#ECFDF5', text: '#10B981' },
  FINANCING_INFLOW: { bg: '#ECFDF5', text: '#10B981' },
  ASSET_RELEASE: { bg: '#F1F5F9', text: '#64748B' },
  EXPENSE: { bg: '#FEE2E2', text: '#EF4444' },
  DEBT_PAYMENT: { bg: '#FFF7ED', text: '#EA580C' },
  ASSET_ALLOCATION: { bg: '#F1F5F9', text: '#64748B' },
  TRANSFER: { bg: '#EFF6FF', text: '#2563EB' },
};

const PAGE_SIZE = 30;

type TabFilter = 'ALL' | 'INCOME' | 'EXPENSE' | 'TRANSFER';
type StatusFilter = 'ALL' | 'PENDING' | 'PAID' | 'CANCELLED';

function statusFromParam(value: string | string[] | undefined): StatusFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'PENDING' || v === 'PAID' || v === 'CANCELLED' ? v : 'ALL';
}

export default function HistoryScreen() {
  const router = useRouter();
  const { status: statusParam, cycle: cycleParam } = useLocalSearchParams<{
    status?: string;
    cycle?: string;
  }>();
  const { household } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const cyclesQ = useHouseholdCycles(householdId);
  const cancelledCyclesQ = useCancelledCycles(householdId);
  const cancelCycle = useCancelCycle();
  const requestedCycleId = Array.isArray(cycleParam) ? cycleParam[0] : cycleParam;
  const selectedCycle = selectHistoryCycle(
    requestedCycleId,
    cyclesQ.data ?? [],
    cancelledCyclesQ.data ?? [],
    cycleQ.data ?? null
  );
  const viewingCancelled = !!selectedCycle?.cancelled_at;
  const cycleId = selectedCycle?.id;
  const accsQ = useAccounts(householdId);
  const ledgerQ = useTransactionLedger(householdId, cycleId, 'actual');

  const [q, setQ] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [tab, setTab] = useState<TabFilter>('ALL');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showCycles, setShowCycles] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const status = statusFromParam(statusParam);

  const confirmCancelCycle = (cycle: NonNullable<typeof selectedCycle>) => {
    if (!householdId || cancelCycle.isPending) return;
    Alert.alert(
      'Batalkan siklus?',
      `${cycle.name} · #${cycle.id.slice(0, 8)} akan disimpan sebagai arsip batal. Seluruh rencana yang belum dieksekusi di siklus ini ikut dibatalkan.`,
      [
        { text: 'Kembali', style: 'cancel' },
        {
          text: 'Batalkan siklus',
          style: 'destructive',
          onPress: () => {
            void cancelCycle
              .mutateAsync({ householdId, cycleId: cycle.id })
              .then(() => {
                setShowCycles(false);
                router.setParams({ cycle: undefined, status: undefined });
              })
              .catch((error: unknown) => {
                const message =
                  error instanceof Error
                    ? error.message
                    : 'Coba lagi setelah memuat ulang data.';
                Alert.alert('Siklus tidak dibatalkan', message);
              });
          },
        },
      ]
    );
  };

  const allRows: LedgerRow[] = useMemo(() => ledgerQ.data ?? [], [ledgerQ.data]);

  const narrowed = useMemo(() => {
    return allRows.filter((r) => {
      if (tab === 'INCOME' && r.direction !== 'INCOME') return false;
      if (tab === 'EXPENSE' && (r.direction !== 'EXPENSE' || r.flowType === 'TRANSFER')) return false;
      if (tab === 'TRANSFER' && r.flowType !== 'TRANSFER') return false;
      if (accountId && r.account_id !== accountId) return false;
      if (q.trim()) {
        const query = q.toLowerCase();
        const matchName = r.name.toLowerCase().includes(query);
        const matchCat = r.categories?.name?.toLowerCase().includes(query);
        const matchAcc = r.accounts?.name?.toLowerCase().includes(query);
        if (!matchName && !matchCat && !matchAcc) return false;
      }
      return true;
    });
  }, [allRows, tab, accountId, q]);

  const filtered = useMemo(
    () => (status === 'ALL' ? narrowed : narrowed.filter((r) => r.status === status)),
    [narrowed, status]
  );

  const pendingCount = useMemo(
    () => allRows.filter((r) => r.status === 'PENDING').length,
    [allRows]
  );
  // The banner carries the amount too, so it ties back to Home's "setelah N
  // tagihan dibayar" instead of being a bare count.
  const pendingAmount = useMemo(
    () => allRows
      .filter((r) => r.status === 'PENDING')
      .reduce((sum, r) => sum + r.displayAmount, 0),
    [allRows]
  );

  // "Belum dieksekusi" is a checklist, not a page: it always shows every pending
  // row, so it can never disagree with the banner above it. Paging applies to the
  // dated rows only, and those are ordered by the date they are grouped under —
  // the query returns them by created_at, so slicing that order used to hide a
  // plan written when the cycle opened behind rows added later.
  const pendingRows = useMemo(
    () => filtered.filter((r) => r.status === 'PENDING'),
    [filtered]
  );
  const datedRows = useMemo(
    () => filtered
      .filter((r) => r.status !== 'PENDING')
      .sort((a, b) => (a.release_date ?? '') < (b.release_date ?? '') ? 1 : -1),
    [filtered]
  );
  const page = datedRows.slice(0, visible);
  const remaining = datedRows.length - page.length;

  const groups = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const pending = pendingRows;
    const dated = page;

    const map = new Map<string, { key: string; label: string; rows: LedgerRow[] }>();
    for (const r of dated) {
      const key = r.release_date ?? 'no-date';
      const label = longDateFullLabel(r.release_date) ?? ledgerDayLabel(r.release_date, today);
      if (!map.has(key)) map.set(key, { key, label, rows: [] });
      map.get(key)!.rows.push(r);
    }
    const datedGroups = [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));

    return pending.length > 0
      ? [{ key: 'pending', label: 'Belum dieksekusi', rows: pending }, ...datedGroups]
      : datedGroups;
  }, [page, pendingRows]);

  const accounts = accsQ.data ?? [];
  const cyclesList = cyclesQ.data ?? [];
  const currentCycleIndex = cyclesList.findIndex((c) => c.id === selectedCycle?.id);

  function goToPrevCycle() {
    if (currentCycleIndex < cyclesList.length - 1 && currentCycleIndex !== -1) {
      router.setParams({ cycle: cyclesList[currentCycleIndex + 1].id });
      setVisible(PAGE_SIZE);
    }
  }

  function goToNextCycle() {
    if (currentCycleIndex > 0) {
      router.setParams({ cycle: cyclesList[currentCycleIndex - 1].id });
      setVisible(PAGE_SIZE);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={ledgerQ.isFetching}
            onRefresh={() => {
              void cycleQ.refetch();
              void cyclesQ.refetch();
              void cancelledCyclesQ.refetch();
              void ledgerQ.refetch();
            }}
          />
        }
      >
        {/* Top Header: Title & Search Button */}
        <View style={styles.topHeader}>
          <Text style={styles.screenTitle}>Transaksi</Text>
          <Pressable
            onPress={() => setShowSearch((v) => !v)}
            style={[styles.searchIconBtn, showSearch && styles.searchIconBtnActive]}
            accessibilityLabel="Cari transaksi"
          >
            <Search size={18} color={showSearch ? '#FFFFFF' : '#0B1527'} />
          </Pressable>
        </View>

        {/* Cycle Pill Selector: < Oktober 2026 ▾ > */}
        <View style={styles.cyclePillRow}>
          <View style={styles.cyclePillContainer}>
            <Pressable
              onPress={goToPrevCycle}
              disabled={currentCycleIndex >= cyclesList.length - 1}
              style={[
                styles.cycleNavArrow,
                currentCycleIndex >= cyclesList.length - 1 && styles.cycleNavArrowDisabled,
              ]}
              hitSlop={8}
              accessibilityLabel="Siklus sebelumnya"
            >
              <ChevronLeft
                size={16}
                color={currentCycleIndex >= cyclesList.length - 1 ? '#CBD5E1' : '#0B1527'}
              />
            </Pressable>

            <Pressable
              onPress={() => setShowCycles(true)}
              style={styles.cyclePillCenter}
              accessibilityLabel="Buka daftar siklus"
            >
              <Text style={styles.cyclePillText} numberOfLines={1}>
                {selectedCycle
                  ? `${selectedCycle.name}${viewingCancelled ? ' (Batal)' : ''}`
                  : 'Pilih siklus'}
              </Text>
              <ChevronDown size={14} color="#64748B" />
            </Pressable>

            <Pressable
              onPress={goToNextCycle}
              disabled={currentCycleIndex <= 0}
              style={[
                styles.cycleNavArrow,
                currentCycleIndex <= 0 && styles.cycleNavArrowDisabled,
              ]}
              hitSlop={8}
              accessibilityLabel="Siklus berikutnya"
            >
              <ChevronRight
                size={16}
                color={currentCycleIndex <= 0 ? '#CBD5E1' : '#0B1527'}
              />
            </Pressable>
          </View>
        </View>

        {viewingCancelled && (
          <View style={styles.archiveNotice}>
            <Text style={styles.archiveTitle}>Arsip siklus batal · hanya baca</Text>
            <Text style={styles.archiveDetail}>
              Rencana yang dibatalkan tetap terlihat untuk audit, tetapi tidak dihitung sebagai
              aktivitas riil.
            </Text>
          </View>
        )}

        {/* Expandable Search & Filter Bar */}
        {(showSearch || q.length > 0) && (
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Search size={16} color="#94A3B8" />
              <TextInput
                value={q}
                onChangeText={(v) => {
                  setQ(v);
                  setVisible(PAGE_SIZE);
                }}
                placeholder="Cari transaksi..."
                placeholderTextColor="#94A3B8"
                style={styles.searchInput}
                autoFocus={showSearch && q.length === 0}
              />
              {q.length > 0 && (
                <Pressable onPress={() => setQ('')} hitSlop={10}>
                  <X size={15} color="#94A3B8" />
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={() => setShowFilters(true)}
              style={[
                styles.filterTrigger,
                accountId !== null && styles.filterTriggerActive,
              ]}
            >
              <SlidersHorizontal
                size={16}
                color={accountId !== null ? '#FFFFFF' : '#0B1527'}
              />
            </Pressable>
          </View>
        )}

        {/* 4-way Segmented Filter (05_transaksi.png) */}
        <View style={styles.segmentedControl}>
          <Pressable
            onPress={() => {
              setTab('ALL');
              setVisible(PAGE_SIZE);
            }}
            style={[styles.segmentBtn, tab === 'ALL' && styles.segmentBtnActive]}
          >
            <Text style={[styles.segmentText, tab === 'ALL' && styles.segmentTextActive]}>
              Semua
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setTab('INCOME');
              setVisible(PAGE_SIZE);
            }}
            style={[styles.segmentBtn, tab === 'INCOME' && styles.segmentBtnActive]}
          >
            <Text style={[styles.segmentText, tab === 'INCOME' && styles.segmentTextActive]}>
              Pemasukan
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setTab('EXPENSE');
              setVisible(PAGE_SIZE);
            }}
            style={[styles.segmentBtn, tab === 'EXPENSE' && styles.segmentBtnActive]}
          >
            <Text style={[styles.segmentText, tab === 'EXPENSE' && styles.segmentTextActive]}>
              Pengeluaran
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setTab('TRANSFER');
              setVisible(PAGE_SIZE);
            }}
            style={[styles.segmentBtn, tab === 'TRANSFER' && styles.segmentBtnActive]}
          >
            <Text style={[styles.segmentText, tab === 'TRANSFER' && styles.segmentTextActive]}>
              Transfer
            </Text>
          </Pressable>
        </View>

        {/* Bulk Execution Banner (if pending transactions exist) */}
        {!viewingCancelled && pendingCount > 0 && (
          <Pressable
            style={styles.bulkBanner}
            onPress={() => router.push('/bulk-execute')}
          >
            <View style={styles.bulkIconBox}>
              <Clock size={16} color={Colors.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bulkBannerTitle}>
                {pendingCount} transaksi belum dieksekusi · {formatRupiah(pendingAmount)}
              </Text>
              <Text style={styles.bulkBannerSub}>Tap untuk checklist &amp; eksekusi</Text>
            </View>
            <ChevronRight size={16} color={Colors.textMuted} />
          </Pressable>
        )}

        {/* Query Errors / Empty States */}
        {ledgerQ.isError && householdId && (
          <QueryError
            onRetry={() => {
              void ledgerQ.refetch();
              void cycleQ.refetch();
            }}
            retrying={ledgerQ.isFetching}
            message="Riwayat transaksi belum bisa dibaca. Datamu aman."
          />
        )}

        {ledgerQ.isLoading && (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Memuat riwayat transaksi…</Text>
          </View>
        )}

        {!ledgerQ.isLoading && !ledgerQ.isError && filtered.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {allRows.length === 0
                ? 'Belum ada transaksi di siklus ini.'
                : 'Tidak ada transaksi yang cocok dengan filter.'}
            </Text>
            {(q.length > 0 || tab !== 'ALL' || !!accountId || status !== 'ALL') && (
              <Pressable
                onPress={() => {
                  setQ('');
                  setTab('ALL');
                  setAccountId(null);
                  router.setParams({ status: undefined });
                }}
                style={styles.resetBtn}
              >
                <Text style={styles.resetBtnText}>Reset Filter</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Grouped Ledger by Date */}
        {groups.map((g) => (
          <View key={g.key} style={styles.groupContainer}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupDate}>{g.label}</Text>
              <Text style={styles.groupCount}>{g.rows.length} transaksi</Text>
            </View>

            <View style={styles.ledgerList}>
              {g.rows.map((r, i) => (
                <LedgerCard
                  key={r.id}
                  row={r}
                  isLast={i === g.rows.length - 1}
                  onPress={
                    viewingCancelled
                      ? undefined
                      : () =>
                          router.push({
                            pathname:
                              r.status === 'PENDING'
                                ? '/payment-confirm'
                                : '/transaction-edit',
                            params: { id: r.id },
                          })
                  }
                />
              ))}
            </View>
          </View>
        ))}

        {remaining > 0 && (
          <Pressable
            onPress={() => setVisible((v) => v + PAGE_SIZE)}
            style={styles.loadMoreBtn}
          >
            <Text style={styles.loadMoreText}>Muat {remaining} transaksi lainnya</Text>
            <ChevronRight size={14} color={Colors.textSecondary} />
          </Pressable>
        )}
      </ScrollView>

      {/* Cycle Selector Sheet */}
      <Modal
        visible={showCycles}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCycles(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowCycles(false)}>
          <Pressable style={styles.cycleSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Pilih Siklus</Text>
              <Pressable onPress={() => setShowCycles(false)} hitSlop={10}>
                <X size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              {(cyclesQ.data ?? []).map((cycle) => {
                const isSelected = cycle.id === selectedCycle?.id;
                return (
                  <View
                    key={cycle.id}
                    style={[styles.cycleRowItem, isSelected && styles.cycleRowItemActive]}
                  >
                    <Pressable
                      style={{ flex: 1 }}
                      onPress={() => {
                        router.setParams({ cycle: cycle.id });
                        setVisible(PAGE_SIZE);
                        setShowCycles(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.cycleItemTitle,
                          isSelected && styles.cycleItemTitleActive,
                        ]}
                      >
                        {cycle.name} {cycle.is_active ? '· Aktif' : ''}
                      </Text>
                      <Text style={styles.cycleItemDates}>
                        {formatShortDate(cycle.start_date)} –{' '}
                        {formatShortDate(cycle.end_date)}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => confirmCancelCycle(cycle)}
                      hitSlop={8}
                      style={styles.cancelLink}
                    >
                      <Text style={styles.cancelLinkText}>Batalkan</Text>
                    </Pressable>
                  </View>
                );
              })}

              <View style={styles.newCycleRow}>
                <Pressable
                  onPress={() => {
                    setShowCycles(false);
                    router.push('/new-cycle');
                  }}
                  style={styles.newCycleCta}
                >
                  <Text style={styles.newCycleCtaText}>+ Buat Siklus Baru</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Account / Direction Filter Modal */}
      <Modal
        visible={showFilters}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFilters(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowFilters(false)}>
          <Pressable style={styles.filterSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Filter Transaksi</Text>
              <Pressable onPress={() => setShowFilters(false)} hitSlop={10}>
                <X size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <Text style={styles.filterSectionTitle}>Akun Keuangan</Text>
            <View style={styles.filterChipsRow}>
              <Pressable
                onPress={() => setAccountId(null)}
                style={[styles.filterChip, accountId === null && styles.filterChipActive]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    accountId === null && styles.filterChipTextActive,
                  ]}
                >
                  Semua Akun
                </Text>
              </Pressable>
              {accounts.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => setAccountId(a.id)}
                  style={[styles.filterChip, accountId === a.id && styles.filterChipActive]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      accountId === a.id && styles.filterChipTextActive,
                    ]}
                  >
                    {a.name}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={() => setShowFilters(false)}
              style={styles.applyFilterButton}
            >
              <Text style={styles.applyFilterText}>Terapkan</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function LedgerCard({
  row,
  isLast,
  onPress,
}: {
  row: LedgerRow;
  isLast: boolean;
  onPress?: () => void;
}) {
  const isIncome = row.direction === 'INCOME';
  const isPending = row.status === 'PENDING';
  const isCancelled = row.status === 'CANCELLED';

  const tone = FLOW_TONES[row.flowType];

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.txnCard, !isLast && styles.txnCardBorder]}
    >
      <View style={[styles.txnIconWrap, { backgroundColor: tone.bg }]}>
        <BrandIcon
          name={categoryIconName({
            name: row.categories?.name ?? '',
            type: isIncome ? 'INCOME' : 'EXPENSE',
            icon: row.categories?.icon,
          })}
          size={18}
          label=""
        />
      </View>

      <View style={styles.txnCenter}>
        <Text style={styles.txnTitle} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={styles.txnMeta} numberOfLines={1}>
          {row.categories?.name ?? FLOW_LABELS[row.flowType]} ·{' '}
          {row.accounts?.name ?? 'Tanpa akun'}
        </Text>
      </View>

      <View style={styles.txnRight}>
        <Text
          style={[
            styles.txnAmount,
            isIncome
              ? styles.txnAmountIn
              : isPending
              ? styles.txnAmountPending
              : styles.txnAmountOut,
          ]}
        >
          {isIncome ? '+ ' : '− '}
          {formatRupiah(row.displayAmount)}
        </Text>
        {isPending && (
          <View style={styles.statusBadgeRow}>
            <Text style={styles.statusPending}>Belum lunas</Text>
          </View>
        )}
        {isCancelled && (
          <View style={styles.statusBadgeRow}>
            <Text style={styles.statusBatal}>Batal</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 110,
    gap: 14,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0B1527',
    letterSpacing: -0.5,
  },
  searchIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchIconBtnActive: {
    backgroundColor: '#0B1527',
    borderColor: '#0B1527',
  },
  cyclePillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -2,
    marginBottom: 2,
  },
  cyclePillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: Radius.pill,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  cycleNavArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cycleNavArrowDisabled: {
    opacity: 0.35,
  },
  cyclePillCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  cyclePillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B1527',
    maxWidth: 160,
  },

  /* 4-way Segmented Filter */
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#0B1527',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  /* Search & Filter Trigger */
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  filterTrigger: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterTriggerActive: {
    backgroundColor: Colors.navy,
    borderColor: Colors.navy,
  },

  /* Summary Card */
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: 16,
    padding: 14,
  },
  summaryColumn: {
    flex: 1,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: Colors.borderSubtle,
    marginHorizontal: 12,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  summaryExpense: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.negative,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  summaryIncome: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.accentStrong,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  summaryCount: {
    fontSize: 10.5,
    color: Colors.textSecondary,
    marginTop: 2,
  },

  /* Filter Pills Scroll */
  chipsScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  filterPill: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  filterPillActive: {
    backgroundColor: Colors.navy,
    borderColor: Colors.navy,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  filterPillTextActive: {
    color: Colors.white,
    fontWeight: '700',
  },

  /* Bulk Execution Banner */
  bulkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.warningSoft,
    borderWidth: 1,
    borderColor: Colors.warningBorder,
    borderRadius: 14,
    padding: 12,
  },
  bulkIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.warningSoftIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulkBannerTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  bulkBannerSub: {
    fontSize: 10.5,
    color: Colors.textSecondary,
    marginTop: 1,
  },

  /* Group & Ledger */
  groupContainer: {
    gap: 8,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 4,
    marginTop: 6,
  },
  groupDate: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0B1527',
  },
  groupCount: {
    fontSize: 12,
    color: '#94A3B8',
  },
  ledgerList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  txnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  txnCardBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  txnIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txnCenter: {
    flex: 1,
    gap: 2,
  },
  txnTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0B1527',
  },
  txnMeta: {
    fontSize: 12,
    color: '#64748B',
  },
  txnRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  txnAmount: {
    fontSize: 14.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  txnAmountIn: {
    color: '#10B981',
  },
  txnAmountOut: {
    color: '#0B1527',
  },
  txnAmountPending: {
    color: '#D97706',
  },
  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusLunas: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.accentStrong,
  },
  statusPending: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.alertText,
  },
  statusBatal: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textMuted,
  },

  /* Load More */
  loadMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
  loadMoreText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },

  /* Empty & Loading */
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  resetBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: '#F1F5F9',
  },
  resetBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  archiveNotice: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  archiveTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  archiveDetail: {
    fontSize: 10.5,
    color: Colors.textSecondary,
  },

  /* Modals */
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlayScrim,
    justifyContent: 'flex-end',
  },
  cycleSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    gap: 14,
  },
  filterSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    gap: 14,
  },
  sheetHandle: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.borderStrong,
    alignSelf: 'center',
    marginBottom: 2,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  cycleRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  cycleRowItemActive: {
    backgroundColor: '#F8FAFC',
  },
  cycleItemTitle: {
    fontSize: 13.5,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  cycleItemTitleActive: {
    color: Colors.info,
    fontWeight: '700',
  },
  cycleItemDates: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  cancelLink: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cancelLinkText: {
    fontSize: 11,
    color: Colors.negative,
    fontWeight: '600',
  },
  newCycleRow: {
    marginTop: 12,
  },
  newCycleCta: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  newCycleCtaText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  filterSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 4,
  },
  filterChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: '#F1F5F9',
  },
  filterChipActive: {
    backgroundColor: Colors.navy,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: Colors.white,
    fontWeight: '700',
  },
  applyFilterButton: {
    backgroundColor: Colors.navy,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 10,
  },
  applyFilterText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
});
