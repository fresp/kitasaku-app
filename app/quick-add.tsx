import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Info from 'lucide-react-native/icons/info';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah, formatRupiahShort } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useAccounts,
  useActiveCycle,
  useCategories,
  useCreateFinancingLoan,
  useQuickAdd,
} from '../lib/queries';
import { REPAYMENT_MODES, type RepaymentMode } from '../lib/obligation';
import { splitInstallments } from '../lib/zero-based';
import { categoryIconName } from '../lib/category-icon';
import { PrimaryButton } from '../components/ui/Button';
import { BrandIcon } from '../components/ui/BrandIcon';
import { LinkedEffectCard } from '../components/quick-add/LinkedEffectCard';

function parseAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

type Kind = 'out' | 'in' | 'loan';

const KINDS: Kind[] = ['out', 'in', 'loan'];

function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && (KINDS as string[]).includes(value);
}

export default function QuickAddScreen() {
  const router = useRouter();
  // Callers preselect the mode so the button the family tapped matches the form
  // they land on ("Catat pemasukan" must not open Pengeluaran, and the Funding
  // Gap strategies must not all open it either). A missing or unknown param
  // falls back to expense, the most common entry point.
  const params = useLocalSearchParams<{ kind?: string }>();
  const initialKind: Kind = isKind(params.kind) ? params.kind : 'out';
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const catsQ = useCategories(householdId);
  const accsQ = useAccounts(householdId);
  const quickAdd = useQuickAdd();
  const createLoan = useCreateFinancingLoan();

  const [kind, setKind] = useState<Kind>(initialKind);
  // `kind` is user-editable once open, so it cannot simply be derived from the
  // param the way history.tsx derives its status filter. Re-syncing during render
  // instead of in an effect keeps a re-push onto a still-mounted screen (a
  // different entry point asking for a different mode) from landing on the old
  // one — and avoids the setState-in-effect cascading render that lint flags.
  const [lastKindParam, setLastKindParam] = useState<Kind>(initialKind);
  if (initialKind !== lastKindParam) {
    setLastKindParam(initialKind);
    setKind(initialKind);
  }
  const [name, setName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Loan-only fields. Kept separate from the expense/income state so switching
  // mode never carries a half-filled schedule into a plain transaction.
  //
  // `repaymentMode` is the plan SHAPE (design's "Rencana bayar" / Flow A's "Cara
  // pembayaran"), not how the money physically moves. The old form here asked
  // for `repayment_method` (Transfer/Tunai/…) plus an interest figure — neither
  // appears in design Screen 4, and neither is what decides whether the loan
  // shows up in Kewajiban with a schedule.
  const [lender, setLender] = useState('');
  const [repaymentMode, setRepaymentMode] = useState<RepaymentMode>('INSTALLMENT');
  // Per-cycle installment for INSTALLMENT mode. The row count is derived from it
  // rather than asked for directly, so the family states the number they will
  // actually pay each cycle and cannot enter a schedule that does not sum to the
  // loan. Loan principal carries no interest here — design Screen 4 has no
  // interest field, so "total repayment" is just the amount received.
  const [perCycleText, setPerCycleText] = useState('');

  const categories = useMemo(() => catsQ.data ?? [], [catsQ.data]);
  const accounts = useMemo(() => accsQ.data ?? [], [accsQ.data]);
  const amount = parseAmount(amountText);
  const isLoan = kind === 'loan';

  // Income and expense categories are disjoint in the schema (migration 001:
  // type in EXPENSE/INCOME/INVESTMENT). Showing every category in both modes let
  // an income transaction be filed under an expense category, which then skewed
  // the budget-health ring. Design 4B labels this grid "KATEGORI INCOME
  // OPERASIONAL" and lists only income categories, so filter both ways.
  const visibleCategories = useMemo(
    () =>
      kind === 'in'
        ? categories.filter((c) => c.type === 'INCOME')
        : categories.filter((c) => c.type !== 'INCOME'),
    [categories, kind]
  );

  // Derived from the filtered list, not the raw one. An explicit pick only
  // survives while it is actually visible: switching Pengeluaran → Income after
  // choosing an expense category would otherwise leave the stale id selected,
  // wrong for the transaction being written.
  const pickedCategoryId =
    categoryId && visibleCategories.some((c) => c.id === categoryId) ? categoryId : null;
  const selectedCategoryId = pickedCategoryId ?? visibleCategories[0]?.id ?? null;
  const selectedAccountId = accountId ?? accounts[0]?.id ?? null;

  const perCycle = parseAmount(perCycleText);
  // No interest input in design Screen 4, so the repayment total IS the amount
  // received. `interestFeeAmount` is still passed as 0 explicitly rather than
  // omitted, so the RPC's own default can never drift from the preview.
  const totalRepayment = amount;
  // Derived from the per-cycle figure instead of asked for directly: the family
  // states what they will pay each cycle, and the row count follows from the
  // loan, so the schedule cannot be entered in a way that fails to sum.
  const installmentCount = useMemo(() => {
    if (!isLoan || repaymentMode !== 'INSTALLMENT' || perCycle <= 0 || amount <= 0) return 0;
    return Math.ceil(amount / perCycle);
  }, [isLoan, repaymentMode, perCycle, amount]);

  // Preview only — the SQL splitter in migration 005 is what actually writes
  // the rows; both are pinned to the same examples by the test suite.
  const preview = useMemo(
    () => (isLoan && installmentCount > 0 ? splitInstallments(totalRepayment, installmentCount) : []),
    [isLoan, totalRepayment, installmentCount]
  );

  // Design names the amount on the button (4B: "Simpan Income • Rp 15,8 jt",
  // 4: "Simpan Pinjaman • Rp 10 jt"), so the last thing read before committing
  // is how much is being committed. The nominal is dropped until one is typed
  // rather than showing "• Rp 0".
  const ctaLabel = useMemo(() => {
    if (isLoan) {
      if (createLoan.isPending) return 'Menyimpan…';
      return amount > 0 ? `Simpan Pinjaman • ${formatRupiahShort(totalRepayment)}` : 'Simpan Pinjaman';
    }
    if (quickAdd.isPending) return 'Menyimpan…';
    if (kind === 'in') {
      return amount > 0 ? `Simpan Income • ${formatRupiahShort(amount)}` : 'Simpan Income';
    }
    return amount > 0 ? `Simpan Transaksi • ${formatRupiahShort(amount)}` : 'Simpan Transaksi';
  }, [isLoan, createLoan.isPending, quickAdd.isPending, kind, amount, totalRepayment]);

  async function save() {
    setErr(null);
    if (!householdId || !cycleQ.data?.id) {
      setErr('Belum ada siklus aktif. Buat siklus dulu lewat "Buka Siklus Baru".');
      return;
    }
    if (!isLoan && name.trim().length < 3) { setErr('Nama transaksi minimal 3 huruf.'); return; }
    if (amount <= 0) { setErr('Nominal harus lebih dari Rp 0.'); return; }

    if (isLoan) {
      if (lender.trim().length < 3) { setErr('Nama pemberi pinjaman minimal 3 huruf.'); return; }
      // The plan is what makes a loan show up in Kewajiban with a schedule, so
      // each mode is held to its own requirement rather than one shared count.
      if (repaymentMode === 'INSTALLMENT') {
        if (perCycle <= 0) { setErr('Nominal cicilan harus lebih dari Rp 0.'); return; }
        if (perCycle > amount) { setErr('Nominal cicilan tidak boleh melebihi nominal pinjaman.'); return; }
        // The RPC caps installments at 600, so a tiny per-cycle figure against a
        // large loan has to be refused here rather than sent and rejected. No
        // lower-bound check is needed: with perCycle >= 1, ceil(amount/perCycle)
        // can never exceed amount, so the RPC's "total < count" guard is
        // unreachable from this form.
        if (installmentCount > 600) { setErr('Jumlah angsuran maksimal 600.'); return; }
      }
      try {
        await createLoan.mutateAsync({
          householdId,
          cycleId: cycleQ.data.id,
          amount,
          name: `Pencairan ${lender.trim()}`,
          obligationTitle: lender.trim(),
          obligationType: 'LOAN',
          accountId: selectedAccountId,
          repaymentMode,
          // Only an installment plan has rows; LUMP and MANUAL settle without a
          // schedule, and asking the RPC to generate one row would give them a
          // fake plan the family never chose.
          installmentCount: repaymentMode === 'INSTALLMENT' ? installmentCount : null,
          startDate: new Date().toISOString().slice(0, 10),
          interestFeeAmount: 0,
        });
        router.back();
      } catch (e: any) {
        setErr(e?.message ?? 'Gagal menyimpan pinjaman.');
      }
      return;
    }

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

  // Design draws this as a bottom sheet over a scrim, not a full screen: the
  // strip of dimmed content behind it is what tells the family they have not
  // left the screen they were on. The route is still a full-screen modal
  // (presentation: 'modal' in _layout.tsx) because the loan form is long and a
  // short sheet would fight the keyboard — only the chrome changes.
  return (
    <View style={styles.scrim}>
      {/* Tapping the dim area dismisses, which is what a scrim promises. It
          costs a half-filled form, so it lives on the scrim only and never on
          the sheet itself. */}
      <Pressable
        style={styles.scrimTap}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Tutup Quick Add"
      />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Quick Add Transaksi</Text>

          <View style={styles.toggle}>
            <Pressable onPress={() => setKind('out')} style={[styles.toggleOpt, kind === 'out' && styles.toggleActive]}>
              <Text style={[styles.toggleText, kind === 'out' && styles.toggleTextActive]}>Pengeluaran</Text>
            </Pressable>
            <Pressable onPress={() => setKind('in')} style={[styles.toggleOpt, kind === 'in' && styles.toggleActive]}>
              <Text style={[styles.toggleText, kind === 'in' && styles.toggleTextActive]}>Income</Text>
            </Pressable>
            <Pressable onPress={() => setKind('loan')} style={[styles.toggleOpt, isLoan && styles.toggleActive]}>
              <Text style={[styles.toggleText, isLoan && styles.toggleTextActive]}>Terima Pinjaman</Text>
            </Pressable>
          </View>

          <Text style={styles.amount}>{formatRupiah(amount)}</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder={isLoan ? 'Nominal pinjaman diterima, mis. 5000000' : 'Ketik nominal, mis. 65000'}
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            style={styles.nominalInput}
          />
          <Text style={styles.dateHint}>
            {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
            {isLoan ? ' • Pemasukan Pendanaan' : kind === 'in' ? ' • Income Operasional' : ' • Langsung Lunas'}
          </Text>

          {isLoan ? (
            <>
              <TextInput
                value={lender}
                onChangeText={setLender}
                placeholder="Contoh: Pinjaman Bank BRI"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />

              <Text style={styles.sectionLabel}>CARA PEMBAYARAN</Text>
              <View style={styles.grid}>
                {REPAYMENT_MODES.map((m) => {
                  const active = repaymentMode === m.value;
                  return (
                    <Pressable
                      key={m.value}
                      onPress={() => setRepaymentMode(m.value)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{m.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.modeHint}>
                {REPAYMENT_MODES.find((m) => m.value === repaymentMode)?.hint}
              </Text>

              {repaymentMode === 'INSTALLMENT' && (
                <>
                  <Text style={styles.sectionLabel}>NOMINAL CICILAN PER SIKLUS</Text>
                  <TextInput
                    value={perCycleText}
                    onChangeText={setPerCycleText}
                    placeholder="mis. 2000000"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                    style={styles.nominalInput}
                  />
                  {installmentCount > 0 && (
                    <Text style={styles.modeHint}>
                      {formatRupiahShort(perCycle)} / siklus · estimasi {installmentCount} kali
                    </Text>
                  )}
                </>
              )}

              {preview.length > 0 && (
                <View style={styles.preview}>
                  <Text style={styles.previewTitle}>
                    {preview.length}× angsuran • total kembali {formatRupiah(totalRepayment)}
                  </Text>
                  <Text style={styles.previewLine}>
                    {preview
                      .slice(0, 3)
                      .map((p) => formatRupiah(p))
                      .join(' · ')}
                    {preview.length > 3 ? ` · … +${preview.length - 3} lagi` : ''}
                  </Text>
                </View>
              )}

              {amount > 0 && <LinkedEffectCard kind="loan" amount={amount} />}
            </>
          ) : (
            <>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Contoh: Jajan Kopi & Cemilan"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />

              <Text style={styles.sectionLabel}>
                {kind === 'in' ? 'KATEGORI INCOME OPERASIONAL' : 'KATEGORI'}
              </Text>
              <View style={styles.grid}>
                {visibleCategories.map((c) => {
                  const active = (selectedCategoryId ?? '') === c.id;
                  return (
                    <Pressable key={c.id} onPress={() => setCategoryId(c.id)} style={[styles.chip, active && styles.chipActive]}>
                      {/* The chip is how the family picks a category, so it shows
                          the icon that will end up on the transaction row. */}
                      <BrandIcon
                        name={categoryIconName({ name: c.name, type: c.type, icon: c.icon })}
                        size={15}
                        label=""
                      />
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.name}</Text>
                    </Pressable>
                  );
                })}
                {visibleCategories.length === 0 && (
                  <Text style={styles.muted}>
                    {catsQ.isLoading
                      ? 'Memuat kategori…'
                      : kind === 'in'
                        ? 'Belum ada kategori pemasukan. Tambahkan lewat Kelola Kategori.'
                        : 'Belum ada kategori pengeluaran. Tambahkan lewat Kelola Kategori.'}
                  </Text>
                )}
              </View>

              <View style={styles.recurring}>
                <View>
                  <Text style={styles.recurringTitle}>Jadikan Transaksi Rutin Bulanan</Text>
                  <Text style={styles.recurringSub}>Otomatis muncul di siklus berikutnya</Text>
                </View>
                <Switch value={recurring} onValueChange={setRecurring} trackColor={{ true: Colors.paidText, false: Colors.borderStrong }} />
              </View>
            </>
          )}

          <Text style={styles.sectionLabel}>{kind === 'in' ? 'MASUK KE AKUN' : 'AKUN'}</Text>
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

          {/* Design 4 places this after AKUN, and 4B places its income twin after
              MASUK KE AKUN: the helper answers the question the chosen account
              raises, so it reads as a consequence of the row above it. */}
          {isLoan && (
            <View style={styles.helperCard}>
              <Info size={16} color={Colors.financingText} />
              <Text style={styles.helperText}>
                Pinjaman harus memiliki rencana pembayaran agar muncul di daftar kewajiban.
              </Text>
            </View>
          )}

          {kind === 'in' && (
            <>
              <View style={styles.zeroLiabilityCard}>
                <Info size={16} color={Colors.paidText} />
                <Text style={styles.zeroLiabilityText}>
                  Income operasional menambah kas riil &amp; surplus keluarga tanpa menimbulkan
                  kewajiban utang.
                </Text>
              </View>
              {amount > 0 && (
                <LinkedEffectCard
                  kind="income"
                  amount={amount}
                  accountName={accounts.find((a) => a.id === selectedAccountId)?.name}
                />
              )}
            </>
          )}

          {err && (
            <View style={styles.errBox}>
              <Text style={styles.errText}>{err}</Text>
            </View>
          )}

          <PrimaryButton
            label={ctaLabel}
            onPress={save}
          />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  // The scrim is the dimmed backdrop from design ($overlay.scrim-light); the
  // sheet sits at the bottom of it with only its top corners rounded, which is
  // what makes it read as a sheet rather than a screen.
  scrim: { flex: 1, backgroundColor: Colors.overlayScrimLight, justifyContent: 'flex-end' },
  scrimTap: { flex: 1 },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    // Rounded top corners only clip if the sheet clips: without this, content
    // overscrolling past the top edge paints square corners over the scrim.
    overflow: 'hidden',
    // Capped so a strip of scrim stays visible on a tall screen: a sheet that
    // reaches the status bar has stopped being a sheet.
    maxHeight: '92%',
  },
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
  preview: { backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 12, gap: 4 },
  previewTitle: { color: Colors.textPrimary, fontWeight: '600', fontSize: FontSize.body },
  previewLine: { color: Colors.textSecondary, fontSize: FontSize.body, fontVariant: ['tabular-nums'] },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
  modeHint: { color: Colors.textMuted, fontSize: FontSize.body, lineHeight: 18 },
  // Design's loan validation card ($state.financing.bg) and income explainer
  // ($state.paid.bg) are the same shape in two tones.
  helperCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.financingBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.financingBorder, padding: 10,
  },
  helperText: { flex: 1, color: Colors.financingText, fontSize: FontSize.caption, lineHeight: 16 },
  zeroLiabilityCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.paidBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.paidText, padding: 10,
  },
  zeroLiabilityText: { flex: 1, color: Colors.paidText, fontSize: FontSize.caption, lineHeight: 16 },
});
