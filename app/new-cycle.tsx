import { useMemo, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useAccounts, useCategories, useCreateCycle, useTemplates } from '../lib/queries';
import { Badge } from '../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

function parseNum(t: string): number {
  return parseInt(t.replace(/[^0-9]/g, '') || '0', 10);
}

export default function NewCycleScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const tmplQ = useTemplates(householdId);
  const catsQ = useCategories(householdId);
  const accsQ = useAccounts(householdId);
  const createCycle = useCreateCycle();

  const activeTemplates = useMemo(
    () => (tmplQ.data ?? []).filter((t) => t.status === 'ACTIVE'),
    [tmplQ.data]
  );
  const [checked, setChecked] = useState<Record<string, boolean> | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [cycleName, setCycleName] = useState('Siklus Nov 2026');
  const [start, setStart] = useState('2026-10-25');
  const [end, setEnd] = useState('2026-11-24');
  const [incomeText, setIncomeText] = useState('15844000');
  const [err, setErr] = useState<string | null>(null);

  const isChecked = (id: string, fallback = true) =>
    checked ? (checked[id] ?? fallback) : fallback;
  const amountFor = (id: string, fallback: number) =>
    amounts[id] !== undefined ? parseNum(amounts[id]) : fallback;

  const selected = activeTemplates.filter((t) => isChecked(t.id));
  const totalRutin = selected.reduce((s, t) => s + amountFor(t.id, t.default_amount), 0);
  const income = parseNum(incomeText);
  const sisa = income - totalRutin;

  async function submit() {
    setErr(null);
    if (!householdId) { setErr('Login dulu untuk membuka siklus.'); return; }
    if (selected.length === 0 && income <= 0) { setErr('Pilih minimal 1 pos rutin atau isi pemasukan.'); return; }
    try {
      await createCycle.mutateAsync({
        householdId,
        name: cycleName.trim() || 'Siklus Baru',
        start, end,
        incomeAmount: income,
        incomeAccountId: accsQ.data?.[0]?.id ?? null,
        incomeCategoryId: (catsQ.data ?? []).find((c) => c.type === 'INCOME')?.id ?? null,
        items: selected.map((t) => ({
          templateId: t.id, name: t.name,
          amount: amountFor(t.id, t.default_amount),
          categoryId: t.category_id, accountId: t.account_id,
          direction: t.direction,
        })),
      });
      router.replace('/(tabs)');
    } catch (e: any) { setErr(e?.message ?? 'Gagal membuka siklus.'); }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>TRANSAKSI PAYDAY-TO-PAYDAY • SETUP OTOMATIS</Text>
        <Text style={styles.title}>Buka Siklus Anggaran Baru</Text>

        <Text style={styles.label}>NAMA SIKLUS</Text>
        <TextInput value={cycleName} onChangeText={setCycleName} style={styles.input} />
        <View style={styles.dateRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>MULAI</Text>
            <TextInput value={start} onChangeText={setStart} style={styles.input} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>SELESAI</Text>
            <TextInput value={end} onChangeText={setEnd} style={styles.input} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>PEMASUKAN GAJIAN PERTAMA</Text>
          <TextInput value={incomeText} onChangeText={setIncomeText} keyboardType="number-pad" style={styles.incomeInput} />
          <Text style={styles.muted}>{formatRupiah(income)} • {accsQ.data?.[0]?.name ?? 'Mandiri'}</Text>
        </View>

        <Text style={styles.label}>PILIH TRANSAKSI RUTIN YANG DI-CLONE ({activeTemplates.length} POS AKTIF)</Text>
        {tmplQ.isLoading && <Text style={styles.muted}>Memuat template…</Text>}
        {activeTemplates.map((t) => {
          const on = isChecked(t.id);
          return (
            <View key={t.id} style={styles.tplRow}>
              <Pressable
                onPress={() => setChecked((p) => ({ ...(p ?? {}), [t.id]: !on }))}
                style={[styles.check, on && styles.checkOn]}
              >
                <Text style={[styles.checkText, on && styles.checkTextOn]}>{on ? '✓' : ''}</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.tplName}>{t.name}</Text>
                <Text style={styles.muted}>
                  {(t as any).categories?.name ?? ''} • {(t as any).accounts?.name ?? ''}
                </Text>
                <TextInput
                  value={amounts[t.id] ?? String(t.default_amount)}
                  onChangeText={(v) => setAmounts((p) => ({ ...p, [t.id]: v }))}
                  keyboardType="number-pad"
                  style={styles.amtInput}
                />
              </View>
            </View>
          );
        })}

        <View style={styles.projection}>
          <Text style={styles.muted}>Pemasukan {formatRupiah(income)} − Rutin {formatRupiah(totalRutin)}</Text>
          <Text style={styles.sisa}>Estimasi Sisa Bersih {formatRupiah(sisa)}</Text>
        </View>

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}

        <PrimaryButton label={createCycle.isPending ? 'Membuka…' : `Buka ${cycleName}`} onPress={submit} />
        <SecondaryButton label="Kembali" onPress={() => router.back()} />
        <Badge label="Pos COMPLETED otomatis tidak muncul di daftar ini" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 20, gap: 10, paddingBottom: 32 },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 0.6 },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '700' },
  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1, marginTop: 6 },
  input: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary, backgroundColor: Colors.canvas },
  dateRow: { flexDirection: 'row', gap: 10 },
  card: { backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 14, gap: 6 },
  incomeInput: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  tplRow: { flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, padding: 12, alignItems: 'flex-start' },
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: Colors.borderStrong, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkOn: { backgroundColor: Colors.paidText, borderColor: Colors.paidText },
  checkText: { fontWeight: '700' },
  checkTextOn: { color: Colors.white },
  tplName: { color: Colors.textPrimary, fontWeight: '600', fontSize: 15 },
  amtInput: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.sm, paddingHorizontal: 10, height: 40, marginTop: 6, fontSize: 15, color: Colors.textPrimary, backgroundColor: Colors.surface },
  projection: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, padding: 14, gap: 4 },
  sisa: { color: Colors.white, fontWeight: '700', fontSize: 16, fontVariant: ['tabular-nums'] },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
