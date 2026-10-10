import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { allocationUsage, overspendTotal } from '../lib/zero-based-accounting';
import { defaultAccountId, isZeroBasedCashAccount } from '../lib/account';
import { useAuth } from '../lib/auth-context';
import {
  useAccounts,
  useActiveCycle,
  useCategories,
  useCreateAllocation,
  useCycleAllocations,
  useDeleteAllocation,
  useObligations,
  useTransactions,
  useZeroBasedSummary,
} from '../lib/queries';
import type { AllocationType, CycleAllocation } from '../lib/queries';
import { categoryIconName } from '../lib/category-icon';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';
import { BrandIcon } from '../components/ui/BrandIcon';
import { QueryError } from '../components/ui/QueryError';

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
  // The commitments are only half the picture; what actually moved is read
  // through the planned row each allocation links to (migration 028).
  const txnsQ = useTransactions(householdId, cycleId);
  const txnById = useMemo(
    () => new Map((txnsQ.data ?? []).map((t) => [t.id, t])),
    [txnsQ.data]
  );
  const accsQ = useAccounts(householdId);
  const createAlloc = useCreateAllocation();
  const deleteAlloc = useDeleteAllocation();

  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<AllocationType>('EXPENSE');
  const [amountText, setAmountText] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [obligationId, setObligationId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const summary = summaryQ.data;
  const allocations = useMemo(() => allocsQ.data ?? [], [allocsQ.data]);
  const categories = useMemo(() => catsQ.data ?? [], [catsQ.data]);
  const obligations = useMemo(() => obligQ.data ?? [], [obligQ.data]);
  const accounts = useMemo(() => (accsQ.data ?? []).filter(isZeroBasedCashAccount), [accsQ.data]);
  const legacyAllocations = useMemo(
    () => allocations.filter((a) => !isZeroBasedCashAccount({ type: a.accounts?.type ?? '' })),
    [allocations],
  );
  const eligibleAllocations = useMemo(
    () => allocations.filter((a) => isZeroBasedCashAccount({ type: a.accounts?.type ?? '' })),
    [allocations],
  );
  const hasLegacyUnassigned = legacyAllocations.some((row) => !row.accounts);
  const legacyTotal = legacyAllocations.reduce((sum, row) => sum + (row.cancelled_at ? 0 : Math.max(0, row.amount)), 0);
  const eligibleDefaultAccountId = defaultAccountId(accounts);
  const selectedAccountId = accounts.some((account) => account.id === accountId)
    ? accountId
    : eligibleDefaultAccountId;
  const displayedAllocations = eligibleAllocations;
  const hasExcludedAllocations = legacyAllocations.length > 0;
  const amount = parseAmount(amountText);

  // Rebuild allocations grouped by the same eligible-account rule as summary.
  const grouped = useMemo(() => {
    const map = new Map<AllocationType, CycleAllocation[]>();
    for (const a of displayedAllocations) {
      const list = map.get(a.allocation_type) ?? [];
      list.push(a);
      map.set(a.allocation_type, list);
    }
    return ALLOCATION_ORDER.filter((t) => map.has(t)).map((t) => ({
      type: t,
      rows: map.get(t)!,
      total: map.get(t)!.reduce((s, r) => s + (r.cancelled_at ? 0 : r.amount), 0),
    }));
  }, [displayedAllocations]);


  const overspend = useMemo(
    () => overspendTotal(displayedAllocations, txnById),
    [displayedAllocations, txnById]
  );

  async function submit() {
    setErr(null);
    if (!householdId || !cycleId) { setErr('Belum ada siklus aktif.'); return; }
    if (amount <= 0) { setErr('Nominal alokasi harus lebih dari Rp 0.'); return; }
    if (type === 'DEBT_PAYMENT' && !obligationId) {
      setErr('Pilih tanggungan yang dilunasi.');
      return;
    }
    try {
      if (!selectedAccountId) {
        setErr('Pilih rekening bank atau e-wallet untuk alokasi.');
        return;
      }
      await createAlloc.mutateAsync({
        householdId,
        cycleId,
        allocationType: type,
        amount,
        categoryId,
        obligationId: type === 'DEBT_PAYMENT' ? obligationId : null,
        accountId: selectedAccountId,
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
          <BrandIcon name="context-goal" size={44} label="" />
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
            <Text style={styles.summarySub}>Sumber dan alokasi hanya menghitung rekening bank serta e-wallet.</Text>
            <SummaryRow label="Total Sumber Dana" value={summary.sourceFunds.total} />
            <Text style={styles.summarySub}>
              Income {formatRupiah(summary.sourceFunds.operatingIncome)} · Pendanaan{' '}
              {formatRupiah(summary.sourceFunds.financingInflow)} · Aset{' '}
              {formatRupiah(summary.sourceFunds.assetRelease)}
            </Text>
            <View style={styles.summaryDivider} />
            <SummaryRow label="Total Alokasi" value={summary.allocations.total} accent />
            {overspend > 0 && (
              <SummaryRow label="Terpakai melebihi rencana" value={overspend} tone="alert" />
            )}
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

        {hasExcludedAllocations && (
          <View style={styles.legacyNotice}>
            <Text style={styles.legacyTitle}>Alokasi lama di luar saldo Zero-Based</Text>
            <Text style={styles.legacyText}>
              {hasLegacyUnassigned ? 'Ada alokasi tanpa akun atau akun non-kas; ' : 'Ada alokasi pada akun non-kas; '}
              {formatRupiah(legacyTotal)} tidak dihitung dalam total kas. Data historis tetap tersimpan.
            </Text>
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
                    <BrandIcon
                      name={categoryIconName({ name: c.name, type: c.type, icon: c.icon })}
                      size={15}
                      label=""
                    />
                    <Text style={styles.chipText}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.formLabel}>AKUN</Text>
            <View style={styles.chips}>
              {accounts.map((a) => {
                const active = a.id === selectedAccountId;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => setAccountId(a.id)}
                    style={[styles.chip, active && styles.chipOutline]}
                  >
                    <Text style={styles.chipText}>{a.name}</Text>
                  </Pressable>
                );
              })}
              {accounts.length === 0 && (
                <Text style={styles.muted}>
                  {accsQ.isLoading ? 'Memuat akun…' : 'Tambahkan rekening bank atau e-wallet terlebih dahulu.'}
                </Text>
              )}
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

        {allocsQ.isError && householdId && (
          <QueryError
            onRetry={() => {
              allocsQ.refetch();
              summaryQ.refetch();
            }}
            retrying={allocsQ.isFetching}
            message="Alokasi belum bisa dibaca, jadi total di bawah belum lengkap. Datamu tidak hilang."
          />
        )}

        {allocsQ.isLoading && <Text style={styles.muted}>Memuat alokasi…</Text>}
        {!allocsQ.isLoading && !allocsQ.isError && allocations.length === 0 && (
          <View style={styles.emptyBox}>
            <BrandIcon name="empty-belum-ada-tabungan" size={72} label="" />
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
            {g.rows.map((r) => {
              const usage = allocationUsage(r, txnById);
              return (
                <View key={r.id} style={styles.row}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {r.obligations?.title ?? r.categories?.name ?? ALLOCATION_LABELS[r.allocation_type]}
                    </Text>
                    {usage.actual === null ? (
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {r.accounts?.name ?? 'Tanpa akun'}
                        {r.note ? ` • ${r.note}` : ''}
                      </Text>
                    ) : (
                      <Text
                        style={[
                          styles.rowMeta,
                          usage.delta !== null && usage.delta > 0 && styles.rowOver,
                          usage.delta !== null && usage.delta < 0 && styles.rowUnder,
                        ]}
                        numberOfLines={1}
                      >
                        Terpakai {formatRupiah(usage.actual)}
                        {usage.delta !== null && usage.delta > 0
                          ? ` • lebih ${formatRupiah(usage.delta)}`
                          : usage.delta !== null && usage.delta < 0
                            ? ` • sisa ${formatRupiah(-usage.delta)}`
                            : ' • pas rencana'}
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.rowAmount}>{formatRupiah(r.amount)}</Text>
                    <Text style={styles.rowPlanLabel}>rencana</Text>
                  </View>
                  <Pressable onPress={() => remove(r)} hitSlop={8}>
                    <Text style={styles.rowDelete}>Hapus</Text>
                  </Pressable>
                </View>
              );
            })}
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
  rowOver: { color: Colors.financingText },
  rowUnder: { color: Colors.paidText },
  rowPlanLabel: { color: Colors.textMuted, fontSize: 9.5, marginTop: 1 },
  rowAmount: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rowDelete: { color: Colors.pendingText, fontSize: FontSize.caption, fontWeight: '600' },
  legacyNotice: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12, gap: 4 },
  legacyTitle: { color: Colors.pendingText, fontSize: FontSize.body, fontWeight: '700' },
  legacyText: { color: Colors.pendingText, fontSize: FontSize.caption, lineHeight: 18 },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
