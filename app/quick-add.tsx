import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useAccounts, useActiveCycle, useCategories, useQuickAdd } from '../lib/queries';
import { PrimaryButton } from '../components/ui/Button';

function parseAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

export default function QuickAddScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const catsQ = useCategories(householdId);
  const accsQ = useAccounts(householdId);
  const quickAdd = useQuickAdd();

  const [kind, setKind] = useState<'out' | 'in'>('out');
  const [name, setName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const categories = useMemo(() => catsQ.data ?? [], [catsQ.data]);
  const accounts = useMemo(() => accsQ.data ?? [], [accsQ.data]);
  const amount = parseAmount(amountText);

  const selectedCategoryId = categoryId ?? categories[0]?.id ?? null;
  const selectedAccountId = accountId ?? accounts[0]?.id ?? null;

  async function save() {
    setErr(null);
    if (!householdId || !cycleQ.data?.id) {
      setErr('Belum ada siklus aktif. Buat siklus dulu lewat "Buka Siklus Baru".');
      return;
    }
    if (name.trim().length < 3) { setErr('Nama transaksi minimal 3 huruf.'); return; }
    if (amount <= 0) { setErr('Nominal harus lebih dari Rp 0.'); return; }
    try {
      await quickAdd.mutateAsync({
        householdId,
        cycleId: cycleQ.data.id,
        name: name.trim(),
        amount,
        direction: kind === 'out' ? 'EXPENSE' : 'INCOME',
        categoryId: selectedCategoryId,
        accountId: selectedAccountId,
        makeRecurring: recurring,
      });
      router.back();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan. Coba lagi.');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.handle} />
        <Text style={styles.title}>Quick Add Transaksi</Text>

        <View style={styles.toggle}>
          <Pressable onPress={() => setKind('out')} style={[styles.toggleOpt, kind === 'out' && styles.toggleActive]}>
            <Text style={[styles.toggleText, kind === 'out' && styles.toggleTextActive]}>Pengeluaran</Text>
          </Pressable>
          <Pressable onPress={() => setKind('in')} style={[styles.toggleOpt, kind === 'in' && styles.toggleActive]}>
            <Text style={[styles.toggleText, kind === 'in' && styles.toggleTextActive]}>Pemasukan</Text>
          </Pressable>
        </View>

        <Text style={styles.amount}>{formatRupiah(amount)}</Text>
        <TextInput
          value={amountText}
          onChangeText={setAmountText}
          placeholder="Ketik nominal, mis. 65000"
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
          style={styles.nominalInput}
        />
        <Text style={styles.dateHint}>
          {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })} • Hari ini • Langsung Lunas
        </Text>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Contoh: Jajan Kopi & Cemilan"
          placeholderTextColor={Colors.textMuted}
          style={styles.input}
        />

        <Text style={styles.sectionLabel}>KATEGORI</Text>
        <View style={styles.grid}>
          {categories.map((c) => {
            const active = (selectedCategoryId ?? '') === c.id;
            return (
              <Pressable key={c.id} onPress={() => setCategoryId(c.id)} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.name}</Text>
              </Pressable>
            );
          })}
          {categories.length === 0 && <Text style={styles.muted}>Memuat kategori…</Text>}
        </View>

        <Text style={styles.sectionLabel}>AKUN</Text>
        <View style={styles.grid}>
          {accounts.map((a) => {
            const active = (selectedAccountId ?? '') === a.id;
            return (
              <Pressable key={a.id} onPress={() => setAccountId(a.id)} style={[styles.chip, active && styles.chipOutline]}>
                <Text style={styles.chipText}>{a.name}</Text>
              </Pressable>
            );
          })}
          {accounts.length === 0 && <Text style={styles.muted}>Memuat akun…</Text>}
        </View>

        <View style={styles.recurring}>
          <View>
            <Text style={styles.recurringTitle}>Jadikan Transaksi Rutin Bulanan</Text>
            <Text style={styles.recurringSub}>Otomatis muncul di siklus berikutnya</Text>
          </View>
          <Switch value={recurring} onValueChange={setRecurring} trackColor={{ true: Colors.paidText, false: Colors.borderStrong }} />
        </View>

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}

        <PrimaryButton label={quickAdd.isPending ? 'Menyimpan…' : 'Simpan Transaksi'} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 20, gap: 12, paddingBottom: 32 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.borderStrong, alignSelf: 'center' },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '600' },
  toggle: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, flexDirection: 'row', padding: 4 },
  toggleOpt: { flex: 1, paddingVertical: 10, borderRadius: Radius.pill, alignItems: 'center' },
  toggleActive: { backgroundColor: Colors.surface },
  toggleText: { color: Colors.textMuted, fontWeight: '600' },
  toggleTextActive: { color: Colors.textPrimary },
  amount: { color: Colors.textPrimary, fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
  nominalInput: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, paddingHorizontal: 14, height: 48, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.canvas },
  dateHint: { color: Colors.textMuted, fontSize: FontSize.body },
  input: { backgroundColor: Colors.canvas, borderRadius: Radius.md, padding: 14, borderWidth: 1, borderColor: Colors.borderSubtle, fontSize: 15, color: Colors.textPrimary },
  sectionLabel: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '600', letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 10 },
  chipActive: { backgroundColor: Colors.brandPrimary },
  chipOutline: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: Colors.white },
  muted: { color: Colors.textMuted },
  recurring: { backgroundColor: Colors.canvas, borderRadius: Radius.md, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recurringTitle: { color: Colors.textPrimary, fontWeight: '600' },
  recurringSub: { color: Colors.textMuted, fontSize: FontSize.body, marginTop: 2 },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
