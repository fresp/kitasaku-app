import { useMemo, useState } from 'react';
import {
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
import { useRouter } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import ArrowDown from 'lucide-react-native/icons/arrow-down';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Check from 'lucide-react-native/icons/check';
import Search from 'lucide-react-native/icons/search';
import X from 'lucide-react-native/icons/x';
import Utensils from 'lucide-react-native/icons/utensils';
import Home from 'lucide-react-native/icons/house';
import Car from 'lucide-react-native/icons/car';
import Zap from 'lucide-react-native/icons/zap';
import GraduationCap from 'lucide-react-native/icons/graduation-cap';
import Heart from 'lucide-react-native/icons/heart';
import Sparkles from 'lucide-react-native/icons/sparkles';
import ShoppingBag from 'lucide-react-native/icons/shopping-bag';
import CircleDollarSign from 'lucide-react-native/icons/circle-dollar-sign';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import Layers from 'lucide-react-native/icons/layers';

import { Colors, Radius } from '../constants/theme';
import { formatRupiah, formatRupiahShort } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useCategories,
  useCycleYears,
  useYearInsight,
} from '../lib/queries';
import {
  buildYearBuckets,
  latestActiveMonth,
  monthFullName,
  monthYearLabel,
  windowEndingAt,
} from '../lib/insight';

function getCategoryVisual(name: string) {
  const n = (name || '').toLowerCase();
  if (n.includes('makan') || n.includes('kuliner') || n.includes('food') || n.includes('jajan')) {
    return { Icon: Utensils, bg: '#FEF3C7', color: '#D97706' };
  }
  if (n.includes('rumah') || n.includes('kost') || n.includes('sewa') || n.includes('home')) {
    return { Icon: Home, bg: '#ECFDF5', color: '#059669' };
  }
  if (n.includes('didik') || n.includes('sekolah') || n.includes('kursus') || n.includes('kuliah') || n.includes('buku')) {
    return { Icon: GraduationCap, bg: '#F3E8FF', color: '#9333EA' };
  }
  if (n.includes('transport') || n.includes('bensin') || n.includes('parkir') || n.includes('ojek') || n.includes('mobil')) {
    return { Icon: Car, bg: '#FFEDD5', color: '#EA580C' };
  }
  if (n.includes('listrik') || n.includes('air') || n.includes('internet') || n.includes('tagihan') || n.includes('wifi')) {
    return { Icon: Zap, bg: '#FEF9C3', color: '#CA8A04' };
  }
  if (n.includes('sehat') || n.includes('obat') || n.includes('dokter') || n.includes('medis') || n.includes('klinik')) {
    return { Icon: Heart, bg: '#FCE7F3', color: '#DB2777' };
  }
  if (n.includes('hiburan') || n.includes('nonton') || n.includes('game') || n.includes('rekreasi') || n.includes('libur')) {
    return { Icon: Sparkles, bg: '#EDE9FE', color: '#7C3AED' };
  }
  if (n.includes('belanja') || n.includes('shop') || n.includes('pakaian') || n.includes('baju')) {
    return { Icon: ShoppingBag, bg: '#FEE2E2', color: '#DC2626' };
  }
  if (n.includes('finansial') || n.includes('pajak') || n.includes('asuransi') || n.includes('admin')) {
    return { Icon: CircleDollarSign, bg: '#DCFCE7', color: '#16A34A' };
  }
  if (n.includes('invest') || n.includes('saham') || n.includes('reksa') || n.includes('emas') || n.includes('tabung')) {
    return { Icon: TrendingUp, bg: '#CCFBF1', color: '#0D9488' };
  }
  return { Icon: Layers, bg: '#F1F5F9', color: '#475569' };
}

export default function AssetInsightScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const catsQ = useCategories(householdId);
  const categories = useMemo(() => catsQ.data ?? [], [catsQ.data]);

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

  const activeMonth = useMemo(
    () => selectedMonth ?? latestActiveMonth(buckets) ?? (new Date().getMonth() + 1),
    [selectedMonth, buckets]
  );

  const windowBuckets = useMemo(
    () => windowEndingAt(buckets, 6),
    [buckets]
  );

  const currentBucket = useMemo(
    () => buckets.find((b) => b.month === activeMonth),
    [buckets, activeMonth]
  );

  const prevMonth = activeMonth === 1 ? 12 : activeMonth - 1;
  const prevBucket = useMemo(
    () => buckets.find((b) => b.month === prevMonth),
    [buckets, prevMonth]
  );

  // Income metrics
  const currentIncome = useMemo(() => {
    if (!currentBucket) return 0;
    return currentBucket.actualIncome > 0
      ? currentBucket.actualIncome
      : currentBucket.plannedIncome;
  }, [currentBucket]);

  const prevIncome = useMemo(() => {
    if (!prevBucket) return 0;
    return prevBucket.actualIncome > 0
      ? prevBucket.actualIncome
      : prevBucket.plannedIncome;
  }, [prevBucket]);

  const incomeTrendText = useMemo(() => {
    if (prevIncome <= 0) return currentIncome > 0 ? '↗ Baru bulan ini' : 'Stabil';
    const deltaPct = Math.round(((currentIncome - prevIncome) / prevIncome) * 100);
    if (deltaPct >= 0) return `↗ +${deltaPct}% dari bulan lalu`;
    return `↘ ${deltaPct}% dari bulan lalu`;
  }, [currentIncome, prevIncome]);

  // Expense metrics
  const currentExpense = useMemo(() => {
    if (!currentBucket) return 0;
    return currentBucket.actualExpense > 0
      ? currentBucket.actualExpense
      : currentBucket.plannedExpense;
  }, [currentBucket]);

  const prevExpense = useMemo(() => {
    if (!prevBucket) return 0;
    return prevBucket.actualExpense > 0
      ? prevBucket.actualExpense
      : prevBucket.plannedExpense;
  }, [prevBucket]);

  const expenseTrendText = useMemo(() => {
    if (prevExpense <= 0) return currentExpense > 0 ? '↗ Baru bulan ini' : 'Stabil';
    const deltaPct = Math.round(((currentExpense - prevExpense) / prevExpense) * 100);
    if (deltaPct >= 0) return `↗ +${deltaPct}% dari bulan lalu`;
    return `↘ ${deltaPct}% dari bulan lalu`;
  }, [currentExpense, prevExpense]);

  // Chart scaling calculations
  const maxChartVal = useMemo(() => {
    let m = 1;
    for (const b of windowBuckets) {
      const inc = b.actualIncome > 0 ? b.actualIncome : b.plannedIncome;
      const exp = b.actualExpense > 0 ? b.actualExpense : b.plannedExpense;
      if (inc > m) m = inc;
      if (exp > m) m = exp;
    }
    return m;
  }, [windowBuckets]);

  // Category breakdown ranking for selected month
  const categoryRankings = useMemo(() => {
    if (!currentBucket) return [];
    const entries: {
      id: string;
      name: string;
      amount: number;
      pct: number;
    }[] = [];

    const totalExp = currentExpense > 0 ? currentExpense : 1;

    // Check expenseByCategory map in currentBucket
    for (const [catId, amt] of Object.entries(currentBucket.expenseByCategory)) {
      if (amt <= 0) continue;
      const cat = categories.find((c) => c.id === catId);
      entries.push({
        id: catId,
        name: cat?.name ?? 'Lainnya',
        amount: amt,
        pct: Math.round((amt / totalExp) * 100),
      });
    }

    // Sort descending by amount
    entries.sort((a, b) => b.amount - a.amount);
    return entries;
  }, [currentBucket, currentExpense, categories]);

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categoryRankings;
    const q = searchQuery.toLowerCase();
    return categoryRankings.filter((c) => c.name.toLowerCase().includes(q));
  }, [categoryRankings, searchQuery]);

  const displayedCategories = useMemo(() => {
    if (showAllCategories || searchQuery.trim()) return filteredCategories;
    return filteredCategories.slice(0, 4);
  }, [filteredCategories, showAllCategories, searchQuery]);

  const refetch = () => {
    void yearQ.refetch();
    void catsQ.refetch();
    void yearsQ.refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Top Header */}
      <View style={styles.header}>
        <Pressable
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.headerBtn}
        >
          <ChevronLeft size={22} color="#0B1527" />
        </Pressable>
        <Text style={styles.headerTitle}>Insight</Text>
        <Pressable
          hitSlop={10}
          onPress={() => setSearchVisible((prev) => !prev)}
          style={styles.headerBtn}
        >
          <Search size={20} color={searchVisible ? Colors.brandPrimary : Colors.textPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={yearQ.isFetching} onRefresh={refetch} />}
      >
        {/* Month Selector Pill */}
        <View style={styles.monthPillContainer}>
          <Pressable
            style={styles.monthPill}
            onPress={() => setMonthPickerVisible(true)}
          >
            <Text style={styles.monthPillText}>
              {monthYearLabel(activeMonth, activeYear)}
            </Text>
            <ChevronDown size={14} color="#64748B" />
          </Pressable>
        </View>

        {/* Dual Summary Cards */}
        <View style={styles.summaryGrid}>
          {/* Pemasukan Card */}
          <View style={styles.incomeCard}>
            <View style={styles.cardHeader}>
              <View style={styles.incomeIconSquircle}>
                <ArrowUp size={16} color="#FFFFFF" strokeWidth={2.5} />
              </View>
              <Text style={styles.cardLabel}>Pemasukan</Text>
            </View>
            <Text style={styles.incomeValue}>
              {formatRupiah(currentIncome)}
            </Text>
            <Text style={styles.incomeTrend}>
              {incomeTrendText}
            </Text>
          </View>

          {/* Pengeluaran Card */}
          <View style={styles.expenseCard}>
            <View style={styles.cardHeader}>
              <View style={styles.expenseIconSquircle}>
                <ArrowDown size={16} color="#FFFFFF" strokeWidth={2.5} />
              </View>
              <Text style={styles.cardLabel}>Pengeluaran</Text>
            </View>
            <Text style={styles.expenseValue}>
              {formatRupiah(currentExpense)}
            </Text>
            <Text style={styles.expenseTrend}>
              {expenseTrendText}
            </Text>
          </View>
        </View>

        {/* 6-Month Trend Chart Section */}
        <View style={styles.chartSection}>
          <Text style={styles.chartTitle}>Tren 6 bulan terakhir</Text>

          {/* Chart Canvas */}
          <View style={styles.chartWrapper}>
            {/* Left Y-axis ticks */}
            <View style={styles.yAxis}>
              <Text style={styles.axisTickText}>
                {formatRupiahShort(maxChartVal).replace('Rp ', '')}
              </Text>
              <Text style={styles.axisTickText}>
                {formatRupiahShort(Math.round(maxChartVal / 2)).replace('Rp ', '')}
              </Text>
              <Text style={styles.axisTickText}>0</Text>
            </View>

            {/* Chart Columns Area */}
            <View style={styles.columnsArea}>
              {/* Background Guide Lines */}
              <View style={[styles.guideLine, { top: '8%' }]} />
              <View style={[styles.guideLine, { top: '50%' }]} />
              <View style={[styles.guideLine, { bottom: 22 }]} />

              <View style={styles.barsContainer}>
                {windowBuckets.map((b) => {
                  const inc = b.actualIncome > 0 ? b.actualIncome : b.plannedIncome;
                  const exp = b.actualExpense > 0 ? b.actualExpense : b.plannedExpense;

                  const incHeight = maxChartVal > 0 ? Math.min(100, Math.max(8, (inc / maxChartVal) * 100)) : 8;
                  const expHeight = maxChartVal > 0 ? Math.min(100, Math.max(8, (exp / maxChartVal) * 100)) : 8;
                  const isCurrent = b.month === activeMonth;

                  return (
                    <Pressable
                      key={b.month}
                      onPress={() => setSelectedMonth(b.month)}
                      style={[styles.barCol, isCurrent && styles.barColActive]}
                    >
                      <View style={styles.barsGroup}>
                        {/* Income Bar (Blue) */}
                        <View
                          style={[
                            styles.bar,
                            styles.incomeBar,
                            { height: `${incHeight}%` },
                            isCurrent && styles.barActiveHighlight,
                          ]}
                        />
                        {/* Expense Bar (Red) */}
                        <View
                          style={[
                            styles.bar,
                            styles.expenseBar,
                            { height: `${expHeight}%` },
                            isCurrent && styles.barActiveHighlight,
                          ]}
                        />
                      </View>
                      <Text style={[styles.monthLabel, isCurrent && styles.monthLabelActive]}>
                        {b.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Legend */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#2563EB' }]} />
              <Text style={styles.legendLabel}>Pemasukan</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
              <Text style={styles.legendLabel}>Pengeluaran</Text>
            </View>
          </View>
        </View>

        {/* Kategori Terbesar Section */}
        <View style={styles.categorySection}>
          <View style={styles.categoryHeader}>
            <Text style={styles.categoryTitle}>Kategori terbesar</Text>
            {categoryRankings.length > 4 && (
              <Pressable
                onPress={() => setShowAllCategories((prev) => !prev)}
                hitSlop={8}
              >
                <Text style={styles.seeAllText}>
                  {showAllCategories ? 'Tampilkan sedikit' : 'Lihat semua'}
                </Text>
              </Pressable>
            )}
          </View>

          {searchVisible && (
            <View style={styles.searchBar}>
              <Search size={16} color="#94A3B8" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Cari kategori..."
                placeholderTextColor="#94A3B8"
                style={styles.searchInput}
                autoFocus
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                  <X size={16} color="#94A3B8" />
                </Pressable>
              )}
            </View>
          )}

          <View style={styles.categoryCard}>
            {displayedCategories.length === 0 ? (
              <View style={styles.emptyCategories}>
                <Text style={styles.emptyCategoriesText}>
                  Belum ada catatan pengeluaran pada bulan ini
                </Text>
              </View>
            ) : (
              displayedCategories.map((item, index) => {
                const visual = getCategoryVisual(item.name);
                const VisualIcon = visual.Icon;
                const isLast = index === displayedCategories.length - 1;

                return (
                  <View
                    key={item.id}
                    style={[styles.categoryRow, !isLast && styles.categoryRowBordered]}
                  >
                    <View style={[styles.categorySquircle, { backgroundColor: visual.bg }]}>
                      <VisualIcon size={20} color={visual.color} />
                    </View>
                    <View style={styles.categoryInfo}>
                      <Text style={styles.categoryName} numberOfLines={1}>
                        {item.name}
                      </Text>
                    </View>
                    <View style={styles.categoryNumbers}>
                      <Text style={styles.categoryPct}>{item.pct}%</Text>
                      <Text style={styles.categoryAmount}>{formatRupiah(item.amount)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>

      {/* Month & Year Picker Modal */}
      <Modal
        visible={monthPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMonthPickerVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setMonthPickerVisible(false)}
        >
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pilih Bulan &amp; Tahun</Text>
              <Pressable hitSlop={8} onPress={() => setMonthPickerVisible(false)}>
                <X size={20} color="#64748B" />
              </Pressable>
            </View>

            {/* Year selector row */}
            {years.length > 1 && (
              <View style={styles.yearRow}>
                {years.map((y) => (
                  <Pressable
                    key={y}
                    onPress={() => setYear(y)}
                    style={[styles.yearChip, activeYear === y && styles.yearChipActive]}
                  >
                    <Text style={[styles.yearChipText, activeYear === y && styles.yearChipTextActive]}>
                      {y}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Months 3x4 Grid */}
            <View style={styles.monthsGrid}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const isSelected = activeMonth === m;
                const bucket = buckets.find((b) => b.month === m);
                const hasData = bucket?.hasCycle;

                return (
                  <Pressable
                    key={m}
                    onPress={() => {
                      setSelectedMonth(m);
                      setMonthPickerVisible(false);
                    }}
                    style={[
                      styles.monthCell,
                      isSelected && styles.monthCellSelected,
                      !hasData && styles.monthCellEmpty,
                    ]}
                  >
                    <Text
                      style={[
                        styles.monthCellText,
                        isSelected && styles.monthCellTextSelected,
                        !hasData && styles.monthCellTextEmpty,
                      ]}
                    >
                      {monthFullName(m)}
                    </Text>
                    {isSelected && <Check size={14} color="#FFFFFF" />}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
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
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0B1527',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 18,
  },

  // Month selector pill
  monthPillContainer: {
    alignItems: 'center',
    marginBottom: 4,
  },
  monthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  monthPillText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0B1527',
  },

  // Summary Grid
  summaryGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  incomeCard: {
    flex: 1,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
    borderRadius: 16,
    padding: 14,
  },
  expenseCard: {
    flex: 1,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    borderRadius: 16,
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  incomeIconSquircle: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expenseIconSquircle: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    fontSize: 12.5,
    fontWeight: '500',
    color: '#64748B',
  },
  incomeValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1527',
    letterSpacing: -0.2,
  },
  expenseValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1527',
    letterSpacing: -0.2,
  },
  incomeTrend: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
    marginTop: 4,
  },
  expenseTrend: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 4,
  },

  // 6-Month Chart Section
  chartSection: {
    gap: 12,
    marginTop: 6,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1527',
  },
  chartWrapper: {
    height: 160,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 10,
  },
  yAxis: {
    width: 32,
    justifyContent: 'space-between',
    paddingBottom: 24,
    alignItems: 'flex-start',
  },
  axisTickText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  columnsArea: {
    flex: 1,
    position: 'relative',
    justifyContent: 'flex-end',
  },
  guideLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  barsContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: 24,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    height: '100%',
    justifyContent: 'flex-end',
    paddingHorizontal: 2,
  },
  barColActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.04)',
    borderRadius: 8,
  },
  barsGroup: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: '85%',
  },
  bar: {
    width: 10,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  incomeBar: {
    backgroundColor: '#2563EB',
  },
  expenseBar: {
    backgroundColor: '#EF4444',
  },
  barActiveHighlight: {
    opacity: 1,
  },
  monthLabel: {
    fontSize: 11.5,
    fontWeight: '500',
    color: '#64748B',
    position: 'absolute',
    bottom: -20,
  },
  monthLabelActive: {
    color: '#0B1527',
    fontWeight: '700',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginTop: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },

  // Category Section
  categorySection: {
    gap: 12,
    marginTop: 8,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1527',
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0B1527',
  },
  categoryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  emptyCategories: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCategoriesText: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  categoryRowBordered: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  categorySquircle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryInfo: {
    flex: 1,
  },
  categoryName: {
    fontSize: 14.5,
    fontWeight: '600',
    color: '#0B1527',
  },
  categoryNumbers: {
    alignItems: 'flex-end',
    gap: 2,
  },
  categoryPct: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0B1527',
  },
  categoryAmount: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },

  // Modal Sheet
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 21, 39, 0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    gap: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0B1527',
  },
  yearRow: {
    flexDirection: 'row',
    gap: 8,
  },
  yearChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: '#F1F5F9',
  },
  yearChipActive: {
    backgroundColor: '#2563EB',
  },
  yearChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  yearChipTextActive: {
    color: '#FFFFFF',
  },
  monthsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  monthCell: {
    width: '31%',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    gap: 4,
  },
  monthCellSelected: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  monthCellEmpty: {
    opacity: 0.6,
  },
  monthCellText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0B1527',
  },
  monthCellTextSelected: {
    color: '#FFFFFF',
  },
  monthCellTextEmpty: {
    color: '#94A3B8',
  },
});
