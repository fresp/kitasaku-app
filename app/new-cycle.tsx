import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useAccounts, useCategories, useCreateCycle, useObligations, useTemplates } from '../lib/queries';
import { calculateFundingGap, calculateUnallocatedFunds } from '../lib/zero-based';
import { Badge } from '../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

function parseAmount(t: string): number {
  return parseInt(t.replace(/[^0-9]/g, '') || '0', 10);
}

export default function NewCycleScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const tmplQ = useTemplates(householdId);
  const catsQ = useCategories(householdId);
  const accsQ = useAccounts(householdId);
  const obligQ = useObligations(householdId);
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
  // Obligations settled within this cycle. All open ones are selected by
  // default because a carried-over debt is not optional spending — leaving one
  // out is what creates a silent funding gap.
  const [obligChecked, setObligChecked] = useState<Record<string, boolean> | null>(null);

  const isChecked = (id: string, fallback = true) =>
    checked ? (checked[id] ?? fallback) : fallback;
  const amountFor = (id: string, fallback: number) =>
    amounts[id] !== undefined ? parseAmount(amounts[id]) : fallback;

  const selected = activeTemplates.filter((t) => isChecked(t.id));
  const totalRecurring = selected.reduce((s, t) => s + amountFor(t.id, t.default_amount), 0);

  const openObligations = useMemo(
    () => (obligQ.data ?? []).filter((o) => o.remaining_amount > 0 && o.status !== 'SETTLED' && o.status !== 'CANCELLED'),
    [obligQ.data]
  );
  const isObligChecked = (id: string) => (obligChecked ? (obligChecked[id] ?? true) : true);
  const selectedObligations = openObligations.filter((o) => isObligChecked(o.id));
  const totalDebtPayment = selectedObligations.reduce((s, o) => s + o.remaining_amount, 0);

  const income = parseAmount(incomeText);
  // The planned allocation is everything this cycle has already committed to,
  // before any voluntary savings. What is left is unallocated, not "sisa bersih"
  // — zero-based means it still needs a purpose.
  const requiredAllocation = totalRecurring + totalDebtPayment;
  const fundingGap = calculateFundingGap(requiredAllocation, income);
  const unallocated = calculateUnallocatedFunds(income, requiredAllocation);
  const canOpen = fundingGap === 0;

  async function submit() {
    setErr(null);
    if (!householdId) { setErr('Login dulu untuk membuka siklus.'); return; }
    if (selected.length === 0 && income <= 0) { setErr('Pilih minimal 1 pos rutin atau isi pemasukan.'); return; }
    if (!canOpen) {
      setErr(
        `Funding gap ${formatRupiah(fundingGap)} belum tertutup. Tambah pemasukan, lepas aset, atau catat pinjaman baru dulu.`
      );
      return;
    }
    try {
      const cycle = await createCycle.mutateAsync({
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
      void cycle;
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

        <Text style={styles.label}>
          PEMBAYARAN KEWAJIBAN SIKLUS INI ({openObligations.length} TANGGUNGAN AKTIF)
        </Text>
        {openObligations.length === 0 ? (
          <Text style={styles.muted}>Tidak ada tanggungan terbuka yang dibawa ke siklus ini.</Text>
        ) : (
          openObligations.map((o) => {
            const on = isObligChecked(o.id);
            return (
              <Pressable
                key={o.id}
                onPress={() => setObligChecked((p) => ({ ...(p ?? {}), [o.id]: !on }))}
                style={styles.obligRow}
              >
                <View style={[styles.check, on && styles.checkOn]}>
                  <Text style={[styles.checkText, on && styles.checkTextOn]}>{on ? '✓' : ''}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tplName}>{o.title}</Text>
                  <Text style={styles.muted}>
                    {o.type} • Sisa {formatRupiah(o.remaining_amount)}
                    {o.due_date ? ` • Jatuh tempo ${o.due_date}` : ''}
                  </Text>
                </View>
                <Text style={styles.obligAmt}>{formatRupiah(o.remaining_amount)}</Text>
              </Pressable>
            );
          })
        )}
        <Text style={styles.note}>
          Penerimaan pinjaman tidak dianggap income rutin dan tidak di-clone ke siklus berikutnya.
        </Text>

        <View style={styles.projection}>
          <Text style={styles.projLabel}>ZERO-BASED ALLOCATION SIKLUS INI</Text>
          <ProjRow label={`+ Pemasukan (${selected.length} pos rutin)`} value={income} />
          <ProjRow label={`− Pengeluaran rutin`} value={-totalRecurring} />
          <ProjRow label={`− Pembayaran kewajiban (${selectedObligations.length})`} value={-totalDebtPayment} />
          <View style={styles.projDivider} />
          {fundingGap > 0 ? (
            <>
              <ProjRow label="= Funding Gap (Kebutuhan Pendanaan)" value={fundingGap} tone="gap" />
              <Text style={styles.projNote}>
                Kebutuhan {formatRupiah(requiredAllocation)} melebihi sumber dana {formatRupiah(income)}.
                Siklus tidak dapat dibuka selama Funding Gap belum tertutup.
              </Text>
              <Text style={styles.strategiesTitle}>STRATEGI TUTUP FUNDING GAP</Text>
              <Text style={styles.strategy}>• Tambah Pendapatan</Text>
              <Text style={styles.strategy}>• Pencairan Aset (Asset Release) — catat lewat Quick Add</Text>
              <Text style={styles.strategy}>• Pinjaman Baru (Financing Inflow) — catat lewat Quick Add</Text>
            </>
          ) : (
            <>
              <ProjRow
                label="= Dana belum dialokasikan"
                value={unallocated}
                tone={unallocated > 0 ? 'warn' : 'ok'}
              />
              <Text style={styles.projNote}>
                {unallocated > 0
                  ? `${formatRupiah(unallocated)} belum punya tujuan. Alokasikan penuh ke Belanja, Pelunasan Utang, & Tabungan/Aset hingga tersisa Rp 0.`
                  : 'Seluruh dana telah dialokasikan penuh (Unallocated Funds = Rp 0).'}
              </Text>
            </>
          )}
        </View>

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}

        <PrimaryButton
          label={createCycle.isPending ? 'Membuka…' : canOpen ? `Buka ${cycleName}` : 'Tutup Funding Gap Dulu'}
          onPress={submit}
        />
        <SecondaryButton label="Kembali" onPress={() => router.back()} />
        <Badge label="Pos COMPLETED otomatis tidak muncul di daftar ini" />
      </ScrollView>
    </SafeAreaView>
  );
}

function ProjRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'gap' | 'warn' | 'ok';
}) {
  const color = tone === 'gap'
    ? Colors.pendingBorder
    : tone === 'warn'
      ? Colors.financingBorder
      : tone === 'ok'
        ? Colors.paidBg
        : Colors.white;
  return (
    <View style={styles.projRow}>
      <Text style={styles.projRowLabel}>{label}</Text>
      <Text style={[styles.projRowValue, { color }]}>
        {value < 0 ? `−${formatRupiah(Math.abs(value))}` : formatRupiah(value)}
      </Text>
    </View>
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
  projLabel: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  projRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingVertical: 2 },
  projRowLabel: { color: Colors.borderStrong, fontSize: FontSize.caption, flex: 1 },
  projRowValue: { fontSize: FontSize.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
  projDivider: { height: 1, backgroundColor: Colors.heroFooter, marginVertical: 4 },
  projNote: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16, marginTop: 2 },
  strategiesTitle: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 1, marginTop: 8 },
  strategy: { color: Colors.borderStrong, fontSize: FontSize.caption, lineHeight: 18 },
  obligRow: { flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, padding: 12, alignItems: 'center' },
  obligAmt: { color: Colors.textPrimary, fontWeight: '600', fontSize: FontSize.body, fontVariant: ['tabular-nums'] },
  note: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
