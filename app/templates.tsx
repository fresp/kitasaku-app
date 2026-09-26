import { useMemo, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah, formatRupiahShort } from '../lib/format';
import { requireSupabase } from '../lib/supabase';
import { useAuth } from '../lib/auth-context';
import { useAccounts, useCategories, useTemplates } from '../lib/queries';
import { Badge } from '../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

export default function TemplatesScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const tmplQ = useTemplates(householdId);
  const catsQ = useCategories(householdId);
  const accsQ = useAccounts(householdId);

  const [filter, setFilter] = useState<'ACTIVE' | 'COMPLETED'>('ACTIVE');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const list = useMemo(
    () => (tmplQ.data ?? []).filter((t) => t.status === filter),
    [tmplQ.data, filter]
  );
  const activeCount = (tmplQ.data ?? []).filter((t) => t.status === 'ACTIVE').length;
  const doneCount = (tmplQ.data ?? []).length - activeCount;
  const baseline = (tmplQ.data ?? [])
    .filter((t) => t.status === 'ACTIVE' && t.direction === 'EXPENSE')
    .reduce((s, t) => s + t.default_amount, 0);

  async function create() {
    setErr(null);
    const amount = parseInt(amountText.replace(/[^0-9]/g, '') || '0', 10);
    if (!householdId) { setErr('Login dulu.'); return; }
    if (name.trim().length < 3) { setErr('Nama template minimal 3 huruf.'); return; }
    if (amount <= 0) { setErr('Nominal harus lebih dari Rp 0.'); return; }
    try {
      const sb = requireSupabase();
      const { error } = await sb.from('recurring_templates').insert({
        household_id: householdId,
        name: name.trim(),
        category_id: catsQ.data?.[0]?.id ?? null,
        account_id: accsQ.data?.[0]?.id ?? null,
        direction: 'EXPENSE',
        default_amount: amount,
        status: 'ACTIVE',
      });
      if (error) throw error;
      setName(''); setAmountText(''); setShowForm(false);
      tmplQ.refetch();
    } catch (e: any) { setErr(e?.message ?? 'Gagal menyimpan.'); }
  }

  async function setStatus(id: string, status: 'ACTIVE' | 'COMPLETED') {
    const sb = requireSupabase();
    await sb.from('recurring_templates').update({ status }).eq('id', id);
    tmplQ.refetch();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Template Transaksi Rutin</Text>
          <Pressable onPress={() => setShowForm((v) => !v)}>
            <Text style={styles.add}>{showForm ? 'Tutup' : '+ Tambah'}</Text>
          </Pressable>
        </View>

        <View style={styles.baseline}>
          <Text style={styles.eyebrow}>TOTAL KOMITMEN RUTIN BULANAN • {activeCount} AKTIF</Text>
          <Text style={styles.total}>{formatRupiah(baseline)} / siklus</Text>
          <Text style={styles.sub}>Kebutuhan wajib yang otomatis di-clone setiap siklus baru</Text>
        </View>

        {showForm && (
          <View style={styles.form}>
            <Text style={styles.label}>NAMA POS</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Wifi Rumah" placeholderTextColor={Colors.textMuted} style={styles.input} />
            <Text style={styles.label}>NOMINAL DEFAULT</Text>
            <TextInput value={amountText} onChangeText={setAmountText} placeholder="385000" placeholderTextColor={Colors.textMuted} keyboardType="number-pad" style={styles.input} />
            <PrimaryButton label="Simpan Template" onPress={create} />
          </View>
        )}

        <View style={styles.filter}>
          <Pressable onPress={() => setFilter('ACTIVE')} style={[styles.opt, filter === 'ACTIVE' && styles.optOn]}>
            <Text style={[styles.optText, filter === 'ACTIVE' && styles.optTextOn]}>Aktif ({activeCount})</Text>
          </Pressable>
          <Pressable onPress={() => setFilter('COMPLETED')} style={[styles.opt, filter === 'COMPLETED' && styles.optOn]}>
            <Text style={[styles.optText, filter === 'COMPLETED' && styles.optTextOn]}>Selesai ({doneCount})</Text>
          </Pressable>
        </View>

        {list.map((t) => (
          <View key={t.id} style={styles.card}>
            <View style={styles.head}>
              <Text style={styles.name}>{t.name}</Text>
              <Badge label={t.status === 'ACTIVE' ? 'Aktif' : 'Selesai'} tone={t.status === 'ACTIVE' ? 'paid' : 'default'} />
            </View>
            <Text style={styles.meta}>
              {(t as any).categories?.name ?? '—'} • {(t as any).accounts?.name ?? '—'}
            </Text>
            <Text style={styles.amount}>{formatRupiah(t.default_amount)} • {formatRupiahShort(t.default_amount)}</Text>
            {t.status === 'ACTIVE' ? (
              <SecondaryButton label="Tandai Selesai" onPress={() => setStatus(t.id, 'COMPLETED')} />
            ) : (
              <SecondaryButton label="Aktifkan Lagi" onPress={() => setStatus(t.id, 'ACTIVE')} />
            )}
          </View>
        ))}
        {list.length === 0 && <Text style={styles.muted}>Tidak ada template {filter === 'ACTIVE' ? 'aktif' : 'selesai'}.</Text>}

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '600' },
  add: { color: Colors.textPrimary, fontWeight: '600' },
  baseline: { backgroundColor: Colors.textPrimary, borderRadius: Radius.lg, padding: 16, gap: 4 },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '600', letterSpacing: 0.6 },
  total: { color: Colors.white, fontSize: FontSize.heroNumeral, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sub: { color: Colors.borderStrong, fontSize: FontSize.body },
  form: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 14, gap: 8 },
  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  input: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary, backgroundColor: Colors.canvas },
  filter: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, flexDirection: 'row', padding: 4 },
  opt: { flex: 1, paddingVertical: 10, borderRadius: Radius.pill, alignItems: 'center' },
  optOn: { backgroundColor: Colors.surface },
  optText: { color: Colors.textMuted, fontWeight: '600' },
  optTextOn: { color: Colors.textPrimary },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 14, gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600', flex: 1 },
  meta: { color: Colors.textMuted, fontSize: FontSize.body },
  amount: { color: Colors.textPrimary, fontWeight: '700', fontVariant: ['tabular-nums'] },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
