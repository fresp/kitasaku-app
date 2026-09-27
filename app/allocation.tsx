import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useActiveCycle,
  useCategories,
  useCreateAllocation,
  useCycleAllocations,
  useDeleteAllocation,
  useObligations,
  useZeroBasedSummary,
} from '../lib/queries';
import type { AllocationType, CycleAllocation } from '../lib/queries';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

const ALLOCATION_LABELS: Record<AllocationType, string> = {
  EXPENSE: 'Belanja',
  DEBT_PAYMENT: 'Pelunasan Utang',
  ASSET: 'Aset',
  SAVINGS: 'Tabungan',
  INVESTMENT: 'Investasi',
  EMERGENCY_FUND: 'Dana Darurat',
  OTHER: 'Lainnya',
};

const ALLOCATION_ORDER: AllocationType[] = [
  'EXPENSE',
  'DEBT_PAYMENT',
  'ASSET',
  'SAVINGS',
  'INVESTMENT',
  'EMERGENCY_FUND',
  'OTHER',
];

function parseAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

export default function AllocationScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const cycleId = cycleQ.data?.id;
  const summaryQ = useZeroBasedSummary(householdId, cycleId, 'planned');
  const allocsQ = useCycleAllocations(householdId, cycleId);
  const catsQ = useCategories(householdId);
  const obligQ = useObligations(householdId);
  const createAlloc = useCreateAllocation();
  const deleteAlloc = useDeleteAllocation();

  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<AllocationType>('EXPENSE');
  const [amountText, setAmountText] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [obligationId, setObligationId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const summary = summaryQ.data;
  const allocations = useMemo(() => allocsQ.data ?? [], [allocsQ.data]);
  const categories = useMemo(() => catsQ.data ?? [], [catsQ.data]);
  const obligations = useMemo(() => obligQ.data ?? [], [obligQ.data]);
  const amount = parseAmount(amountText);

  const grouped = useMemo(() => {
    const map = new Map<AllocationType, CycleAllocation[]>();
    for (const a of allocations) {
      const list = map.get(a.allocation_type) ?? [];
      list.push(a);
      map.set(a.allocation_type, list);
    }
    return ALLOCATION_ORDER.filter((t) => map.has(t)).map((t) => ({
      type: t,
      rows: map.get(t)!,
      total: map.get(t)!.reduce((s, r) => s + r.amount, 0),
    }));
  }, [allocations]);

  async function submit() {
    setErr(null);
    if (!householdId || !cycleId) { setErr('Belum ada siklus aktif.'); return; }
    if (amount <= 0) { setErr('Nominal alokasi harus lebih dari Rp 0.'); return; }
    if (type === 'DEBT_PAYMENT' && !obligationId) {
      setErr('Pilih tanggungan yang dilunasi.');
      return;
    }
    try {
      await createAlloc.mutateAsync({
        householdId,
        cycleId,
        allocationType: type,
        amount,
        categoryId,
        obligationId: type === 'DEBT_PAYMENT' ? obligationId : null,
      });
      setAmountText(''); setShowForm(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan alokasi.');
    }
  }

  async function remove(a: CycleAllocation) {
    setErr(null);
    try {
      await deleteAlloc.mutateAsync({ id: a.id });
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menghapus alokasi.');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>ZERO-BASED ALLOCATION</Text>
            <Text style={styles.title}>Detail Alokasi</Text>
            <Text style={styles.sub}>
              {cycleQ.data ? `${cycleQ.data.name} • ${cycleQ.data.start_date} – ${cycleQ.data.end_date}` : 'Belum ada siklus aktif'}
            </Text>
          </View>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.close}>Tutup</Text>
          </Pressable>
        </View>

        {summary && (
          <View style={styles.summary}>
            <SummaryRow label="Total Sumber Dana" value={summary.sourceFunds.total} />
            <Text style={styles.summarySub}>
              Income {formatRupiah(summary.sourceFunds.operatingIncome)} · Pendanaan{' '}
              {formatRupiah(summary.sourceFunds.financingInflow)} · Aset{' '}
              {formatRupiah(summary.sourceFunds.assetRelease)}
            </Text>
            <View style={styles.summaryDivider} />
            <SummaryRow label="Total Alokasi" value={summary.allocations.total} accent />
            <View style={styles.summaryDivider} />
            <SummaryRow
              label="Dana belum dialokasikan"
              value={summary.unallocatedFunds}
              tone={summary.status === 'COMPLETE' ? 'paid' : summary.status === 'FUNDING_GAP' ? 'pending' : 'alert'}
            />
            {summary.fundingGap > 0 && (
              <>
                <View style={styles.summaryDivider} />
                <SummaryRow label="Funding Gap" value={summary.fundingGap} tone="pending" />
                <Text style={styles.summarySub}>
                  Kebutuhan {formatRupiah(summary.requiredAllocation)} melebihi sumber dana.{' '}
                  Tutup gap dengan menambah pendapatan, melepas aset, atau mencatat pinjaman baru.
                </Text>
              </>
            )}
          </View>
        )}

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}

        {showForm ? (
          <View style={styles.form}>
            <Text style={styles.formLabel}>JENIS ALOKASI</Text>
            <View style={styles.chips}>
              {ALLOCATION_ORDER.map((t) => {
                const active = t === type;
                return (
                  <Pressable key={t} onPress={() => setType(t)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {ALLOCATION_LABELS[t]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.formLabel}>NOMINAL</Text>
            <TextInput
              value={amountText}
              onChangeText={setAmountText}
              placeholder="mis. 1500000"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              style={styles.input}
            />
            <Text style={styles.formHint}>{formatRupiah(amount)}</Text>

            {type === 'DEBT_PAYMENT' && (
              <>
                <Text style={styles.formLabel}>TANGGUNGAN</Text>
                <View style={styles.chips}>
                  {obligations.map((o) => {
                    const active = o.id === obligationId;
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => setObligationId(o.id)}
                        style={[styles.chip, active && styles.chipOutline]}
                      >
                        <Text style={styles.chipText}>
                          {o.title} · {formatRupiah(o.remaining_amount)}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {obligations.length === 0 && (
                    <Text style={styles.muted}>Belum ada tanggungan. Catat lewat menu Pinjaman.</Text>
                  )}
                </View>
              </>
            )}

            <Text style={styles.formLabel}>KATEGORI (OPSIONAL)</Text>
            <View style={styles.chips}>
              {categories.map((c) => {
                const active = c.id === categoryId;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setCategoryId(active ? null : c.id)}
                    style={[styles.chip, active && styles.chipOutline]}
                  >
                    <Text style={styles.chipText}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>

            <PrimaryButton
              label={createAlloc.isPending ? 'Menyimpan…' : 'Simpan Alokasi'}
              onPress={submit}
            />
            <SecondaryButton label="Batal" onPress={() => { setShowForm(false); setErr(null); }} />
          </View>
        ) : (
          <PrimaryButton label="+ Alokasikan Dana" onPress={() => setShowForm(true)} />
        )}

        {allocsQ.isLoading && <Text style={styles.muted}>Memuat alokasi…</Text>}
        {!allocsQ.isLoading && allocations.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.muted}>
              Belum ada alokasi di siklus ini. Seluruh sumber dana masih menganggur.
            </Text>
          </View>
        )}

        {grouped.map((g) => (
          <View key={g.type} style={styles.group}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>{ALLOCATION_LABELS[g.type]}</Text>
              <Text style={styles.groupTotal}>{formatRupiah(g.total)}</Text>
            </View>
            {g.rows.map((r) => (
              <View key={r.id} style={styles.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {r.obligations?.title ?? r.categories?.name ?? ALLOCATION_LABELS[r.allocation_type]}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {r.accounts?.name ?? 'Tanpa akun'}
                    {r.note ? ` • ${r.note}` : ''}
                  </Text>
                </View>
                <Text style={styles.rowAmount}>{formatRupiah(r.amount)}</Text>
                <Pressable onPress={() => remove(r)} hitSlop={8}>
                  <Text style={styles.rowDelete}>Hapus</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryRow({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: number;
  accent?: boolean;
  tone?: 'paid' | 'pending' | 'alert';
}) {
  const color = tone === 'paid'
    ? Colors.paidText
    : tone === 'pending'
      ? Colors.pendingText
      : tone === 'alert'
        ? Colors.alertText
        : Colors.white;
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, accent && { color: Colors.textMuted }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]}>{formatRupiah(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '600' },
  sub: { color: Colors.textSecondary, fontSize: FontSize.body, marginTop: 2 },
  close: { color: Colors.textPrimary, fontWeight: '600', paddingTop: 18 },
  summary: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.xl, padding: 16, gap: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  summaryLabel: { color: Colors.borderStrong, fontSize: FontSize.body, flex: 1 },
  summaryValue: { fontSize: FontSize.currencyLarge, fontWeight: '700', fontVariant: ['tabular-nums'] },
  summarySub: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  summaryDivider: { height: 1, backgroundColor: Colors.heroFooter, marginVertical: 2 },
  form: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14, gap: 8,
  },
  formLabel: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  formHint: { color: Colors.textSecondary, fontSize: FontSize.body, fontVariant: ['tabular-nums'] },
  input: {
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary,
    backgroundColor: Colors.canvas, fontVariant: ['tabular-nums'],
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 10 },
  chipActive: { backgroundColor: Colors.brandPrimary },
  chipOutline: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontWeight: '600', fontSize: FontSize.body },
  chipTextActive: { color: Colors.white },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  emptyBox: { paddingVertical: 12 },
  group: { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 12, gap: 8 },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  groupTitle: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700' },
  groupTotal: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  rowName: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600' },
  rowMeta: { color: Colors.textMuted, fontSize: FontSize.caption },
  rowAmount: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rowDelete: { color: Colors.pendingText, fontSize: FontSize.caption, fontWeight: '600' },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
