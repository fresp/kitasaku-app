import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Plus from 'lucide-react-native/icons/plus';
import EllipsisVertical from 'lucide-react-native/icons/ellipsis-vertical';
import Check from 'lucide-react-native/icons/check';
import X from 'lucide-react-native/icons/x';
import Copy from 'lucide-react-native/icons/copy';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import Landmark from 'lucide-react-native/icons/landmark';
import CreditCard from 'lucide-react-native/icons/credit-card';
import Wallet from 'lucide-react-native/icons/wallet';
import Banknote from 'lucide-react-native/icons/banknote';
import PiggyBank from 'lucide-react-native/icons/piggy-bank';
import Smartphone from 'lucide-react-native/icons/smartphone';
import Pencil from 'lucide-react-native/icons/pencil';
import Trash2 from 'lucide-react-native/icons/trash';
import Archive from 'lucide-react-native/icons/archive';
import CircleAlert from 'lucide-react-native/icons/circle-alert';

import { Colors, FontSize, Radius } from '../constants/theme';
import { useAuth } from '../lib/auth-context';
import {
  ACCOUNT_ICON_CHOICES,
  ACCOUNT_TYPE_DEFAULT_ICONS,
  accountSubline,
  maskAccountNumber,
  resolveAccountIcon,
  validateAccountNumber,
} from '../lib/account';
import type { AccountType } from '../lib/account';
import {
  useAccountUsage,
  useAccounts,
  useArchiveAccount,
  useCreateAccount,
  useDeleteAccount,
  useReactivateAccount,
  useUpdateAccount,
} from '../lib/queries';
import type { Account } from '../lib/queries';
import { Badge } from '../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

/**
 * Screen "Kelola Akun" — Flow J: Managed Account.
 *
 * Slices 3 frames from design.pen:
 *   - Frame J1: List view (Active Accounts, Archived Accounts, Empty State)
 *   - Frame J2: Add / Edit form (Account Name, Type Grid, Account Number with live preview & copy,
 *               Account Holder Name, Icon Picker, and smart Archive vs Delete action)
 *   - Frame J3: Confirmation bottom sheet for archiving accounts
 */

interface FormDraft {
  id: string | null;
  name: string;
  type: AccountType;
  accountNumber: string;
  accountHolderName: string;
  icon: string | null;
  sortOrder: number;
}

const EMPTY_DRAFT: FormDraft = {
  id: null,
  name: '',
  type: 'BANK',
  accountNumber: '',
  accountHolderName: '',
  icon: null,
  sortOrder: 0,
};

const TYPE_OPTIONS: { type: AccountType; label: string; icon: string }[] = [
  { type: 'BANK', label: 'Rekening bank', icon: 'landmark' },
  { type: 'CREDIT_CARD', label: 'Kartu kredit', icon: 'credit-card' },
  { type: 'E_WALLET', label: 'E-wallet', icon: 'wallet' },
  { type: 'CASH', label: 'Tunai', icon: 'banknote' },
];

function renderAccountIconGlyph(iconName: string, size = 18, color: string = Colors.textSecondary) {
  switch (iconName) {
    case 'landmark':
      return <Landmark size={size} color={color} />;
    case 'credit-card':
      return <CreditCard size={size} color={color} />;
    case 'wallet':
      return <Wallet size={size} color={color} />;
    case 'banknote':
      return <Banknote size={size} color={color} />;
    case 'piggy-bank':
      return <PiggyBank size={size} color={color} />;
    case 'smartphone':
      return <Smartphone size={size} color={color} />;
    default:
      return <Wallet size={size} color={color} />;
  }
}

export default function ManagedAccountScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const accsQ = useAccounts(householdId, { includeArchived: true });
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const archiveAccount = useArchiveAccount();
  const reactivateAccount = useReactivateAccount();
  const deleteAccount = useDeleteAccount();

  // Screen view modes: 'list' | 'form'
  const [viewMode, setViewMode] = useState<'list' | 'form'>('list');
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Bottom sheet state for J3 Archive Confirmation
  const [archiveTarget, setArchiveTarget] = useState<Account | null>(null);

  // Card action menu target
  const [menuTarget, setMenuTarget] = useState<Account | null>(null);

  // Check usage for the editing account
  const usageQ = useAccountUsage(draft.id ?? undefined);
  const isReferenced = usageQ.data?.isUsed ?? true; // Safe default: assume referenced until proven otherwise

  const allAccounts = useMemo(() => accsQ.data ?? [], [accsQ.data]);
  const activeAccounts = useMemo(
    () => allAccounts.filter((a) => a.is_active !== false),
    [allAccounts]
  );
  const archivedAccounts = useMemo(
    () => allAccounts.filter((a) => a.is_active === false),
    [allAccounts]
  );

  const saving = createAccount.isPending || updateAccount.isPending;

  function openCreateForm() {
    setDraft({
      ...EMPTY_DRAFT,
      sortOrder: activeAccounts.length + 1,
    });
    setFormErr(null);
    setCopied(false);
    setViewMode('form');
  }

  function openEditForm(acc: Account) {
    setDraft({
      id: acc.id,
      name: acc.name,
      type: (acc.type as AccountType) || 'BANK',
      accountNumber: acc.account_number ?? '',
      accountHolderName: acc.account_holder_name ?? '',
      icon: acc.icon ?? null,
      sortOrder: acc.sort_order ?? 0,
    });
    setFormErr(null);
    setCopied(false);
    setViewMode('form');
  }

  async function handleCopyNumber() {
    const num = draft.accountNumber.trim();
    if (!num) return;
    await Clipboard.setStringAsync(num);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function saveAccount() {
    setFormErr(null);
    if (!householdId) return;

    if (!draft.name.trim() || draft.name.trim().length < 2) {
      setFormErr('Nama akun minimal 2 huruf.');
      return;
    }

    const numErr = validateAccountNumber(draft.accountNumber);
    if (numErr) {
      setFormErr(numErr);
      return;
    }

    try {
      if (draft.id) {
        await updateAccount.mutateAsync({
          id: draft.id,
          name: draft.name,
          type: draft.type,
          accountNumber: draft.accountNumber,
          accountHolderName: draft.accountHolderName,
          icon: draft.icon,
          sortOrder: draft.sortOrder,
        });
      } else {
        await createAccount.mutateAsync({
          householdId,
          name: draft.name,
          type: draft.type,
          accountNumber: draft.accountNumber,
          accountHolderName: draft.accountHolderName,
          icon: draft.icon,
          sortOrder: draft.sortOrder,
        });
      }
      setViewMode('list');
    } catch (e: any) {
      setFormErr(e?.message ?? 'Gagal menyimpan data akun.');
    }
  }

  async function executeArchive(acc: Account) {
    try {
      await archiveAccount.mutateAsync({ id: acc.id });
      setArchiveTarget(null);
      if (viewMode === 'form') {
        setViewMode('list');
      }
    } catch (e: any) {
      Alert.alert('Gagal Mengarsipkan', e?.message ?? 'Terjadi kesalahan saat mengarsipkan akun.');
    }
  }

  async function executeReactivate(acc: Account) {
    try {
      await reactivateAccount.mutateAsync({ id: acc.id });
    } catch (e: any) {
      Alert.alert('Gagal Mengaktifkan', e?.message ?? 'Terjadi kesalahan saat mengaktifkan akun.');
    }
  }

  async function executeDelete(acc: Account) {
    Alert.alert(
      'Hapus Akun',
      `Yakin ingin menghapus akun "${acc.name}" secara permanen? Tindakan ini tidak dapat dibatalkan.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount.mutateAsync({ id: acc.id });
              if (viewMode === 'form') {
                setViewMode('list');
              }
            } catch (e: any) {
              Alert.alert('Gagal Menghapus', e?.message ?? 'Akun tidak dapat dihapus.');
            }
          },
        },
      ]
    );
  }

  // ==========================================
  // FRAME J2: FORM VIEW (Tambah / Ubah Akun)
  // ==========================================
  if (viewMode === 'form') {
    const isEdit = !!draft.id;
    const effectiveDefaultIcon = ACCOUNT_TYPE_DEFAULT_ICONS[draft.type] ?? 'wallet';
    const effectiveIcon = draft.icon ?? effectiveDefaultIcon;
    const maskedPreview = draft.accountNumber.trim().length >= 4
      ? maskAccountNumber(draft.accountNumber)
      : null;

    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          {/* Top Bar */}
          <View style={styles.topBar}>
            <Pressable onPress={() => setViewMode('list')} style={styles.backBtn}>
              <ArrowLeft size={18} color={Colors.textPrimary} />
            </Pressable>
            <Text style={styles.crumb}>
              Kelola Akun / {isEdit ? 'Ubah Akun' : 'Tambah Akun'}
            </Text>
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.eyebrow}>KELOLA AKUN</Text>
            <Text style={styles.title}>{isEdit ? 'Ubah Akun' : 'Tambah Akun'}</Text>
            <Text style={styles.supporting}>
              {isEdit
                ? 'Perbarui data rekening atau kartu keluarga'
                : 'Tambah data rekening, kartu, atau e-wallet keluarga'}
            </Text>
          </View>

          {/* Form Fields */}
          <View style={styles.formCard}>
            {/* Field 1: Nama Akun */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>NAMA AKUN *</Text>
              <View style={styles.inputWithIcon}>
                <TextInput
                  value={draft.name}
                  onChangeText={(v) => setDraft({ ...draft, name: v })}
                  placeholder="Contoh: Mandiri"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.inputFlex}
                />
                <Pencil size={16} color={Colors.textMuted} />
              </View>
            </View>

            {/* Field 2: Tipe Akun (2x2 grid) */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>TIPE AKUN</Text>
              <View style={styles.typeGrid}>
                {TYPE_OPTIONS.map((opt) => {
                  const selected = draft.type === opt.type;
                  return (
                    <Pressable
                      key={opt.type}
                      onPress={() => setDraft({ ...draft, type: opt.type })}
                      style={[styles.typeCard, selected && styles.typeCardSelected]}
                    >
                      <View style={styles.typeCardHeader}>
                        <View
                          style={[
                            styles.typeCardIconBox,
                            selected && styles.typeCardIconBoxSelected,
                          ]}
                        >
                          {renderAccountIconGlyph(
                            opt.icon,
                            16,
                            selected ? Colors.brandPrimary : Colors.textSecondary
                          )}
                        </View>
                        {selected && <Check size={16} color={Colors.paidText} strokeWidth={2.5} />}
                      </View>
                      <Text
                        style={[
                          styles.typeCardLabel,
                          selected && styles.typeCardLabelSelected,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Field 3: Nomor Akun */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>NOMOR AKUN (OPSIONAL)</Text>
              <View style={styles.inputWithAction}>
                <TextInput
                  value={draft.accountNumber}
                  onChangeText={(v) => setDraft({ ...draft, accountNumber: v })}
                  placeholder="Contoh: 1400012348821"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numeric"
                  style={styles.inputFlex}
                />
                {draft.accountNumber.trim().length > 0 && (
                  <Pressable onPress={handleCopyNumber} style={styles.copyBtn}>
                    {copied ? (
                      <Check size={14} color={Colors.paidText} />
                    ) : (
                      <Copy size={14} color={Colors.textSecondary} />
                    )}
                    <Text
                      style={[
                        styles.copyBtnText,
                        copied && { color: Colors.paidText },
                      ]}
                    >
                      {copied ? 'Tersalin' : 'Salin nomor'}
                    </Text>
                  </Pressable>
                )}
              </View>

              {maskedPreview ? (
                <View style={styles.previewRow}>
                  <Check size={14} color={Colors.paidText} strokeWidth={2.5} />
                  <Text style={styles.previewText}>Tampil sebagai {maskedPreview}</Text>
                </View>
              ) : null}

              <Text style={styles.helperText}>
                {draft.accountNumber.trim().length > 0
                  ? 'Disimpan lengkap, tapi hanya 4 digit terakhir yang tampil di layar lain.'
                  : 'Kosongkan kalau tidak ingin mencatat nomornya.'}
              </Text>
            </View>

            {/* Field 4: Nama Pemilik Rekening */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>NAMA PEMILIK REKENING (OPSIONAL)</Text>
              <TextInput
                value={draft.accountHolderName}
                onChangeText={(v) => setDraft({ ...draft, accountHolderName: v })}
                placeholder="Contoh: Andra Pratama"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
              <Text style={styles.helperText}>
                Nama yang tertera di rekening. Boleh berbeda dari nama kamu.
              </Text>
            </View>

            {/* Field 5: Icon Akun */}
            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>ICON AKUN (OPSIONAL)</Text>
                {draft.icon && (
                  <Pressable onPress={() => setDraft({ ...draft, icon: null })}>
                    <Text style={styles.resetLink}>Gunakan default</Text>
                  </Pressable>
                )}
              </View>

              <View style={styles.iconRow}>
                {ACCOUNT_ICON_CHOICES.map((ic) => {
                  const isSelected = effectiveIcon === ic;
                  const isExplicit = draft.icon === ic;
                  return (
                    <Pressable
                      key={ic}
                      onPress={() => setDraft({ ...draft, icon: ic })}
                      style={[
                        styles.iconChoice,
                        isSelected && styles.iconChoiceSelected,
                      ]}
                    >
                      {renderAccountIconGlyph(
                        ic,
                        18,
                        isSelected ? Colors.brandPrimary : Colors.textSecondary
                      )}
                      {isExplicit && (
                        <View style={styles.iconBadge}>
                          <Check size={8} color={Colors.white} strokeWidth={3} />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Error Message */}
            {formErr && (
              <View style={styles.errBox}>
                <CircleAlert size={16} color={Colors.pendingText} />
                <Text style={styles.errText}>{formErr}</Text>
              </View>
            )}

            {/* Action Row */}
            <View style={styles.actionRow}>
              <View style={{ flex: 1 }}>
                <SecondaryButton
                  label="Batal"
                  onPress={() => {
                    setViewMode('list');
                    setFormErr(null);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={saving ? 'Menyimpan…' : 'Simpan'}
                  onPress={saveAccount}
                />
              </View>
            </View>

            {/* Destructive Action (Edit Mode Only) */}
            {isEdit && (
              <View style={styles.destructiveSection}>
                <View style={styles.divider} />
                {isReferenced ? (
                  <View style={{ gap: 8 }}>
                    <Pressable
                      onPress={() => {
                        const target = allAccounts.find((a) => a.id === draft.id);
                        if (target) setArchiveTarget(target);
                      }}
                      style={styles.archiveBtn}
                    >
                      <Archive size={16} color={Colors.alertText} />
                      <Text style={styles.archiveBtnText}>Arsipkan Akun</Text>
                    </Pressable>
                    <Text style={styles.destructiveHelper}>
                      Akun ini dipakai di transaksi atau template, jadi tidak bisa dihapus.
                      Arsipkan supaya tidak muncul lagi di pilihan pembayaran — riwayatnya tetap utuh.
                    </Text>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    <Pressable
                      onPress={() => {
                        const target = allAccounts.find((a) => a.id === draft.id);
                        if (target) executeDelete(target);
                      }}
                      style={styles.deleteBtn}
                    >
                      <Trash2 size={16} color={Colors.pendingText} />
                      <Text style={styles.deleteBtnText}>Hapus Akun</Text>
                    </Pressable>
                    <Text style={styles.destructiveHelper}>
                      Akun ini belum pernah digunakan di transaksi atau template. Bisa dihapus secara permanen.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>

        {/* J3 Bottom Sheet Modal if opened from form view */}
        {renderArchiveBottomSheet()}
      </SafeAreaView>
    );
  }

  // ==========================================
  // FRAME J1: LIST VIEW (Screen - Managed Account)
  // ==========================================
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <Text style={styles.crumb}>My Profile / Kelola Akun</Text>
        </View>

        {/* Screen Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.eyebrow}>MY PROFILE · PREFERENSI</Text>
            <Text style={styles.title}>Kelola Akun</Text>
            <Text style={styles.supporting}>
              Rekening, kartu, dan e-wallet keluarga
            </Text>
          </View>
          <Pressable onPress={openCreateForm} style={styles.addBtn}>
            <Plus size={14} color={Colors.white} />
            <Text style={styles.addBtnText}>Tambah Akun</Text>
          </Pressable>
        </View>

        {/* Empty State */}
        {allAccounts.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconBox}>
              <Wallet size={28} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Belum ada akun</Text>
            <Text style={styles.emptySub}>
              Tambahkan rekening, kartu, atau e-wallet supaya pembayaran bisa dicatat dari sumber yang benar.
            </Text>
            <Pressable onPress={openCreateForm} style={styles.emptyAddBtn}>
              <Plus size={16} color={Colors.white} />
              <Text style={styles.emptyAddText}>Tambah Akun</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Active Accounts Group */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>
                AKUN AKTIF ({activeAccounts.length})
              </Text>
            </View>

            <View style={styles.accountList}>
              {activeAccounts.map((acc) => {
                const iconName = resolveAccountIcon(acc.type, acc.icon);
                const sub = accountSubline(acc);

                return (
                  <Pressable
                    key={acc.id}
                    onPress={() => openEditForm(acc)}
                    style={styles.accountCard}
                  >
                    <View style={styles.accountIconBox}>
                      {renderAccountIconGlyph(iconName, 18, Colors.brandPrimary)}
                    </View>

                    <View style={styles.accountCardMiddle}>
                      <View style={styles.nameRow}>
                        <Text style={styles.accountName} numberOfLines={1}>
                          {acc.name}
                        </Text>
                        {acc.account_holder_name ? (
                          <Text style={styles.holderTag} numberOfLines={1}>
                            · {acc.account_holder_name}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.accountSubline}>{sub}</Text>
                    </View>

                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        setMenuTarget(acc);
                      }}
                      style={styles.moreBtn}
                      hitSlop={8}
                    >
                      <EllipsisVertical size={16} color={Colors.textSecondary} />
                    </Pressable>
                  </Pressable>
                );
              })}
            </View>

            {/* Archived Accounts Group */}
            {archivedAccounts.length > 0 && (
              <View style={styles.archivedSection}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitleMuted}>
                    DIARSIPKAN ({archivedAccounts.length})
                  </Text>
                </View>

                <View style={styles.accountList}>
                  {archivedAccounts.map((acc) => {
                    const iconName = resolveAccountIcon(acc.type, acc.icon);
                    const sub = accountSubline(acc);

                    return (
                      <View key={acc.id} style={[styles.accountCard, styles.accountCardArchived]}>
                        <View style={[styles.accountIconBox, styles.accountIconBoxArchived]}>
                          {renderAccountIconGlyph(iconName, 18, Colors.textMuted)}
                        </View>

                        <View style={styles.accountCardMiddle}>
                          <View style={styles.nameRow}>
                            <Text
                              style={[styles.accountName, styles.accountNameArchived]}
                              numberOfLines={1}
                            >
                              {acc.name}
                            </Text>
                            <Badge label="— Diarsipkan" tone="default" />
                          </View>
                          <Text style={styles.accountSublineMuted}>{sub}</Text>
                        </View>

                        <Pressable
                          onPress={() => executeReactivate(acc)}
                          style={styles.reactivateInlineBtn}
                        >
                          <RotateCcw size={14} color={Colors.paidText} />
                          <Text style={styles.reactivateInlineText}>Aktifkan</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>

                <View style={styles.archivedNotice}>
                  <Text style={styles.archivedNoticeText}>
                    Akun diarsipkan tidak muncul di pilihan &quot;Bayar dari&quot;, Alokasi, atau Template Rutin.
                  </Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Action Sheet Menu for card row */}
      {renderRowActionMenu()}

      {/* FRAME J3: BOTTOM SHEET KONFIRMASI ARSIP */}
      {renderArchiveBottomSheet()}
    </SafeAreaView>
  );

  // ==========================================
  // HELPER: J1 ROW ACTION MENU (MODAL)
  // ==========================================
  function renderRowActionMenu() {
    if (!menuTarget) return null;
    const isArchived = menuTarget.is_active === false;

    return (
      <Modal
        visible={!!menuTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuTarget(null)}
      >
        <Pressable style={styles.modalScrim} onPress={() => setMenuTarget(null)}>
          <View style={styles.actionSheetContent}>
            <View style={styles.actionSheetHeader}>
              <Text style={styles.actionSheetTitle} numberOfLines={1}>
                {menuTarget.name}
              </Text>
              <Pressable onPress={() => setMenuTarget(null)} style={styles.closeBtn}>
                <X size={18} color={Colors.textSecondary} />
              </Pressable>
            </View>

            <Pressable
              onPress={() => {
                const target = menuTarget;
                setMenuTarget(null);
                openEditForm(target);
              }}
              style={styles.actionSheetRow}
            >
              <Pencil size={18} color={Colors.textPrimary} />
              <Text style={styles.actionSheetRowText}>Ubah Akun</Text>
            </Pressable>

            {!isArchived ? (
              <Pressable
                onPress={() => {
                  const target = menuTarget;
                  setMenuTarget(null);
                  setArchiveTarget(target);
                }}
                style={styles.actionSheetRow}
              >
                <Archive size={18} color={Colors.alertText} />
                <Text style={[styles.actionSheetRowText, { color: Colors.alertText }]}>
                  Arsipkan Akun
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => {
                  const target = menuTarget;
                  setMenuTarget(null);
                  executeReactivate(target);
                }}
                style={styles.actionSheetRow}
              >
                <RotateCcw size={18} color={Colors.paidText} />
                <Text style={[styles.actionSheetRowText, { color: Colors.paidText }]}>
                  Aktifkan Lagi
                </Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>
    );
  }

  // ==========================================
  // FRAME J3: BOTTOM SHEET KONFIRMASI ARSIP
  // ==========================================
  function renderArchiveBottomSheet() {
    if (!archiveTarget) return null;

    const iconName = resolveAccountIcon(archiveTarget.type, archiveTarget.icon);
    const sub = accountSubline(archiveTarget);

    return (
      <Modal
        visible={!!archiveTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setArchiveTarget(null)}
      >
        <View style={styles.sheetOverlay}>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setArchiveTarget(null)}
          />

          <View style={styles.sheetCard}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Arsipkan akun ini?</Text>
              <Pressable onPress={() => setArchiveTarget(null)} style={styles.closeBtn}>
                <X size={20} color={Colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.sheetDescription}>
              &quot;{archiveTarget.name}&quot; tidak akan muncul lagi di pilihan &quot;Bayar dari&quot;,
              Alokasi, dan Template Rutin. Transaksi lama yang memakainya tetap utuh dan
              tetap menampilkan nama akun ini.
            </Text>

            {/* Target Account Preview Card */}
            <View style={styles.sheetPreviewCard}>
              <View style={styles.accountIconBox}>
                {renderAccountIconGlyph(iconName, 18, Colors.brandPrimary)}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.accountName}>{archiveTarget.name}</Text>
                  <Badge label="— Akan diarsipkan" tone="alert" />
                </View>
                <Text style={styles.accountSubline}>{sub}</Text>
              </View>
            </View>

            {/* Action Row */}
            <View style={styles.sheetActionRow}>
              <View style={{ flex: 1 }}>
                <SecondaryButton
                  label="Batal"
                  onPress={() => setArchiveTarget(null)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={archiveAccount.isPending ? 'Mengarsipkan…' : 'Arsipkan'}
                  onPress={() => executeArchive(archiveTarget)}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    );
  }
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.canvas,
  },
  container: {
    padding: 16,
    paddingBottom: 48,
    gap: 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  crumb: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  header: {
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    fontSize: FontSize.caption,
    letterSpacing: 0.8,
    color: Colors.textMuted,
    fontWeight: '700',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  supporting: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.brandPrimary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.white,
  },

  // List section styles
  sectionHeaderRow: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  sectionTitleMuted: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  accountList: {
    gap: 8,
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    padding: 12,
    gap: 12,
  },
  accountCardArchived: {
    backgroundColor: Colors.canvas,
    borderColor: Colors.borderSubtle,
    opacity: 0.85,
  },
  accountIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountIconBoxArchived: {
    backgroundColor: Colors.borderSubtle,
  },
  accountCardMiddle: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  accountName: {
    fontSize: FontSize.cardTitle,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  accountNameArchived: {
    color: Colors.textSecondary,
  },
  holderTag: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
  },
  accountSubline: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
  },
  accountSublineMuted: {
    fontSize: FontSize.body,
    color: Colors.textMuted,
  },
  moreBtn: {
    padding: 6,
  },
  reactivateInlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.paidBg,
    borderWidth: 1,
    borderColor: Colors.paidText + '33',
  },
  reactivateInlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.paidText,
  },
  archivedSection: {
    marginTop: 16,
    gap: 8,
  },
  archivedNotice: {
    backgroundColor: Colors.subtle,
    borderRadius: Radius.sm,
    padding: 10,
  },
  archivedNoticeText: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
    lineHeight: 16,
  },

  // Empty state
  emptyCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    padding: 24,
    alignItems: 'center',
    textAlign: 'center',
    gap: 8,
    marginTop: 16,
  },
  emptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptySub: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 8,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.brandPrimary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.pill,
  },
  emptyAddText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.white,
  },

  // Form styles
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    padding: 16,
    gap: 16,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resetLink: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    color: Colors.textSecondary,
    textDecorationLine: 'underline',
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    height: 44,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    backgroundColor: Colors.canvas,
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    height: 44,
    backgroundColor: Colors.canvas,
  },
  inputWithAction: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    paddingLeft: 12,
    paddingRight: 6,
    height: 44,
    backgroundColor: Colors.canvas,
  },
  inputFlex: {
    flex: 1,
    height: 44,
    fontSize: FontSize.body,
    color: Colors.textPrimary,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Radius.sm,
  },
  copyBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  previewText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    color: Colors.paidText,
  },
  helperText: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
    lineHeight: 15,
  },

  // Type Grid
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeCard: {
    width: '48.5%',
    backgroundColor: Colors.canvas,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    padding: 12,
    gap: 8,
  },
  typeCardSelected: {
    backgroundColor: Colors.surface,
    borderColor: Colors.brandPrimary,
    borderWidth: 1.5,
  },
  typeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeCardIconBox: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    backgroundColor: Colors.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeCardIconBoxSelected: {
    backgroundColor: Colors.subtle,
  },
  typeCardLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  typeCardLabelSelected: {
    fontWeight: '700',
    color: Colors.textPrimary,
  },

  // Icon choices row
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  iconChoice: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.canvas,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconChoiceSelected: {
    backgroundColor: Colors.surface,
    borderColor: Colors.brandPrimary,
    borderWidth: 2,
  },
  iconBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Error box
  errBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.pendingBg,
    borderRadius: Radius.sm,
    padding: 10,
  },
  errText: {
    fontSize: FontSize.caption,
    color: Colors.pendingText,
    flex: 1,
  },

  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },

  // Destructive section
  destructiveSection: {
    gap: 12,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderSubtle,
  },
  archiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.alertText,
    backgroundColor: Colors.alertBg,
  },
  archiveBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.alertText,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.pendingBorder,
    backgroundColor: Colors.pendingBg,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.pendingText,
  },
  destructiveHelper: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
    lineHeight: 16,
    textAlign: 'center',
  },

  // Action Sheet (Modal)
  modalScrim: {
    flex: 1,
    backgroundColor: Colors.overlayScrim,
    justifyContent: 'flex-end',
  },
  actionSheetContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: 20,
    gap: 12,
  },
  actionSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  actionSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  closeBtn: {
    padding: 4,
  },
  actionSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  actionSheetRowText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },

  // Bottom Sheet (J3)
  sheetOverlay: {
    flex: 1,
    backgroundColor: Colors.overlayScrim,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: 20,
    gap: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  sheetDescription: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  sheetPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.canvas,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    padding: 12,
  },
  sheetActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
});
