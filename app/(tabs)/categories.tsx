import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah, formatRupiahShort } from '../../lib/format';
import { useAuth } from '../../lib/auth-context';
import { useActiveCycle, useCategories, useTransactions } from '../../lib/queries';
import { Badge } from '../../components/ui/Badge';

export default function CategoriesScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const catsQ = useCategories(householdId);
  const txnsQ = useTransactions(householdId, cycleQ.data?.id);

  const rows = useMemo(() => {
    const cats = catsQ.data ?? [];
    const txns = txnsQ.data ?? [];
    const byCat: Record<string, number> = {};
    for (const t of txns) {
      if (t.direction === 'EXPENSE' && t.status === 'PAID' && t.category_id) {
        byCat[t.category_id] = (byCat[t.category_id] ?? 0) + t.actual_amount;
      }
    }
    return cats
      .filter((c) => c.type === 'EXPENSE')
      .map((c) => {
        const spent = byCat[c.id] ?? 0;
        const budget = c.monthly_budget ?? 0;
        const ratio = budget > 0 ? spent / budget : spent > 0 ? 2 : 0;
        const tone = ratio > 1 ? 'pending' : ratio > 0.8 ? 'alert' : 'paid';
        const evalLabel = ratio > 1 ? 'MELEBIHI RENCANA' : ratio > 0.8 ? 'CEK RINCIAN' : 'ANGGARAN AMAN';
        const fill = ratio > 1 ? '#DC2626' : ratio > 0.8 ? '#D97706' : '#059669';
        return { id: c.id, name: c.name, spent, budget, tone, evalLabel, fill, widthPct: Math.min(100, Math.round(ratio * 100)) };
      });
  }, [catsQ.data, txnsQ.data]);

  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const pct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Budget Health</Text>
        <View style={styles.health}>
          <Text style={styles.pct}>{pct}%</Text>
          <Text style={styles.muted}>Terpakai</Text>
          <Text style={styles.nums}>
            {formatRupiahShort(totalSpent)} / {formatRupiahShort(totalBudget)}
          </Text>
          <Text style={styles.muted}>{cycleQ.data?.name ?? 'Siklus'} • Rencana vs realisasi</Text>
        </View>
        {!householdId && <Text style={styles.muted}>Mode offline — login untuk budget live.</Text>}
        {rows.map((c) => (
          <Pressable key={c.id} onPress={() => router.push({ pathname: '/category-detail', params: { id: c.id } })} style={styles.card}>
            <View style={styles.head}>
              <Text style={styles.name}>{c.name}</Text>
              <Badge label={c.evalLabel} tone={c.tone as any} />
            </View>
            <Text style={styles.spent}>
              {formatRupiah(c.spent)} / {formatRupiah(c.budget)}
            </Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.max(c.widthPct, 2)}%` as any, backgroundColor: c.fill }]} />
            </View>
          </Pressable>
        ))}
        {rows.length === 0 && <Text style={styles.muted}>Belum ada kategori. Buat ruang keluarga untuk seed otomatis.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '600' },
  health: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 20, alignItems: 'center', gap: 2 },
  pct: { color: Colors.textPrimary, fontSize: 40, fontWeight: '700', fontVariant: ['tabular-nums'] },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  nums: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600', marginTop: 6 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 14, gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600', flex: 1 },
  spent: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, backgroundColor: Colors.subtle, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
