import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../constants/theme';
import { BrandIcon } from '../components/ui/BrandIcon';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { cycleWindowFrom } from '../lib/profile';
import { useAccounts, useCategories, useCreateCycle, useObligations, useTemplates } from '../lib/queries';
import { defaultAccountId } from '../lib/account';
import { cycleReadiness } from '../lib/zero-based';
import { Badge } from '../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';
import { ZeroBasedProjection } from '../components/ui/ZeroBasedProjection';

function parseAmount(t: string): number {
  return parseInt(t.replace(/[^0-9]/g, '') || '0', 10);
}

export default function NewCycleScreen() {
  const router = useRouter();
  const { household, loading: authLoading } = useAuth();
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
  // Seeded from the family's own payday (migration 007) once the household
  // loads, so the form opens on *their* cycle rather than a literal that was
  // correct for one month in 2026. Editing the fields is the point of the
  // screen, so this only fills them in; it never overwrites a typed value.
  const [cycleName, setCycleName] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const seeded = useRef(false);
  const cycleWindow = useMemo(
    () => cycleWindowFrom(household?.payday_day, new Date().toISOString().slice(0, 10)),
    [household?.payday_day]
  );
  useEffect(() => {
    // Waits for auth to settle before seeding. `household` is null while the
    // membership is still loading, and seeding then would lock in the
    // no-payday fallback (today) — the family's real payday would arrive a
    // moment later and be ignored, because `seeded` is already spent.
    if (seeded.current || authLoading || !cycleWindow) return;
    seeded.current = true;
    setCycleName((v) => v || cycleWindow.name);
    setStart((v) => v || cycleWindow.start);
    setEnd((v) => v || cycleWindow.end);
  }, [authLoading, cycleWindow]);

  // The payday figure is not derivable — only the family knows it — so it
  // starts empty with a placeholder rather than pre-filled with a stranger's
  // salary.
  const [incomeText, setIncomeText] = useState('');
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

  // A routine position is either a commitment (EXPENSE → an allocation) or a
  // source (INCOME → part of the money this cycle can spend). Summing them into
  // one number — as this screen used to — both understates the funds available
  // and books a salary as if it were a bill. The split matters more now than it
  // did before: the EXPENSE side is what gets written to `cycle_allocations`
  // when the cycle opens, so the gate and the stored plan have to agree.
  const recurringExpense = selected
    .filter((t) => t.direction === 'EXPENSE')
    .reduce((s, t) => s + amountFor(t.id, t.default_amount), 0);
  const recurringIncome = selected
    .filter((t) => t.direction === 'INCOME')
    .reduce((s, t) => s + amountFor(t.id, t.default_amount), 0);

  const openObligations = useMemo(
    () => (obligQ.data ?? []).filter((o) => o.remaining_amount > 0 && o.status !== 'SETTLED' && o.status !== 'CANCELLED'),
    [obligQ.data]
  );
  const isObligChecked = (id: string) => (obligChecked ? (obligChecked[id] ?? true) : true);
  const selectedObligations = openObligations.filter((o) => isObligChecked(o.id));
  const totalDebtPayment = selectedObligations.reduce((s, o) => s + o.remaining_amount, 0);

  // The "Pinjaman" system category (migration 006) is what classifies a
  // debt-payment row in the ledger — an obligation carries no category of its
  // own. Without it the row lands in Riwayat with no category and a
  // name-derived icon that claims a debt paydown is a purchase.
  const debtCategoryId = useMemo(
    () => (catsQ.data ?? []).find((c) => c.system_role === 'DEBT_PAYMENT')?.id ?? null,
    [catsQ.data]
  );

  const income = parseAmount(incomeText);
  // Everything this cycle can spend: the payday figure plus any routine income
  // position the family cloned in.
  const sourceFunds = income + recurringIncome;
  // The planned allocation is everything this cycle has already committed to,
  // before any voluntary savings. What is left is unallocated, not "sisa bersih"
  // — zero-based means it still needs a purpose.
  //
  // Savings/asset allocations are not part of this sum: a cycle that has not
  // been opened yet has no `cycle_allocations` rows to count, so there is
  // nothing to add. Funding Gap reads the same gate over the allocations that
  // do exist once the cycle is live, and both go through `cycleReadiness`.
  const requiredAllocation = recurringExpense + totalDebtPayment;
  const readiness = cycleReadiness(requiredAllocation, sourceFunds);
  const { fundingGap, unallocatedFunds: unallocated } = readiness;
  const unallocatedLabel =
    unallocated > 0
      ? `${formatRupiah(unallocated)} belum punya tujuan. Alokasikan penuh ke Belanja, Pelunasan Utang, & Tabungan/Aset hingga tersisa Rp 0.`
      : 'Seluruh dana telah dialokasikan penuh (Unallocated Funds = Rp 0).';
  // A failed read of the routine positions or the open obligations empties the
  // list the family is asked to confirm — and an empty list looks like a
  // decision, not a failure. Opening on that would clone nothing and carry no
  // debt forward, so the gate stays shut until the lists are actually readable.
  const loadFailed = tmplQ.isError || obligQ.isError;
  const canOpen = readiness.canOpen && !loadFailed;

  async function submit() {
    setErr(null);
    if (!householdId) { setErr('Login dulu untuk membuka siklus.'); return; }
    // The dates are seeded, not typed, so an empty one means the seeding never
    // ran — saving would write a cycle with no period and every ledger row in
    // it would be undated.
    if (!start.trim() || !end.trim()) {
      setErr('Isi tanggal mulai dan selesai siklus dulu.');
      return;
    }
    if (selected.length === 0 && selectedObligations.length === 0 && income <= 0) {
      setErr('Pilih minimal 1 pos rutin, 1 kewajiban, atau isi pemasukan.');
      return;
    }
    if (!canOpen) {
      setErr(
        loadFailed
          ? 'Daftar pos rutin atau tanggungan belum bisa dibaca. Coba muat ulang dulu supaya siklus tidak terbuka tanpa isinya.'
          : `Funding gap ${formatRupiah(fundingGap)} belum tertutup. Tambah pemasukan, lepas aset, atau catat pinjaman baru dulu.`
      );
      return;
    }
    try {
      const cycle = await createCycle.mutateAsync({
        householdId,
        name: cycleName.trim() || 'Siklus Baru',
        start, end,
        primaryAccountId: defaultAccountId(accsQ.data ?? []),
        incomeAmount: income,
        incomeAccountId: defaultAccountId(accsQ.data ?? []),
        incomeCategoryId: (catsQ.data ?? []).find((c) => c.type === 'INCOME')?.id ?? null,
        items: selected.map((t) => ({
          templateId: t.id, name: t.name,
          amount: amountFor(t.id, t.default_amount),
          categoryId: t.category_id, accountId: t.account_id,
          direction: t.direction,
        })),
        // Carried-over obligations, at their remaining amount. Each becomes a
        // PENDING DEBT_PAYMENT row plus its allocation, so "what do we still owe
        // this cycle" is a list the family can open and pay — not just a number
        // in the projection below.
        //
        // The row name is the obligation title verbatim, matching what
        // `useAllocateObligation` writes: the two paths must produce the same
        // row, or the same debt shows up under two names in the ledger.
        obligations: selectedObligations.map((o) => ({
          obligationId: o.id,
          title: o.title,
          amount: o.remaining_amount,
          categoryId: debtCategoryId,
          accountId: null,
        })),
      });
      void cycle;
      router.replace('/(tabs)');
    } catch (e: any) { setErr(e?.message ?? 'Gagal membuka siklus.'); }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <BrandIcon name="context-calendar" size={44} label="" />
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>TRANSAKSI PAYDAY-TO-PAYDAY • SETUP OTOMATIS</Text>
            <Text style={styles.title}>Buka Siklus Anggaran Baru</Text>
          </View>
        </View>

        <Text style={styles.label}>NAMA SIKLUS</Text>
        <TextInput
          value={cycleName}
          onChangeText={setCycleName}
          placeholder="mis. Siklus Nov 2026"
          placeholderTextColor={Colors.textMuted}
          style={styles.input}
        />
        <View style={styles.dateRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>MULAI</Text>
            <TextInput
              value={start}
              onChangeText={setStart}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>SELESAI</Text>
            <TextInput
              value={end}
              onChangeText={setEnd}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />
          </View>
        </View>
        {/* Branch on the payday itself, not on `cycleWindow`: the window is
            also derived (from today) when payday is unset, so testing the
            window would print "tgl null" for every household that has not set
            one yet — which is the default state after signing up. */}
        <Text style={styles.note}>
          {household?.payday_day
            ? `Tanggal mengikuti hari gajian keluarga (tgl ${household.payday_day}). Ubah kalau siklus ini beda.`
            : 'Belum ada hari gajian di Ruang Keluarga, jadi tanggal di bawah cuma perkiraan sebulan dari hari ini — atur tanggal gajian supaya terisi sendiri.'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>PEMASUKAN GAJIAN PERTAMA</Text>
          <TextInput
            value={incomeText}
            onChangeText={setIncomeText}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={Colors.textMuted}
            style={styles.incomeInput}
          />
          <Text style={styles.muted}>{formatRupiah(income)} • {accsQ.data?.find((a) => a.id === defaultAccountId(accsQ.data ?? []))?.name ?? 'belum ada akun'}</Text>
        </View>

        <View style={styles.labelRow}>
          <Text style={styles.label}>
            PILIH TRANSAKSI RUTIN YANG DI-CLONE ({activeTemplates.length} POS AKTIF)
          </Text>
          {/* Screen 9 (Template Rutin) was registered in the router but nothing
              linked to it, so the screen shipped unreachable. Buka Siklus is
              where a family notices a missing or wrong routine, so the way to
              fix it belongs here rather than buried in My Profile. */}
          <Pressable onPress={() => router.push('/templates')} hitSlop={8}>
            <Text style={styles.labelLink}>Kelola</Text>
          </Pressable>
        </View>
        {tmplQ.isLoading && <Text style={styles.muted}>Memuat template…</Text>}
        {tmplQ.isError && (
          <QueryError
            onRetry={() => tmplQ.refetch()}
            retrying={tmplQ.isFetching}
            message="Daftar pos rutin belum bisa dibaca, jadi siklus ini bisa terbuka tanpa pos yang seharusnya ikut."
          />
        )}
        {!tmplQ.isLoading && !tmplQ.isError && activeTemplates.length === 0 && (
          <View style={styles.emptyArt}>
            <BrandIcon name="empty-belum-ada-rencana" size={72} label="" />
            <Text style={styles.muted}>
              Belum ada pos rutin aktif. Siklus tetap bisa dibuka dengan pemasukan dan tanggungan saja.
            </Text>
          </View>
        )}
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
        {/* Without this, a failed read of the obligations renders the same
            "tidak ada tanggungan terbuka" card as a family that genuinely owes
            nothing — and the cycle would open carrying no debt forward. */}
        {obligQ.isError && (
          <QueryError
            onRetry={() => obligQ.refetch()}
            retrying={obligQ.isFetching}
            message="Daftar tanggungan belum bisa dibaca, jadi kewajiban yang seharusnya ikut ke siklus ini belum terlihat."
          />
        )}
        {obligQ.isLoading && <Text style={styles.muted}>Memuat tanggungan…</Text>}
        {!obligQ.isLoading && !obligQ.isError && openObligations.length === 0 ? (
          <View style={styles.emptyArt}>
            <BrandIcon name="empty-tidak-ada-tagihan" size={72} label="" />
            <Text style={styles.muted}>Tidak ada tanggungan terbuka yang dibawa ke siklus ini.</Text>
          </View>
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

        <ZeroBasedProjection
          title="ZERO-BASED ALLOCATION SIKLUS INI"
          source={{
            incomeLines: [
              { label: '+ Pemasukan gajian', value: income },
              ...(recurringIncome > 0
                ? [{ label: '+ Pos pemasukan rutin', value: recurringIncome }]
                : []),
            ],
            // Nothing has been borrowed or released yet at this point: a loan
            // is recorded after the cycle exists, and asset release has no
            // capture path. The rows render at Rp 0 so a family can see what
            // "sumber dana" excludes, which is the whole point of the row.
            financingInflow: 0,
            assetRelease: 0,
          }}
          allocations={{
            expense: recurringExpense,
            expenseCount: selected.filter((t) => t.direction === 'EXPENSE').length,
            debtPayment: totalDebtPayment,
            debtCount: selectedObligations.length,
            savingsAssets: 0,
            savingsCount: 0,
            other: 0,
            otherCount: 0,
          }}
          readiness={readiness}
          note={
            fundingGap > 0
              ? `Kebutuhan ${formatRupiah(requiredAllocation)} melebihi sumber dana ${formatRupiah(sourceFunds)}. Siklus tidak dapat dibuka selama Funding Gap belum tertutup.`
              : unallocatedLabel
          }
          strategies={
            fundingGap > 0 ? (
              <>
                <Text style={styles.strategiesTitle}>STRATEGI TUTUP FUNDING GAP</Text>
                <Text style={styles.strategy}>• Tambah Pendapatan</Text>
                {/* Quick Add writes OPERATING_INCOME for every income and never
                    ASSET_RELEASE, so this line used to send the family into a
                    form that would record the wrong flow type. It is marked
                    unavailable here the same way Funding Gap already does. */}
                <Text style={styles.strategy}>• Pencairan Aset (Asset Release) — belum tersedia di app</Text>
                <Text style={styles.strategy}>• Pinjaman Baru (Financing Inflow) — catat lewat Quick Add</Text>
              </>
            ) : undefined
          }
        />

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}

        <PrimaryButton
          label={
            createCycle.isPending
              ? 'Membuka…'
              : canOpen
                ? `Buka ${cycleName}`
                : loadFailed
                  ? 'Muat Ulang Dulu'
                  : 'Tutup Funding Gap Dulu'
          }
          onPress={submit}
        />
        <SecondaryButton label="Kembali" onPress={() => router.back()} />
        <Badge label="Pos COMPLETED otomatis tidak muncul di daftar ini" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  emptyArt: { alignItems: 'center', gap: 10, paddingVertical: 12 },

  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 20, gap: 10, paddingBottom: 32 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 0.6 },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '700' },
  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1, marginTop: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  labelLink: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '700', marginTop: 6 },
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
  strategiesTitle: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 1, marginTop: 8 },
  strategy: { color: Colors.borderStrong, fontSize: FontSize.caption, lineHeight: 18 },
  obligRow: { flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, padding: 12, alignItems: 'center' },
  obligAmt: { color: Colors.textPrimary, fontWeight: '600', fontSize: FontSize.body, fontVariant: ['tabular-nums'] },
  note: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
