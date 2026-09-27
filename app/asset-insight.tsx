import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import ArrowLeftRight from 'lucide-react-native/icons/arrow-left-right';
import Calendar from 'lucide-react-native/icons/calendar';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import { Colors, FontSize, Radius } from '../constants/theme';
import { BrandIcon } from '../components/ui/BrandIcon';
import { formatRupiah, formatRupiahShort } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useCategories, useCycleYears, useObligations, useYearInsight } from '../lib/queries';
import {
  accumulateAssets,
  annualTotals,
  assetSeriesByType,
  assetSummary,
  ASSET_BANDS,
  bandKeyOfAllocationType,
  bandLabel,
  buildTrendInsights,
  buildYearBuckets,
  latestActiveMonth,
  liabilitySeries,
  monthFullName,
  monthOverMonth,
  monthYearLabel,
  planVsActual,
  windowEndingAt,
} from '../lib/insight';
import type { PvaMetric } from '../lib/insight';
import type { ChartColumn } from '../components/ui/Charts';
import { normalizeObligationType, shortDateLabel } from '../lib/obligation';
import { Badge } from '../components/ui/Badge';
import { SegmentedTabs } from '../components/ui/SegmentedTabs';
import {
  ChartScaleRow,
  GroupedBarChart,
  Legend,
  ProgressTrack,
  StackedBarChart,
  StatCard,
  StatGrid,
  StatRow,
  VarianceBarChart,
} from '../components/ui/Charts';
import {
  InsightCallout,
  MoverList,
  RuleBanner,
  SectionCard,
  SectionHeader,
  TrendSummary,
} from '../components/ui/InsightSections';

/**
 * Screen 2C — Insight & Aset 2026.
 *
 * Seven sections over one year of cycles, reached from My Profile.
 *
 * The screen computes nothing. Every figure it draws comes from
 * `buildYearBuckets` in lib/insight.ts — twelve buckets built once — and each
 * section is a different projection of the same array. That is the point: the
 * "Sumber Dana vs Alokasi" chart and the "Plan vs Actual" chart both claim to
 * describe October, and the only way to guarantee they agree is to make them
 * read the same object rather than run the same query twice.
 *
 * Three honesty rules the screen must not break:
 *
 *   * A month with no cycle is not a month of zero spending. It renders an
 *     empty slot with a dimmed label, never a zero-height bar.
 *   * The ledger has no assets table, so "aset" means an allocation the family
 *     marked as not-spending. The section says so rather than implying a market
 *     value it cannot know.
 *   * The design's summary paragraphs are about a specific family's numbers.
 *     They are generated from this family's data or omitted — never copied.
 */

const ASSET_BAND_COLORS: Record<string, string> = {
  EMERGENCY_FUND: Colors.chartIncome,
  CHILD: Colors.chartFinancing,
  INVESTMENT: Colors.chartInvestment,
  LIQUIDITY: Colors.chartAsset,
};

/** Expense bar colour: green under plan, amber slightly over, red well over. */
function expenseTone(actual: number, planned: number): string {
  if (planned <= 0) return actual > 0 ? Colors.chartFinancing : Colors.chartPlan;
  const over = (actual - planned) / planned;
  if (over > 0.15) return Colors.chartExpense;
  if (over > 0) return Colors.chartFinancing;
  return Colors.chartIncome;
}

export default function AssetInsightScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const [range, setRange] = useState<'6' | '12'>('12');
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [expenseCat, setExpenseCat] = useState<string | null>(null);
  const [assetMode, setAssetMode] = useState<'monthly' | 'cumulative'>('cumulative');
  const [pvaMetric, setPvaMetric] = useState<PvaMetric>('expenses');

  const catsQ = useCategories(householdId);
  const obligQ = useObligations(householdId);

  const categories = useMemo(() => catsQ.data ?? [], [catsQ.data]);
  const categoryNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.id] = c.name;
    return m;
  }, [categories]);

  // The year comes from the data, not the clock: opening a screen that charts
  // "2026" when the family's last cycle was in 2025 would show twelve empty
  // columns and call it an analysis. A separate cheap query lists the years so
  // the selector never offers a year with nothing in it.
  const yearsQ = useCycleYears(householdId);
  const years = useMemo(() => yearsQ.data ?? [new Date().getFullYear()], [yearsQ.data]);

  const [year, setYear] = useState<number | null>(null);
  const activeYear = year ?? years[0];
  const yearQ = useYearInsight(householdId, activeYear);

  const cycles = useMemo(() => yearQ.data?.cycles ?? [], [yearQ.data]);
  const txns = useMemo(() => yearQ.data?.txns ?? [], [yearQ.data]);
  const allocations = useMemo(() => yearQ.data?.allocations ?? [], [yearQ.data]);

  const buckets = useMemo(
    () => buildYearBuckets({ cycles, txns, allocations, year: activeYear }),
    [cycles, txns, allocations, activeYear]
  );
  // The expense section re-derives its own buckets when a category chip is
  // active, so plan and actual are both restricted to that category. Filtering
  // the finished buckets instead would compare a category's spending against
  // the whole family's plan.
  const expenseBuckets = useMemo(
    () => buildYearBuckets({ cycles, txns, allocations, year: activeYear, expenseCategoryId: expenseCat }),
    [cycles, txns, allocations, activeYear, expenseCat]
  );

  const annual = useMemo(() => annualTotals(buckets), [buckets]);
  const assets = useMemo(() => assetSummary(buckets), [buckets]);

  const obligations = useMemo(() => obligQ.data ?? [], [obligQ.data]);
  const outstanding = useMemo(
    () => obligations.reduce((s, o) => s + Math.max(0, o.remaining_amount), 0),
    [obligations]
  );

  const insights = useMemo(
    () => buildTrendInsights({ buckets, annual, assets, currentOutstanding: outstanding }),
    [buckets, annual, assets, outstanding]
  );

  const todayISO = new Date().toISOString().slice(0, 10);

  const windowBuckets = useMemo(() => windowEndingAt(buckets, range === '6' ? 6 : 12), [buckets, range]);
  const windowExpenseBuckets = useMemo(
    () => windowEndingAt(expenseBuckets, range === '6' ? 6 : 12),
    [expenseBuckets, range]
  );

  const activeMonth = useMemo(
    () => selectedMonth ?? latestActiveMonth(buckets),
    [selectedMonth, buckets]
  );

  // ------- Section 1: cashflow -------
  const cashflowColumns: ChartColumn[] = useMemo(
    () =>
      windowBuckets.map((b) => ({
        month: b.month,
        label: b.label,
        hasData: b.hasCycle,
        left: [
          { value: b.financingInflow, color: Colors.chartFinancing },
          { value: b.actualIncome > 0 ? b.actualIncome : b.plannedIncome, color: Colors.chartIncome },
        ].filter((s) => s.value > 0),
        right: [
          { value: b.actualDebtPayment, color: Colors.chartLiability },
          { value: b.actualExpense > 0 ? b.actualExpense : b.plannedExpense, color: Colors.chartExpense },
        ].filter((s) => s.value > 0),
        marker: {
          value: b.netCashflow,
          color: b.netCashflow >= 0 ? Colors.chartNetCashflow : Colors.chartExpense,
        },
      })),
    [windowBuckets]
  );

  const selected = useMemo(
    () => buckets.find((b) => b.month === activeMonth) ?? null,
    [buckets, activeMonth]
  );

  // ------- Section 2: income -------
  const incomeColumns: ChartColumn[] = useMemo(
    () =>
      windowBuckets.map((b) => ({
        month: b.month,
        label: b.label,
        hasData: b.hasCycle,
        left: [{ value: b.plannedIncome, color: Colors.chartPlan }].filter((s) => s.value > 0),
        right: [
          { value: b.actualIncome > 0 ? b.actualIncome : b.plannedIncome, color: Colors.chartIncome },
          { value: b.financingInflow, color: Colors.chartFinancing },
        ].filter((s) => s.value > 0),
      })),
    [windowBuckets]
  );

  const incomeSources = useMemo(() => {
    const names = new Set<string>();
    for (const t of txns) {
      if (t.direction !== 'INCOME') continue;
      if (t.status !== 'PAID') continue;
      if ((t.flow_type ?? '') !== 'OPERATING_INCOME') continue;
      if (t.categories?.name) names.add(t.categories.name);
    }
    return [...names];
  }, [txns]);

  // ------- Section 3: expenses -------
  const expenseCategories = useMemo(
    () =>
      categories
        .filter((c) => c.type === 'EXPENSE')
        .filter((c) => {
          // Only categories that actually appear in the year: a chip that
          // filters to nothing is a dead control.
          for (const b of buckets) if (b.expenseByCategory[c.id]) return true;
          return false;
        })
        .slice(0, 4),
    [categories, buckets]
  );

  const expenseColumns: ChartColumn[] = useMemo(
    () =>
      windowExpenseBuckets.map((b) => ({
        month: b.month,
        label: b.label,
        hasData: b.hasCycle,
        left: [{ value: b.plannedExpense, color: Colors.chartPlan }].filter((s) => s.value > 0),
        right: [
          { value: b.actualExpense, color: expenseTone(b.actualExpense, b.plannedExpense) },
        ].filter((s) => s.value > 0),
      })),
    [windowExpenseBuckets]
  );

  const overspendStreak = useMemo(() => {
    const over = buckets.filter(
      (b) => b.hasCycle && b.plannedExpense > 0 && b.actualExpense > b.plannedExpense
    );
    if (over.length === 0) return null;
    const first = over[0];
    const last = over[over.length - 1];
    return first.month === last.month
      ? `Overspend ${monthFullName(first.month)}`
      : `Overspend ${first.label}–${last.label}`;
  }, [buckets]);

  // The biggest overspend category in the selected month, measured against its
  // own monthly budget. "Focus" is a claim about which category is the problem,
  // so it has to be computed from this family's rows rather than named.
  const focus = useMemo(() => {
    if (!selected) return null;
    let best: {
      id: string;
      name: string;
      budget: number;
      actual: number;
      prev: number;
    } | null = null;
    const prevBucket = buckets.find(
      (b) => b.month === (selected.month === 1 ? 12 : selected.month - 1)
    );
    for (const c of categories) {
      if (c.type !== 'EXPENSE') continue;
      const actual = selected.expenseByCategory[c.id] ?? 0;
      if (actual <= 0) continue;
      const budget = c.monthly_budget ?? 0;
      const gap = actual - budget;
      if (best === null || gap > best.actual - best.budget) {
        best = {
          id: c.id,
          name: c.name,
          budget,
          actual,
          prev: prevBucket?.expenseByCategory[c.id] ?? 0,
        };
      }
    }
    return best;
  }, [selected, categories, buckets]);

  // ------- Section 4: month over month -------
  const mom = useMemo(
    () => (activeMonth ? monthOverMonth(buckets, activeMonth, categoryNames) : null),
    [buckets, activeMonth, categoryNames]
  );

  // ------- Section 5: assets -------
  const assetBands = useMemo(() => assetSeriesByType(windowBuckets, assetMode), [windowBuckets, assetMode]);
  const accumulated = useMemo(() => accumulateAssets(windowBuckets), [windowBuckets]);
  const assetColumns: ChartColumn[] = useMemo(
    () =>
      windowBuckets.map((b, i) => ({
        month: b.month,
        label: b.label,
        hasData: b.hasCycle,
        left: assetBands[i]
          .map((band) => ({
            value: band.value,
            color: ASSET_BAND_COLORS[band.key] ?? Colors.chartAsset,
          }))
          .filter((s) => s.value > 0),
        right: [],
      })),
    [windowBuckets, assetBands]
  );

  // ------- Section 6: plan vs actual -------
  const pvaPoints = useMemo(() => planVsActual(windowBuckets, pvaMetric), [windowBuckets, pvaMetric]);
  const pvaColumns: ChartColumn[] = useMemo(
    () =>
      pvaPoints.map((p) => ({
        month: p.month,
        label: p.label,
        hasData: windowBuckets.find((b) => b.month === p.month)?.hasCycle ?? false,
        left: p.variance > 0 ? [{ value: p.variance, color: Colors.chartExpense }] : [],
        right: p.variance < 0 ? [{ value: -p.variance, color: Colors.chartIncome }] : [],
      })),
    [pvaPoints, windowBuckets]
  );
  const pvaNet = useMemo(() => pvaPoints.reduce((s, p) => s + p.variance, 0), [pvaPoints]);

  // ------- Section 7: liabilities -------
  const liabilityByType = useMemo(() => {
    const byType: Record<string, Set<string>> = {};
    for (const o of obligations) {
      const t = normalizeObligationType(o.type);
      (byType[t] ??= new Set()).add(o.id);
    }
    return byType;
  }, [obligations]);

  const [liabType, setLiabType] = useState<'loan' | 'reimburse' | 'installment' | 'bill'>('loan');
  const liabIds = liabilityByType[liabType];
  const liabOutstanding = useMemo(
    () =>
      obligations
        .filter((o) => liabIds?.has(o.id))
        .reduce((s, o) => s + Math.max(0, o.remaining_amount), 0),
    [obligations, liabIds]
  );
  const liabSeries = useMemo(
    () => liabilitySeries(buckets, liabOutstanding, liabIds),
    [buckets, liabOutstanding, liabIds]
  );
  const liabColumns: ChartColumn[] = useMemo(
    () =>
      windowBuckets.map((b) => {
        const idx = buckets.findIndex((x) => x.month === b.month);
        const value = idx >= 0 ? liabSeries[idx] : 0;
        return {
          month: b.month,
          label: b.label,
          hasData: b.hasCycle,
          left: value > 0 ? [{ value, color: Colors.chartLiability }] : [],
          right: [],
        };
      }),
    [windowBuckets, buckets, liabSeries]
  );

  const nextDue = useMemo(() => {
    let best: string | null = null;
    for (const o of obligations) {
      const d = o.due_date;
      if (!d || d < todayISO) continue;
      if (!best || d < best) best = d;
    }
    return best;
  }, [obligations, todayISO]);

  const principalPaid = annual.debtPayment;
  const interestFees = useMemo(
    () => obligations.reduce((s, o) => s + Math.max(0, o.interest_fee_amount ?? 0), 0),
    [obligations]
  );
  const loanTotals = useMemo(() => {
    let total = 0;
    let remaining = 0;
    for (const o of obligations) {
      total += Math.max(0, o.total_amount);
      remaining += Math.max(0, o.remaining_amount);
    }
    return { total, remaining, paid: Math.max(0, total - remaining) };
  }, [obligations]);

  const activeLoans = useMemo(
    () => obligations.filter((o) => normalizeObligationType(o.type) === 'LOAN').length,
    [obligations]
  );

  // Naming every gap month would run to a paragraph in a 10pt footer, and the
  // chart above already shows which months are short. The note names the first
  // one and counts the rest.
  const gapMonths = buckets.filter((b) => b.fundingGap > 0);
  const fundingGapNote =
    gapMonths.length === 0
      ? 'Funding gap: tidak ada'
      : `Funding gap ${gapMonths[0].label}: ${formatRupiahShort(gapMonths[0].fundingGap)}${
          gapMonths.length > 1 ? ` (+${gapMonths.length - 1} bulan lain)` : ''
        }`;

  const loading = yearQ.isLoading || yearsQ.isLoading;
  const refetch = () => {
    void yearQ.refetch();
    void catsQ.refetch();
    void obligQ.refetch();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={yearQ.isFetching} onRefresh={refetch} />}
      >
        {/* ---------- Header ---------- */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={16} color={Colors.textPrimary} />
            <Text style={styles.backText}>My Profile</Text>
          </Pressable>
          <View style={styles.crumbPill}>
            <Text style={styles.crumbText}>Insight &amp; Aset 2026</Text>
          </View>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.eyebrow}>KEUANGAN · MY PROFILE</Text>
          <Text style={styles.title}>Insight &amp; Aset 2026</Text>
          <Text style={styles.supporting}>
            Analisis tren keuangan keluarga dari bulan ke bulan.
          </Text>
        </View>

        <View style={styles.selectorBar}>
          <Pressable
            style={styles.yearDropdown}
            disabled={years.length < 2}
            onPress={() => {
              // Only cycles forward when there is somewhere to go; a control
              // that looks tappable and does nothing is worse than a label.
              const i = years.indexOf(activeYear);
              setYear(years[(i + 1) % years.length]);
              setSelectedMonth(null);
            }}
          >
            <Calendar size={13} color={Colors.textSecondary} />
            <Text style={styles.yearLabel}>Tahun {activeYear} · Jan–Des</Text>
            {years.length > 1 && <ChevronDown size={12} color={Colors.textMuted} />}
          </Pressable>
          <SegmentedTabs
            items={[
              { key: '6', label: '6 Bulan' },
              { key: '12', label: '12 Bulan' },
            ]}
            activeKey={range}
            onChange={(k) => setRange(k as '6' | '12')}
          />
        </View>

        {!householdId && <Text style={styles.muted}>Mode offline — login untuk analisis live.</Text>}
        {loading && <Text style={styles.muted}>Memuat data tahun {activeYear}…</Text>}

        {!loading && annual.monthsWithCycle === 0 && (
          <SectionCard>
            <View style={styles.emptyArt}>
              <BrandIcon name="empty-data-tidak-ditemukan" size={72} label="" />
            </View>
            <SectionHeader
              title="Belum ada data tahun ini"
              subtitle={`Tidak ada siklus anggaran di ${activeYear}. Buka siklus dulu supaya trennya bisa dihitung.`}
            />
          </SectionCard>
        )}

        {!loading && annual.monthsWithCycle > 0 && (
          <>
            {/* ---------- Section 1: Ringkasan Tren ---------- */}
            <TrendSummary
              insights={insights}
              subtitle="Poin penting untuk keputusan finansial keluarga sebelum melihat rincian grafik."
            />

            {/* ---------- Section: Cashflow ---------- */}
            <SectionCard>
              <SectionHeader
                title="Sumber Dana vs Alokasi"
                subtitle="Perbandingan sumber dana, alokasi, dan dana belum dialokasikan setiap bulan."
                trailing={
                  <Badge
                    label={`${annual.coveredMonths} Bln Alokasi Selesai · ${annual.gapMonths} Funding Gap`}
                    tone={annual.gapMonths > 0 ? 'pending' : 'paid'}
                  />
                }
              />
              <Legend
                items={[
                  { label: 'Op Income', color: Colors.chartIncome },
                  { label: 'Financing Inflow', color: Colors.chartFinancing },
                  { label: 'Pengeluaran Riil', color: Colors.chartExpense },
                  { label: 'Liab Payment', color: Colors.chartLiability },
                  { label: 'Funding Gap', color: Colors.brandPrimary },
                ]}
              />

              {selected && (
                <View style={styles.tooltip}>
                  <View style={styles.tooltipHead}>
                    <View style={styles.tooltipTitleGroup}>
                      <View style={styles.activeDot} />
                      <Text style={styles.tooltipTitle}>
                        {monthYearLabel(selected.month, activeYear)} (Bulan Dipilih)
                      </Text>
                    </View>
                    {selected.fundingGap > 0 ? (
                      <Badge
                        label={`Funding Gap: ${formatRupiah(selected.fundingGap)}`}
                        tone="pending"
                      />
                    ) : (
                      <Badge label="Alokasi Terpenuhi" tone="paid" />
                    )}
                  </View>
                  <View style={styles.figGrid}>
                    <View style={styles.figRow}>
                      <Fig
                        label="Inc Operasional"
                        value={formatRupiah(selected.actualIncome || selected.plannedIncome)}
                        color={Colors.paidText}
                      />
                      <Fig
                        label="Pendanaan"
                        value={formatRupiah(selected.financingInflow)}
                        color={Colors.alertText}
                      />
                    </View>
                    <View style={styles.figRow}>
                      <Fig
                        label="Pengeluaran Riil"
                        value={formatRupiah(selected.actualExpense || selected.plannedExpense)}
                        color={Colors.chartExpense}
                      />
                      <Fig
                        label="Kewajiban"
                        value={formatRupiah(selected.actualDebtPayment)}
                        color={Colors.chartLiability}
                      />
                    </View>
                  </View>
                </View>
              )}

              <View style={styles.chartSurface}>
                <ChartScaleRow
                  left={`+${formatRupiahShort(Math.max(1, ...cashflowColumns.map((c) => c.left.reduce((s, b) => s + b.value, 0))))} (Inflow)`}
                  right="Ketuk bulan untuk detail"
                />
                <GroupedBarChart
                  columns={cashflowColumns}
                  height={110}
                  activeMonth={activeMonth}
                  onPressMonth={setSelectedMonth}
                />
              </View>

              <View style={styles.footNotes}>
                <Text style={styles.footNote} numberOfLines={2}>
                  {`Unallocated Funds ${selected?.label ?? ''} = ${formatRupiahShort(selected?.unallocated ?? 0)} · ${fundingGapNote}`}
                </Text>
                <Text style={styles.footNoteDim}>
                  {range === '12' ? '12 Bulan Penuh' : '6 Bulan Terakhir'}
                </Text>
              </View>
            </SectionCard>

            {/* ---------- Section 2: Income ---------- */}
            <SectionCard>
              <SectionHeader
                title="Trend Monthly Income"
                subtitle="Lihat perubahan pemasukan aktual dibandingkan rencana bulanan."
                trailing={
                  annual.avgIncome > 0 ? (
                    <Badge label={`Rata-rata: ${formatRupiahShort(annual.avgIncome)}/bln`} tone="paid" />
                  ) : undefined
                }
              />
              <Legend
                items={[
                  { label: 'Rencana income', color: Colors.chartPlan },
                  { label: 'Realisasi operasional', color: Colors.chartIncome },
                  { label: 'Financing Inflow', color: Colors.chartFinancing },
                ]}
                dot={8}
              />
              <View style={styles.chartSurface}>
                <ChartScaleRow
                  left={`Maks: ${formatRupiahShort(annual.bestIncomeMonth?.value ?? 0)} (Puncak ${annual.bestIncomeMonth ? monthFullName(annual.bestIncomeMonth.month) : '—'})`}
                  right={`Baseline Plan: ${formatRupiahShort(
                    Math.round(
                      buckets.filter((b) => b.plannedIncome > 0).reduce((s, b) => s + b.plannedIncome, 0) /
                        Math.max(1, buckets.filter((b) => b.plannedIncome > 0).length)
                    )
                  )}`}
                />
                <GroupedBarChart
                  columns={incomeColumns}
                  height={110}
                  activeMonth={activeMonth}
                  onPressMonth={setSelectedMonth}
                  barWidth={6}
                />
              </View>
              <RuleBanner
                text="Aturan Zero-Based: Gaji & bonus adalah Operating Income. Pinjaman eksternal adalah Financing Inflow, bukan income. Penarikan aset adalah Asset Release, bukan income."
                tone="alert"
              />
              {incomeSources.length > 0 && (
                <Text style={styles.catList}>
                  {`Sumber Income: ${incomeSources.join(' · ')}`}
                </Text>
              )}
              <StatGrid>
                <StatRow>
                  <StatCard label="Total rencana" value={formatRupiah(annual.plannedIncome)} />
                  <StatCard
                    label="Total realisasi"
                    value={formatRupiah(annual.actualIncome)}
                    tone="paid"
                  />
                </StatRow>
                <StatRow>
                  <StatCard
                    label="Bulan tertinggi"
                    value={
                      annual.bestIncomeMonth
                        ? `${monthFullName(annual.bestIncomeMonth.month)} (${formatRupiah(annual.bestIncomeMonth.value)})`
                        : '—'
                    }
                    tone="paid"
                  />
                  <StatCard
                    label="Bulan terendah"
                    value={
                      annual.lowestIncomeMonth
                        ? `${monthFullName(annual.lowestIncomeMonth.month)} (${formatRupiah(annual.lowestIncomeMonth.value)})`
                        : '—'
                    }
                  />
                </StatRow>
              </StatGrid>
              {annual.bestIncomeMonth && annual.avgIncome > 0 && (
                <InsightCallout
                  text={`Pemasukan tertinggi di ${monthFullName(annual.bestIncomeMonth.month)} (${formatRupiah(annual.bestIncomeMonth.value)}) — ${formatRupiahShort(annual.bestIncomeMonth.value - annual.avgIncome)} di atas rata-rata bulanan.`}
                  tone="paid"
                />
              )}
            </SectionCard>

            {/* ---------- Section 3: Expenses ---------- */}
            <SectionCard>
              <SectionHeader
                title="Trend Monthly Expenses"
                subtitle="Bandingkan pengeluaran aktual dengan rencana dan lihat kategori yang paling banyak berubah."
                trailing={
                  overspendStreak ? <Badge label={overspendStreak} tone="pending" /> : undefined
                }
              />
              {expenseCategories.length > 0 && (
                <View style={styles.chips}>
                  <Chip label="Semua Kategori" active={expenseCat === null} onPress={() => setExpenseCat(null)} />
                  {expenseCategories.map((c) => (
                    <Chip
                      key={c.id}
                      label={c.name}
                      active={expenseCat === c.id}
                      onPress={() => setExpenseCat(c.id)}
                    />
                  ))}
                </View>
              )}
              <View style={styles.chartSurface}>
                <ChartScaleRow
                  left="Rencana vs Realisasi (Abu = Plan, Warna = Status)"
                  right={
                    selected && selected.actualExpense > 0
                      ? `${selected.label}: ${formatRupiahShort(selected.actualExpense)}`
                      : undefined
                  }
                  rightColor={Colors.pendingBorder}
                />
                <GroupedBarChart
                  columns={expenseColumns}
                  height={95}
                  activeMonth={activeMonth}
                  onPressMonth={setSelectedMonth}
                  barWidth={6}
                />
              </View>

              {focus && focus.budget > 0 && focus.actual > focus.budget && (
                <View style={styles.focus}>
                  <View style={styles.focusHead}>
                    <Text style={styles.focusTitle} numberOfLines={1}>
                      {`Fokus Kategori: ${focus.name} (Overspend Terbesar)`}
                    </Text>
                    <Text style={styles.focusBadge}>Crimson State (&gt;+15%)</Text>
                  </View>
                  <StatRow>
                    <MiniStat label="Rencana /bln" value={formatRupiah(focus.budget)} />
                    <MiniStat
                      label={`Realisasi ${selected?.label ?? ''}`}
                      value={formatRupiah(focus.actual)}
                      color={Colors.pendingBorder}
                    />
                    <MiniStat
                      label={`Variansi ${selected?.label ?? ''}`}
                      value={`+${formatRupiah(focus.actual - focus.budget)}`}
                      color={Colors.pendingBorder}
                    />
                    <MiniStat
                      label="MoM bln lalu"
                      value={
                        focus.prev > 0
                          ? `${focus.actual >= focus.prev ? '↑' : '↓'} ${Math.round(
                              ((focus.actual - focus.prev) / focus.prev) * 100
                            )}%`
                          : 'Baru'
                      }
                      color={Colors.pendingBorder}
                    />
                  </StatRow>
                </View>
              )}

              <StatGrid>
                <StatRow>
                  <StatCard label="Rata-rata pengeluaran" value={`${formatRupiah(annual.avgExpense)} /bln`} />
                  <StatCard
                    label="Total variansi tahunan"
                    value={`${annual.expenseVariance >= 0 ? '+' : '−'}${formatRupiah(Math.abs(annual.expenseVariance))} ${
                      annual.expenseVariance > 0 ? '(Over)' : annual.expenseVariance < 0 ? '(Hemat)' : ''
                    }`.trim()}
                    tone={annual.expenseVariance > 0 ? 'pending' : 'paid'}
                  />
                </StatRow>
              </StatGrid>

              {focus && focus.budget > 0 && focus.actual > focus.budget && (
                <InsightCallout
                  text={`${focus.name} menjadi kategori dengan overspend terbesar di ${selected ? monthYearLabel(selected.month, activeYear) : ''} — ${formatRupiah(focus.actual - focus.budget)} di atas rencana bulanannya.`}
                  tone="pending"
                />
              )}
            </SectionCard>

            {/* ---------- Section 4: MoM ---------- */}
            <SectionCard>
              <SectionHeader
                title="Perubahan dari Bulan Sebelumnya"
                subtitle="Pergerakan riil antarkategori untuk mengidentifikasi pemicu defisit kas bulanan."
              />
              <View style={styles.selector}>
                <ArrowLeftRight size={12} color={Colors.textSecondary} />
                <Text style={styles.selectorText}>
                  {mom
                    ? `${monthYearLabel(mom.month, activeYear)} vs ${monthYearLabel(mom.previousMonth, activeYear)}`
                    : 'Belum ada bulan untuk dibandingkan'}
                </Text>
              </View>
              {mom && (
                <>
                  <MoverList
                    title="Naik paling besar (Overspend &amp; Kenaikan)"
                    movers={mom.risers}
                    tone="up"
                    emptyText="Tidak ada kategori yang naik bulan ini."
                  />
                  <View style={styles.divider} />
                  <MoverList
                    title="Turun paling besar (Penghematan)"
                    movers={mom.fallers}
                    tone="down"
                    emptyText="Tidak ada kategori yang turun bulan ini."
                  />
                </>
              )}
            </SectionCard>

            {/* ---------- Section 5: Assets ---------- */}
            <SectionCard>
              <SectionHeader
                title="Trend Alokasi Aset Likuid"
                subtitle="Pantau perubahan dana darurat, tabungan, dan aset investasi sepanjang tahun."
                trailing={
                  <SegmentedTabs
                    items={[
                      { key: 'monthly', label: 'Per Bulan' },
                      { key: 'cumulative', label: 'Akumulasi' },
                    ]}
                    activeKey={assetMode}
                    onChange={(k) => setAssetMode(k as 'monthly' | 'cumulative')}
                  />
                }
              />
              <Legend
                items={ASSET_BANDS.map((b) => ({
                  label: b.label,
                  color: ASSET_BAND_COLORS[b.key] ?? Colors.chartAsset,
                }))}
                dot={7}
              />
              <View style={styles.chartSurface}>
                <ChartScaleRow
                  left={
                    accumulated.length > 0
                      ? `Pertumbuhan Akumulasi: ${formatRupiahShort(accumulated[0])} → ${formatRupiahShort(accumulated[accumulated.length - 1])}`
                      : undefined
                  }
                  leftColor={Colors.paidText}
                  right={`Total rencana: ${formatRupiahShort(assets.plannedTotal)}`}
                />
                <StackedBarChart
                  columns={assetColumns}
                  height={120}
                  activeMonth={activeMonth}
                  onPressMonth={setSelectedMonth}
                />
              </View>
              <Text style={styles.catList}>
                Aset dihitung dari alokasi bulanan bertipe Aset / Tabungan / Investasi / Dana Darurat — bukan nilai pasar.
              </Text>
              <StatGrid>
                <StatRow>
                  <StatCard label="Total rencana aset" value={formatRupiah(assets.plannedTotal)} />
                  <StatCard
                    label="Saldo akumulasi saat ini"
                    value={formatRupiah(assets.total)}
                    tone="paid"
                  />
                </StatRow>
                <StatRow>
                  <StatCard
                    label="Kenaikan sejak awal tahun"
                    value={
                      assets.growthPct !== null
                        ? `+${formatRupiah(assets.growth)} (+${assets.growthPct}%)`
                        : `+${formatRupiah(assets.growth)}`
                    }
                    tone="paid"
                  />
                  <StatCard
                    label="Kontributor terbesar"
                    value={
                      assets.topType
                        ? `${bandLabel(bandKeyOfAllocationType(assets.topType)) ?? assets.topType} (${formatRupiahShort(assets.topAmount)})`
                        : '—'
                    }
                  />
                </StatRow>
              </StatGrid>
            </SectionCard>

            {/* ---------- Section 6: Plan vs Actual ---------- */}
            <SectionCard>
              <SectionHeader
                title="Plan vs Actual"
                subtitle="Evaluasi selisih realisasi terhadap target anggaran per bulan."
                trailing={
                  <Text style={[styles.netDelta, { color: pvaNet > 0 ? Colors.pendingBorder : Colors.paidText }]}>
                    {`Net Variansi: ${pvaNet >= 0 ? '+' : '−'}${formatRupiahShort(Math.abs(pvaNet))}`}
                  </Text>
                }
              />
              <SegmentedTabs
                items={[
                  { key: 'income', label: 'Pemasukan' },
                  { key: 'expenses', label: 'Pengeluaran' },
                  { key: 'investments', label: 'Investasi' },
                  { key: 'assets', label: 'Aset' },
                ]}
                activeKey={pvaMetric}
                onChange={(k) => setPvaMetric(k as PvaMetric)}
              />
              <Legend
                items={[
                  { label: 'Di atas plan (Over)', color: Colors.chartExpense },
                  { label: 'Sesuai plan (±2%)', color: Colors.chartPlan },
                  { label: 'Di bawah plan (Hemat)', color: Colors.chartIncome },
                ]}
              />
              <View style={styles.chartSurface}>
                <ChartScaleRow
                  left={`+${formatRupiahShort(Math.max(0, ...pvaPoints.map((p) => p.variance)))} (Over)`}
                  leftColor={Colors.pendingBorder}
                  right={`−${formatRupiahShort(Math.abs(Math.min(0, ...pvaPoints.map((p) => p.variance))))} (Hemat)`}
                  rightColor={Colors.paidText}
                />
                <VarianceBarChart
                  columns={pvaColumns}
                  height={95}
                  activeMonth={activeMonth}
                  onPressMonth={setSelectedMonth}
                />
              </View>
              <RuleBanner
                text="Penerimaan pinjaman dan cicilan pokok dipisahkan dari evaluasi belanja operasional."
                tone="alert"
              />
            </SectionCard>

            {/* ---------- Section 7: Liabilities ---------- */}
            <SectionCard>
              <SectionHeader
                title="Trend Kewajiban"
                subtitle="Lihat pertumbuhan dan pembayaran pinjaman, reimburse, cicilan, dan tagihan dari bulan ke bulan."
                trailing={
                  <Badge
                    label={`${activeLoans} Pinjaman Berjalan`}
                    tone={activeLoans > 0 ? 'alert' : 'paid'}
                  />
                }
              />
              <View style={styles.chips}>
                {(
                  [
                    ['loan', 'Pinjaman (Aktif)'],
                    ['reimburse', 'Reimburse'],
                    ['installment', 'Cicilan'],
                    ['bill', 'Tagihan'],
                  ] as const
                ).map(([key, label]) => (
                  <Chip
                    key={key}
                    label={label}
                    active={liabType === key}
                    onPress={() => setLiabType(key)}
                    disabled={!liabilityByType[key]}
                  />
                ))}
              </View>
              <View style={styles.chartSurface}>
                <ChartScaleRow
                  left={
                    buckets.some((b) => b.financingInflow > 0)
                      ? `${buckets.filter((b) => b.financingInflow > 0).map((b) => `${b.label}: +${formatRupiahShort(b.financingInflow)} (Inflow)`).join(' · ')}`
                      : 'Belum ada pemasukan pinjaman'
                  }
                  leftColor={Colors.alertText}
                  right={
                    buckets.some((b) => b.actualDebtPayment > 0)
                      ? `${buckets.filter((b) => b.actualDebtPayment > 0).map((b) => `${b.label}: −${formatRupiahShort(b.actualDebtPayment)}`).join(' · ')}`
                      : undefined
                  }
                  rightColor={Colors.chartLiability}
                />
                <GroupedBarChart
                  columns={liabColumns}
                  height={60}
                  activeMonth={activeMonth}
                  onPressMonth={setSelectedMonth}
                  barWidth={12}
                  colGap={3}
                />
                {/* The chart draws an empty grid when nothing was borrowed, and
                    an empty grid is easy to read as a rendering failure. The
                    illustration says which state this is. */}
                {!buckets.some((b) => b.financingInflow > 0) && (
                  <View style={styles.emptyArt}>
                    <BrandIcon name="empty-belum-ada-pemasukan" size={72} label="" />
                  </View>
                )}
              </View>
              <RuleBanner
                icon="alert"
                tone="alert"
                text={`Aturan Akuntansi: Penerimaan pinjaman menambah kas & kewajiban. Pelunasan pokok${principalPaid > 0 ? ` (${formatRupiahShort(principalPaid)})` : ''} mengurangi saldo utang dan bukan biaya belanja konsumtif. Bunga/admin dicatat sebagai beban pengeluaran.`}
              />
              <StatGrid>
                <StatRow>
                  <StatCard
                    label="Saldo kewajiban"
                    value={formatRupiah(liabOutstanding)}
                    tone="pending"
                  />
                  <StatCard
                    label="Pokok terbayar (tahun ini)"
                    value={formatRupiah(principalPaid)}
                    tone="alert"
                  />
                </StatRow>
                <StatRow>
                  <StatCard label="Total bunga & biaya" value={formatRupiah(interestFees)} />
                  <StatCard
                    label="Jatuh tempo berikutnya"
                    value={nextDue ? shortDateLabel(nextDue) ?? nextDue : 'Tidak ada'}
                  />
                </StatRow>
              </StatGrid>
              <View style={styles.progressBox}>
                <View style={styles.progressHead}>
                  <Text style={styles.progressLabel}>Progres pelunasan kewajiban</Text>
                  <Text style={styles.progressPct}>
                    {loanTotals.total > 0
                      ? `${Math.round((loanTotals.paid / loanTotals.total) * 100)}% (${formatRupiahShort(loanTotals.paid)} / ${formatRupiahShort(loanTotals.total)})`
                      : '—'}
                  </Text>
                </View>
                <ProgressTrack
                  pct={loanTotals.total > 0 ? (loanTotals.paid / loanTotals.total) * 100 : 0}
                  color={Colors.chartLiability}
                />
              </View>
            </SectionCard>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Fig({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.fig}>
      <Text style={styles.figLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.figValue, { color }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.miniValue, color ? { color } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
    >
      <Text
        style={[styles.chipLabel, active && styles.chipLabelActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 14, paddingBottom: 40 },
  muted: { fontSize: FontSize.caption, color: Colors.textMuted },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  backText: { fontSize: FontSize.caption, color: Colors.textPrimary, fontWeight: '500' },
  crumbPill: {
    backgroundColor: Colors.subtle,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexShrink: 1,
  },
  crumbText: { fontSize: FontSize.caption, color: Colors.textSecondary },

  titleBlock: { gap: 4 },
  eyebrow: { fontSize: FontSize.microLabel, color: Colors.textMuted, letterSpacing: 0.6 },
  title: { fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  supporting: { fontSize: FontSize.body, color: Colors.textSecondary },

  selectorBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  yearDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  yearLabel: { fontSize: FontSize.caption, color: Colors.textPrimary, fontWeight: '500' },

  tooltip: { backgroundColor: Colors.canvas, borderRadius: Radius.md, padding: 10, gap: 8 },
  tooltipHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tooltipTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.chartExpense },
  tooltipTitle: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  figGrid: { gap: 8 },
  figRow: { flexDirection: 'row', gap: 8 },
  fig: { flex: 1, gap: 2 },
  figLabel: { fontSize: FontSize.microLabel, color: Colors.textMuted },
  figValue: { fontSize: FontSize.microValue, fontWeight: '600' },

  emptyArt: { alignItems: 'center', paddingTop: 8 },
  chartSurface: { backgroundColor: Colors.canvas, borderRadius: Radius.md, padding: 10 },
  footNotes: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  footNote: { fontSize: FontSize.microLabel, color: Colors.textSecondary, flexShrink: 1 },
  footNoteDim: { fontSize: FontSize.microLabel, color: Colors.textMuted },

  catList: { fontSize: FontSize.caption, color: Colors.textMuted, lineHeight: 16 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: Colors.subtle,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: Colors.brandPrimary },
  chipDisabled: { opacity: 0.4 },
  chipLabel: { fontSize: FontSize.caption, color: Colors.textSecondary },
  chipLabelActive: { color: Colors.surface, fontWeight: '600' },

  focus: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 10, gap: 8 },
  focusHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  focusTitle: { fontSize: FontSize.body, fontWeight: '600', color: Colors.pendingText, flexShrink: 1 },
  focusBadge: { fontSize: FontSize.microLabel, color: Colors.pendingBorder },
  miniStat: { flex: 1, gap: 2 },
  miniLabel: { fontSize: FontSize.microLabel, color: Colors.textMuted },
  miniValue: { fontSize: FontSize.caption, fontWeight: '600', color: Colors.textSecondary },

  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.subtle,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  selectorText: { fontSize: FontSize.caption, color: Colors.textPrimary, fontWeight: '500' },
  divider: { height: 1, backgroundColor: Colors.borderSubtle },

  netDelta: { fontSize: FontSize.caption, fontWeight: '700' },

  progressBox: { gap: 6 },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  progressLabel: { fontSize: FontSize.caption, color: Colors.textSecondary },
  progressPct: { fontSize: FontSize.caption, fontWeight: '700', color: Colors.chartLiability },
});
