import { useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Search from 'lucide-react-native/icons/search';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import Calendar from 'lucide-react-native/icons/calendar';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import { categoryIconName } from '../../lib/category-icon';
import { BrandIcon } from '../../components/ui/BrandIcon';
import { QueryError } from '../../components/ui/QueryError';
import { useAuth } from '../../lib/auth-context';
import { useAccounts, useActiveCycle, useHouseholdCycles, useTransactionLedger } from '../../lib/queries';
import type { LedgerRow } from '../../lib/queries';
import {
  filterLedger,
  formatShortDate,
  ledgerDayLabel,
  summarizeLedger,
} from '../../lib/zero-based';
import type { FlowType } from '../../lib/zero-based';

/**
 * Screen 6 — Riwayat. The ledger is the reconciliation view: unlike Home, it
 * reads in `actual` mode, because the question here is "what actually left the
 * account?", not "what did we plan?". A PENDING row therefore shows its
 * planned amount and is visually marked as not yet executed.
 */

const FLOW_LABELS: Record<FlowType, string> = {
  OPERATING_INCOME: 'Income Operasional',
  FINANCING_INFLOW: 'Pemasukan Pendanaan',
  ASSET_RELEASE: 'Pelepasan Aset',
  EXPENSE: 'Pengeluaran',
  DEBT_PAYMENT: 'Pembayaran Kewajiban',
  ASSET_ALLOCATION: 'Alokasi Aset',
  TRANSFER: 'Relokasi Antar Akun',
};

/** Per-flow chip colour, so a flow type keeps its identity across screens. */
const FLOW_TONES: Record<FlowType, { bg: string; border: string; text: string }> = {
  OPERATING_INCOME: { bg: Colors.paidBg, border: Colors.borderSubtle, text: Colors.paidText },
  FINANCING_INFLOW: { bg: Colors.financingBg, border: Colors.financingBorder, text: Colors.financingText },
  ASSET_RELEASE: { bg: Colors.subtle, border: Colors.borderSubtle, text: Colors.textSecondary },
  EXPENSE: { bg: Colors.subtle, border: Colors.borderSubtle, text: Colors.textSecondary },
  DEBT_PAYMENT: { bg: Colors.loanBg, border: Colors.loanBorder, text: Colors.loanText },
  ASSET_ALLOCATION: { bg: Colors.subtle, border: Colors.borderSubtle, text: Colors.textSecondary },
  TRANSFER: { bg: Colors.subtle, border: Colors.borderSubtle, text: Colors.textSecondary },
};

/** Rows shown before "Muat N transaksi lainnya" is tapped. */
const PAGE_SIZE = 30;

type DirectionFilter = 'ALL' | 'EXPENSE' | 'INCOME';

type StatusFilter = 'ALL' | 'PENDING' | 'PAID' | 'CANCELLED';

/**
 * The status filter lives in the URL, not in component state.
 *
 * Home's "N transaksi belum dibayar" alert links to `/(tabs)/history?status=PENDING`,
 * and a tab screen stays mounted once visited — so state initialised from the
 * param would be correct on the first visit and silently ignored on every one
 * after it. Reading the param every render (and writing it back with
 * `router.setParams`) keeps one source of truth, and makes the filtered view
 * survivable across a reload.
 */
function statusFromParam(value: string | string[] | undefined): StatusFilter {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'PENDING' || v === 'PAID' || v === 'CANCELLED' ? v : 'ALL';
}

export default function HistoryScreen() {
  const router = useRouter();
  const { status: statusParam, cycle: cycleParam } = useLocalSearchParams<{ status?: string; cycle?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const cyclesQ = useHouseholdCycles(householdId);
  const requestedCycleId = Array.isArray(cycleParam) ? cycleParam[0] : cycleParam;
  const selectedCycle = cyclesQ.data?.find((cycle) => cycle.id === requestedCycleId)
    ?? cycleQ.data
    ?? null;
  const cycleId = selectedCycle?.id;
  const accsQ = useAccounts(householdId);
  // actual mode: the ledger reports what was executed, not what was planned.
  // The *amounts on screen* come from `displayAmount` instead, so an unexecuted
  // row still reads as its plan rather than as Rp 0 — see LedgerRow.
  const ledgerQ = useTransactionLedger(householdId, cycleId, 'actual');

  const [q, setQ] = useState('');
  const [direction, setDirection] = useState<DirectionFilter>('ALL');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showCycles, setShowCycles] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const status = statusFromParam(statusParam);

  const setStatus = (next: StatusFilter) => {
    setVisible(PAGE_SIZE);
    router.setParams({ status: next === 'ALL' ? undefined : next });
  };

  const allRows: LedgerRow[] = useMemo(() => ledgerQ.data ?? [], [ledgerQ.data]);

  // Search + direction + account, with the status filter deliberately left off.
  // The status chips count against this set, so "Belum dibayar · 3" keeps
  // meaning "3 pending rows match what you have already narrowed to" instead of
  // collapsing to the count of the chip you just tapped.
  const narrowed = useMemo(
    () =>
      filterLedger(
        allRows.map((r) => ({
          ...r,
          accountName: r.accounts?.name ?? null,
          categoryName: r.categories?.name ?? null,
        })),
        { query: q, direction: direction === 'ALL' ? null : direction, accountId }
      ),
    [allRows, q, direction, accountId]
  );

  // Routed back through `filterLedger` rather than a one-line `.filter`, so the
  // status rule lives in exactly one place — including its "a row with no status
  // is unknown, not excluded" clause, which an inline comparison would silently
  // invert.
  const filtered = useMemo(
    () => (status === 'ALL' ? narrowed : filterLedger(narrowed, { status })),
    [narrowed, status]
  );

  const pendingCount = useMemo(
    () => narrowed.filter((r) => r.status === 'PENDING').length,
    [narrowed]
  );
  // Counted, not derived as `narrowed.length - pendingCount`: that arithmetic
  // silently books a row with no status as executed, and it is the same
  // assumption the status filter deliberately refuses to make.
  const paidCount = useMemo(
    () => narrowed.filter((r) => r.status === 'PAID').length,
    [narrowed]
  );
  const cancelledCount = useMemo(
    () => narrowed.filter((r) => r.status === 'CANCELLED').length,
    [narrowed]
  );

  // Totalled from `displayAmount`, not `amount`: the summary block already
  // claims to describe what is on screen, and a block reading "Rp 0" above a
  // list of unpaid bills would contradict the rows right under it.
  const totals = useMemo(
    () => summarizeLedger(filtered.map((r) => ({ direction: r.direction, amount: r.displayAmount }))),
    [filtered]
  );

  const page = filtered.slice(0, visible);
  const remaining = filtered.length - page.length;

  // Day grouping matches the design's "Hari Ini · 25 Sep" headings.
  //
  // Unexecuted rows are grouped separately, at the top. They have no
  // `release_date` to sort by — every row cloned when a cycle opens is
  // `PENDING` with a null date — so leaving them in the date buckets would bury
  // the entire "what do we still owe" list under an undated heading at the
  // bottom, which is the opposite of what the alert that links here promises.
  const groups = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const pending = page.filter((r) => r.status === 'PENDING');
    const dated = page.filter((r) => r.status !== 'PENDING');

    const map = new Map<string, { key: string; label: string; rows: LedgerRow[] }>();
    for (const r of dated) {
      const key = r.release_date ?? 'no-date';
      const label = ledgerDayLabel(r.release_date, today);
      if (!map.has(key)) map.set(key, { key, label, rows: [] });
      map.get(key)!.rows.push(r);
    }
    // Newest day first; a settled row with no date sorts last.
    const datedGroups = [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));

    // "Belum dieksekusi", not "Belum dibayar": the bucket holds pending rows of
    // both directions, and an un-cleared salary is not a bill.
    return pending.length > 0
      ? [{ key: 'pending', label: 'Belum dieksekusi', rows: pending }, ...datedGroups]
      : datedGroups;
  }, [page]);

  const accounts = accsQ.data ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={ledgerQ.isFetching}
            onRefresh={() => {
              void cycleQ.refetch();
              void cyclesQ.refetch();
              void ledgerQ.refetch();
            }}
          />
        }
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>LEDGER · KELUARGA</Text>
            <Text style={styles.title}>Riwayat Transaksi</Text>
          </View>
        </View>

        <View style={styles.cycleActions}>
          <Pressable onPress={() => setShowCycles(true)} style={styles.cyclePill}>
            <Calendar size={14} color={Colors.textSecondary} />
            <Text style={styles.cyclePillText} numberOfLines={1}>
              {selectedCycle?.name ?? 'Belum ada siklus'}
            </Text>
            <ChevronRight size={14} color={Colors.textSecondary} />
          </Pressable>
          <Pressable onPress={() => router.push('/new-cycle')} style={styles.newCycleButton}>
            <Text style={styles.newCycleText}>Siklus baru</Text>
          </Pressable>
        </View>

        <Modal visible={showCycles} transparent animationType="slide" onRequestClose={() => setShowCycles(false)}>
          <View style={styles.sheetOverlay}>
            <Pressable style={styles.sheetBackdrop} onPress={() => setShowCycles(false)} />
            <View style={styles.cycleSheet}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Pilih siklus</Text>
                <Pressable onPress={() => setShowCycles(false)} hitSlop={10}>
                  <Text style={styles.sheetClose}>Tutup</Text>
                </Pressable>
              </View>
              {cyclesQ.isLoading && <Text style={styles.muted}>Memuat daftar siklus…</Text>}
              {cyclesQ.isError && <QueryError onRetry={() => cyclesQ.refetch()} retrying={cyclesQ.isFetching} message="Daftar siklus belum bisa dibaca." />}
              <ScrollView style={styles.cycleList}>
                {(cyclesQ.data ?? []).map((cycle) => (
                  <Pressable
                    key={cycle.id}
                    style={[styles.cycleOption, cycle.id === selectedCycle?.id && styles.cycleOptionActive]}
                    onPress={() => {
                      router.setParams({ cycle: cycle.id });
                      setVisible(PAGE_SIZE);
                      setShowCycles(false);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cycleOptionName}>{cycle.name}{cycle.is_active ? ' · Aktif' : ''}</Text>
                      <Text style={styles.cycleOptionDate}>{formatShortDate(cycle.start_date)} – {formatShortDate(cycle.end_date)}</Text>
                    </View>
                    {cycle.id === selectedCycle?.id && <Text style={styles.cycleSelected}>Dipilih</Text>}
                  </Pressable>
                ))}
                {!cyclesQ.isLoading && !cyclesQ.isError && (cyclesQ.data?.length ?? 0) === 0 && (
                  <Text style={styles.muted}>Belum ada siklus.</Text>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <View style={styles.searchRow}>
          <View style={styles.search}>
            <Search size={17} color={Colors.textMuted} />
            <TextInput
              value={q}
              onChangeText={(v) => {
                setQ(v);
                setVisible(PAGE_SIZE);
              }}
              placeholder="Cari transaksi atau toko..."
              placeholderTextColor={Colors.textMuted}
              style={styles.searchInput}
            />
          </View>
          <Pressable
            onPress={() => setShowFilters((v) => !v)}
            style={[styles.filterBtn, showFilters && styles.filterBtnOn]}
          >
            <SlidersHorizontal
              size={13}
              color={showFilters ? Colors.white : Colors.textPrimary}
            />
            <Text style={[styles.filterText, showFilters && styles.filterTextOn]}>Filter</Text>
          </Pressable>
        </View>

        <View style={styles.summary}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sumLabel}>
              PENGELUARAN{cycleQ.data ? ` ${formatShortDate(cycleQ.data.end_date)?.split(' ')[1]?.toUpperCase() ?? ''}` : ''}
            </Text>
            <Text style={styles.sumOut}>−{formatRupiah(totals.expense)}</Text>
            <Text style={styles.sumMeta}>{totals.expenseCount} transaksi</Text>
          </View>
          <View style={styles.sumDivider} />
          <View style={{ flex: 1 }}>
            <Text style={styles.sumLabel}>PEMASUKAN</Text>
            <Text style={styles.sumIn}>+{formatRupiah(totals.income)}</Text>
            <Text style={styles.sumMeta}>{totals.incomeCount} transaksi</Text>
          </View>
        </View>

        <View style={styles.chips}>
          <Chip
            label={`Semua · ${narrowed.length}`}
            active={status === 'ALL' && direction === 'ALL' && !accountId}
            primary
            onPress={() => {
              setDirection('ALL');
              setAccountId(null);
              setStatus('ALL');
            }}
          />
          {/* "Belum dieksekusi", not "Belum dibayar": the filter is on status
              alone, so an un-cleared salary sits in this bucket too — and the
              heading it opens uses the same word, so the chip never promises
              fewer rows than it shows. Home's alert is the opposite case: it
              counts expenses only and says "belum dibayar". */}
          <Chip
            label={`Belum dieksekusi · ${pendingCount}`}
            active={status === 'PENDING'}
            onPress={() => setStatus(status === 'PENDING' ? 'ALL' : 'PENDING')}
          />
          <Chip
            label={`Sudah dieksekusi · ${paidCount}`}
            active={status === 'PAID'}
            onPress={() => setStatus(status === 'PAID' ? 'ALL' : 'PAID')}
          />
          <Chip
            label={`Dibatalkan · ${cancelledCount}`}
            active={status === 'CANCELLED'}
            onPress={() => setStatus(status === 'CANCELLED' ? 'ALL' : 'CANCELLED')}
          />
          <Chip
            label="Pengeluaran"
            active={direction === 'EXPENSE'}
            onPress={() => setDirection(direction === 'EXPENSE' ? 'ALL' : 'EXPENSE')}
          />
          <Chip
            label="Pemasukan"
            active={direction === 'INCOME'}
            onPress={() => setDirection(direction === 'INCOME' ? 'ALL' : 'INCOME')}
          />
        </View>

        {showFilters && (
          <View style={styles.chips}>
            {accounts.map((a) => (
              <Chip
                key={a.id}
                label={a.name}
                muted
                active={accountId === a.id}
                onPress={() => setAccountId(accountId === a.id ? null : a.id)}
              />
            ))}
            {accounts.length === 0 && <Text style={styles.muted}>Belum ada akun.</Text>}
          </View>
        )}

        {!householdId && (
          <Text style={styles.muted}>Mode offline — login untuk riwayat live.</Text>
        )}

        {pendingCount > 0 && (
          <Pressable style={styles.bulkButton} onPress={() => router.push('/bulk-execute')}>
            <Text style={styles.bulkButtonText}>Checklist eksekusi {pendingCount} transaksi</Text>
            <Text style={styles.bulkButtonSub}>Pilih, lihat preview, lalu bagikan ke keluarga</Text>
          </Pressable>
        )}

        {/* Before this, a failed ledger read rendered the empty state below —
            "Belum ada transaksi di siklus ini" — which on a reconciliation
            screen is a claim, not a placeholder. */}
        {ledgerQ.isError && householdId && (
          <QueryError
            onRetry={() => {
              ledgerQ.refetch();
              cycleQ.refetch();
            }}
            retrying={ledgerQ.isFetching}
            message="Riwayat transaksi belum bisa dibaca, jadi daftar di bawah belum lengkap. Datamu tidak hilang."
          />
        )}

        {ledgerQ.isLoading && <Text style={styles.muted}>Memuat riwayat…</Text>}

        {!ledgerQ.isLoading && !ledgerQ.isError && filtered.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.empty}>
              {allRows.length === 0
                ? 'Belum ada transaksi di siklus ini.'
                : 'Tidak ada transaksi yang cocok dengan filter.'}
            </Text>
            {(q.length > 0 || direction !== 'ALL' || !!accountId || status !== 'ALL') && (
              <Pressable
                onPress={() => {
                  setQ('');
                  setDirection('ALL');
                  setAccountId(null);
                  setStatus('ALL');
                }}
              >
                <Text style={styles.emptyLink}>Reset filter</Text>
              </Pressable>
            )}
          </View>
        )}

        {groups.map((g) => (
          <View key={g.key} style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle}>{g.label}</Text>
              <Text style={styles.groupCount}>{g.rows.length} transaksi</Text>
            </View>
            <View style={styles.ledger}>
              {g.rows.map((r, i) => (
                <LedgerRowView
                  key={r.id}
                  row={r}
                  first={i === 0}
                  onPress={() => router.push({
                    pathname: r.status === 'PENDING' ? '/payment-confirm' : '/transaction-edit',
                    params: { id: r.id },
                  })}
                />
              ))}
            </View>
          </View>
        ))}

        {remaining > 0 && (
          <Pressable onPress={() => setVisible((v) => v + PAGE_SIZE)} style={styles.foot}>
            <Text style={styles.footText}>Muat {remaining} transaksi lainnya</Text>
            <ChevronRight size={14} color={Colors.textSecondary} />
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({
  label,
  active,
  primary,
  muted,
  onPress,
}: {
  label: string;
  active?: boolean;
  primary?: boolean;
  muted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        muted && styles.chipMuted,
        primary && styles.chipPrimary,
        active && !primary && styles.chipActive,
      ]}
    >
      <Text
        style={[
          styles.chipText,
          primary && styles.chipTextPrimary,
          active && !primary && styles.chipTextActive,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function LedgerRowView({ row, first, onPress }: { row: LedgerRow; first: boolean; onPress?: () => void }) {
  const flow = row.flowType;
  const tone = FLOW_TONES[flow];
  const isIncome = row.direction === 'INCOME';
  const executed = row.status === 'PAID';

  // `displayAmount`, not `amount`: in `actual` mode the latter is 0 for every
  // unexecuted row, which is correct for the projection and wrong on screen.
  // A pending row shows the plan it was created with, greyed and labelled
  // "Rencana" so it is never mistaken for money that moved.
  const amountColor = !executed
    ? Colors.textMuted
    : isIncome
      ? Colors.paidText
      : Colors.textPrimary;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.row, !first && styles.rowBordered]}
    >
      <View style={[styles.iconBox, { backgroundColor: tone.bg, borderColor: tone.border }]}>
        <BrandIcon
          name={categoryIconName({
            name: row.categories?.name ?? '',
            type: isIncome ? 'INCOME' : 'EXPENSE',
            icon: row.categories?.icon,
          })}
          size={20}
          label=""
        />
      </View>
      <View style={styles.rowMid}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {FLOW_LABELS[flow]} · {row.accounts?.name ?? 'Tanpa akun'}
          {row.categories?.name ? ` · ${row.categories.name}` : ''}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, { color: amountColor }]}>
          {isIncome ? '+' : '−'}
          {formatRupiah(row.displayAmount)}
        </Text>
        <View style={[styles.flowBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
          <Text style={[styles.flowBadgeText, { color: tone.text }]} numberOfLines={1}>
            {executed ? FLOW_LABELS[flow] : 'Rencana'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700', marginTop: 2 },
  cycleActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cyclePill: {
    flex: 1,
    alignSelf: 'flex-start',
    maxWidth: '75%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.subtle,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  cyclePillText: { flex: 1, color: Colors.textPrimary, fontSize: 12, fontWeight: '600' },
  newCycleButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: Colors.brandPrimary },
  newCycleText: { color: Colors.white, fontSize: 12, fontWeight: '700' },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.35)' },
  sheetBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  cycleSheet: { maxHeight: '75%', backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 12 },
  sheetHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: Colors.borderStrong },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700' },
  sheetClose: { color: Colors.brandPrimary, fontSize: 13, fontWeight: '600' },
  cycleList: { flexGrow: 0 },
  cycleOption: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, marginBottom: 8 },
  cycleOptionActive: { borderColor: Colors.brandPrimary, backgroundColor: Colors.subtle },
  cycleOptionName: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
  cycleOptionDate: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 3 },
  cycleSelected: { color: Colors.brandPrimary, fontSize: FontSize.caption, fontWeight: '700' },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.canvas,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: { flex: 1, fontSize: 13, color: Colors.textPrimary },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
  },
  filterBtnOn: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  filterText: { color: Colors.textPrimary, fontSize: 12, fontWeight: '600' },
  filterTextOn: { color: Colors.white },
  summary: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    padding: 14,
  },
  sumLabel: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '600' },
  sumOut: { color: Colors.pendingText, fontSize: FontSize.currencyLarge, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 4 },
  sumIn: { color: Colors.paidText, fontSize: FontSize.currencyLarge, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 4 },
  sumMeta: { color: Colors.textSecondary, fontSize: FontSize.caption, marginTop: 2 },
  sumDivider: { width: 1, backgroundColor: Colors.borderSubtle, marginHorizontal: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipMuted: { backgroundColor: Colors.subtle },
  chipPrimary: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '500' },
  chipTextPrimary: { color: Colors.white, fontWeight: '700' },
  chipTextActive: { color: Colors.white, fontWeight: '700' },
  group: { gap: 6 },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  groupTitle: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
  groupCount: { color: Colors.textMuted, fontSize: FontSize.caption },
  ledger: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  rowBordered: { borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: 16, fontWeight: '700' },
  rowMid: { flex: 1, gap: 2 },
  rowTitle: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  rowSub: { color: Colors.textMuted, fontSize: FontSize.caption },
  rowRight: { alignItems: 'flex-end', gap: 4, maxWidth: 140 },
  rowAmount: { fontSize: 13.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  flowBadge: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  flowBadgeText: { fontSize: FontSize.microLabel, fontWeight: '600' },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
  },
  footText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  emptyBox: { gap: 8, paddingVertical: 16 },
  empty: { color: Colors.textMuted, fontSize: FontSize.body, textAlign: 'center' },
  emptyLink: { color: Colors.textPrimary, fontWeight: '600', textAlign: 'center' },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  bulkButton: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, padding: 14, gap: 3 },
  bulkButtonText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  bulkButtonSub: { color: Colors.white + 'D9', fontSize: FontSize.caption },
});
