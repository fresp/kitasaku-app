import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Wallet from 'lucide-react-native/icons/wallet';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useAccounts, useAccountZeroBasedSummary, useActiveCycle } from '../lib/queries';
import { QueryError } from '../components/ui/QueryError';

export default function AccountSummaryScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const accountsQ = useAccounts(householdId);
  const accounts = useMemo(() => (accountsQ.data ?? []).filter((a) => a.is_active !== false), [accountsQ.data]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const selected = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;
  const summaryQ = useAccountZeroBasedSummary(householdId, cycleQ.data?.id, selected?.id, 'planned');
  const summary = summaryQ.data;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}><Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Kembali"><ArrowLeft size={18} color={Colors.textPrimary} /></Pressable><View><Text style={styles.eyebrow}>ZERO-BASED · PER AKUN</Text><Text style={styles.title}>Ringkasan Akun</Text></View></View>
        <View style={styles.notice}><Wallet size={18} color={Colors.textSecondary} /><Text style={styles.noticeText}>Setiap akun dihitung mandiri. Relokasi masuk sebagai keluar di akun asal dan masuk di akun tujuan, tanpa menambah sumber dana rumah tangga.</Text></View>
        {!cycleQ.data && <Text style={styles.warning}>Belum ada siklus aktif. Ringkasan akun akan muncul setelah siklus dibuka.</Text>}
        <Text style={styles.label}>PILIH AKUN</Text>
        <View style={styles.chips}>{accounts.map((account) => <Pressable key={account.id} onPress={() => setAccountId(account.id)} style={[styles.chip, selected?.id === account.id && styles.chipActive]}><Text style={[styles.chipText, selected?.id === account.id && styles.chipTextActive]}>{account.name}</Text><Text style={[styles.typeText, selected?.id === account.id && styles.chipTextActive]}>{account.type}</Text></Pressable>)}</View>
        {summaryQ.isError && <QueryError onRetry={() => summaryQ.refetch()} retrying={summaryQ.isFetching} message="Ringkasan akun belum bisa dibaca." />}
        {summary && selected && <>
          <View style={[styles.hero, summary.status === 'FUNDING_GAP' && styles.heroGap]}><Text style={styles.heroLabel}>{selected.name} · {cycleQ.data?.name}</Text><Text style={styles.heroValue}>{formatRupiah(summary.netCashflow)}</Text><Text style={styles.heroSub}>{summary.status === 'FUNDING_GAP' ? 'Akun mengalami funding gap' : summary.status === 'UNALLOCATED' ? 'Dana belum memiliki tujuan' : 'Pergerakan akun seimbang'}</Text></View>
          <View style={styles.card}><Text style={styles.cardTitle}>Dana masuk</Text><Row label="Income operasional" value={summary.incoming.operatingIncome} positive /><Row label="Pemasukan pendanaan" value={summary.incoming.financingInflow} positive /><Row label="Pelepasan aset" value={summary.incoming.assetRelease} positive /><Row label="Relokasi masuk" value={summary.incoming.transferIn} positive total /></View>
          <View style={styles.card}><Text style={styles.cardTitle}>Dana keluar</Text><Row label="Pengeluaran" value={summary.outgoing.expense} /><Row label="Pembayaran kewajiban" value={summary.outgoing.debtPayment} /><Row label="Alokasi aset" value={summary.outgoing.assetAllocation} /><Row label="Relokasi keluar" value={summary.outgoing.transferOut} total /></View>
        </>}
        {!accounts.length && !accountsQ.isLoading && <Text style={styles.empty}>Belum ada akun aktif.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, positive, total }: { label: string; value: number; positive?: boolean; total?: boolean }) {
  return <View style={[styles.row, total && styles.totalRow]}><Text style={styles.rowLabel}>{label}</Text><Text style={[styles.rowValue, positive && styles.positive]}>{positive ? '+' : '−'}{formatRupiah(value)}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 36, height: 36, borderRadius: Radius.pill, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.borderSubtle },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 23, fontWeight: '700', marginTop: 2 },
  notice: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', padding: 12, backgroundColor: Colors.subtle, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  noticeText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 18 },
  label: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexGrow: 1, minWidth: '44%', padding: 11, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },
  typeText: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 2 },
  chipTextActive: { color: Colors.white },
  hero: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.lg, padding: 16, gap: 4 },
  heroGap: { backgroundColor: Colors.pendingText },
  heroLabel: { color: '#CBD5E1', fontSize: FontSize.caption },
  heroValue: { color: Colors.white, fontSize: 28, fontWeight: '700' },
  heroSub: { color: '#CBD5E1', fontSize: FontSize.body },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 14, gap: 8 },
  cardTitle: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  totalRow: { borderTopWidth: 1, borderTopColor: Colors.borderSubtle, paddingTop: 10, marginTop: 2 },
  rowLabel: { color: Colors.textSecondary, fontSize: FontSize.body },
  rowValue: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },
  positive: { color: Colors.paidText },
  warning: { color: Colors.alertText, backgroundColor: Colors.alertBg, borderRadius: Radius.md, padding: 11, fontSize: FontSize.body },
  empty: { color: Colors.textMuted, textAlign: 'center', paddingVertical: 20 },
});
