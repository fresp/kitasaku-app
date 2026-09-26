import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useActiveCycle, useCategories, useTransactions } from '../lib/queries';
import { Badge } from '../components/ui/Badge';
import { SecondaryButton } from '../components/ui/Button';

export default function CategoryDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const catsQ = useCategories(householdId);
  const txnsQ = useTransactions(householdId, cycleQ.data?.id);

  const cat = useMemo(() => (catsQ.data ?? []).find((c) => c.id === id), [catsQ.data, id]);
  const items = useMemo(
    () => (txnsQ.data ?? []).filter((t) => t.category_id === id && t.direction === 'EXPENSE'),
    [txnsQ.data, id]
  );
  const spent = items.filter((t) => t.status === 'PAID').reduce((s, t) => s + t.actual_amount, 0);
  const budget = cat?.monthly_budget ?? 0;
  const over = spent - budget;
  const ratio = budget > 0 ? spent / budget : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>DETAIL KATEGORI • {cycleQ.data?.name ?? ''}</Text>
        <Text style={styles.title}>{cat?.name ?? 'Kategori'}</Text>

        <View style={styles.hero}>
          <Badge
            label={over > 0 ? `MELEBIHI RENCANA (+${formatRupiah(over)})` : 'ANGGARAN AMAN'}
            tone={over > 0 ? 'pending' : 'paid'}
          />
          <Text style={styles.spent}>
            {formatRupiah(spent)} <Text style={styles.budget}>dari {formatRupiah(budget)}</Text>
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, Math.max(Math.round(ratio * 100), 2))}%` as any, backgroundColor: over > 0 ? '#DC2626' : '#059669' }]} />
          </View>
          <Text style={styles.muted}>{items.length} transaksi tercatat</Text>
        </View>

        <Text style={styles.label}>DAFTAR BELANJA KATEGORI INI</Text>
        {items.map((t) => (
          <View key={t.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{t.name}</Text>
              <Text style={styles.muted}>
                {t.release_date ?? 'Belum bayar'} • {(t as any).accounts?.name ?? '—'}
              </Text>
            </View>
            <Text style={styles.amount}>
              {formatRupiah(t.status === 'PAID' ? t.actual_amount : t.planned_amount)}
            </Text>
            <Badge label={t.status === 'PAID' ? '✓ Paid' : 'Pending'} tone={t.status === 'PAID' ? 'paid' : 'pending'} />
          </View>
        ))}
        {items.length === 0 && <Text style={styles.muted}>Belum ada transaksi di kategori ini.</Text>}

        {over > 0 && (
          <View style={styles.advice}>
            <Text style={styles.adviceText}>
              Pengeluaran kategori ini melampaui rencana. Pertimbangkan menyesuaikan pagu bulan depan
              atau menggeser sisa kas dari kategori yang masih surplus.
            </Text>
          </View>
        )}

        <SecondaryButton label="Kembali" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 0.6 },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '700' },
  hero: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 16, gap: 8 },
  spent: { color: Colors.textPrimary, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  budget: { color: Colors.textMuted, fontSize: 15, fontWeight: '500' },
  track: { height: 8, borderRadius: 4, backgroundColor: Colors.subtle, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  row: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: Colors.textPrimary, fontSize: 15, fontWeight: '500' },
  amount: { fontSize: FontSize.currencyLarge, fontWeight: '600', fontVariant: ['tabular-nums'], color: Colors.textPrimary },
  advice: { backgroundColor: Colors.alertBg, borderRadius: Radius.md, padding: 12 },
  adviceText: { color: Colors.alertText, fontSize: FontSize.body },
});
