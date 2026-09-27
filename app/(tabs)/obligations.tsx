import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Plus from 'lucide-react-native/icons/plus';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { BrandIcon } from '../../components/ui/BrandIcon';
import { formatRupiah } from '../../lib/format';
import { useAuth } from '../../lib/auth-context';
import { useActiveCycle, useCreateObligation, useObligations } from '../../lib/queries';
import {
  matchesObligationFilter,
  obligationBacklog,
  obligationFilterCounts,
  type ObligationFilter,
} from '../../lib/obligation';
import { ObligationRow } from '../../components/ui/ObligationRow';
import { PrimaryButton } from '../../components/ui/Button';

/**
 * Screen 3 — Tanggungan.
 *
 * The pool of everything the family owes outside the monthly routine: loans,
 * reimbursements, installments, and one-off bills. Home answers "is this
 * cycle's plan sound?"; this screen answers "what do we still owe, and which of
 * it is late?".
 *
 * Per-card state comes from `loanState` in lib/obligation.ts and per-row
 * payment actions live in `ObligationRow`, so this file only lays out the
 * filters, the overview, and the list.
 */

const FILTERS: { key: ObligationFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'loan', label: 'Pinjaman' },
  { key: 'reimburse', label: 'Reimburse' },
  { key: 'installment', label: 'Cicilan' },
  { key: 'bill', label: 'Tagihan' },
];

export default function ObligationsScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const obligQ = useObligations(householdId);
  const createOb = useCreateObligation();

  const [filter, setFilter] = useState<ObligationFilter>('all');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [totalText, setTotalText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Read once per render rather than held in state: a stored "today" would go
  // stale the moment the app is left open across midnight, and every card's
  // overdue verdict depends on it.
  const todayISO = new Date().toISOString().slice(0, 10);

  const obligations = useMemo(() => obligQ.data ?? [], [obligQ.data]);
  const backlog = useMemo(() => obligationBacklog(obligations), [obligations]);
  const counts = useMemo(() => obligationFilterCounts(obligations), [obligations]);
  const visible = useMemo(
    () => obligations.filter((o) => matchesObligationFilter(o.type, filter)),
    [obligations, filter]
  );

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

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Kewajiban &amp; Reimburse</Text>
          <Pressable onPress={() => setShowForm((v) => !v)} style={styles.addBtn}>
            <Plus size={14} color={Colors.white} />
            <Text style={styles.addText}>{showForm ? 'Tutup' : 'Tambah'}</Text>
          </Pressable>
        </View>

        {showForm && (
          <View style={styles.form}>
            <Text style={styles.label}>JUDUL TANGGUNGAN</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="Reimburse Belanja Istri" placeholderTextColor={Colors.textMuted} style={styles.input} />
            <Text style={styles.label}>TOTAL NOMINAL</Text>
            <TextInput value={totalText} onChangeText={setTotalText} placeholder="2000000" placeholderTextColor={Colors.textMuted} keyboardType="number-pad" style={styles.input} />
            <PrimaryButton label={createOb.isPending ? 'Menyimpan…' : 'Simpan Tanggungan'} onPress={submitCreate} />
            <Text style={styles.hint}>
              Pinjaman dengan jadwal cicilan dicatat lewat Quick Add → Terima Pinjaman, supaya
              bunga dan angsurannya ikut tersimpan.
            </Text>
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => {
            const active = f.key === filter;
            const n = counts[f.key];
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {f.label}
                  {n > 0 ? ` ${n}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.overview}>
          <Text style={styles.eyebrow}>{backlog.eyebrow}</Text>
          <Text style={styles.total}>{formatRupiah(backlog.total)}</Text>
          <Text style={styles.sub}>{backlog.sub}</Text>
        </View>

        {obligQ.isLoading && <Text style={styles.muted}>Memuat tanggungan…</Text>}
        {!householdId && (
          <Text style={styles.muted}>Mode offline — login untuk melihat pool tanggungan live.</Text>
        )}

        {!obligQ.isLoading && visible.length === 0 && (
          <View style={styles.emptyBox}>
            <BrandIcon
              name={
                obligations.length === 0
                  ? 'empty-tidak-ada-tagihan'
                  : 'empty-data-tidak-ditemukan'
              }
              size={72}
              label=""
            />
            <Text style={styles.muted}>
              {obligations.length === 0
                ? 'Belum ada tanggungan tercatat. Pinjaman yang kamu terima lewat Quick Add otomatis muncul di sini.'
                : `Tidak ada ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} yang terbuka.`}
            </Text>
          </View>
        )}

        {visible.map((o) => (
          <ObligationRow
            key={o.id}
            obligation={o}
            todayISO={todayISO}
            householdId={householdId}
            cycleId={cycleQ.data?.id}
            onPressDetail={() =>
              router.push({ pathname: '/loan-detail', params: { id: o.id } })
            }
          />
        ))}

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
  container: { padding: 16, gap: 12, paddingBottom: 96 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '600' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.brandPrimary,
    borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8,
  },
  addText: { color: Colors.white, fontWeight: '600', fontSize: FontSize.body },

  form: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14, gap: 8,
  },
  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  input: {
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary,
    backgroundColor: Colors.canvas,
  },
  hint: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },

  filterRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  chip: {
    backgroundColor: Colors.subtle, borderRadius: Radius.pill,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  chipActive: { backgroundColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontSize: FontSize.body, fontWeight: '600' },
  chipTextActive: { color: Colors.white },

  overview: { backgroundColor: Colors.textPrimary, borderRadius: Radius.lg, padding: 16, gap: 4 },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '600', letterSpacing: 0.6 },
  total: { color: Colors.white, fontSize: FontSize.heroNumeral, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sub: { color: Colors.borderStrong, fontSize: FontSize.body },

  emptyBox: { paddingVertical: 16, paddingHorizontal: 4, alignItems: 'center', gap: 10 },
  muted: { color: Colors.textMuted, fontSize: FontSize.body, lineHeight: 18 },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
