import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah, formatRupiahShort } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useActiveCycle, useCategories, useTransactionLedger } from '../lib/queries';
import { budgetFillPct, budgetHealthStatus } from '../lib/zero-based';
import type { BudgetHealthStatus } from '../lib/zero-based';
import { Badge } from '../components/ui/Badge';
import { BudgetRing } from '../components/ui/BudgetRing';

/**
 * Screen 5 — Budget Health.
 *
 * Reached from Tanggungan ("Kewajiban & Reimburse") rather than from the bottom
 * nav: the design's nav is Home / Tanggungan / Riwayat / My Profile, and the
 * budget verdict belongs next to the obligations that consume it, not as a
 * fourth destination competing with the ledger.
 *
 * Reads in `actual` mode: this screen judges what has been spent against the
 * pagu, so a PENDING row must not count as money already gone. The verdict for
 * each category comes from `budgetHealthStatus`, which is the same function
 * Detail Kategori uses — one rule, not two that can drift.
 */

const FILL_COLORS: Record<BudgetHealthStatus, string> = {
  OVER: Colors.pendingBorder,
  WATCH: Colors.alertText,
  SAFE: Colors.paidText,
  NO_BUDGET: Colors.chartAxis,
};

export default function BudgetHealthScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const cycleId = cycleQ.data?.id;
  const catsQ = useCategories(householdId);
  const ledgerQ = useTransactionLedger(householdId, cycleId, 'actual');

  const rows = useMemo(() => {
    const cats = (catsQ.data ?? []).filter((c) => c.type === 'EXPENSE');
    const txns = ledgerQ.data ?? [];
    const byCat = new Map<string, number>();
    for (const t of txns) {
      if (t.direction !== 'EXPENSE' || t.status !== 'PAID' || !t.category_id) continue;
      byCat.set(t.category_id, (byCat.get(t.category_id) ?? 0) + t.actual_amount);
    }
    return cats.map((c) => {
      const spent = byCat.get(c.id) ?? 0;
      const budget = c.monthly_budget ?? 0;
      const health = budgetHealthStatus(spent, budget);
      return {
        id: c.id,
        name: c.name,
        spent,
        budget,
        health,
        fill: FILL_COLORS[health.status],
        widthPct: budgetFillPct(health),
      };
    });
  }, [catsQ.data, ledgerQ.data]);

  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const pct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const overallColor = pct > 100 ? Colors.pendingBorder : pct > 80 ? Colors.alertText : Colors.paidText;

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
              void catsQ.refetch();
              void ledgerQ.refetch();
            }}
          />
        }
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <Text style={styles.crumb}>Tanggungan / Budget Health</Text>
        </View>

        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>RINGKASAN ANGGARAN</Text>
            <Text style={styles.title}>Budget Health</Text>
          </View>
          <Pressable onPress={() => router.push('/kelola-kategori')} style={styles.manageBtn}>
            <SlidersHorizontal size={13} color={Colors.textPrimary} />
            <Text style={styles.manageText}>Kelola</Text>
          </Pressable>
        </View>

        <View style={styles.health}>
          <BudgetRing pct={pct} color={overallColor} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.healthCycle}>
              {cycleQ.data?.name ?? 'Belum ada siklus aktif'}
            </Text>
            <Text style={styles.healthNums}>
              {formatRupiahShort(totalSpent)} / {formatRupiahShort(totalBudget)}
            </Text>
            <Text style={styles.healthSub}>Rencana vs realisasi bulan berjalan</Text>
          </View>
        </View>

        {!householdId && (
          <Text style={styles.muted}>Mode offline — login untuk budget live.</Text>
        )}

        {catsQ.isLoading && <Text style={styles.muted}>Memuat kategori…</Text>}

        {rows.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => router.push({ pathname: '/category-detail', params: { id: c.id } })}
            style={styles.card}
          >
            <View style={styles.head}>
              <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
              <Badge label={c.health.label} tone={c.health.tone} />
            </View>
            <Text style={styles.nums}>
              {formatRupiah(c.spent)} / {c.budget > 0 ? formatRupiah(c.budget) : 'Tanpa pagu'}
            </Text>
            <View style={styles.track}>
              <View
                style={[styles.fill, { width: `${c.widthPct}%` as any, backgroundColor: c.fill }]}
              />
            </View>
          </Pressable>
        ))}

        {!catsQ.isLoading && rows.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.muted}>
              Belum ada kategori pengeluaran. Buat ruang keluarga untuk seed otomatis,
              atau tambahkan sendiri di Kelola Kategori.
            </Text>
            <Pressable onPress={() => router.push('/kelola-kategori')}>
              <Text style={styles.emptyLink}>Kelola kategori →</Text>
            </Pressable>
          </View>
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
    width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  crumb: { color: Colors.textSecondary, fontSize: FontSize.caption },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700' },
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle,
    borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 8,
  },
  manageText: { color: Colors.textPrimary, fontSize: 12, fontWeight: '600' },
  health: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 16,
  },
  healthCycle: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '600' },
  healthNums: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '600', fontVariant: ['tabular-nums'] },
  healthSub: { color: Colors.textSecondary, fontSize: FontSize.caption },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14, gap: 6,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '600', flex: 1 },
  nums: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, backgroundColor: Colors.subtle, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  emptyBox: { gap: 8, paddingVertical: 12 },
  emptyLink: { color: Colors.textPrimary, fontWeight: '600' },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
});
