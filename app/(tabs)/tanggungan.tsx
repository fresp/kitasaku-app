import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import { useAuth } from '../../lib/auth-context';
import { useActiveCycle, useAllocateObligation, useCategories, useAccounts, useCreateObligation, useObligations, useTransactions } from '../../lib/queries';
import { Badge } from '../../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';

export default function TanggunganScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const obligQ = useObligations(householdId);
  const catsQ = useCategories(householdId);
  const accsQ = useAccounts(householdId);
  const txnsQ = useTransactions(householdId, cycleQ.data?.id);
  const allocate = useAllocateObligation();
  const createOb = useCreateObligation();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [totalText, setTotalText] = useState('');
  const [allocId, setAllocId] = useState<string | null>(null);
  const [allocText, setAllocText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const obligations = useMemo(() => obligQ.data ?? [], [obligQ.data]);
  const totalSisa = obligations.reduce((s, o) => s + (o.remaining_amount ?? 0), 0);
  const allocTarget = obligations.find((o) => o.id === allocId) ?? null;

  const historyByOb = useMemo(() => {
    const map: Record<string, { date: string; amount: number; account: string }[]> = {};
    for (const t of txnsQ.data ?? []) {
      if (t.obligation_id && t.status === 'PAID') {
        (map[t.obligation_id] ??= []).push({
          date: t.release_date ?? '',
          amount: t.actual_amount,
          account: (t as any).accounts?.name ?? '',
        });
      }
    }
    return map;
  }, [txnsQ.data]);

  async function submitCreate() {
    setErr(null);
    const total = parseInt(totalText.replace(/[^0-9]/g, '') || '0', 10);
    if (!householdId) { setErr('Login dulu untuk mencatat tanggungan.'); return; }
    if (title.trim().length < 3) { setErr('Judul minimal 3 huruf.'); return; }
    if (total <= 0) { setErr('Total nominal harus lebih dari Rp 0.'); return; }
    try {
      await createOb.mutateAsync({ householdId, title: title.trim(), type: 'BILL', total });
      setTitle(''); setTotalText(''); setShowForm(false);
    } catch (e: any) { setErr(e?.message ?? 'Gagal menyimpan.'); }
  }

  async function submitAllocate() {
    setErr(null);
    const amount = parseInt(allocText.replace(/[^0-9]/g, '') || '0', 10);
    if (!householdId || !cycleQ.data?.id || !allocTarget) return;
    if (amount <= 0) { setErr('Nominal alokasi harus lebih dari Rp 0.'); return; }
    if (amount > allocTarget.remaining_amount) { setErr('Nominal melebihi sisa tanggungan.'); return; }
    try {
      await allocate.mutateAsync({
        householdId,
        cycleId: cycleQ.data.id,
        obligationId: allocTarget.id,
        amount,
        categoryId: catsQ.data?.[0]?.id ?? null,
        accountId: accsQ.data?.[0]?.id ?? null,
      });
      setAllocId(null); setAllocText('');
      router.push('/(tabs)');
    } catch (e: any) { setErr(e?.message ?? 'Gagal mengalokasikan.'); }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Tanggungan & Reimburse</Text>
          <Pressable onPress={() => setShowForm((v) => !v)}>
            <Text style={styles.add}>{showForm ? 'Tutup' : '+ Tambah'}</Text>
          </Pressable>
        </View>

        {showForm && (
          <View style={styles.form}>
            <Text style={styles.label}>JUDUL TANGGUNGAN</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="Reimburse Belanja Istri" placeholderTextColor={Colors.textMuted} style={styles.input} />
            <Text style={styles.label}>TOTAL NOMINAL</Text>
            <TextInput value={totalText} onChangeText={setTotalText} placeholder="2000000" placeholderTextColor={Colors.textMuted} keyboardType="number-pad" style={styles.input} />
            <PrimaryButton label={createOb.isPending ? 'Menyimpan…' : 'Simpan Tanggungan'} onPress={submitCreate} />
          </View>
        )}

        <View style={styles.overview}>
          <Text style={styles.eyebrow}>TOTAL TANGGUNGAN BELUM LUNAS • {obligations.length} AKTIF</Text>
          <Text style={styles.total}>{formatRupiah(totalSisa)}</Text>
          <Text style={styles.sub}>Kewajiban independen di luar rutinitas bulanan</Text>
        </View>

        {obligQ.isLoading && <Text style={styles.muted}>Memuat tanggungan…</Text>}
        {!householdId && <Text style={styles.muted}>Mode offline — login untuk melihat pool tanggungan live.</Text>}

        {obligations.map((o) => {
          const paid = o.total_amount - o.remaining_amount;
          const pct = o.total_amount > 0 ? Math.round((paid / o.total_amount) * 100) : 0;
          const hist = historyByOb[o.id] ?? [];
          return (
            <View key={o.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{o.title}</Text>
                <Badge
                  label={o.status === 'PARTIAL' ? `PARTIAL • ${pct}%` : o.status}
                  tone={o.status === 'PARTIAL' ? 'alert' : 'pending'}
                />
              </View>
              <Text style={styles.breakdown}>
                Total {formatRupiah(o.total_amount)} • Sisa {formatRupiah(o.remaining_amount)}
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.max(pct, 2)}%` as any, backgroundColor: o.status === 'PARTIAL' ? Colors.alertText : Colors.pendingBorder }]} />
              </View>
              {hist.length > 0 && (
                <View style={styles.history}>
                  {hist.map((h, i) => (
                    <Text key={i} style={styles.historyText}>
                      {h.date}: Dibayar {formatRupiah(h.amount)}{h.account ? ` (${h.account})` : ''}
                    </Text>
                  ))}
                </View>
              )}
              {allocId === o.id ? (
                <View style={{ gap: 8 }}>
                  <TextInput
                    value={allocText}
                    onChangeText={setAllocText}
                    placeholder={`Nominal (sisa ${formatRupiah(o.remaining_amount)})`}
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                  <PrimaryButton label={allocate.isPending ? 'Menarik…' : 'Tarik ke Anggaran Bulan Ini'} onPress={submitAllocate} />
                  <SecondaryButton label="Batal" onPress={() => { setAllocId(null); setAllocText(''); }} />
                </View>
              ) : (
                <PrimaryButton
                  label="+ Alokasikan ke Bulan Ini"
                  onPress={() => { setAllocId(o.id); setAllocText(String(o.remaining_amount)); setErr(null); }}
                />
              )}
            </View>
          );
        })}

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '600' },
  add: { color: Colors.textPrimary, fontWeight: '600' },
  form: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 14, gap: 8 },
  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  input: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary, backgroundColor: Colors.canvas },
  overview: { backgroundColor: Colors.textPrimary, borderRadius: Radius.lg, padding: 16, gap: 4 },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '600', letterSpacing: 0.6 },
  total: { color: Colors.white, fontSize: FontSize.heroNumeral, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sub: { color: Colors.borderStrong, fontSize: FontSize.body },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 14, gap: 8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600', flex: 1 },
  breakdown: { color: Colors.textSecondary, fontSize: FontSize.body },
  track: { height: 6, borderRadius: 3, backgroundColor: Colors.subtle, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  history: { backgroundColor: Colors.canvas, borderRadius: Radius.sm, padding: 10, gap: 2 },
  historyText: { color: Colors.textSecondary, fontSize: FontSize.body },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
