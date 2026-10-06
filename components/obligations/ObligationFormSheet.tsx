import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Calendar from 'lucide-react-native/icons/calendar';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import X from 'lucide-react-native/icons/x';
import { Colors, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import {
  formatAccountNumberDisplay,
  formatBankBadge,
  type Beneficiary,
} from '../../lib/beneficiary';
import { useCategories, useCreateObligation } from '../../lib/queries';
import { BeneficiaryPickerSheet } from './BeneficiaryPickerSheet';

export type FormObligationType = 'BILL' | 'INSTALLMENT' | 'REIMBURSEMENT' | 'LOAN';

const FREQUENCY_OPTIONS = [
  { label: 'Bulanan', type: 'BILL' as FormObligationType },
  { label: 'Sekali bayar', type: 'BILL' as FormObligationType },
  { label: 'Cicilan per bulan', type: 'INSTALLMENT' as FormObligationType },
  { label: 'Mingguan', type: 'BILL' as FormObligationType },
  { label: 'Tahunan', type: 'BILL' as FormObligationType },
];

function formatISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseAmount(text: string): number {
  return parseInt(text.replace(/[^0-9]/g, '') || '0', 10);
}

export function ObligationFormSheet({
  visible,
  onClose,
  householdId,
}: {
  visible: boolean;
  onClose: () => void;
  householdId: string | undefined;
}) {
  const catsQ = useCategories(householdId);
  const createOb = useCreateObligation();

  const [title, setTitle] = useState('');
  const [totalText, setTotalText] = useState('');
  const [frequency, setFrequency] = useState('Bulanan');
  const [type, setType] = useState<FormObligationType>('BILL');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [remindMe, setRemindMe] = useState(true);
  const [attachedBeneficiary, setAttachedBeneficiary] = useState<Beneficiary | null>(null);

  // Sub-pickers
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const [freqPickerOpen, setFreqPickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [beneficiaryPickerOpen, setBeneficiaryPickerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const categories = useMemo(
    () => (catsQ.data ?? []).filter((category) => category.type === 'EXPENSE'),
    [catsQ.data]
  );

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId]
  );

  const totalAmount = parseAmount(totalText);

  function resetForm() {
    setTitle('');
    setTotalText('');
    setFrequency('Bulanan');
    setType('BILL');
    setCategoryId(null);
    setDueDate('');
    setNotes('');
    setRemindMe(true);
    setAttachedBeneficiary(null);
    setErr(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleAmountChange(text: string) {
    const raw = text.replace(/[^0-9]/g, '');
    if (!raw) {
      setTotalText('');
      return;
    }
    const num = parseInt(raw, 10);
    setTotalText(formatRupiah(num));
  }

  function setQuickDueDate(daysFromNow: number) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    setDueDate(formatISO(d));
    setDatePickerOpen(false);
  }

  async function handleSubmit() {
    setErr(null);
    if (!householdId) {
      setErr('Household tidak ditemukan.');
      return;
    }
    if (title.trim().length < 3) {
      setErr('Nama tanggungan minimal 3 karakter.');
      return;
    }
    if (totalAmount <= 0) {
      setErr('Nominal harus lebih dari Rp 0.');
      return;
    }

    try {
      await createOb.mutateAsync({
        householdId,
        title: title.trim(),
        type,
        total: totalAmount,
        dueDate: dueDate.trim() || null,
        categoryId: categoryId || null,
        beneficiaryId: attachedBeneficiary?.id ?? null,
        recipient: attachedBeneficiary?.name ?? (notes.trim() || undefined),
      });
      handleClose();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan tanggungan.');
    }
  }

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={handleClose}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.scrim}
        >
          <View style={styles.sheet}>
            {/* Drag Handle */}
            <View style={styles.sheetHandle} />

            {/* Header: Title + Close */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Tambah Tanggungan</Text>
              <Pressable
                onPress={handleClose}
                hitSlop={12}
                style={styles.closeBtn}
                accessibilityLabel="Tutup"
              >
                <X size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Field 1: Nama Tanggungan */}
              <View style={styles.field}>
                <Text style={styles.label}>Nama Tanggungan</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Contoh: Listrik PLN"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                />
              </View>

              {/* Field 2: Kategori */}
              <View style={styles.field}>
                <Text style={styles.label}>Kategori</Text>
                <Pressable
                  onPress={() => setCatPickerOpen(true)}
                  style={styles.pickerBox}
                >
                  <Text
                    style={[
                      styles.pickerText,
                      !selectedCategory && styles.pickerTextPlaceholder,
                    ]}
                  >
                    {selectedCategory ? selectedCategory.name : 'Pilih kategori'}
                  </Text>
                  <ChevronDown size={18} color={Colors.textMuted} />
                </Pressable>
              </View>

              {/* Field 3: Nominal */}
              <View style={styles.field}>
                <Text style={styles.label}>Nominal</Text>
                <TextInput
                  value={totalText}
                  onChangeText={handleAmountChange}
                  placeholder="Rp 0"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  style={[styles.input, { fontVariant: ['tabular-nums'] }]}
                />
              </View>

              {/* Field 4: Frekuensi */}
              <View style={styles.field}>
                <Text style={styles.label}>Frekuensi</Text>
                <Pressable
                  onPress={() => setFreqPickerOpen(true)}
                  style={styles.pickerBox}
                >
                  <Text style={styles.pickerText}>{frequency}</Text>
                  <ChevronDown size={18} color={Colors.textMuted} />
                </Pressable>
              </View>

              {/* Field 5: Tanggal jatuh tempo */}
              <View style={styles.field}>
                <Text style={styles.label}>Tanggal jatuh tempo</Text>
                <Pressable
                  onPress={() => setDatePickerOpen(true)}
                  style={styles.pickerBox}
                >
                  <View style={styles.rowCenter}>
                    <Calendar size={18} color={Colors.textMuted} />
                    <Text
                      style={[
                        styles.pickerText,
                        !dueDate && styles.pickerTextPlaceholder,
                        { marginLeft: 8 },
                      ]}
                    >
                      {dueDate ? dueDate : 'Pilih tanggal'}
                    </Text>
                  </View>
                  <ChevronDown size={18} color={Colors.textMuted} />
                </Pressable>
              </View>

              {/* Field 6: Akun pembayaran */}
              <View style={styles.field}>
                <Text style={styles.label}>Akun pembayaran</Text>
                <Pressable
                  onPress={() => setBeneficiaryPickerOpen(true)}
                  style={styles.pickerBox}
                >
                  <Text
                    style={[
                      styles.pickerText,
                      !attachedBeneficiary && styles.pickerTextPlaceholder,
                    ]}
                    numberOfLines={1}
                  >
                    {attachedBeneficiary
                      ? `${formatBankBadge(attachedBeneficiary.bank_name)} · ${formatAccountNumberDisplay(attachedBeneficiary.account_number)}`
                      : 'Pilih akun'}
                  </Text>
                  <ChevronDown size={18} color={Colors.textMuted} />
                </Pressable>
              </View>

              {/* Field 7: Catatan (opsional) */}
              <View style={styles.field}>
                <Text style={styles.label}>Catatan (opsional)</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Tulis catatan..."
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                />
              </View>

              {/* Field 8: Ingatkan saya Switch */}
              <View style={styles.switchRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.switchTitle}>Ingatkan saya</Text>
                  <Text style={styles.switchSubtitle}>
                    Kirim notifikasi sebelum jatuh tempo
                  </Text>
                </View>
                <Switch
                  value={remindMe}
                  onValueChange={setRemindMe}
                  trackColor={{ false: '#E2E8F0', true: Colors.info }}
                  thumbColor={Colors.white}
                />
              </View>

              {/* Error display */}
              {err && <Text style={styles.errorText}>{err}</Text>}

              {/* Bottom CTA Button: Simpan */}
              <Pressable
                onPress={handleSubmit}
                disabled={createOb.isPending}
                style={[styles.submitBtn, createOb.isPending && styles.submitBtnDisabled]}
              >
                <Text style={styles.submitBtnText}>
                  {createOb.isPending ? 'Menyimpan…' : 'Simpan'}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Category Picker Sheet */}
      <Modal
        visible={catPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCatPickerOpen(false)}
      >
        <Pressable
          style={styles.subModalBackdrop}
          onPress={() => setCatPickerOpen(false)}
        >
          <Pressable style={styles.subModalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.subModalTitle}>Pilih Kategori</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <Pressable
                onPress={() => {
                  setCategoryId(null);
                  setCatPickerOpen(false);
                }}
                style={styles.modalOption}
              >
                <Text style={[styles.modalOptionText, !categoryId && styles.modalOptionActive]}>
                  Tanpa Kategori
                </Text>
                {!categoryId && <Check size={18} color={Colors.info} />}
              </Pressable>
              {categories.map((c) => {
                const isSelected = c.id === categoryId;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      setCategoryId(c.id);
                      setCatPickerOpen(false);
                    }}
                    style={styles.modalOption}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        isSelected && styles.modalOptionActive,
                      ]}
                    >
                      {c.name}
                    </Text>
                    {isSelected && <Check size={18} color={Colors.info} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Frequency Picker Sheet */}
      <Modal
        visible={freqPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFreqPickerOpen(false)}
      >
        <Pressable
          style={styles.subModalBackdrop}
          onPress={() => setFreqPickerOpen(false)}
        >
          <Pressable style={styles.subModalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.subModalTitle}>Pilih Frekuensi</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {FREQUENCY_OPTIONS.map((opt) => {
                const isSelected = opt.label === frequency;
                return (
                  <Pressable
                    key={opt.label}
                    onPress={() => {
                      setFrequency(opt.label);
                      setType(opt.type);
                      setFreqPickerOpen(false);
                    }}
                    style={styles.modalOption}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        isSelected && styles.modalOptionActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {isSelected && <Check size={18} color={Colors.info} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Quick Date Picker Sheet */}
      <Modal
        visible={datePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDatePickerOpen(false)}
      >
        <Pressable
          style={styles.subModalBackdrop}
          onPress={() => setDatePickerOpen(false)}
        >
          <Pressable style={styles.subModalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.subModalTitle}>Pilih Tanggal Jatuh Tempo</Text>

            <View style={styles.quickDateRow}>
              <Pressable
                onPress={() => setQuickDueDate(7)}
                style={styles.quickDateBtn}
              >
                <Text style={styles.quickDateBtnText}>+7 hari</Text>
              </Pressable>
              <Pressable
                onPress={() => setQuickDueDate(14)}
                style={styles.quickDateBtn}
              >
                <Text style={styles.quickDateBtnText}>+14 hari</Text>
              </Pressable>
              <Pressable
                onPress={() => setQuickDueDate(30)}
                style={styles.quickDateBtn}
              >
                <Text style={styles.quickDateBtnText}>+30 hari</Text>
              </Pressable>
            </View>

            <View style={{ gap: 6, marginTop: 10 }}>
              <Text style={styles.label}>Atau ketik format YYYY-MM-DD:</Text>
              <TextInput
                value={dueDate}
                onChangeText={setDueDate}
                placeholder="2026-10-25"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
            </View>

            <Pressable
              onPress={() => setDatePickerOpen(false)}
              style={[styles.submitBtn, { marginTop: 14 }]}
            >
              <Text style={styles.submitBtnText}>Terapkan Tanggal</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Beneficiary Picker Sheet */}
      <BeneficiaryPickerSheet
        visible={beneficiaryPickerOpen}
        onClose={() => setBeneficiaryPickerOpen(false)}
        householdId={householdId}
        selectedBeneficiaryId={attachedBeneficiary?.id ?? null}
        onSelectBeneficiary={(b) => {
          setAttachedBeneficiary(b);
          setBeneficiaryPickerOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: Colors.overlayScrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '92%',
    paddingBottom: 24,
  },
  sheetHandle: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0B1527',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 14,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  input: {
    height: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#0B1527',
  },
  pickerBox: {
    height: 48,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0B1527',
  },
  pickerTextPlaceholder: {
    color: '#94A3B8',
    fontWeight: '400',
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    marginTop: 4,
  },
  switchTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0B1527',
  },
  switchSubtitle: {
    fontSize: 12,
    color: '#64748B',
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: 4,
  },
  submitBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#0B1527',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  submitBtnDisabled: {
    opacity: 0.65,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  /* Sub-Modal / Sheets */
  subModalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlayScrim,
    justifyContent: 'flex-end',
  },
  subModalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    gap: 14,
  },
  subModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  modalOptionText: {
    fontSize: 14,
    color: Colors.textPrimary,
  },
  modalOptionActive: {
    color: Colors.info,
    fontWeight: '700',
  },
  quickDateRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickDateBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickDateBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
});
