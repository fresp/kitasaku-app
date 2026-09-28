import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import ArrowLeftRight from 'lucide-react-native/icons/arrow-left-right';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useAccounts, useActiveCycle, useCreateTransfer } from '../lib/queries';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

function parseAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

export default function TransferScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const accountsQ = useAccounts(householdId);
  const createTransfer = useCreateTransfer();

  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const [name, setName] = useState('Relokasi antar akun');
  const [amountText, setAmountText] = useState('');
  const [fromAccountId, setFromAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [auditMode, setAuditMode] = useState(false);

  const selectedFrom = fromAccountId ?? accounts[0]?.id ?? null;
  const selectedTo = toAccountId ?? accounts.find((a) => a.id !== selectedFrom)?.id ?? null;
  const amount = parseAmount(amountText);
  const canSubmit = !!householdId && (auditMode || !!cycleQ.data?.id) && !!selectedFrom && !!selectedTo && selectedFrom !== selectedTo && amount > 0;

  async function submit() {
    setErr(null);
    if (!householdId) { setErr('Login dulu untuk mencatat relokasi.'); return; }
    if (!auditMode && !cycleQ.data?.id) { setErr('Belum ada siklus aktif. Aktifkan mode audit untuk mencatat relokasi historis.'); return; }
    if (!name.trim() || name.trim().length < 3) { setErr('Nama relokasi minimal 3 huruf.'); return; }
    if (amount <= 0) { setErr('Nominal relokasi harus lebih dari Rp 0.'); return; }
    if (!selectedFrom || !selectedTo) { setErr('Pilih akun asal dan tujuan.'); return; }
    if (selectedFrom === selectedTo) { setErr('Akun asal dan tujuan harus berbeda.'); return; }

    try {
      await createTransfer.mutateAsync({
        householdId,
        cycleId: auditMode ? null : cycleQ.data!.id,
        name: name.trim(),
        amount,
        fromAccountId: selectedFrom,
        toAccountId: selectedTo,
      });
      router.back();
    } catch (e: any) {
      setErr(e?.message ?? 'Relokasi belum tersimpan.');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Kembali">
            <ArrowLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>PERGERAKAN INTERNAL</Text>
            <Text style={styles.title}>Relokasi Antar Akun</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <ArrowLeftRight size={20} color={Colors.textSecondary} />
          <Text style={styles.infoText}>
            Relokasi hanya memindahkan uang antar akun keluarga. Ini bukan income, bukan pengeluaran, dan tidak menambah total alokasi rumah tangga.
          </Text>
        </View>
        <Pressable
          onPress={() => setAuditMode((value) => !value)}
          style={[styles.auditToggle, auditMode && styles.auditToggleActive]}
        >
          <Text style={[styles.auditTitle, auditMode && styles.auditTitleActive]}>Relokasi audit non-siklus</Text>
          <Text style={styles.muted}>Gunakan untuk mencatat perpindahan historis tanpa membebani siklus aktif.</Text>
        </Pressable>
        {auditMode && <Text style={styles.auditNotice}>Mode audit aktif · cycle_id akan kosong.</Text>}

        {accountsQ.isError && <QueryError onRetry={() => accountsQ.refetch()} retrying={accountsQ.isFetching} message="Daftar akun belum bisa dibaca. Relokasi belum dapat dicatat." />}

        {accountsQ.isError && <QueryError onRetry={() => accountsQ.refetch()} retrying={accountsQ.isFetching} message="Daftar akun belum bisa dibaca. Relokasi belum dapat dicatat." />}
        {cycleQ.isError && <QueryError onRetry={() => cycleQ.refetch()} retrying={cycleQ.isFetching} message="Siklus aktif belum bisa dibaca." />}

        {!cycleQ.isLoading && !cycleQ.data && <Text style={styles.warning}>Belum ada siklus aktif. Relokasi saat ini harus menunggu siklus dibuka.</Text>}

        <View style={styles.card}>
          <Text style={styles.label}>NAMA RELOKASI</Text>
          <TextInput value={name} onChangeText={setName} placeholder="mis. Pindah dana ke e-wallet" placeholderTextColor={Colors.textMuted} style={styles.input} />

          <Text style={styles.label}>NOMINAL</Text>
          <TextInput value={amountText} onChangeText={setAmountText} placeholder="mis. 500000" placeholderTextColor={Colors.textMuted} keyboardType="number-pad" style={styles.amountInput} />
          <Text style={styles.amountHint}>{formatRupiah(amount)}</Text>

          <Text style={styles.label}>AKUN ASAL</Text>
          <View style={styles.chips}>
            {accounts.map((account) => {
              const active = account.id === selectedFrom;
              return <Pressable key={account.id} onPress={() => setFromAccountId(account.id)} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{account.name}</Text></Pressable>;
            })}
          </View>

          <Text style={styles.label}>AKUN TUJUAN</Text>
          <View style={styles.chips}>
            {accounts.map((account) => {
              const active = account.id === selectedTo;
              const disabled = account.id === selectedFrom;
              return <Pressable key={account.id} disabled={disabled} onPress={() => setToAccountId(account.id)} style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{account.name}</Text></Pressable>;
            })}
          </View>
          {accounts.length < 2 && <Text style={styles.muted}>Tambahkan minimal dua akun aktif untuk membuat relokasi.</Text>}
        </View>

        {err && <Text style={styles.error}>{err}</Text>}
        <PrimaryButton label={createTransfer.isPending ? 'Menyimpan…' : 'Simpan Relokasi'} onPress={canSubmit && !createTransfer.isPending ? submit : undefined} />
        <SecondaryButton label="Batal" onPress={() => router.back()} />
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
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13, backgroundColor: Colors.subtle, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  infoText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 19 },
  card: { gap: 8, padding: 15, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  label: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.7, marginTop: 5 },
  input: { height: 44, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, paddingHorizontal: 12, color: Colors.textPrimary, backgroundColor: Colors.canvas, fontSize: FontSize.body },
  amountInput: { color: Colors.textPrimary, fontSize: 28, fontWeight: '700', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: Colors.borderStrong },
  amountHint: { color: Colors.textSecondary, fontSize: FontSize.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: Colors.subtle },
  chipActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipDisabled: { opacity: 0.35 },
  chipText: { color: Colors.textSecondary, fontSize: FontSize.body, fontWeight: '600' },
  chipTextActive: { color: Colors.white },
  muted: { color: Colors.textMuted, fontSize: FontSize.caption },
  warning: { color: Colors.alertText, backgroundColor: Colors.alertBg, borderRadius: Radius.md, padding: 12, fontSize: FontSize.body },
  error: { color: Colors.pendingText, backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12, fontSize: FontSize.body },
  auditToggle: { gap: 4, padding: 12, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle },
  auditToggleActive: { backgroundColor: Colors.paidBg, borderColor: Colors.paidText },
  auditTitle: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },
  auditTitleActive: { color: Colors.paidText },
  auditNotice: { color: Colors.paidText, backgroundColor: Colors.paidBg, borderRadius: Radius.md, padding: 10, fontSize: FontSize.caption },
});
