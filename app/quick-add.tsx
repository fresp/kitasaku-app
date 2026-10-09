import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Calendar from 'lucide-react-native/icons/calendar';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Info from 'lucide-react-native/icons/info';
import X from 'lucide-react-native/icons/x';
import { Colors, Radius } from '../constants/theme';
import { formatRupiah, formatRupiahShort } from '../lib/format';
import { defaultAccountId, isZeroBasedCashAccount } from '../lib/account';
import { useAuth } from '../lib/auth-context';
import {
  useAccounts,
  useActiveCycle,
  useCategories,
  useCreateFinancingLoan,
  useQuickAdd,
} from '../lib/queries';
import {
  longDateFullLabel,
  REPAYMENT_MODES,
  type RepaymentMode,
} from '../lib/obligation';
import {
  calculateInstallmentSchedule,
  scheduleInterest,
  scheduleTotal,
  type InstallmentMode,
} from '../lib/installments';
import { categoryIconName } from '../lib/category-icon';
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
  const [kind, setKind] = useState<Kind>(initialKind);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);

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

  // Loan fields
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

  const visibleCategories = useMemo(
    () =>
      kind === 'in'
        ? categories.filter((c) => c.type === 'INCOME' && c.system_role !== 'UNTRACKED')
        : categories.filter((c) => c.type !== 'INCOME' && c.system_role !== 'UNTRACKED'),
    [categories, kind]
  );

  const selectedCategoryId =
    categoryId && visibleCategories.some((c) => c.id === categoryId)
      ? categoryId
      : visibleCategories[0]?.id ?? null;

  const selectedCategory = visibleCategories.find((c) => c.id === selectedCategoryId);
  const pickedAccountId = accountId ?? defaultAccountId(accounts);
  const pickedAccount = accounts.find((a) => a.id === pickedAccountId);
  // Cycle rows only use BANK / E_WALLET (migration 028). Outside audit mode a
  // credit card or cash pick falls back to the default bank account.
  const selectedAccountId =
    !isAuditEntry && pickedAccount && !isZeroBasedCashAccount(pickedAccount)
      ? defaultAccountId(accounts)
      : pickedAccountId;
  // Audit entries are expenses only, so income never offers non-cash accounts.
  const pickerAccounts = kind === 'in' ? accounts.filter(isZeroBasedCashAccount) : accounts;
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const formattedReleaseDate = longDateFullLabel(releaseDate);

  const tenor = parseAmount(tenorText);
  const monthlyRateBps = Math.round((Number(monthlyRateText.replace(',', '.')) || 0) * 100);
  const installmentCount = isLoan && repaymentMode === 'INSTALLMENT' ? tenor : 0;
  const preview = useMemo(
    () =>
      isLoan && installmentCount > 0
        ? calculateInstallmentSchedule({
            principalAmount: amount,
            tenor: installmentCount,
            mode: installmentMode,
            monthlyInterestRateBps: monthlyRateBps,
          })
        : [],
    [isLoan, amount, installmentCount, installmentMode, monthlyRateBps]
  );
  const previewTotal = scheduleTotal(preview);
  const previewInterest = scheduleInterest(preview);

  const isSubmitting = quickAdd.isPending || createLoan.isPending;

  async function save() {
    setErr(null);
    if (!householdId) {
      setErr('Login dulu untuk mencatat transaksi.');
      return;
    }
    if (!isAuditEntry && !cycleAvailable) {
      setErr('Belum ada siklus aktif. Pilih mode audit untuk mencatat transaksi di luar siklus.');
      return;
    }
    if (!isValidISODate(releaseDate) || releaseDate > todayISO()) {
      setErr('Tanggal transaksi tidak valid atau berada di masa depan.');
      return;
    }
    if (!isLoan && name.trim().length < 3) {
      setErr('Catatan/nama transaksi minimal 3 huruf.');
      return;
    }
    if (amount <= 0) {
      setErr('Nominal harus lebih dari Rp 0.');
      return;
    }

    if (isLoan) {
      if (lender.trim().length < 3) {
        setErr('Nama pemberi pinjaman minimal 3 huruf.');
        return;
      }
      if (repaymentMode === 'INSTALLMENT') {
        if (tenor < 1 || tenor > 600) {
          setErr('Tenor harus antara 1 dan 600 siklus.');
          return;
        }
        if (preview.length === 0) {
          setErr('Jadwal cicilan tidak valid.');
          return;
        }
      }
      try {
        await createLoan.mutateAsync({
          householdId,
          cycleId: cycleQ.data!.id,
          amount,
          name: `Pencairan ${lender.trim()}`,
          obligationTitle: lender.trim(),
          obligationType: 'LOAN',
          accountId: selectedAccountId,
          repaymentMode,
          installmentCount: repaymentMode === 'INSTALLMENT' ? installmentCount : null,
          startDate: releaseDate,
          releaseDate,
          interestFeeAmount: installmentMode === 'FIXED_INSTALLMENT' ? 0 : previewInterest,
          interestMode: repaymentMode === 'INSTALLMENT' ? installmentMode : null,
          monthlyInterestRateBps: repaymentMode === 'INSTALLMENT' ? monthlyRateBps : 0,
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
        cycleId: auditMode ? null : cycleQ.data!.id,
        name: name.trim(),
        amount,
        direction: kind === 'out' ? 'EXPENSE' : 'INCOME',
        categoryId: selectedCategoryId,
        accountId: selectedAccountId,
        makeRecurring: auditMode ? false : recurring,
        releaseDate: saveAsPending ? null : releaseDate,
        status: saveAsPending ? 'PENDING' : 'PAID',
      });
      router.back();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan. Coba lagi.');
    }
  }

  return (
    <View style={styles.scrim}>
      <Pressable
        style={styles.scrimTap}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Tutup Tambah Transaksi"
      />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Sheet Handle */}
          <View style={styles.handle} />

          {/* Header Row (Title & Close Button) */}
          <View style={styles.headerRow}>
            <Text style={styles.title}>
              {kind === 'in' ? 'Catat Pemasukan' : isLoan ? 'Terima Pinjaman' : 'Tambah Transaksi'}
            </Text>
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              accessibilityLabel="Tutup dialog"
              style={styles.closeBtn}
            >
              <X size={20} color={Colors.textPrimary} />
            </Pressable>
          </View>

          {/* Segmented Toggle (Pengeluaran | Pemasukan | Transfer) */}
          <View style={styles.toggle}>
            <Pressable
              onPress={() => {
                setAuditMode(false);
                setKind('out');
              }}
              style={[styles.toggleOpt, kind === 'out' && styles.toggleActive]}
            >
              <Text style={[styles.toggleText, kind === 'out' && styles.toggleTextActive]}>
                Pengeluaran
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setAuditMode(false);
                setKind('in');
              }}
              style={[styles.toggleOpt, kind === 'in' && styles.toggleActive]}
            >
              <Text style={[styles.toggleText, kind === 'in' && styles.toggleTextActive]}>
                Pemasukan
              </Text>
            </Pressable>

            <Pressable
              onPress={() => router.push('/transfer')}
              style={styles.toggleOpt}
            >
              <Text style={styles.toggleText}>Transfer</Text>
            </Pressable>
          </View>

          {/* Audit Toggle Option */}
          <Pressable
            onPress={() => {
              setAuditMode(!auditMode);
              if (!auditMode) {
                setKind('out');
                setRecurring(false);
              }
            }}
            style={[styles.auditToggle, auditMode && styles.auditToggleActive]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.auditTitle, auditMode && styles.auditTitleActive]}>
                Transaksi di luar siklus (audit)
              </Text>
              <Text style={styles.auditSub}>
                Catat transaksi tanpa membebani target pergerakan siklus berjalan.
              </Text>
            </View>
            <Switch
              value={auditMode}
              onValueChange={(next) => {
                setAuditMode(next);
                if (next) {
                  setKind('out');
                  setRecurring(false);
                }
              }}
              trackColor={{ true: Colors.paidText, false: Colors.borderStrong }}
            />
          </Pressable>

          {!auditMode && !cycleAvailable && (
            <Text style={styles.warning}>
              Belum ada siklus aktif. Aktifkan mode audit untuk mencatat transaksi di luar siklus.
            </Text>
          )}

          {/* Field: Nominal */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Nominal</Text>
            <View style={styles.nominalBox}>
              <Text style={styles.nominalPrefix}>Rp</Text>
              <TextInput
                value={amountText}
                onChangeText={setAmountText}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                style={styles.nominalInputField}
              />
            </View>
          </View>

          {isLoan ? (
            <>
              {/* Loan: Pemberi Pinjaman */}
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Pemberi Pinjaman</Text>
                <TextInput
                  value={lender}
                  onChangeText={setLender}
                  placeholder="Contoh: Pinjaman Bank BRI"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.inputCard}
                />
              </View>

              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Cara Pembayaran</Text>
                <View style={styles.chipsRow}>
                  {REPAYMENT_MODES.map((m) => (
                    <Pressable
                      key={m.value}
                      onPress={() => setRepaymentMode(m.value)}
                      style={[styles.chip, repaymentMode === m.value && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, repaymentMode === m.value && styles.chipTextActive]}>
                        {m.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {repaymentMode === 'INSTALLMENT' && (
                <>
                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Model Cicilan</Text>
                    <View style={styles.chipsRow}>
                      {(['FIXED_INSTALLMENT', 'FLOATING_INTEREST'] as InstallmentMode[]).map((mode) => (
                        <Pressable
                          key={mode}
                          onPress={() => setInstallmentMode(mode)}
                          style={[styles.chip, installmentMode === mode && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, installmentMode === mode && styles.chipTextActive]}>
                            {mode === 'FIXED_INSTALLMENT' ? 'Cicilan tetap' : 'Bunga mengambang'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Tenor (Jumlah Siklus/Bulan)</Text>
                    <TextInput
                      value={tenorText}
                      onChangeText={setTenorText}
                      placeholder="mis. 12"
                      placeholderTextColor={Colors.textMuted}
                      keyboardType="number-pad"
                      style={styles.inputCard}
                    />
                  </View>

                  {installmentMode === 'FLOATING_INTEREST' && (
                    <View style={styles.fieldBlock}>
                      <Text style={styles.fieldLabel}>Bunga per Bulan (%)</Text>
                      <TextInput
                        value={monthlyRateText}
                        onChangeText={setMonthlyRateText}
                        placeholder="mis. 1,5"
                        placeholderTextColor={Colors.textMuted}
                        keyboardType="decimal-pad"
                        style={styles.inputCard}
                      />
                    </View>
                  )}
                </>
              )}

              {preview.length > 0 && (
                <View style={styles.previewBox}>
                  <Text style={styles.previewTitle}>
                    {preview.length}× angsuran · total kembali {formatRupiah(previewTotal)}
                  </Text>
                  <Text style={styles.previewLine}>
                    {preview.slice(0, 3).map((p) => formatRupiah(p.totalAmount)).join(' · ')}
                    {preview.length > 3 ? ` · … +${preview.length - 3} lagi` : ''}
                  </Text>
                </View>
              )}

              {amount > 0 && <LinkedEffectCard kind="loan" amount={amount} />}
            </>
          ) : (
            <>
              {/* Field: Kategori */}
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Kategori</Text>
                <Pressable
                  onPress={() => setCategoryPickerOpen(true)}
                  style={styles.selectorRow}
                >
                  <View style={styles.selectorLeft}>
                    {selectedCategory && (
                      <BrandIcon
                        name={categoryIconName({
                          name: selectedCategory.name,
                          type: selectedCategory.type,
                          icon: selectedCategory.icon,
                        })}
                        size={18}
                        label=""
                      />
                    )}
                    <Text style={styles.selectorValue}>
                      {selectedCategory ? selectedCategory.name : 'Pilih kategori'}
                    </Text>
                  </View>
                  <ChevronDown size={18} color={Colors.textMuted} />
                </Pressable>
              </View>

              {/* Field: Tanggal */}
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Tanggal</Text>
                {dateEditing ? (
                  <View style={styles.dateEditor}>
                    <TextInput
                      value={releaseDate}
                      onChangeText={setReleaseDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={Colors.textMuted}
                      autoFocus
                      style={styles.inputCard}
                      onSubmitEditing={() => setDateEditing(false)}
                    />
                  </View>
                ) : (
                  <Pressable style={styles.selectorRow} onPress={() => setDateEditing(true)}>
                    <View style={styles.selectorLeft}>
                      <Calendar size={18} color={Colors.textPrimary} />
                      <Text style={styles.selectorValue}>
                        {formattedReleaseDate ?? releaseDate}
                      </Text>
                    </View>
                    <Text style={styles.editDateLink}>Ubah</Text>
                  </Pressable>
                )}
              </View>

              {/* Field: Akun */}
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>
                  {kind === 'in' ? 'Masuk ke Akun' : 'Akun Pembayaran'}
                </Text>
                <Pressable
                  onPress={() => setAccountPickerOpen(true)}
                  style={styles.selectorRow}
                >
                  <Text style={styles.selectorValue}>
                    {selectedAccount ? selectedAccount.name : 'Pilih akun'}
                  </Text>
                  <ChevronDown size={18} color={Colors.textMuted} />
                </Pressable>
                {isAuditEntry && selectedAccount && !isZeroBasedCashAccount(selectedAccount) && (
                  <Text style={styles.warning}>
                    {selectedAccount.name} dicatat sebagai riwayat di luar siklus, tidak dihitung di siklus.
                  </Text>
                )}
              </View>

              {/* Field: Status Pelunasan */}
              <View style={styles.switchCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchTitle}>
                    {kind === 'in' ? 'Menunggu diterima' : 'Belum dibayar'}
                  </Text>
                  <Text style={styles.switchSub}>
                    {kind === 'in'
                      ? 'Simpan sebagai rencana & konfirmasi saat uang masuk.'
                      : 'Simpan sebagai rencana & konfirmasi saat pembayaran.'}
                  </Text>
                </View>
                <Switch
                  value={saveAsPending}
                  onValueChange={setSaveAsPending}
                  trackColor={{ true: Colors.paidText, false: Colors.borderStrong }}
                />
              </View>

              {/* Recurring Option */}
              <View style={styles.switchCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchTitle}>Jadikan Transaksi Rutin</Text>
                  <Text style={styles.switchSub}>Otomatis muncul di siklus berikutnya</Text>
                </View>
                <Switch
                  value={recurring}
                  onValueChange={setRecurring}
                  trackColor={{ true: Colors.paidText, false: Colors.borderStrong }}
                />
              </View>

              {/* Field: Catatan (opsional) */}
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Catatan (opsional)</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Tulis catatan atau nama transaksi..."
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  style={styles.notesInput}
                />
              </View>
            </>
          )}

          {kind === 'in' && (
            <View style={styles.zeroLiabilityCard}>
              <Info size={16} color={Colors.paidText} />
              <Text style={styles.zeroLiabilityText}>
                Pemasukan menambah kas riil &amp; alokasi siklus tanpa kewajiban utang.
              </Text>
            </View>
          )}

          {err && (
            <View style={styles.errBox}>
              <Text style={styles.errText}>{err}</Text>
            </View>
          )}

          {/* Solid Dark Navy CTA Button */}
          <Pressable
            onPress={save}
            disabled={isSubmitting}
            style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
          >
            <Text style={styles.primaryButtonText}>
              {isSubmitting
                ? 'Menyimpan…'
                : amount > 0
                ? `Simpan · ${formatRupiahShort(amount)}`
                : 'Simpan'}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      {/* Category Picker Modal */}
      <Modal
        visible={categoryPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setCategoryPickerOpen(false)}
        >
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Pilih Kategori</Text>
              <Pressable onPress={() => setCategoryPickerOpen(false)} hitSlop={10}>
                <X size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 340 }}>
              <View style={styles.pickerGrid}>
                {visibleCategories.map((c) => {
                  const isSelected = c.id === selectedCategoryId;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => {
                        setCategoryId(c.id);
                        setCategoryPickerOpen(false);
                      }}
                      style={[styles.pickerItem, isSelected && styles.pickerItemActive]}
                    >
                      <BrandIcon
                        name={categoryIconName({ name: c.name, type: c.type, icon: c.icon })}
                        size={18}
                        label=""
                      />
                      <Text
                        style={[styles.pickerItemText, isSelected && styles.pickerItemTextActive]}
                      >
                        {c.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Account Picker Modal */}
      <Modal
        visible={accountPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAccountPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setAccountPickerOpen(false)}
        >
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Pilih Akun Kas</Text>
              <Pressable onPress={() => setAccountPickerOpen(false)} hitSlop={10}>
                <X size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 300 }}>
              <View style={styles.accountList}>
                {pickerAccounts.map((a) => {
                  const isSelected = a.id === selectedAccountId;
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => {
                        if (!isZeroBasedCashAccount(a) && !auditMode) {
                          setAuditMode(true);
                          setRecurring(false);
                        }
                        setAccountId(a.id);
                        setAccountPickerOpen(false);
                      }}
                      style={[styles.accountOption, isSelected && styles.accountOptionActive]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.accountOptionName,
                            isSelected && styles.accountOptionNameActive,
                          ]}
                        >
                          {a.name}
                        </Text>
                        <Text style={styles.accountOptionType}>{a.type}</Text>
                      </View>
                      {isSelected && <View style={styles.activeDot} />}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: Colors.overlayScrim,
    justifyContent: 'flex-end',
  },
  scrimTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    maxHeight: '94%',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
    gap: 14,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.borderStrong,
    alignSelf: 'center',
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: Colors.textPrimary,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeBtn: {
    padding: 4,
  },

  /* Segmented Toggle */
  toggle: {
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    flexDirection: 'row',
    padding: 4,
    gap: 4,
  },
  toggleOpt: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleActive: {
    backgroundColor: '#0B1527',
  },
  toggleText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  /* Field Structure */
  fieldBlock: {
    gap: 6,
  },
  fieldLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  nominalBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 56,
    backgroundColor: '#FFFFFF',
  },
  nominalPrefix: {
    color: '#0B1527',
    fontSize: 22,
    fontWeight: '700',
    marginRight: 6,
  },
  nominalInputField: {
    flex: 1,
    fontSize: 24,
    fontWeight: '700',
    color: '#0B1527',
    fontVariant: ['tabular-nums'],
  },
  inputCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 14,
    color: '#0B1527',
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
  },
  selectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  selectorValue: {
    color: '#0B1527',
    fontSize: 14,
    fontWeight: '600',
  },
  editDateLink: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
  },
  dateEditor: {
    gap: 6,
  },
  notesInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    minHeight: 74,
    fontSize: 13.5,
    color: '#0B1527',
    textAlignVertical: 'top',
  },

  /* Switch Cards */
  switchCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  switchTitle: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  switchSub: {
    color: Colors.textMuted,
    fontSize: 10.5,
    marginTop: 2,
    lineHeight: 14,
  },

  /* Audit Toggle */
  auditToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FAFBFD',
    borderRadius: 13,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  auditToggleActive: {
    backgroundColor: Colors.paidBg,
    borderColor: Colors.paidText,
  },
  auditTitle: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  auditTitleActive: {
    color: Colors.paidText,
  },
  auditSub: {
    color: Colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  warning: {
    color: Colors.alertText,
    backgroundColor: Colors.alertBg,
    borderRadius: 10,
    padding: 10,
    fontSize: 11,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#F1F5F9',
    borderRadius: Radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: Colors.navy,
  },
  chipText: {
    color: Colors.textSecondary,
    fontSize: 11.5,
    fontWeight: '600',
  },
  chipTextActive: {
    color: Colors.white,
  },
  previewBox: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  previewTitle: {
    color: Colors.textPrimary,
    fontWeight: '700',
    fontSize: 12,
  },
  previewLine: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  zeroLiabilityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.paidBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.paidText,
    padding: 10,
  },
  zeroLiabilityText: {
    flex: 1,
    color: Colors.paidText,
    fontSize: 11,
    lineHeight: 15,
  },
  errBox: {
    backgroundColor: Colors.pendingBg,
    borderRadius: 11,
    padding: 11,
  },
  errText: {
    color: Colors.pendingText,
    fontSize: 12,
  },

  /* Primary Solid Button */
  primaryButton: {
    backgroundColor: Colors.navy,
    borderRadius: 16,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '700',
  },

  /* Modals */
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlayScrim,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 32,
    gap: 12,
  },
  sheetHandle: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.borderStrong,
    alignSelf: 'center',
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sheetTitle: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 4,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: '#F1F5F9',
  },
  pickerItemActive: {
    backgroundColor: Colors.accentSoft,
    borderWidth: 1,
    borderColor: Colors.accentStrong,
  },
  pickerItemText: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  pickerItemTextActive: {
    color: Colors.accentStrong,
    fontWeight: '700',
  },
  accountList: {
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: 14,
    overflow: 'hidden',
  },
  accountOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  accountOptionActive: {
    backgroundColor: '#F8FAFC',
  },
  accountOptionName: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  accountOptionNameActive: {
    color: Colors.info,
    fontWeight: '700',
  },
  accountOptionType: {
    color: Colors.textMuted,
    fontSize: 10.5,
    marginTop: 2,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.info,
  },
});
