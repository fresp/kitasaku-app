import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import { useAuth } from '../../lib/auth-context';
import { useActiveCycle, useTransactions } from '../../lib/queries';

export default function RiwayatScreen() {
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const txnsQ = useTransactions(householdId, cycleQ.data?.id);
  const [q, setQ] = useState('');

  const paid = useMemo(() => {
    const all = (txnsQ.data ?? []).filter((t) => t.status === 'PAID');
    const needle = q.trim().toLowerCase();
    return (needle ? all.filter((t) => t.name.toLowerCase().includes(needle)) : all).slice(0, 60);
  }, [txnsQ.data, q]);

  const out = paid.filter((t) => t.direction === 'EXPENSE').reduce((s, t) => s + t.actual_amount, 0);
  const income = paid.filter((t) => t.direction === 'INCOME').reduce((s, t) => s + t.actual_amount, 0);

  const groups = useMemo(() => {
    const map = new Map<string, typeof paid>();
    for (const t of paid) {
      const key = t.release_date ?? 'Tanpa tanggal';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [paid]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Riwayat Transaksi</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Cari transaksi…"
          placeholderTextColor={Colors.textMuted}
          style={styles.search}
        />
        <View style={styles.summary}>
          <View>
            <Text style={styles.sumLabel}>PENGELUARAN</Text>
            <Text style={styles.sumOut}>-{formatRupiah(out)}</Text>
            <Text style={styles.sumMeta}>{paid.filter((t) => t.direction === 'EXPENSE').length} transaksi</Text>
          </View>
          <View style={styles.divider} />
          <View>
            <Text style={styles.sumLabel}>PEMASUKAN</Text>
            <Text style={styles.sumIn}>+{formatRupiah(income)}</Text>
            <Text style={styles.sumMeta}>{paid.filter((t) => t.direction === 'INCOME').length} transaksi</Text>
          </View>
        </View>
        {!householdId && <Text style={styles.muted}>Mode offline — login untuk riwayat live.</Text>}
        {groups.map(([date, items]) => (
          <View key={date} style={{ gap: 8 }}>
            <Text style={styles.group}>{date}</Text>
            {items.map((t) => (
              <View key={t.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{t.name}</Text>
                  <Text style={styles.meta}>
                    {(t as any).categories?.name ?? '—'} • {(t as any).accounts?.name ?? '—'}
                  </Text>
                </View>
                <Text style={[styles.amount, t.direction === 'INCOME' ? styles.income : styles.expense]}>
                  {t.direction === 'INCOME' ? '+' : '-'}{formatRupiah(t.actual_amount)}
                </Text>
              </View>
            ))}
          </View>
        ))}
        {groups.length === 0 && <Text style={styles.muted}>Belum ada transaksi lunas di siklus ini.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 14, paddingBottom: 32 },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '600' },
  search: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, paddingHorizontal: 12, height: 44, fontSize: 15, color: Colors.textPrimary, backgroundColor: Colors.surface },
  summary: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 14, flexDirection: 'row' },
  sumLabel: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '600' },
  sumOut: { color: Colors.textPrimary, fontSize: FontSize.currencyLarge, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 4 },
  sumIn: { color: Colors.paidText, fontSize: FontSize.currencyLarge, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 4 },
  sumMeta: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 2 },
  divider: { width: 1, backgroundColor: Colors.borderSubtle, marginHorizontal: 14 },
  group: { color: Colors.textSecondary, fontSize: FontSize.body, fontWeight: '600' },
  row: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { color: Colors.textPrimary, fontSize: 15, fontWeight: '500' },
  meta: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 2 },
  amount: { fontSize: FontSize.currencyLarge, fontWeight: '600', fontVariant: ['tabular-nums'] },
  income: { color: Colors.paidText },
  expense: { color: Colors.textPrimary },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
});
