import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Plus from 'lucide-react-native/icons/plus';
import { Colors, FontSize, Radius } from '../constants/theme';
import { useAuth } from '../lib/auth-context';
import { useSpecialBudgetFigures, useSpecialBudgets } from '../lib/queries';
import { localISODate, specialBudgetStatus } from '../lib/special-budget';
import { QueryError } from '../components/ui/QueryError';
import { SpecialBudgetRow } from '../components/special-budget/SpecialBudgetRow';

/** Every Anggaran Khusus of the household: open ones first, then the archive. */
export default function SpecialBudgetsScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const budgetsQ = useSpecialBudgets(householdId);
  const figuresQ = useSpecialBudgetFigures(householdId);
  const today = localISODate(new Date());

  const { open, closed } = useMemo(() => {
    const all = budgetsQ.data ?? [];
    return {
      open: all
        .filter((b) => specialBudgetStatus(b, today) !== 'CLOSED')
        .sort((a, b) => a.end_date.localeCompare(b.end_date)),
      closed: all.filter((b) => specialBudgetStatus(b, today) === 'CLOSED'),
    };
  }, [budgetsQ.data, today]);

  const failed = budgetsQ.isError || figuresQ.isError;
  const figures = figuresQ.data ?? {};
  const open_ = (id: string) => router.push({ pathname: '/special-budget', params: { id } });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={budgetsQ.isFetching || figuresQ.isFetching}
            onRefresh={() => {
              void budgetsQ.refetch();
              void figuresQ.refetch();
            }}
          />
        }
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Kembali">
            <ArrowLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Anggaran Khusus</Text>
        </View>

        <Text style={styles.lead}>
          Untuk belanja di luar rutin yang ada tanggalnya: Lebaran, liburan, renovasi. Uangnya tetap
          di rekening asal, hanya dicatat terpisah dari siklus.
        </Text>

        <Pressable
          onPress={() => router.push('/special-budget-new')}
          style={styles.newBtn}
          accessibilityRole="button"
        >
          <Plus size={16} color={Colors.white} />
          <Text style={styles.newBtnText}>Buka anggaran khusus</Text>
        </Pressable>

        {failed && (
          <QueryError
            onRetry={() => {
              void budgetsQ.refetch();
              void figuresQ.refetch();
            }}
            retrying={budgetsQ.isFetching || figuresQ.isFetching}
          />
        )}

        {!failed && budgetsQ.isLoading && <Text style={styles.muted}>Memuat anggaran khusus…</Text>}

        {!failed && !budgetsQ.isLoading && open.length === 0 && closed.length === 0 && (
          <Text style={styles.muted}>Belum ada anggaran khusus.</Text>
        )}

        {!failed && open.length > 0 && (
          <View style={styles.card}>
            {open.map((b, i) => (
              <SpecialBudgetRow
                key={b.id}
                budget={b}
                figures={figures[b.id]}
                todayISO={today}
                onPress={() => open_(b.id)}
                isLast={i === open.length - 1}
              />
            ))}
          </View>
        )}

        {!failed && closed.length > 0 && (
          <>
            <Text style={styles.section}>Sudah ditutup</Text>
            <View style={styles.card}>
              {closed.map((b, i) => (
                <SpecialBudgetRow
                  key={b.id}
                  budget={b}
                  figures={figures[b.id]}
                  todayISO={today}
                  onPress={() => open_(b.id)}
                  isLast={i === closed.length - 1}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '700' },
  lead: { color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 19 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 48, borderRadius: Radius.md, backgroundColor: Colors.brandPrimary,
  },
  newBtnText: { color: Colors.white, fontSize: 15, fontWeight: '600' },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.borderSubtle, paddingHorizontal: 14,
  },
  section: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 8 },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
});
