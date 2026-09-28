import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Calendar from 'lucide-react-native/icons/calendar';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { longDateFullLabel } from '../lib/obligation';
import { useAccounts, useActiveCycle, useCategories, useTransactionLedger, useUpdateTransaction } from '../lib/queries';
import { useAuth } from '../lib/auth-context';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

function parseAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function TransactionEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const ledgerQ = useTransactionLedger(householdId, cycleQ.data?.id, 'actual');
  const catsQ = useCategories(householdId);
  const accsQ = useAccounts(householdId);
  const update = useUpdateTransaction();

  const txn = useMemo(() => (ledgerQ.data ?? []).find((row) => row.id === id), [ledgerQ.data, id]);
  const [name, setName] = useState<string | null>(null);
  const [amountText, setAmountText] = useState<string | null>(null);
  const [releaseDate, setReleaseDate] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null | undefined>(undefined);
  const [accountId, setAccountId] = useState<string | null | undefined>(undefined);
  const [dateEditing, setDateEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const currentName = name ?? txn?.name ?? '';
  const currentAmount = amountText === null ? (txn?.status === 'PAID' ? txn.actual_amount : txn?.planned_amount ?? 0) : parseAmount(amountText);
  const currentDate = releaseDate ?? txn?.release_date ?? todayISO();
  const currentCategoryId = categoryId === undefined ? txn?.category_id ?? null : categoryId;
  const currentAccountId = accountId === undefined ? txn?.account_id ?? null : accountId;
  const categories = (catsQ.data ?? []).filter((c) => c.type === (txn?.direction === 'INCOME' ? 'INCOME' : 'EXPENSE'));
  const accounts = accsQ.data ?? [];
  const loading = ledgerQ.isLoading || cycleQ.isLoading;
  const failed = ledgerQ.isError || cycleQ.isError;

  async function save() {
    if (!txn) return;
    setErr(null);
    if (currentDate > todayISO()) {
      setErr('Tanggal transaksi tidak boleh di masa depan.');
      return;
    }
    try {
      await update.mutateAsync({
        id: txn.id,
        name: currentName,
        amount: currentAmount,
        releaseDate: currentDate,
        categoryId: currentCategoryId,
        accountId: currentAccountId,
        status: txn.status,
      });
      router.back();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal memperbarui transaksi.');
    }
  }

  if (failed || loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          {failed ? <QueryError onRetry={() => { void ledgerQ.refetch(); void cycleQ.refetch(); }} /> : <Text style={styles.muted}>Memuat transaksi…</Text>}
          <PrimaryButton label="Kembali" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  if (!txn) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><Text style={styles.title}>Transaksi tidak ditemukan</Text><PrimaryButton label="Kembali" onPress={() => router.back()} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.handle} />
        <Text style={styles.eyebrow}>UBAH TRANSAKSI</Text>
        <Text style={styles.title}>{txn.status === 'PAID' ? 'Revisi transaksi' : 'Ubah rencana transaksi'}</Text>
        <Text style={styles.muted}>Status tetap {txn.status === 'PAID' ? 'sudah dieksekusi' : 'belum dieksekusi'} setelah disimpan.</Text>

        <Text style={styles.label}>Nama transaksi</Text>
        <TextInput value={currentName} onChangeText={setName} style={styles.input} placeholder="Nama transaksi" placeholderTextColor={Colors.textMuted} />

        <Text style={styles.label}>Nominal</Text>
        <TextInput value={amountText ?? formatRupiah(currentAmount, { withPrefix: false })} onChangeText={setAmountText} style={styles.input} keyboardType="number-pad" placeholder="Nominal" placeholderTextColor={Colors.textMuted} />

        <Text style={styles.label}>Tanggal transaksi</Text>
        {dateEditing ? (
          <View style={styles.dateEditor}>
            <TextInput value={currentDate} onChangeText={setReleaseDate} onSubmitEditing={() => setDateEditing(false)} autoFocus style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />
            <Text style={styles.muted}>Gunakan format YYYY-MM-DD.</Text>
          </View>
        ) : (
          <Pressable style={styles.dateRow} onPress={() => setDateEditing(true)}>
            <View style={styles.dateLeft}><Calendar size={17} color={Colors.textPrimary} /><Text style={styles.value}>{longDateFullLabel(currentDate) ?? currentDate}</Text></View>
            <Text style={styles.link}>Ubah</Text>
          </Pressable>
        )}

        <Text style={styles.label}>Kategori</Text>
        <View style={styles.chips}>{categories.map((c) => <Pressable key={c.id} onPress={() => setCategoryId(c.id)} style={[styles.chip, currentCategoryId === c.id && styles.chipActive]}><Text style={[styles.chipText, currentCategoryId === c.id && styles.chipTextActive]}>{c.name}</Text></Pressable>)}</View>

        <Text style={styles.label}>{txn.direction === 'INCOME' ? 'Masuk ke akun' : 'Akun'}</Text>
        <View style={styles.chips}>{accounts.map((a) => <Pressable key={a.id} onPress={() => setAccountId(a.id)} style={[styles.chip, currentAccountId === a.id && styles.chipActive]}><Text style={[styles.chipText, currentAccountId === a.id && styles.chipTextActive]}>{a.name}</Text></Pressable>)}</View>

        {err && <Text style={styles.error}>{err}</Text>}
        <View style={styles.ctaRow}><View style={{ flex: 1 }}><SecondaryButton label="Batal" onPress={() => router.back()} /></View><View style={{ flex: 1 }}><PrimaryButton label={update.isPending ? 'Menyimpan…' : 'Simpan perubahan'} onPress={save} /></View></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 20, gap: 10, paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.borderStrong, alignSelf: 'center' },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '700' },
  label: { color: Colors.textSecondary, fontSize: FontSize.body, fontWeight: '600', marginTop: 5 },
  value: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600' },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  input: { backgroundColor: Colors.canvas, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, height: 48, paddingHorizontal: 14, color: Colors.textPrimary, fontSize: 15 },
  dateEditor: { gap: 5 },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, padding: 13 },
  dateLeft: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  link: { color: Colors.textPrimary, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, paddingHorizontal: 13, paddingVertical: 9 },
  chipActive: { backgroundColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: Colors.white },
  error: { color: Colors.pendingText, backgroundColor: Colors.pendingBg, padding: 10, borderRadius: Radius.md },
  ctaRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
});
