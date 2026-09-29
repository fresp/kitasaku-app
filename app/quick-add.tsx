import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Calendar from 'lucide-react-native/icons/calendar';
import Info from 'lucide-react-native/icons/info';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah, formatRupiahShort } from '../lib/format';
import { defaultAccountId } from '../lib/account';
import { useAuth } from '../lib/auth-context';
import { useAccounts, useActiveCycle, useCategories, useCreateFinancingLoan, useQuickAdd } from '../lib/queries';
import { longDateFullLabel, REPAYMENT_MODES, type RepaymentMode } from '../lib/obligation';
import { calculateInstallmentSchedule, scheduleInterest, scheduleTotal, type InstallmentMode } from '../lib/installments';
import { categoryIconName } from '../lib/category-icon';
import { PrimaryButton } from '../components/ui/Button';
import { BrandIcon } from '../components/ui/BrandIcon';
import { LinkedEffectCard } from '../components/quick-add/LinkedEffectCard';

function parseAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isValidISODate(value: string): boolean {
  return longDateFullLabel(value) !== null;
}
type Kind = 'out' | 'in' | 'loan';
const KINDS: Kind[] = ['out', 'in', 'loan'];
function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && (KINDS as string[]).includes(value);
}

export default function QuickAddScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; scope?: string }>();
  const initialKind: Kind = isKind(params.kind) ? params.kind : 'out';
  const initialAudit = params.scope === 'audit';
  const [auditMode, setAuditMode] = useState(initialAudit);
  const [lastScopeParam, setLastScopeParam] = useState(initialAudit);
  if (initialAudit !== lastScopeParam) {
    setLastScopeParam(initialAudit);
    setAuditMode(initialAudit);
  }
  const [kind, setKind] = useState<Kind>(initialKind);
  const [lastKindParam, setLastKindParam] = useState<Kind>(initialKind);
  if (initialKind !== lastKindParam) {
    setLastKindParam(initialKind);
    setKind(initialKind);
  }
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const catsQ = useCategories(householdId);
  const accsQ = useAccounts(householdId);
  const quickAdd = useQuickAdd();
  const createLoan = useCreateFinancingLoan();
  const [name, setName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [releaseDate, setReleaseDate] = useState(todayISO());
  const [dateEditing, setDateEditing] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [saveAsPending, setSaveAsPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lender, setLender] = useState('');
  const [repaymentMode, setRepaymentMode] = useState<RepaymentMode>('INSTALLMENT');
  const [tenorText, setTenorText] = useState('');
  const [monthlyRateText, setMonthlyRateText] = useState('');
  const [installmentMode, setInstallmentMode] = useState<InstallmentMode>('FIXED_INSTALLMENT');

  const categories = useMemo(() => catsQ.data ?? [], [catsQ.data]);
  const accounts = useMemo(() => accsQ.data ?? [], [accsQ.data]);
  const amount = parseAmount(amountText);
  const isLoan = kind === 'loan';
  const cycleAvailable = !!cycleQ.data?.id;
  const isAuditEntry = auditMode && !isLoan;
  // Income and expense categories are disjoint in the schema. Keep the picker
  // aligned with the direction so an income cannot be filed as an expense.
  const visibleCategories = useMemo(
    () => kind === 'in'
      ? categories.filter((c) => c.type === 'INCOME' && c.system_role !== 'UNTRACKED')
      : categories.filter((c) => c.type !== 'INCOME' && c.system_role !== 'UNTRACKED'),
    [categories, kind]
  );
  const selectedCategoryId = categoryId && visibleCategories.some((c) => c.id === categoryId)
    ? categoryId
    : visibleCategories[0]?.id ?? null;
  const selectedAccountId = accountId ?? defaultAccountId(accounts);
  const formattedReleaseDate = longDateFullLabel(releaseDate);
  const tenor = parseAmount(tenorText);
  const monthlyRateBps = Math.round((Number(monthlyRateText.replace(',', '.')) || 0) * 100);
  const installmentCount = isLoan && repaymentMode === 'INSTALLMENT' ? tenor : 0;
  const preview = useMemo(() => isLoan && installmentCount > 0 ? calculateInstallmentSchedule({ principalAmount: amount, tenor: installmentCount, mode: installmentMode, monthlyInterestRateBps: monthlyRateBps }) : [], [isLoan, amount, installmentCount, installmentMode, monthlyRateBps]);
  const previewTotal = scheduleTotal(preview);
  const previewInterest = scheduleInterest(preview);
  const ctaLabel = useMemo(() => {
    if (isLoan) {
      if (createLoan.isPending) return 'Menyimpan…';
      return amount > 0
        ? `Simpan Pinjaman • ${formatRupiahShort(previewTotal || amount)}`
        : 'Simpan Pinjaman';
    }
    if (quickAdd.isPending) return 'Menyimpan…';
    const verb = saveAsPending
      ? (kind === 'in' ? 'Simpan rencana pemasukan' : 'Simpan sebagai rencana')
      : (kind === 'in' ? 'Simpan income & tandai diterima' : 'Simpan & tandai sudah dibayar');
    return amount > 0 ? `${verb} • ${formatRupiahShort(amount)}` : verb;
  }, [isLoan, createLoan.isPending, quickAdd.isPending, kind, amount, previewTotal, saveAsPending]);

  async function save() {
    setErr(null);
    if (!householdId) { setErr('Login dulu untuk mencatat transaksi.'); return; }
    if (!isAuditEntry && !cycleAvailable) { setErr('Belum ada siklus aktif. Pilih mode audit untuk mencatat transaksi di luar siklus.'); return; }
    if (!isValidISODate(releaseDate) || releaseDate > todayISO()) { setErr('Tanggal transaksi tidak valid atau berada di masa depan.'); return; }
    if (!isLoan && name.trim().length < 3) { setErr('Nama transaksi minimal 3 huruf.'); return; }
    if (amount <= 0) { setErr('Nominal harus lebih dari Rp 0.'); return; }
    if (isLoan) {
      if (lender.trim().length < 3) { setErr('Nama pemberi pinjaman minimal 3 huruf.'); return; }
      if (repaymentMode === 'INSTALLMENT') {
        if (tenor < 1 || tenor > 600) { setErr('Tenor harus antara 1 dan 600 siklus.'); return; }
        if (preview.length === 0) { setErr('Jadwal cicilan tidak valid.'); return; }
      }
      try {
        await createLoan.mutateAsync({ householdId, cycleId: cycleQ.data!.id, amount, name: `Pencairan ${lender.trim()}`, obligationTitle: lender.trim(), obligationType: 'LOAN', accountId: selectedAccountId, repaymentMode, installmentCount: repaymentMode === 'INSTALLMENT' ? installmentCount : null, startDate: releaseDate, releaseDate, interestFeeAmount: installmentMode === 'FIXED_INSTALLMENT' ? 0 : previewInterest, interestMode: repaymentMode === 'INSTALLMENT' ? installmentMode : null, monthlyInterestRateBps: repaymentMode === 'INSTALLMENT' ? monthlyRateBps : 0 });
        router.back();
      } catch (e: any) { setErr(e?.message ?? 'Gagal menyimpan pinjaman.'); }
      return;
    }
    try {
      await quickAdd.mutateAsync({ householdId, cycleId: auditMode ? null : cycleQ.data!.id, name: name.trim(), amount, direction: kind === 'out' ? 'EXPENSE' : 'INCOME', categoryId: selectedCategoryId, accountId: selectedAccountId, makeRecurring: auditMode ? false : recurring, releaseDate: saveAsPending ? null : releaseDate, status: saveAsPending ? 'PENDING' : 'PAID' });
      router.back();
    } catch (e: any) { setErr(e?.message ?? 'Gagal menyimpan. Coba lagi.'); }
  }

  return (
    <View style={styles.scrim}>
      <Pressable style={styles.scrimTap} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Tutup Quick Add" />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.handle} /><Text style={styles.title}>Quick Add Transaksi</Text>
          <View style={styles.toggle}>
            {([['out', 'Pengeluaran'], ['in', 'Income'], ['loan', 'Terima Pinjaman']] as [Kind, string][]).map(([value, label]) => <Pressable key={value} onPress={() => { setAuditMode(false); setKind(value); }} style={[styles.toggleOpt, !auditMode && kind === value && styles.toggleActive]}><Text style={[styles.toggleText, !auditMode && kind === value && styles.toggleTextActive]}>{label}</Text></Pressable>)}
          </View>
          <Pressable onPress={() => { setAuditMode(!auditMode); if (!auditMode) { setKind('out'); setRecurring(false); } }} style={[styles.auditToggle, auditMode && styles.auditToggleActive]}><View style={{ flex: 1 }}><Text style={[styles.auditTitle, auditMode && styles.auditTitleActive]}>Transaksi audit di luar siklus</Text><Text style={styles.auditSub}>Catat transaksi historis/non-siklus tanpa membebani saldo siklus aktif.</Text></View><Switch value={auditMode} onValueChange={(next) => { setAuditMode(next); if (next) { setKind('out'); setRecurring(false); } }} trackColor={{ true: Colors.paidText, false: Colors.borderStrong }} /></Pressable>
          {auditMode && <Text style={styles.auditNotice}>Mode audit aktif · transaksi tidak masuk perhitungan zero-based siklus.</Text>}
          {!auditMode && !cycleAvailable && <Text style={styles.warning}>Belum ada siklus aktif. Aktifkan mode audit untuk mencatat transaksi di luar siklus.</Text>}
          <Text style={styles.amount}>{formatRupiah(amount)}</Text>
          <TextInput value={amountText} onChangeText={setAmountText} placeholder={isLoan ? 'Nominal pinjaman diterima, mis. 5000000' : 'Ketik nominal, mis. 65000'} placeholderTextColor={Colors.textMuted} keyboardType="number-pad" style={styles.nominalInput} />
          {dateEditing ? <View style={styles.dateEditor}><TextInput value={releaseDate} onChangeText={setReleaseDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} autoFocus style={styles.dateInput} onSubmitEditing={() => setDateEditing(false)} /></View> : <Pressable style={styles.dateRow} onPress={() => setDateEditing(true)}><View style={styles.dateLeft}><Calendar size={16} color={Colors.textPrimary} /><Text style={styles.dateValue}>{formattedReleaseDate ?? releaseDate}</Text></View><Text style={styles.dateLink}>Ubah</Text></Pressable>}
          {isLoan ? <>
            <TextInput value={lender} onChangeText={setLender} placeholder="Contoh: Pinjaman Bank BRI" placeholderTextColor={Colors.textMuted} style={styles.input} />
            <Text style={styles.sectionLabel}>CARA PEMBAYARAN</Text><View style={styles.grid}>{REPAYMENT_MODES.map((m) => <Pressable key={m.value} onPress={() => setRepaymentMode(m.value)} style={[styles.chip, repaymentMode === m.value && styles.chipActive]}><Text style={[styles.chipText, repaymentMode === m.value && styles.chipTextActive]}>{m.label}</Text></Pressable>)}</View>
            {repaymentMode === 'INSTALLMENT' && <>
              <Text style={styles.sectionLabel}>MODEL CICILAN</Text><View style={styles.grid}>{(['FIXED_INSTALLMENT', 'FLOATING_INTEREST'] as InstallmentMode[]).map((mode) => <Pressable key={mode} onPress={() => setInstallmentMode(mode)} style={[styles.chip, installmentMode === mode && styles.chipActive]}><Text style={[styles.chipText, installmentMode === mode && styles.chipTextActive]}>{mode === 'FIXED_INSTALLMENT' ? 'Cicilan tetap' : 'Bunga mengambang'}</Text></Pressable>)}</View>
              <Text style={styles.sectionLabel}>TENOR (SIKLUS)</Text><TextInput value={tenorText} onChangeText={setTenorText} placeholder="mis. 12" placeholderTextColor={Colors.textMuted} keyboardType="number-pad" style={styles.nominalInput} />
              {installmentMode === 'FLOATING_INTEREST' && <><Text style={styles.sectionLabel}>BUNGA PER BULAN (%)</Text><TextInput value={monthlyRateText} onChangeText={setMonthlyRateText} placeholder="mis. 1,5" placeholderTextColor={Colors.textMuted} keyboardType="decimal-pad" style={styles.nominalInput} /></>}
            </>}
            {preview.length > 0 && <View style={styles.preview}><Text style={styles.previewTitle}>{preview.length}× angsuran • total kembali {formatRupiah(previewTotal)}</Text><Text style={styles.previewLine}>{preview.slice(0, 3).map((p) => formatRupiah(p.totalAmount)).join(' · ')}{preview.length > 3 ? ` · … +${preview.length - 3} lagi` : ''}</Text></View>}
            {amount > 0 && <LinkedEffectCard kind="loan" amount={amount} />}
          </> : <>
            <TextInput value={name} onChangeText={setName} placeholder="Contoh: Jajan Kopi & Cemilan" placeholderTextColor={Colors.textMuted} style={styles.input} />
            <Text style={styles.sectionLabel}>{kind === 'in' ? 'KATEGORI INCOME OPERASIONAL' : 'KATEGORI'}</Text><View style={styles.grid}>{visibleCategories.map((c) => <Pressable key={c.id} onPress={() => setCategoryId(c.id)} style={[styles.chip, selectedCategoryId === c.id && styles.chipActive]}><BrandIcon name={categoryIconName({ name: c.name, type: c.type, icon: c.icon })} size={15} label="" /><Text style={[styles.chipText, selectedCategoryId === c.id && styles.chipTextActive]}>{c.name}</Text></Pressable>)}</View>
            <View style={styles.recurring}><View><Text style={styles.recurringTitle}>Jadikan Transaksi Rutin Bulanan</Text><Text style={styles.recurringSub}>Otomatis muncul di siklus berikutnya</Text></View><Switch value={recurring} onValueChange={setRecurring} trackColor={{ true: Colors.paidText, false: Colors.borderStrong }} /></View>
            <View style={styles.recurring}><View style={{ flex: 1 }}><Text style={styles.recurringTitle}>{kind === 'in' ? 'Belum diterima' : 'Belum dibayar'}</Text><Text style={styles.recurringSub}>{kind === 'in' ? 'Simpan sebagai rencana pemasukan dan konfirmasi saat dana masuk.' : 'Simpan sebagai rencana dan konfirmasi saat pembayaran dilakukan.'}</Text></View><Switch value={saveAsPending} onValueChange={setSaveAsPending} trackColor={{ true: Colors.paidText, false: Colors.borderStrong }} /></View>
            {saveAsPending && <Text style={styles.pendingNotice}>Rencana tersimpan sebagai PENDING. Konfirmasi eksekusi melalui Riwayat saat sudah terjadi.</Text>}
          </>}
          <Text style={styles.sectionLabel}>{kind === 'in' ? 'MASUK KE AKUN' : 'AKUN'}</Text><View style={styles.grid}>{accounts.map((a) => <Pressable key={a.id} onPress={() => setAccountId(a.id)} style={[styles.chip, selectedAccountId === a.id && styles.chipOutline]}><Text style={styles.chipText}>{a.name}</Text></Pressable>)}</View>
          {isLoan && <View style={styles.helperCard}><Info size={16} color={Colors.financingText} /><Text style={styles.helperText}>Pinjaman harus memiliki rencana pembayaran agar muncul di daftar kewajiban.</Text></View>}
          {kind === 'in' && <View style={styles.zeroLiabilityCard}><Info size={16} color={Colors.paidText} /><Text style={styles.zeroLiabilityText}>Income operasional menambah kas riil &amp; surplus keluarga tanpa menimbulkan kewajiban utang.</Text></View>}
          {err && <View style={styles.errBox}><Text style={styles.errText}>{err}</Text></View>}
          <PrimaryButton label={ctaLabel} onPress={save} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: Colors.overlayScrimLight, justifyContent: 'flex-end' }, scrimTap: { flex: 1 }, sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, overflow: 'hidden', maxHeight: '92%' }, container: { padding: 20, gap: 12, paddingBottom: 32 }, handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.borderStrong, alignSelf: 'center' }, title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '600' }, toggle: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, flexDirection: 'row', padding: 4 }, toggleOpt: { flex: 1, paddingVertical: 10, borderRadius: Radius.pill, alignItems: 'center' }, toggleActive: { backgroundColor: Colors.surface }, toggleText: { color: Colors.textMuted, fontWeight: '600' }, toggleTextActive: { color: Colors.textPrimary }, amount: { color: Colors.textPrimary, fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'] }, nominalInput: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, paddingHorizontal: 14, height: 48, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.canvas }, dateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, padding: 13 }, dateLeft: { flexDirection: 'row', alignItems: 'center', gap: 9 }, dateValue: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600' }, dateLink: { color: Colors.textPrimary, fontWeight: '700' }, dateEditor: { gap: 5 }, dateInput: { backgroundColor: Colors.canvas, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, height: 44, paddingHorizontal: 12, color: Colors.textPrimary }, input: { backgroundColor: Colors.canvas, borderRadius: Radius.md, padding: 14, borderWidth: 1, borderColor: Colors.borderSubtle, fontSize: 15, color: Colors.textPrimary }, sectionLabel: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '600', letterSpacing: 1 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 5 }, chipActive: { backgroundColor: Colors.brandPrimary }, chipOutline: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.brandPrimary }, chipText: { color: Colors.textSecondary, fontWeight: '600' }, chipTextActive: { color: Colors.white }, recurring: { backgroundColor: Colors.canvas, borderRadius: Radius.md, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, recurringTitle: { color: Colors.textPrimary, fontWeight: '600' }, recurringSub: { color: Colors.textMuted, fontSize: FontSize.body, marginTop: 2 }, preview: { backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 12, gap: 4 }, previewTitle: { color: Colors.textPrimary, fontWeight: '600', fontSize: FontSize.body }, previewLine: { color: Colors.textSecondary, fontSize: FontSize.body, fontVariant: ['tabular-nums'] }, errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 }, errText: { color: Colors.pendingText, fontSize: FontSize.body }, helperCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.financingBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.financingBorder, padding: 10 }, helperText: { flex: 1, color: Colors.financingText, fontSize: FontSize.caption, lineHeight: 16 }, zeroLiabilityCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.paidBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.paidText, padding: 10 }, zeroLiabilityText: { flex: 1, color: Colors.paidText, fontSize: FontSize.caption, lineHeight: 16 }, auditToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.canvas, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.borderSubtle }, auditToggleActive: { backgroundColor: Colors.paidBg, borderColor: Colors.paidText }, auditTitle: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600' }, auditTitleActive: { color: Colors.paidText }, auditSub: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 }, auditNotice: { color: Colors.paidText, backgroundColor: Colors.paidBg, borderRadius: Radius.md, padding: 10, fontSize: FontSize.caption }, warning: { color: Colors.alertText, backgroundColor: Colors.alertBg, borderRadius: Radius.md, padding: 10, fontSize: FontSize.caption }, pendingNotice: { color: Colors.paidText, backgroundColor: Colors.paidBg, borderRadius: Radius.md, padding: 10, fontSize: FontSize.caption },
});
