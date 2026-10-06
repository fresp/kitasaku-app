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
import CheckCircle2 from 'lucide-react-native/icons/circle-check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Plus from 'lucide-react-native/icons/plus';
import X from 'lucide-react-native/icons/x';
import { Colors, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import { useAuth } from '../../lib/auth-context';
import {
  useActiveCycle,
  useHouseholdCycles,
  useObligations,
} from '../../lib/queries';
import {
  daysBetween,
  isSettled,
  paidAmount,
  shortDateLabel,
} from '../../lib/obligation';
import { categoryIconName } from '../../lib/category-icon';
import { BrandIcon } from '../../components/ui/BrandIcon';
import { QueryError } from '../../components/ui/QueryError';
import { ObligationFormSheet } from '../../components/obligations/ObligationFormSheet';

type ObligationTab = 'upcoming' | 'paid' | 'all';

function parseDateBadge(isoDate?: string | null): { day: string; month: string } {
  if (!isoDate) return { day: '-', month: '-' };
  const parts = isoDate.split('-');
  if (parts.length < 3) return { day: '-', month: '-' };
  const day = parts[2];
  const monthMap: Record<string, string> = {
    '01': 'Jan',
    '02': 'Feb',
    '03': 'Mar',
    '04': 'Apr',
    '05': 'Mei',
    '06': 'Jun',
    '07': 'Jul',
    '08': 'Agu',
    '09': 'Sep',
    '10': 'Okt',
    '11': 'Nov',
    '12': 'Des',
  };
  const month = monthMap[parts[1]] ?? parts[1];
  return { day, month };
}

export default function ObligationsScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const cyclesQ = useHouseholdCycles(householdId);
  const obligQ = useObligations(householdId);

  const [activeTab, setActiveTab] = useState<ObligationTab>('upcoming');
  const [showForm, setShowForm] = useState(false);
  const [cyclePickerOpen, setCyclePickerOpen] = useState(false);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);

  const todayISO = new Date().toISOString().slice(0, 10);
  const obligations = useMemo(() => obligQ.data ?? [], [obligQ.data]);

  const activeCycle = useMemo(() => {
    if (selectedCycleId) {
      return (cyclesQ.data ?? []).find((c) => c.id === selectedCycleId) ?? cycleQ.data;
    }
    return cycleQ.data;
  }, [selectedCycleId, cyclesQ.data, cycleQ.data]);

  // Partition obligations
  const upcomingList = useMemo(
    () => obligations.filter((o) => !isSettled(o.status)),
    [obligations]
  );
  const paidList = useMemo(
    () => obligations.filter((o) => isSettled(o.status)),
    [obligations]
  );

  const totalUnpaid = useMemo(() => {
    return upcomingList.reduce((acc, o) => {
      const remaining = o.remaining_amount ?? (o.total_amount - paidAmount(o.total_amount, o.remaining_amount));
      return acc + (remaining > 0 ? remaining : 0);
    }, 0);
  }, [upcomingList]);

  const cyclesList = cyclesQ.data ?? [];
  const currentCycleIndex = cyclesList.findIndex((c) => c.id === activeCycle?.id);

  function goToPrevCycle() {
    if (currentCycleIndex < cyclesList.length - 1 && currentCycleIndex !== -1) {
      setSelectedCycleId(cyclesList[currentCycleIndex + 1].id);
    }
  }

  function goToNextCycle() {
    if (currentCycleIndex > 0) {
      setSelectedCycleId(cyclesList[currentCycleIndex - 1].id);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={obligQ.isFetching}
            onRefresh={() => {
              void obligQ.refetch();
              void cycleQ.refetch();
              void cyclesQ.refetch();
            }}
          />
        }
      >
        {/* Top Header: Title & Actions */}
        <View style={styles.topHeader}>
          <Text style={styles.screenTitle}>Tanggungan</Text>
          <Pressable
            onPress={() => setShowForm(true)}
            style={styles.addRoundBtn}
            accessibilityLabel="Tambah Tanggungan"
          >
            <Plus size={20} color="#0B1527" />
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
              onPress={() => setCyclePickerOpen(true)}
              style={styles.cyclePillCenter}
              accessibilityLabel="Buka daftar siklus"
            >
              <Text style={styles.cyclePillText} numberOfLines={1}>
                {activeCycle ? activeCycle.name : 'Pilih Siklus'}
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

        {/* 3-Pill Filter Tabs: Mendatang | Terbayar | Semua */}
        <View style={styles.filterTabs}>
          <Pressable
            onPress={() => setActiveTab('upcoming')}
            style={[styles.filterTab, activeTab === 'upcoming' && styles.filterTabActive]}
          >
            <Text
              style={[
                styles.filterTabText,
                activeTab === 'upcoming' && styles.filterTabTextActive,
              ]}
            >
              Mendatang
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('paid')}
            style={[styles.filterTab, activeTab === 'paid' && styles.filterTabActive]}
          >
            <Text
              style={[
                styles.filterTabText,
                activeTab === 'paid' && styles.filterTabTextActive,
              ]}
            >
              Terbayar
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab('all')}
            style={[styles.filterTab, activeTab === 'all' && styles.filterTabActive]}
          >
            <Text
              style={[
                styles.filterTabText,
                activeTab === 'all' && styles.filterTabTextActive,
              ]}
            >
              Semua
            </Text>
          </Pressable>
        </View>

        {/* Total Belum Dibayar Summary Card */}
        <View style={styles.summaryCard}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.summaryLabel}>Total belum dibayar</Text>
            <Text style={styles.summaryAmount}>{formatRupiah(totalUnpaid)}</Text>
            <Text style={styles.summarySub}>{upcomingList.length} tanggungan</Text>
          </View>
          <View style={styles.calendarIconBox}>
            <Calendar size={22} color={Colors.info} />
          </View>
        </View>

        {/* Query Errors / Loading */}
        {obligQ.isError && householdId && (
          <QueryError
            onRetry={() => {
              void obligQ.refetch();
              void cycleQ.refetch();
            }}
            retrying={obligQ.isFetching}
            message="Pool tanggungan belum bisa dibaca. Datamu aman."
          />
        )}

        {obligQ.isLoading && (
          <View style={styles.loadingBox}>
            <Text style={styles.loadingText}>Memuat tanggungan…</Text>
          </View>
        )}

        {!obligQ.isLoading && !obligQ.isError && obligations.length === 0 && (
          <View style={styles.emptyBox}>
            <BrandIcon name="empty-tidak-ada-tagihan" size={64} label="" />
            <Text style={styles.emptyText}>
              Belum ada tanggungan tercatat. Tap + untuk menambahkan tagihan atau cicilan baru.
            </Text>
          </View>
        )}

        {/* Section: Mendatang */}
        {(activeTab === 'upcoming' || activeTab === 'all') && upcomingList.length > 0 && (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionHeaderTitle}>Mendatang</Text>
            <View style={styles.cardsWrapper}>
              {upcomingList.map((item) => {
                const dateBadge = parseDateBadge(item.due_date);
                const days = daysBetween(todayISO, item.due_date);
                const remaining = item.remaining_amount ?? (item.total_amount - paidAmount(item.total_amount, item.remaining_amount));

                return (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      router.push({ pathname: '/loan-detail', params: { id: item.id } })
                    }
                    style={styles.itemCard}
                  >
                    {/* Date Badge */}
                    <View style={styles.dateBadge}>
                      <Text style={styles.dateBadgeDay}>{dateBadge.day}</Text>
                      <Text style={styles.dateBadgeMonth}>{dateBadge.month}</Text>
                    </View>

                    {/* Squircle Category Icon */}
                    <View style={styles.iconSquircle}>
                      <BrandIcon
                        name={categoryIconName({
                          name: item.title,
                          type: 'EXPENSE',
                        })}
                        size={20}
                        label=""
                      />
                    </View>

                    {/* Content */}
                    <View style={styles.itemCenter}>
                      <Text style={styles.itemTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.itemSubtitle}>
                        {item.type === 'LOAN'
                          ? 'Pinjaman'
                          : item.type === 'INSTALLMENT'
                          ? 'Cicilan'
                          : item.type === 'REIMBURSEMENT'
                          ? 'Reimburse'
                          : 'Tagihan'}
                      </Text>
                      {days !== null && (
                        <Text style={styles.countdownText}>
                          {days > 0
                            ? `${days} hari lagi`
                            : days === 0
                            ? 'Hari ini'
                            : `Lewat ${Math.abs(days)} hari`}
                        </Text>
                      )}
                    </View>

                    {/* Amount */}
                    <View style={styles.itemRight}>
                      <Text style={styles.itemAmount}>{formatRupiah(remaining)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* Section: Terbayar */}
        {(activeTab === 'paid' || activeTab === 'all') && paidList.length > 0 && (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionHeaderTitle}>Terbayar</Text>
            <View style={styles.cardsWrapper}>
              {paidList.map((item) => {
                const dateBadge = parseDateBadge(item.due_date);

                return (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      router.push({ pathname: '/loan-detail', params: { id: item.id } })
                    }
                    style={styles.itemCard}
                  >
                    {/* Date Badge */}
                    <View style={styles.dateBadge}>
                      <Text style={styles.dateBadgeDay}>{dateBadge.day}</Text>
                      <Text style={styles.dateBadgeMonth}>{dateBadge.month}</Text>
                    </View>

                    {/* Squircle Category Icon */}
                    <View style={styles.iconSquircle}>
                      <BrandIcon
                        name={categoryIconName({
                          name: item.title,
                          type: 'EXPENSE',
                        })}
                        size={20}
                        label=""
                      />
                    </View>

                    {/* Content */}
                    <View style={styles.itemCenter}>
                      <Text style={styles.itemTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.itemSubtitle}>
                        {item.type === 'LOAN'
                          ? 'Pinjaman'
                          : item.type === 'INSTALLMENT'
                          ? 'Cicilan'
                          : 'Tagihan'}
                      </Text>
                    </View>

                    {/* Amount + Checkmark */}
                    <View style={styles.itemRightRow}>
                      <Text style={styles.itemAmountMuted}>
                        {formatRupiah(item.total_amount)}
                      </Text>
                      <CheckCircle2 size={18} color={Colors.accentStrong} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Obligation Form Sheet (matches 09_tambah_tanggungan.png) */}
      <ObligationFormSheet
        visible={showForm}
        onClose={() => setShowForm(false)}
        householdId={householdId}
      />

      {/* Cycle Picker Modal */}
      <Modal
        visible={cyclePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCyclePickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setCyclePickerOpen(false)}
        >
          <Pressable style={styles.cycleSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Pilih Siklus</Text>
              <Pressable onPress={() => setCyclePickerOpen(false)} hitSlop={10}>
                <X size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 300 }}>
              {(cyclesQ.data ?? []).map((c) => {
                const isSelected = c.id === activeCycle?.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      setSelectedCycleId(c.id);
                      setCyclePickerOpen(false);
                    }}
                    style={[styles.cycleOption, isSelected && styles.cycleOptionActive]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.cycleOptionName,
                          isSelected && styles.cycleOptionNameActive,
                        ]}
                      >
                        {c.name} {c.is_active ? '· Aktif' : ''}
                      </Text>
                      <Text style={styles.cycleOptionDates}>
                        {shortDateLabel(c.start_date)} – {shortDateLabel(c.end_date)}
                      </Text>
                    </View>
                    {isSelected && <ChevronRight size={16} color={Colors.info} />}
                  </Pressable>
                );
              })}
            </ScrollView>
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
  addRoundBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Cycle Pill Selector */
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

  /* 3-Pill Filter Tabs */
  filterTabs: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterTabActive: {
    backgroundColor: '#0B1527',
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  filterTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  /* Summary Card */
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  summaryAmount: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0B1527',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
    marginTop: 2,
  },
  summarySub: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  calendarIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Section Block */
  sectionBlock: {
    gap: 8,
  },
  sectionHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0B1527',
    letterSpacing: -0.3,
  },
  cardsWrapper: {
    gap: 10,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  dateBadge: {
    width: 38,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBadgeDay: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0B1527',
    lineHeight: 16,
  },
  dateBadgeMonth: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#64748B',
  },
  iconSquircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCenter: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0B1527',
  },
  itemSubtitle: {
    fontSize: 12,
    color: '#64748B',
  },
  countdownText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#EF4444',
  },
  itemRight: {
    alignItems: 'flex-end',
  },
  itemAmount: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0B1527',
    fontVariant: ['tabular-nums'],
  },
  itemRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemAmountMuted: {
    fontSize: 14.5,
    fontWeight: '600',
    color: '#94A3B8',
    fontVariant: ['tabular-nums'],
  },

  /* Empty & Loading */
  loadingBox: {
    padding: 24,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  emptyBox: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  emptyText: {
    fontSize: 12.5,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  /* Modal */
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
  sheetHandle: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.borderStrong,
    alignSelf: 'center',
    marginBottom: 4,
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
  cycleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  cycleOptionActive: {
    backgroundColor: '#F8FAFC',
  },
  cycleOptionName: {
    fontSize: 13.5,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  cycleOptionNameActive: {
    color: Colors.info,
    fontWeight: '700',
  },
  cycleOptionDates: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
});
