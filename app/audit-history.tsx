import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Plus from 'lucide-react-native/icons/plus';
import Search from 'lucide-react-native/icons/search';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useNonCycleTransactions } from '../lib/queries';
import { categoryIconName } from '../lib/category-icon';
import { BrandIcon } from '../components/ui/BrandIcon';
import { QueryError } from '../components/ui/QueryError';

export default function AuditHistoryScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const query = useNonCycleTransactions(householdId);
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data ?? []).filter((row) => !q || `${row.name} ${row.categories?.name ?? ''} ${row.accounts?.name ?? ''}`.toLowerCase().includes(q));
  }, [query.data, search]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} />}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Kembali"><ArrowLeft size={18} color={Colors.textPrimary} /></Pressable>
          <View style={{ flex: 1 }}><Text style={styles.eyebrow}>AUDIT · NON-SIKLUS</Text><Text style={styles.title}>Riwayat Audit</Text></View>
          <Pressable onPress={() => router.push({ pathname: '/quick-add', params: { scope: 'audit' } })} style={styles.add}><Plus size={15} color={Colors.white} /><Text style={styles.addText}>Catat</Text></Pressable>
        </View>
        <View style={styles.notice}><Text style={styles.noticeText}>Transaksi di sini tetap tersimpan untuk audit, tetapi tidak membebani saldo atau alokasi siklus mana pun.</Text></View>
        <View style={styles.search}><Search size={16} color={Colors.textMuted} /><TextInput value={search} onChangeText={setSearch} placeholder="Cari transaksi audit..." placeholderTextColor={Colors.textMuted} style={styles.searchInput} /></View>
        {query.isError && <QueryError onRetry={() => query.refetch()} retrying={query.isFetching} message="Riwayat audit belum bisa dibaca." />}
        {query.isLoading && <Text style={styles.muted}>Memuat transaksi audit…</Text>}
        {!query.isLoading && !query.isError && rows.length === 0 && <Text style={styles.empty}>{query.data?.length ? 'Tidak ada transaksi yang cocok.' : 'Belum ada transaksi di luar siklus.'}</Text>}
        {rows.map((row) => {
          const income = row.direction === 'INCOME';
          return <View key={row.id} style={styles.row}>
            <View style={[styles.icon, { backgroundColor: income ? Colors.paidBg : Colors.subtle }]}><BrandIcon name={categoryIconName({ name: row.categories?.name ?? row.name, type: income ? 'INCOME' : 'EXPENSE', icon: row.categories?.icon })} size={18} label="" /></View>
            <View style={styles.middle}><Text style={styles.rowTitle} numberOfLines={1}>{row.name}</Text><Text style={styles.rowSub} numberOfLines={1}>{row.release_date ?? row.created_at.slice(0, 10)} · {row.accounts?.name ?? 'Tanpa akun'}{row.categories?.name ? ` · ${row.categories.name}` : ''}</Text></View>
            <Text style={[styles.amount, { color: income ? Colors.paidText : Colors.textPrimary }]}>{income ? '+' : '−'}{formatRupiah(row.actual_amount)}</Text>
          </View>;
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 36, height: 36, borderRadius: Radius.pill, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.borderSubtle },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 23, fontWeight: '700', marginTop: 2 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.brandPrimary, borderRadius: Radius.pill, paddingHorizontal: 11, paddingVertical: 8 },
  addText: { color: Colors.white, fontSize: FontSize.caption, fontWeight: '700' },
  notice: { backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.borderSubtle },
  noticeText: { color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 19 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, paddingHorizontal: 12 },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.body },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, padding: 12 },
  icon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, gap: 2 },
  rowTitle: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600' },
  rowSub: { color: Colors.textMuted, fontSize: FontSize.caption },
  amount: { fontSize: FontSize.body, fontWeight: '700' },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  empty: { color: Colors.textMuted, fontSize: FontSize.body, textAlign: 'center', paddingVertical: 20 },
});
