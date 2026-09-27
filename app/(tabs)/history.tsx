import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Search from 'lucide-react-native/icons/search';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import Calendar from 'lucide-react-native/icons/calendar';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import { categoryIconName } from '../../lib/category-icon';
import { BrandIcon } from '../../components/ui/BrandIcon';
import { useAuth } from '../../lib/auth-context';
import { useAccounts, useActiveCycle, useTransactionLedger } from '../../lib/queries';
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
};

/** Per-flow chip colour, so a flow type keeps its identity across screens. */
const FLOW_TONES: Record<FlowType, { bg: string; border: string; text: string }> = {
  OPERATING_INCOME: { bg: Colors.paidBg, border: Colors.borderSubtle, text: Colors.paidText },
  FINANCING_INFLOW: { bg: Colors.financingBg, border: Colors.financingBorder, text: Colors.financingText },
  ASSET_RELEASE: { bg: Colors.subtle, border: Colors.borderSubtle, text: Colors.textSecondary },
  EXPENSE: { bg: Colors.subtle, border: Colors.borderSubtle, text: Colors.textSecondary },
  DEBT_PAYMENT: { bg: Colors.loanBg, border: Colors.loanBorder, text: Colors.loanText },
  ASSET_ALLOCATION: { bg: Colors.subtle, border: Colors.borderSubtle, text: Colors.textSecondary },
};

/** Rows shown before "Muat N transaksi lainnya" is tapped. */
const PAGE_SIZE = 30;

type DirectionFilter = 'ALL' | 'EXPENSE' | 'INCOME';

export default function HistoryScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const cycleId = cycleQ.data?.id;
  const accsQ = useAccounts(householdId);
  // actual mode: the ledger reports what was executed, not what was planned.
  const ledgerQ = useTransactionLedger(householdId, cycleId, 'actual');

  const [q, setQ] = useState('');
  const [direction, setDirection] = useState<DirectionFilter>('ALL');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const allRows: LedgerRow[] = useMemo(() => ledgerQ.data ?? [], [ledgerQ.data]);

  const filtered = useMemo(
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

  const totals = useMemo(() => summarizeLedger(filtered), [filtered]);

  const page = filtered.slice(0, visible);
  const remaining = filtered.length - page.length;

  // Day grouping matches the design's "Hari Ini · 25 Sep" headings. Rows with
  // no release date (not yet executed) fall into their own group rather than
  // being silently dropped.
  const groups = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map<string, { label: string; rows: LedgerRow[] }>();
    for (const r of page) {
      const key = r.release_date ?? '';
      const label = ledgerDayLabel(r.release_date, today);
      if (!map.has(key)) map.set(key, { label, rows: [] });
      map.get(key)!.rows.push(r);
    }
    // Newest day first; the "no date" bucket sorts last because '' < any ISO.
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([, v]) => v);
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

        <Pressable onPress={() => router.push('/new-cycle')} style={styles.cyclePill}>
          <Calendar size={14} color={Colors.textSecondary} />
          <Text style={styles.cyclePillText} numberOfLines={1}>
            {cycleQ.data?.name ?? 'Belum ada siklus aktif'}
          </Text>
          <ChevronRight size={14} color={Colors.textSecondary} />
        </Pressable>

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
            label={`Semua · ${filtered.length}`}
            active={direction === 'ALL' && !accountId}
            primary
            onPress={() => {
              setDirection('ALL');
              setAccountId(null);
            }}
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

        {ledgerQ.isLoading && <Text style={styles.muted}>Memuat riwayat…</Text>}

        {!ledgerQ.isLoading && filtered.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.empty}>
              {allRows.length === 0
                ? 'Belum ada transaksi di siklus ini.'
                : 'Tidak ada transaksi yang cocok dengan filter.'}
            </Text>
            {(q.length > 0 || direction !== 'ALL' || accountId) && (
              <Pressable
                onPress={() => {
                  setQ('');
                  setDirection('ALL');
                  setAccountId(null);
                }}
              >
                <Text style={styles.emptyLink}>Reset filter</Text>
              </Pressable>
            )}
          </View>
        )}

        {groups.map((g) => (
          <View key={g.label} style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle}>{g.label}</Text>
              <Text style={styles.groupCount}>{g.rows.length} transaksi</Text>
            </View>
            <View style={styles.ledger}>
              {g.rows.map((r, i) => (
                <LedgerRowView key={r.id} row={r} first={i === 0} />
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

function LedgerRowView({ row, first }: { row: LedgerRow; first: boolean }) {
  const flow = row.flowType;
  const tone = FLOW_TONES[flow];
  const isIncome = row.direction === 'INCOME';
  const executed = row.status === 'PAID';

  // The amount shown is what the row is worth in actual mode: the executed
  // figure for a PAID row, the plan for a row still pending. `row.amount`
  // already resolved that; only the sign and the colour are decided here.
  const amountColor = !executed
    ? Colors.textMuted
    : isIncome
      ? Colors.paidText
      : Colors.textPrimary;

  return (
    <View style={[styles.row, !first && styles.rowBordered]}>
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
          {formatRupiah(row.amount)}
        </Text>
        <View style={[styles.flowBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
          <Text style={[styles.flowBadgeText, { color: tone.text }]} numberOfLines={1}>
            {executed ? FLOW_LABELS[flow] : 'Belum dieksekusi'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center' },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700', marginTop: 2 },
  cyclePill: {
    alignSelf: 'flex-start',
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
  cyclePillText: { color: Colors.textPrimary, fontSize: 12, fontWeight: '600' },
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
});
