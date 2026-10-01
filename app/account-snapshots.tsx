import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useAccounts, useActiveCycle, useCycleAccountSnapshots, useRecordCycleAccountSnapshot } from '../lib/queries';
import { isZeroBasedCashAccount } from '../lib/account';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

function parseAmount(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) ? amount : null;
}

export default function AccountSnapshotsScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const accountsQ = useAccounts(householdId);
  const snapshotsQ = useCycleAccountSnapshots(householdId, cycleQ.data?.id);
  const saveSnapshot = useRecordCycleAccountSnapshot();
  const accounts = useMemo(
    () => (accountsQ.data ?? []).filter((account) => account.is_active !== false && isZeroBasedCashAccount(account)),
    [accountsQ.data]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0] ?? null;
  const saved = snapshotsQ.data?.find((snapshot) => snapshot.account_id === selected?.id);
  const cycleId = cycleQ.data?.id ?? null;
  const contextKey = `${cycleId ?? ''}:${selected?.id ?? ''}`;
  const [form, setForm] = useState({ contextKey, text: '', editing: false, error: null as string | null });
  const formIsCurrent = form.contextKey === contextKey;
  const text = formIsCurrent ? form.text : '';
  const editing = formIsCurrent && form.editing;
  const error = formIsCurrent ? form.error : null;

  function updateForm(values: Partial<{ text: string; editing: boolean; error: string | null }>) {
    setForm((current) => ({
      contextKey,
      text: values.text !== undefined ? values.text : current.contextKey === contextKey ? current.text : '',
      editing: values.editing !== undefined ? values.editing : current.contextKey === contextKey ? current.editing : false,
      error: Object.prototype.hasOwnProperty.call(values, 'error') ? values.error ?? null : current.contextKey === contextKey ? current.error : null,
    }));
  }

  function selectAccount(accountId: string) {
    setSelectedId(accountId);
    const nextAccount = accounts.find((account) => account.id === accountId);
    setForm({ contextKey: `${cycleId ?? ''}:${nextAccount?.id ?? ''}`, text: '', editing: false, error: null });
  }

  function beginEditing() {
    setForm({ contextKey, text: String(saved?.closing_stated ?? ''), editing: true, error: null });
  }

  const canEdit = !!householdId && !!cycleId && !!selected
    && !cycleQ.isLoading && !cycleQ.isError
    && !accountsQ.isLoading && !accountsQ.isError
    && !snapshotsQ.isLoading && !snapshotsQ.isError;
  const closing = editing ? parseAmount(text) : saved?.closing_stated ?? null;
  const amountError = editing && text.length > 0 && parseAmount(text) === null;
  const canSave = canEdit && editing && closing !== null && !amountError && !saveSnapshot.isPending;

  async function submit() {
    updateForm({ error: null });
    if (!householdId || !cycleId || !selected) {
      updateForm({ error: 'Pilih rekening kas dan pastikan ada siklus aktif.' });
      return;
    }
    if (!canSave || closing === null) {
      updateForm({ error: 'Masukkan saldo akhir yang benar-benar dinyatakan sebagai bilangan bulat yang aman.' });
      return;
    }
    try {
      await saveSnapshot.mutateAsync({ householdId, cycleId, accountId: selected.id, closingStated: closing });
      updateForm({ editing: false, text: '', error: null });
    } catch (e: any) {
      updateForm({ error: e?.message ?? 'Snapshot saldo belum tersimpan.' });
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}><ArrowLeft size={18} color={Colors.textPrimary} /></Pressable>
          <View><Text style={styles.eyebrow}>SALDO YANG DINYATAKAN</Text><Text style={styles.title}>Snapshot Rekening Kas</Text></View>
        </View>
        <Text style={styles.note}>Catat hanya saldo akhir yang terlihat pada bank/e-wallet. Saldo awal siklus berikutnya hanya tersedia bila siklus terdahulu terbaru memiliki snapshot rekening yang sama.</Text>
        {accountsQ.isError && <QueryError onRetry={() => accountsQ.refetch()} retrying={accountsQ.isFetching} message="Daftar rekening belum bisa dibaca." />}
        {cycleQ.isError && <QueryError onRetry={() => cycleQ.refetch()} retrying={cycleQ.isFetching} message="Siklus aktif belum bisa dibaca." />}
        {snapshotsQ.isError && <QueryError onRetry={() => snapshotsQ.refetch()} retrying={snapshotsQ.isFetching} message="Snapshot siklus belum bisa dibaca." />}
        {!cycleQ.data && !cycleQ.isLoading && !cycleQ.isError && <Text style={styles.warning}>Belum ada siklus aktif.</Text>}
        <Text style={styles.label}>REKENING</Text>
        {accountsQ.isLoading ? <Text style={styles.note}>Memuat rekening…</Text> : (
          <View style={styles.chips}>{accounts.map((account) => <Pressable key={account.id} onPress={() => selectAccount(account.id)} disabled={saveSnapshot.isPending} style={[styles.chip, selected?.id === account.id && styles.chipActive]}><Text style={[styles.chipText, selected?.id === account.id && styles.chipTextActive]}>{account.name}</Text><Text style={styles.note}>{account.type}</Text></Pressable>)}</View>
        )}
        {selected && cycleQ.data && <View style={styles.card}>
          <Text style={styles.label}>{selected.name} · {cycleQ.data.name}</Text>
          {snapshotsQ.isLoading ? <Text style={styles.note}>Memuat snapshot…</Text> : snapshotsQ.isError ? null : saved && !editing ? <>
            <Text style={styles.value}>{formatRupiah(saved.closing_stated)}</Text>
            <Text style={styles.note}>Saldo akhir tersimpan · {new Date(saved.noted_at).toLocaleDateString('id-ID')}</Text>
            <SecondaryButton label="Perbarui saldo yang dinyatakan" onPress={canEdit && !saveSnapshot.isPending ? beginEditing : undefined} />
          </> : <>
            <TextInput value={text} onChangeText={(value) => updateForm({ text: value, editing: true, error: null })} keyboardType="number-pad" placeholder="Masukkan saldo akhir" placeholderTextColor={Colors.textMuted} style={styles.input} editable={canEdit && !saveSnapshot.isPending} />
            <Text style={styles.note}>Tidak ada angka saldo yang akan dibuat otomatis dari transaksi.</Text>
            {amountError && <Text style={styles.error}>Nominal harus berupa bilangan bulat yang aman.</Text>}
            {error && <Text style={styles.error}>{error}</Text>}
            <PrimaryButton label={saveSnapshot.isPending ? 'Menyimpan…' : saved ? 'Simpan perubahan' : 'Simpan snapshot'} onPress={canSave ? submit : undefined} />
          </>}
        </View>}
        {selected && cycleQ.data && snapshotsQ.isError && <Text style={styles.note}>Snapshot belum dapat dipastikan. Muat ulang sebelum mencatat saldo.</Text>}
        {!selected && !accountsQ.isLoading && !accountsQ.isError && <Text style={styles.note}>Belum ada rekening BANK atau e-wallet aktif.</Text>}
        {cycleQ.data && selected && !snapshotsQ.isLoading && !snapshotsQ.isError && snapshotsQ.data?.length === 0 && <Text style={styles.note}>Belum ada snapshot untuk siklus ini.</Text>}
        {cycleQ.data && selected && !snapshotsQ.isLoading && !snapshotsQ.isError && snapshotsQ.data && snapshotsQ.data.length > 0 && !saved && <Text style={styles.note}>Belum ada snapshot tersimpan untuk rekening ini.</Text>}
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
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '700', marginTop: 2 },
  note: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 17 },
  label: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: '44%', padding: 11, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },
  chipTextActive: { color: Colors.white },
  card: { gap: 10, padding: 16, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle },
  value: { color: Colors.textPrimary, fontSize: 28, fontWeight: '700' },
  input: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderStrong },
  warning: { color: Colors.alertText, backgroundColor: Colors.alertBg, borderRadius: Radius.md, padding: 11, fontSize: FontSize.body },
  error: { color: Colors.pendingText, fontSize: FontSize.body },
});
