import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Check from 'lucide-react-native/icons/check';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Copy from 'lucide-react-native/icons/copy';
import MoreVertical from 'lucide-react-native/icons/ellipsis-vertical';
import Pencil from 'lucide-react-native/icons/pencil';
import ReceiptText from 'lucide-react-native/icons/receipt-text';
import Trash2 from 'lucide-react-native/icons/trash';
import X from 'lucide-react-native/icons/x';
import { Colors, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  cleanAccountNumber,
  formatAccountNumberDisplay,
  formatBankBadge,
  formatBeneficiaryHolder,
} from '../lib/beneficiary';
import {
  useActiveCycle,
  CANCELLATION_REASONS,
  useConfigureObligationInstallments,
  useAccounts,
  useAllocateDebtPayment,
  useCancelObligation,
  useBeneficiaries,
  useObligationInstallments,
  useObligationPayments,
  useObligations,
  useTransactionById,
} from '../lib/queries';
import {
  installmentProgressLabel,
  longDateFullLabel,
  nextOpenInstallment,
  normalizeObligationType,
  obligationTypeLabel,
  repaymentModeLabel,
  type RepaymentMode,
} from '../lib/obligation';
import {
  calculateInstallmentSchedule,
  scheduleTotal,
  type InstallmentMode,
} from '../lib/installments';
import { categoryIconName } from '../lib/category-icon';
import { BrandIcon } from '../components/ui/BrandIcon';
import { PrimaryButton, SecondaryButton, TextButton } from '../components/ui/Button';

type DetailTab = 'detail' | 'history';

export default function LoanDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const cycleId = cycleQ.data?.id;
  const obligQ = useObligations(householdId);
  const instQ = useObligationInstallments(householdId, id);
  const payQ = useObligationPayments(householdId, id);
  const accsQ = useAccounts(householdId);
  const beneficiariesQ = useBeneficiaries(householdId);
  const configureInstallments = useConfigureObligationInstallments();
  const pay = useAllocateDebtPayment();
  const cancelObligation = useCancelObligation();

  const [activeTab, setActiveTab] = useState<DetailTab>('detail');
  const [err, setErr] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<InstallmentMode>('FIXED_INSTALLMENT');
  const [schedulePrincipalText, setSchedulePrincipalText] = useState('');
  const [scheduleTenorText, setScheduleTenorText] = useState('');
  const [scheduleRateText, setScheduleRateText] = useState('');
  const [scheduleFeeText, setScheduleFeeText] = useState('');
  const [scheduleStartDate, setScheduleStartDate] = useState('');
  const [copied, setCopied] = useState(false);
  const todayISO = new Date().toISOString().slice(0, 10);

  const obligation = useMemo(
    () => (obligQ.data ?? []).find((o) => o.id === id) ?? null,
    [obligQ.data, id]
  );
  const installments = useMemo(() => instQ.data ?? [], [instQ.data]);
  const payments = useMemo(() => payQ.data ?? [], [payQ.data]);

  const schedulePrincipal = Number(schedulePrincipalText.replace(/[^0-9]/g, '') || 0);
  const scheduleTenor = Number(scheduleTenorText.replace(/[^0-9]/g, '') || 0);
  const scheduleRateBps = Math.round((Number(scheduleRateText.replace(',', '.')) || 0) * 100);
  const scheduleFee = Number(scheduleFeeText.replace(/[^0-9]/g, '') || 0);
  const schedulePreview = useMemo(
    () =>
      schedulePrincipal > 0 && scheduleTenor > 0
        ? calculateInstallmentSchedule({
            principalAmount: schedulePrincipal,
            tenor: scheduleTenor,
            mode: scheduleMode,
            monthlyInterestRateBps: scheduleRateBps,
          })
        : [],
    [schedulePrincipal, scheduleTenor, scheduleMode, scheduleRateBps]
  );
  const schedulePreviewBaseTotal = scheduleTotal(schedulePreview);
  const schedulePreviewTotal =
    schedulePreviewBaseTotal + (scheduleMode === 'FIXED_INSTALLMENT' ? scheduleFee : 0);
  const schedulePreviewFeePerCycle =
    scheduleTenor > 0 && scheduleMode === 'FIXED_INSTALLMENT'
      ? Math.floor(scheduleFee / scheduleTenor)
      : 0;

  function openSchedule() {
    setErr(null);
    setSchedulePrincipalText(
      String(obligation?.principal_amount ?? obligation?.remaining_amount ?? 0)
    );
    setScheduleTenorText(String(obligation?.installment_count ?? ''));
    setScheduleRateText(
      obligation?.interest_rate_bps
        ? String(obligation.interest_rate_bps / 100).replace('.', ',')
        : ''
    );
    setScheduleFeeText(String(obligation?.interest_fee_amount ?? 0));
    setScheduleStartDate(obligation?.start_date ?? todayISO);
    setScheduleMode(obligation?.interest_mode ?? 'FIXED_INSTALLMENT');
    setScheduleOpen(true);
  }

  async function saveSchedule() {
    setErr(null);
    if (!householdId) {
      setErr('Login dulu untuk mengatur cicilan.');
      return;
    }
    if (!obligation) {
      setErr('Tanggungan tidak ditemukan.');
      return;
    }
    if (schedulePreview.length === 0) {
      setErr('Isi pokok dan tenor yang valid terlebih dahulu.');
      return;
    }
    try {
      await configureInstallments.mutateAsync({
        householdId,
        obligationId: obligation.id,
        cycleId: cycleId ?? null,
        principal: schedulePrincipal,
        count: scheduleTenor,
        startDate: scheduleStartDate || todayISO,
        interestMode: scheduleMode,
        flatInterest: scheduleMode === 'FIXED_INSTALLMENT' ? scheduleFee : 0,
        monthlyInterestRateBps: scheduleMode === 'FLOATING_INTEREST' ? scheduleRateBps : 0,
      });
      setScheduleOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan jadwal cicilan.');
    }
  }

  const beneficiary = useMemo(() => {
    if (obligation?.beneficiary) return obligation.beneficiary;
    if (!obligation?.beneficiary_id) return null;
    return (beneficiariesQ.data ?? []).find((b) => b.id === obligation.beneficiary_id) ?? null;
  }, [obligation, beneficiariesQ.data]);

  async function handleCopyBeneficiary() {
    if (!beneficiary?.account_number) return;
    const num = cleanAccountNumber(beneficiary.account_number);
    await Clipboard.setStringAsync(num);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const sourceQ = useTransactionById(householdId, obligation?.source_transaction_id ?? undefined);

  if (!obligation) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>
            {obligQ.isLoading ? 'Memuat…' : 'Kewajiban tidak ditemukan'}
          </Text>
          <TextButton label="Kembali" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const type = normalizeObligationType(obligation.type);
  const settled = obligation.status === 'SETTLED';
  const cancelled = obligation.status === 'CANCELLED';

  const nextInst = nextOpenInstallment(installments);
  const nextDueISO = nextInst?.due_date ?? obligation.due_date ?? null;
  const nextOpenAmount =
    nextInst?.planned_amount ?? obligation.planned_installment_amount ?? obligation.remaining_amount;

  const ob = obligation;

  async function payNow() {
    setErr(null);
    if (!householdId || !cycleId) {
      setErr('Buka siklus aktif dulu sebelum membayar.');
      return;
    }
    const amount = Math.min(nextOpenAmount, ob.remaining_amount);
    if (!(amount > 0)) {
      setErr('Tidak ada sisa yang perlu dibayar.');
      return;
    }
    try {
      await pay.mutateAsync({
        householdId,
        cycleId,
        obligationId: ob.id,
        amount,
        accountId: accsQ.data?.[0]?.id ?? null,
      });
      setPayOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal mencatat pembayaran.');
    }
  }

  async function cancel() {
    setErr(null);
    if (!householdId) return;
    if (!cancelReason) {
      setErr('Pilih alasan pembatalan.');
      return;
    }
    try {
      await cancelObligation.mutateAsync({
        householdId,
        obligationId: ob.id,
        reason: cancelReason as Parameters<typeof cancelObligation.mutateAsync>[0]['reason'],
        note: cancelNote,
      });
      setCancelOpen(false);
      router.back();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal membatalkan tanggungan.');
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <ChevronLeft size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.topBarTitle}>Detail Tanggungan</Text>
        <Pressable onPress={() => setCancelOpen(true)} hitSlop={12} style={styles.moreBtn}>
          <MoreVertical size={20} color={Colors.textPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={instQ.isFetching || payQ.isFetching}
            onRefresh={() => {
              void instQ.refetch();
              void payQ.refetch();
              void obligQ.refetch();
            }}
          />
        }
      >
        {/* Hero Card with Squircle Icon */}
        <View style={styles.heroCard}>
          <View style={styles.heroSquircle}>
            <BrandIcon
              name={categoryIconName({
                name: obligation.title,
                type: 'EXPENSE',
              })}
              size={28}
              label=""
            />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.heroTitle} numberOfLines={1}>
              {obligation.title}
            </Text>
            <Text style={styles.heroAmount}>
              {formatRupiah(obligation.remaining_amount || obligation.total_amount)}
            </Text>
          </View>
        </View>

        {/* 2-Segment Control: Detail | Riwayat */}
        <View style={styles.segmentedControl}>
          <Pressable
            onPress={() => setActiveTab('detail')}
            style={[styles.segmentTab, activeTab === 'detail' && styles.segmentTabActive]}
          >
            <Text
              style={[
                styles.segmentTabText,
                activeTab === 'detail' && styles.segmentTabTextActive,
              ]}
            >
              Detail
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('history')}
            style={[styles.segmentTab, activeTab === 'history' && styles.segmentTabActive]}
          >
            <Text
              style={[
                styles.segmentTabText,
                activeTab === 'history' && styles.segmentTabTextActive,
              ]}
            >
              Riwayat
            </Text>
          </Pressable>
        </View>

        {/* Tab 1: Detail View */}
        {activeTab === 'detail' && (
          <View style={styles.metaCard}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Kategori</Text>
              <Text style={styles.metaValue}>{obligationTypeLabel(obligation.type)}</Text>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Tanggal jatuh tempo</Text>
              <Text style={styles.metaValue}>
                {nextDueISO ? longDateFullLabel(nextDueISO) ?? '—' : 'Belum ditentukan'}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Frekuensi</Text>
              <Text style={styles.metaValue}>
                {repaymentModeLabel(obligation.repayment_mode as RepaymentMode) ?? 'Bulanan'}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Akun pembayaran</Text>
              <Text style={styles.metaValue}>
                {beneficiary?.bank_name
                  ? formatBankBadge(beneficiary.bank_name)
                  : sourceQ.data?.accounts?.name ?? 'BCA'}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Pengingat</Text>
              <Text style={styles.metaValue}>2 hari sebelum</Text>
            </View>

            <View style={[styles.metaRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.metaLabel}>Catatan</Text>
              <View style={styles.notesRight}>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {obligation.notes || '—'}
                </Text>
                <ChevronRight size={14} color={Colors.textMuted} />
              </View>
            </View>

            {/* If Beneficiary Account details exist, show copy card */}
            {beneficiary && (
              <View style={styles.transferBox}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.transferBank}>
                    {formatBankBadge(beneficiary.bank_name)} · {beneficiary.name}
                  </Text>
                  <Text style={styles.transferNumber}>
                    {formatAccountNumberDisplay(beneficiary.account_number)}
                    {formatBeneficiaryHolder(beneficiary.account_holder_name)
                      ? ` (${formatBeneficiaryHolder(beneficiary.account_holder_name)})`
                      : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={handleCopyBeneficiary}
                  style={[styles.copyBtn, copied && styles.copyBtnActive]}
                >
                  {copied ? (
                    <>
                      <Check size={12} color={Colors.accentStrong} />
                      <Text style={styles.copyBtnTextCopied}>Tersalin</Text>
                    </>
                  ) : (
                    <>
                      <Copy size={12} color={Colors.info} />
                      <Text style={styles.copyBtnText}>Salin</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}

            {/* Installment configuration helper if applicable */}
            {!cancelled && (type === 'LOAN' || type === 'INSTALLMENT') && (
              <View style={styles.installmentBox}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.installmentTitle}>Atur Tenor & Cicilan</Text>
                  <Text style={styles.installmentSub}>
                    {installmentProgressLabel(installments) || 'Buat jadwal nominal per siklus'}
                  </Text>
                </View>
                <Pressable onPress={openSchedule} style={styles.scheduleBtn}>
                  <Text style={styles.scheduleBtnText}>Atur</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* Tab 2: Riwayat View */}
        {activeTab === 'history' && (
          <View style={styles.metaCard}>
            {payments.length === 0 ? (
              <View style={styles.emptyBox}>
                <ReceiptText size={24} color={Colors.textMuted} />
                <Text style={styles.emptyTitle}>Belum ada riwayat pembayaran</Text>
                <Text style={styles.emptySub}>
                  Setiap cicilan atau pelunasan akan tercatat otomatis di sini.
                </Text>
              </View>
            ) : (
              payments.map((p, idx) => {
                const isLast = idx === payments.length - 1;
                return (
                  <View
                    key={p.id}
                    style={[styles.histRow, !isLast && styles.histRowBorder]}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.histName}>
                        {p.accounts?.name ?? 'Pembayaran Tanggungan'}
                      </Text>
                      <Text style={styles.histDate}>
                        {longDateFullLabel(p.release_date ?? p.created_at.slice(0, 10))}
                        {p.is_final_payment ? ' · Pelunasan' : ''}
                      </Text>
                    </View>
                    <Text style={styles.histAmt}>{formatRupiah(p.actual_amount)}</Text>
                  </View>
                );
              })
            )}
          </View>
        )}

        {err && <Text style={styles.errBanner}>{err}</Text>}

        {/* Primary Action Button: Tandai sudah dibayar */}
        {!settled && !cancelled && (
          <View style={{ marginTop: 8, gap: 8 }}>
            {payOpen ? (
              <View style={styles.payConfirmCard}>
                <Text style={styles.payConfirmTitle}>Konfirmasi Pembayaran</Text>
                <Text style={styles.payConfirmAmount}>
                  {formatRupiah(Math.min(nextOpenAmount, obligation.remaining_amount))}
                </Text>
                <Text style={styles.payConfirmHint}>
                  {nextInst
                    ? `Sesuai tagihan cicilan per ${longDateFullLabel(nextInst.due_date) ?? 'siklus ini'}.`
                    : 'Nominal akan dicatat sebagai pelunasan tanggungan.'}
                </Text>
                <PrimaryButton
                  label={pay.isPending ? 'Menyimpan…' : 'Konfirmasi Sekarang'}
                  onPress={payNow}
                />
                <SecondaryButton label="Batal" onPress={() => setPayOpen(false)} />
              </View>
            ) : (
              <Pressable onPress={() => setPayOpen(true)} style={styles.markPaidBtn}>
                <Text style={styles.markPaidBtnText}>Tandai sudah dibayar</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Dual Actions: Ubah & Hapus */}
        <View style={styles.dualActionRow}>
          <Pressable
            onPress={openSchedule}
            style={styles.editBtn}
            accessibilityLabel="Ubah tanggungan"
          >
            <Pencil size={16} color={Colors.textPrimary} />
            <Text style={styles.editBtnText}>Ubah</Text>
          </Pressable>

          <Pressable
            onPress={() => setCancelOpen(true)}
            style={styles.deleteBtn}
            accessibilityLabel="Hapus tanggungan"
          >
            <Trash2 size={16} color={Colors.negative} />
            <Text style={styles.deleteBtnText}>Hapus</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Cancel Modal */}
      <Modal
        visible={cancelOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCancelOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setCancelOpen(false)}
        >
          <Pressable style={styles.cancelCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.modalTitle}>Batalkan tanggungan?</Text>
            <Text style={styles.modalBody}>
              Tanggungan yang belum dibayar akan ditutup. Catatan audit tetap tersimpan aman.
            </Text>
            <View style={styles.reasonList}>
              {CANCELLATION_REASONS.map((item) => (
                <Pressable
                  key={item.value}
                  onPress={() => setCancelReason(item.value)}
                  style={[
                    styles.reason,
                    cancelReason === item.value && styles.reasonActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.reasonText,
                      cancelReason === item.value && styles.reasonTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={cancelNote}
              onChangeText={setCancelNote}
              placeholder="Catatan tambahan (opsional)"
              placeholderTextColor={Colors.textMuted}
              style={styles.noteInput}
            />
            <View style={styles.modalActions}>
              <View style={{ flex: 1 }}>
                <TextButton label="Kembali" onPress={() => setCancelOpen(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={cancelObligation.isPending ? 'Menyimpan…' : 'Batalkan'}
                  onPress={cancel}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Schedule Configuration Modal */}
      <Modal
        visible={scheduleOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setScheduleOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.scheduleCard}>
            <View style={styles.sheetHandle} />
            <View style={styles.scheduleHeader}>
              <Text style={styles.modalTitle}>Atur Tenor & Cicilan</Text>
              <Pressable onPress={() => setScheduleOpen(false)} hitSlop={10}>
                <X size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.fieldLabel}>POKOK CICILAN</Text>
              <TextInput
                value={schedulePrincipalText}
                onChangeText={setSchedulePrincipalText}
                keyboardType="number-pad"
                placeholder="mis. 5000000"
                placeholderTextColor={Colors.textMuted}
                style={styles.inputBox}
              />
              <Text style={styles.fieldLabel}>TENOR (JUMLAH BULAN/SIKLUS)</Text>
              <TextInput
                value={scheduleTenorText}
                onChangeText={setScheduleTenorText}
                keyboardType="number-pad"
                placeholder="mis. 12"
                placeholderTextColor={Colors.textMuted}
                style={styles.inputBox}
              />
              <Text style={styles.fieldLabel}>BIAYA / BUNGA TETAP (OPSIONAL)</Text>
              <TextInput
                value={scheduleFeeText}
                onChangeText={setScheduleFeeText}
                keyboardType="number-pad"
                placeholder="mis. 250000"
                placeholderTextColor={Colors.textMuted}
                style={styles.inputBox}
              />
              <Text style={styles.fieldLabel}>TANGGAL MULAI</Text>
              <TextInput
                value={scheduleStartDate}
                onChangeText={setScheduleStartDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textMuted}
                style={styles.inputBox}
              />

              {schedulePreview.length > 0 && (
                <View style={styles.previewBox}>
                  <Text style={styles.previewTitle}>
                    {schedulePreview.length}× cicilan · total {formatRupiah(schedulePreviewTotal)}
                  </Text>
                  <Text style={styles.previewLine}>
                    Perkiraan per siklus:{' '}
                    {formatRupiah(schedulePreview[0].totalAmount + schedulePreviewFeePerCycle)}
                  </Text>
                </View>
              )}

              <PrimaryButton
                label={configureInstallments.isPending ? 'Menyimpan…' : 'Simpan Perubahan'}
                onPress={saveSchedule}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 16,
  },

  /* Hero Card */
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  heroSquircle: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    flex: 1,
    gap: 4,
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  heroAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },

  /* Segmented Control */
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: Radius.pill,
    padding: 3,
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentTabActive: {
    backgroundColor: Colors.navy,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  segmentTabTextActive: {
    color: Colors.white,
    fontWeight: '700',
  },

  /* Metadata Card */
  metaCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  metaLabel: {
    fontSize: 14,
    color: '#64748B',
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0B1527',
  },
  notesRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  /* Transfer & Installment Boxes */
  transferBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  transferBank: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  transferNumber: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  copyBtnActive: {
    backgroundColor: Colors.accentSoft,
  },
  copyBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.info,
  },
  copyBtnTextCopied: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.accentStrong,
  },

  installmentBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  installmentTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  installmentSub: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  scheduleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.navy,
  },
  scheduleBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.white,
  },

  /* Empty Box */
  emptyBox: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptySub: {
    fontSize: 11.5,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  histRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  histName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  histDate: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  histAmt: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },

  /* Actions */
  markPaidBtn: {
    height: 50,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markPaidBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0B1527',
  },
  dualActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  editBtn: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  editBtnText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0B1527',
  },
  deleteBtn: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FECACA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  deleteBtnText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#EF4444',
  },

  /* Pay Confirm Card */
  payConfirmCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    gap: 10,
  },
  payConfirmTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  payConfirmAmount: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  payConfirmHint: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4,
  },

  /* Modals */
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlayScrim,
    justifyContent: 'flex-end',
  },
  cancelCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    gap: 12,
  },
  scheduleCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
  },
  sheetHandle: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.borderStrong,
    alignSelf: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  modalBody: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  reasonList: {
    gap: 8,
    marginVertical: 4,
  },
  reason: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  reasonActive: {
    borderColor: Colors.navy,
    backgroundColor: '#F1F5F9',
  },
  reasonText: {
    fontSize: 13,
    color: Colors.textPrimary,
  },
  reasonTextActive: {
    fontWeight: '700',
  },
  noteInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  scheduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  inputBox: {
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    fontSize: 13.5,
    color: Colors.textPrimary,
  },
  previewBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    gap: 4,
  },
  previewTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  previewLine: {
    fontSize: 11.5,
    color: Colors.textSecondary,
  },
  errBanner: {
    fontSize: 12,
    color: Colors.negative,
    backgroundColor: '#FEF2F2',
    padding: 10,
    borderRadius: 10,
  },
  missing: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  missingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
});
