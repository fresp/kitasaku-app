import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Landmark from 'lucide-react-native/icons/landmark';
import Trash2 from 'lucide-react-native/icons/trash';
import X from 'lucide-react-native/icons/x';

import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import {
  formatAccountNumberDisplay,
  formatBankBadge,
  formatBeneficiaryHolder,
  type Beneficiary,
} from '../../lib/beneficiary';
import { useCategories, useCreateObligation } from '../../lib/queries';
import { Badge } from '../ui/Badge';
import { PrimaryButton, SecondaryButton } from '../ui/Button';
import { BeneficiaryPickerSheet } from './BeneficiaryPickerSheet';

/**
 * Modal Sheet — Flow K (Frame K1):
 * "Form Tanggungan & Tagihan"
 *
 * Slices:
 *   - Judul Tanggungan & Total Nominal
 *   - Jenis Tanggungan (Tagihan, Cicilan, Reimburse, Pinjaman)
 *   - Kategori Selector
 *   - Tanggal Jatuh Tempo (Due Date)
 *   - Collapsible progressive-disclosure card "+ Tambah Rekening Tujuan Transfer"
 *   - Modal Frame K2 (BeneficiaryPickerSheet) integration
 */

export type FormObligationType = 'BILL' | 'INSTALLMENT' | 'REIMBURSEMENT' | 'LOAN';

const TYPE_OPTIONS: { type: FormObligationType; label: string }[] = [
  { type: 'BILL', label: 'Tagihan' },
  { type: 'INSTALLMENT', label: 'Cicilan' },
  { type: 'REIMBURSEMENT', label: 'Reimburse' },
  { type: 'LOAN', label: 'Pinjaman' },
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
  const [type, setType] = useState<FormObligationType>('BILL');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string>('');
  const [attachedBeneficiary, setAttachedBeneficiary] = useState<Beneficiary | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const categories = useMemo(
    () => (catsQ.data ?? []).filter((category) => category.type === 'EXPENSE'),
    [catsQ.data],
  );
  const totalAmount = parseAmount(totalText);

  function resetForm() {
    setTitle('');
    setTotalText('');
    setType('BILL');
    setCategoryId(null);
    setDueDate('');
    setAttachedBeneficiary(null);
    setErr(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function setQuickDueDate(daysFromNow: number) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    setDueDate(formatISO(d));
  }

  async function handleSubmit() {
    setErr(null);
    if (!householdId) {
      setErr('Household tidak ditemukan.');
      return;
    }
    if (title.trim().length < 3) {
      setErr('Judul tanggungan minimal 3 huruf.');
      return;
    }
    if (totalAmount <= 0) {
      setErr('Total nominal harus lebih dari Rp 0.');
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
        recipient: attachedBeneficiary?.name ?? undefined,
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
        <View style={styles.scrim}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>Catat Tanggungan / Tagihan</Text>
                <Text style={styles.headerSub}>
                  Kewajiban keluarga di luar pengeluaran rutin bulanan
                </Text>
              </View>
              <Pressable onPress={handleClose} hitSlop={10} style={styles.closeBtn}>
                <X size={20} color={Colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Jenis Tanggungan Selector */}
              <View style={styles.field}>
                <Text style={styles.label}>JENIS KEWAJIBAN</Text>
                <View style={styles.typePills}>
                  {TYPE_OPTIONS.map((t) => {
                    const active = type === t.type;
                    return (
                      <Pressable
                        key={t.type}
                        onPress={() => setType(t.type)}
                        style={[styles.typePill, active && styles.typePillActive]}
                      >
                        <Text style={[styles.typePillText, active && styles.typePillTextActive]}>
                          {t.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Judul Tanggungan */}
              <View style={styles.field}>
                <Text style={styles.label}>JUDUL TANGGUNGAN</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="e.g. Sewa Kontrakan 2026, SPP Sekolah"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                />
              </View>

              {/* Total Nominal */}
              <View style={styles.field}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>TOTAL NOMINAL</Text>
                  {totalAmount > 0 && (
                    <Text style={styles.previewAmt}>{formatRupiah(totalAmount)}</Text>
                  )}
                </View>
                <TextInput
                  value={totalText}
                  onChangeText={setTotalText}
                  placeholder="e.g. 5000000"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  style={[styles.input, { fontVariant: ['tabular-nums'] }]}
                />
              </View>

              {/* Kategori Selector */}
              {categories.length > 0 && (
                <View style={styles.field}>
                  <Text style={styles.label}>KATEGORI ANGGARAN (OPSIONAL)</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.catScroll}
                  >
                    <Pressable
                      onPress={() => setCategoryId(null)}
                      style={[styles.catPill, categoryId === null && styles.catPillActive]}
                    >
                      <Text
                        style={[
                          styles.catPillText,
                          categoryId === null && styles.catPillTextActive,
                        ]}
                      >
                        Tanpa Kategori
                      </Text>
                    </Pressable>
                    {categories.map((c) => {
                      const active = c.id === categoryId;
                      return (
                        <Pressable
                          key={c.id}
                          onPress={() => setCategoryId(c.id)}
                          style={[styles.catPill, active && styles.catPillActive]}
                        >
                          <Text style={[styles.catPillText, active && styles.catPillTextActive]}>
                            {c.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* Due Date */}
              <View style={styles.field}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>TANGGAL JATUH TEMPO (OPSIONAL)</Text>
                  {!!dueDate && (
                    <Pressable onPress={() => setDueDate('')}>
                      <Text style={styles.clearBtnText}>Hapus</Text>
                    </Pressable>
                  )}
                </View>
                <TextInput
                  value={dueDate}
                  onChangeText={setDueDate}
                  placeholder="YYYY-MM-DD (e.g. 2026-10-25)"
                  placeholderTextColor={Colors.textMuted}
                  style={[styles.input, { fontVariant: ['tabular-nums'] }]}
                />
                <View style={styles.dateShortcuts}>
                  <Pressable onPress={() => setQuickDueDate(7)} style={styles.dateShortcut}>
                    <Text style={styles.dateShortcutText}>+7 hari</Text>
                  </Pressable>
                  <Pressable onPress={() => setQuickDueDate(14)} style={styles.dateShortcut}>
                    <Text style={styles.dateShortcutText}>+14 hari</Text>
                  </Pressable>
                  <Pressable onPress={() => setQuickDueDate(30)} style={styles.dateShortcut}>
                    <Text style={styles.dateShortcutText}>+30 hari</Text>
                  </Pressable>
                </View>
              </View>

              {/* Collapsible Progressive-Disclosure Card: Rekening Tujuan Transfer */}
              <View style={styles.field}>
                <Text style={styles.label}>REKENING TUJUAN TRANSFER (FLOW K)</Text>
                {attachedBeneficiary ? (
                  /* Attached beneficiary card */
                  <View style={styles.attachedCard}>
                    <View style={styles.attachedTop}>
                      <Badge
                        label={formatBankBadge(attachedBeneficiary.bank_name)}
                        tone="dark"
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.attachedName} numberOfLines={1}>
                          {attachedBeneficiary.name}
                        </Text>
                        <Text style={styles.attachedNumber}>
                          {formatAccountNumberDisplay(attachedBeneficiary.account_number)}
                          {formatBeneficiaryHolder(attachedBeneficiary.account_holder_name)
                            ? ` • ${formatBeneficiaryHolder(attachedBeneficiary.account_holder_name)}`
                            : ''}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.attachedActions}>
                      <Pressable
                        onPress={() => setPickerOpen(true)}
                        style={styles.changeBtn}
                      >
                        <Text style={styles.changeBtnText}>Ganti Penerima</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setAttachedBeneficiary(null)}
                        style={styles.removeBtn}
                      >
                        <Trash2 size={14} color={Colors.pendingText} />
                        <Text style={styles.removeBtnText}>Hapus</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  /* Unattached prompt card */
                  <Pressable
                    onPress={() => setPickerOpen(true)}
                    style={styles.unattachedCard}
                  >
                    <View style={styles.unattachedIcon}>
                      <Landmark size={20} color={Colors.brandPrimary} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.unattachedTitle}>
                        + Tambah Rekening Tujuan Transfer
                      </Text>
                      <Text style={styles.unattachedSub}>
                        Simpan nomor rekening pemilik kontrakan, sekolah, atau vendor untuk transfer mudah saat bayar.
                      </Text>
                    </View>
                    <ChevronRight size={18} color={Colors.textMuted} />
                  </Pressable>
                )}
              </View>

              {err && <Text style={styles.errorText}>{err}</Text>}

              {/* Submit Buttons */}
              <View style={styles.formActions}>
                <PrimaryButton
                  label={createOb.isPending ? 'Menyimpan…' : 'Simpan Tanggungan'}
                  onPress={handleSubmit}
                />
                <SecondaryButton label="Batal" onPress={handleClose} />
              </View>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Frame K2: Beneficiary Picker Bottom Sheet */}
      <BeneficiaryPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        householdId={householdId}
        selectedBeneficiaryId={attachedBeneficiary?.id ?? null}
        onSelectBeneficiary={(b) => setAttachedBeneficiary(b)}
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
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  headerTitle: {
    fontSize: FontSize.sectionTitle,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  headerSub: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.subtle,
  },
  content: {
    padding: 20,
    paddingBottom: 36,
    gap: 16,
  },
  field: {
    gap: 6,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  previewAmt: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    color: Colors.brandPrimary,
  },
  clearBtnText: {
    fontSize: FontSize.caption,
    color: Colors.pendingText,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    height: 46,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.canvas,
  },
  typePills: {
    flexDirection: 'row',
    gap: 8,
  },
  typePill: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    backgroundColor: Colors.canvas,
  },
  typePillActive: {
    backgroundColor: Colors.brandPrimary,
    borderColor: Colors.brandPrimary,
  },
  typePillText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  typePillTextActive: {
    color: Colors.white,
  },
  catScroll: {
    gap: 8,
    paddingVertical: 4,
  },
  catPill: {
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.canvas,
  },
  catPillActive: {
    backgroundColor: Colors.brandPrimary,
    borderColor: Colors.brandPrimary,
  },
  catPillText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  catPillTextActive: {
    color: Colors.white,
  },
  dateShortcuts: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  dateShortcut: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    backgroundColor: Colors.subtle,
  },
  dateShortcutText: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  unattachedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.brandPrimary,
    backgroundColor: Colors.canvas,
    gap: 12,
  },
  unattachedIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unattachedTitle: {
    fontSize: FontSize.body,
    fontWeight: '600',
    color: Colors.brandPrimary,
  },
  unattachedSub: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  attachedCard: {
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surface,
    gap: 12,
  },
  attachedTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  attachedName: {
    fontSize: FontSize.cardTitle,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  attachedNumber: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  attachedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSubtle,
  },
  changeBtn: {
    paddingVertical: 4,
  },
  changeBtnText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    color: Colors.brandPrimary,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  removeBtnText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    color: Colors.pendingText,
  },
  errorText: {
    fontSize: FontSize.caption,
    color: Colors.pendingText,
  },
  formActions: {
    gap: 10,
    marginTop: 8,
  },
});
