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
import Check from 'lucide-react-native/icons/check';
import Landmark from 'lucide-react-native/icons/landmark';
import Plus from 'lucide-react-native/icons/plus';
import X from 'lucide-react-native/icons/x';

import { Colors, FontSize, Radius } from '../../constants/theme';
import {
  cleanAccountNumber,
  COMMON_BANK_NAMES,
  formatAccountNumberDisplay,
  formatBankBadge,
  formatBeneficiaryHolder,
  validateBeneficiary,
  type Beneficiary,
} from '../../lib/beneficiary';
import { useBeneficiaries, useCreateBeneficiary } from '../../lib/queries';
import { Badge } from '../ui/Badge';
import { PrimaryButton, SecondaryButton } from '../ui/Button';

/**
 * Modal Bottom Sheet — Flow K (Frame K2):
 * "Pilih / Tambah Rekening Penerima"
 *
 * Allows user to:
 * 1. Choose from existing counterparties saved in household.
 * 2. Toggle to inline creation to register a new counterparty with bank name,
 *    account number, and optional account holder name.
 */
export function BeneficiaryPickerSheet({
  visible,
  onClose,
  onSelectBeneficiary,
  householdId,
  selectedBeneficiaryId,
}: {
  visible: boolean;
  onClose: () => void;
  onSelectBeneficiary: (beneficiary: Beneficiary) => void;
  householdId: string | undefined;
  selectedBeneficiaryId?: string | null;
}) {
  const beneficiariesQ = useBeneficiaries(householdId);
  const createBeneficiary = useCreateBeneficiary();

  const savedList = useMemo(() => beneficiariesQ.data ?? [], [beneficiariesQ.data]);

  // Mode: 'list' (pick from saved) vs 'new' (add inline)
  const [mode, setMode] = useState<'list' | 'new'>('list');

  // New beneficiary form fields
  const [name, setName] = useState('');
  const [selectedBank, setSelectedBank] = useState<string>('BCA');
  const [customBank, setCustomBank] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const effectiveBank = selectedBank === 'OTHER' ? customBank.trim() : selectedBank;

  function resetForm() {
    setName('');
    setSelectedBank('BCA');
    setCustomBank('');
    setAccountNumber('');
    setHolderName('');
    setErr(null);
  }

  function handleOpenNew() {
    resetForm();
    setMode('new');
  }

  function handleBackToList() {
    setErr(null);
    setMode('list');
  }

  async function handleSaveNew() {
    setErr(null);
    if (!householdId) {
      setErr('Household tidak ditemukan.');
      return;
    }

    const validation = validateBeneficiary({
      name,
      bank_name: effectiveBank,
      account_number: accountNumber,
    });

    if (!validation.valid) {
      const firstErr =
        validation.errors.name ??
        validation.errors.bank_name ??
        validation.errors.account_number;
      setErr(firstErr ?? 'Harap lengkapi formulir.');
      return;
    }

    try {
      const created = await createBeneficiary.mutateAsync({
        householdId,
        name: name.trim(),
        bankName: effectiveBank,
        accountNumber: cleanAccountNumber(accountNumber),
        accountHolderName: holderName.trim() || null,
      });
      resetForm();
      onSelectBeneficiary(created);
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan rekening penerima.');
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.scrim}>
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>
                {mode === 'list' ? 'Rekening Tujuan Transfer' : 'Tambah Rekening Baru'}
              </Text>
              <Text style={styles.headerSub}>
                {mode === 'list'
                  ? 'Pilih penerima yang tersimpan atau catat baru'
                  : 'Catat rekening tujuan untuk kewajiban ini'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <X size={20} color={Colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {mode === 'list' ? (
              <View style={{ gap: 12 }}>
                {/* Saved list */}
                {savedList.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Landmark size={24} color={Colors.textMuted} />
                    <Text style={styles.emptyTitle}>Belum ada rekening tersimpan</Text>
                    <Text style={styles.emptySub}>
                      Simpan rekening pemilik kontrakan, sekolah, atau pihak lain untuk memudahkan
                      transfer saat jatuh tempo.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.list}>
                    {savedList.map((item) => {
                      const isSelected = item.id === selectedBeneficiaryId;
                      const holder = formatBeneficiaryHolder(item.account_holder_name);
                      return (
                        <Pressable
                          key={item.id}
                          onPress={() => {
                            onSelectBeneficiary(item);
                            onClose();
                          }}
                          style={[styles.beneficiaryCard, isSelected && styles.beneficiaryCardActive]}
                        >
                          <View style={styles.badgeCol}>
                            <Badge label={formatBankBadge(item.bank_name)} tone={isSelected ? 'dark' : 'default'} />
                          </View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={styles.beneficiaryName} numberOfLines={1}>
                              {item.name}
                            </Text>
                            <Text style={styles.beneficiaryNumber}>
                              {formatAccountNumberDisplay(item.account_number)}
                              {holder ? ` • ${holder}` : ''}
                            </Text>
                          </View>
                          {isSelected && (
                            <View style={styles.checkCircle}>
                              <Check size={14} color={Colors.white} strokeWidth={2.5} />
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {/* Add new button */}
                <Pressable onPress={handleOpenNew} style={styles.addNewButton}>
                  <Plus size={16} color={Colors.brandPrimary} />
                  <Text style={styles.addNewButtonText}>+ Tambah Rekening Baru</Text>
                </Pressable>
              </View>
            ) : (
              /* Inline Form: Add new beneficiary */
              <View style={styles.formContainer}>
                {/* Name Label */}
                <View style={styles.field}>
                  <Text style={styles.label}>NAMA / LABEL PENERIMA</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g. Pak Joko (Kontrakan), SPP Al-Azhar"
                    placeholderTextColor={Colors.textMuted}
                    style={styles.input}
                  />
                </View>

                {/* Bank Selector */}
                <View style={styles.field}>
                  <Text style={styles.label}>BANK ATAU E-WALLET TUJUAN</Text>
                  <View style={styles.bankPills}>
                    {COMMON_BANK_NAMES.map((bank) => {
                      const active = selectedBank === bank;
                      return (
                        <Pressable
                          key={bank}
                          onPress={() => setSelectedBank(bank)}
                          style={[styles.bankPill, active && styles.bankPillActive]}
                        >
                          <Text style={[styles.bankPillText, active && styles.bankPillTextActive]}>
                            {bank}
                          </Text>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      onPress={() => setSelectedBank('OTHER')}
                      style={[styles.bankPill, selectedBank === 'OTHER' && styles.bankPillActive]}
                    >
                      <Text
                        style={[
                          styles.bankPillText,
                          selectedBank === 'OTHER' && styles.bankPillTextActive,
                        ]}
                      >
                        Lainnya…
                      </Text>
                    </Pressable>
                  </View>

                  {selectedBank === 'OTHER' && (
                    <TextInput
                      value={customBank}
                      onChangeText={setCustomBank}
                      placeholder="Ketik nama bank (e.g. Permata, Danamon)"
                      placeholderTextColor={Colors.textMuted}
                      style={[styles.input, { marginTop: 8 }]}
                    />
                  )}
                </View>

                {/* Account Number */}
                <View style={styles.field}>
                  <Text style={styles.label}>NOMOR REKENING / NO. VA</Text>
                  <TextInput
                    value={accountNumber}
                    onChangeText={setAccountNumber}
                    placeholder="e.g. 1234567890"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                </View>

                {/* Account Holder Name (Optional) */}
                <View style={styles.field}>
                  <Text style={styles.label}>NAMA PEMILIK DI REKENING (OPSIONAL)</Text>
                  <TextInput
                    value={holderName}
                    onChangeText={setHolderName}
                    placeholder="e.g. Joko Susilo"
                    placeholderTextColor={Colors.textMuted}
                    style={styles.input}
                  />
                </View>

                {err && <Text style={styles.errorText}>{err}</Text>}

                {/* Actions */}
                <View style={styles.formActions}>
                  <PrimaryButton
                    label={createBeneficiary.isPending ? 'Menyimpan…' : 'Simpan & Gunakan'}
                    onPress={handleSaveNew}
                  />
                  {savedList.length > 0 && (
                    <SecondaryButton
                      label="Pilih dari Tersimpan"
                      onPress={handleBackToList}
                    />
                  )}
                </View>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
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
    maxHeight: '85%',
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
    paddingBottom: 32,
    gap: 16,
  },
  emptyCard: {
    backgroundColor: Colors.subtle,
    borderRadius: Radius.md,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: FontSize.cardTitle,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  emptySub: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  list: {
    gap: 10,
  },
  beneficiaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    gap: 12,
  },
  beneficiaryCardActive: {
    borderColor: Colors.brandPrimary,
    backgroundColor: Colors.subtle,
  },
  badgeCol: {
    alignSelf: 'center',
  },
  beneficiaryName: {
    fontSize: FontSize.cardTitle,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  beneficiaryNumber: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addNewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.brandPrimary,
    backgroundColor: Colors.surface,
    gap: 6,
  },
  addNewButtonText: {
    fontSize: FontSize.body,
    fontWeight: '600',
    color: Colors.brandPrimary,
  },
  formContainer: {
    gap: 14,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
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
  bankPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  bankPill: {
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: Colors.canvas,
  },
  bankPillActive: {
    backgroundColor: Colors.brandPrimary,
    borderColor: Colors.brandPrimary,
  },
  bankPillText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  bankPillTextActive: {
    color: Colors.white,
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
