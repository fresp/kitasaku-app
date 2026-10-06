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
import MoreVertical from 'lucide-react-native/icons/ellipsis-vertical';
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

import { Colors, Radius } from '../constants/theme';
import { useAuth } from '../lib/auth-context';
import { formatRupiah } from '../lib/format';
import {
  ACCOUNT_ICON_CHOICES,
  ACCOUNT_TYPE_DEFAULT_ICONS,
  maskAccountNumber,
  validateAccountNumber,
} from '../lib/account';
import type { AccountType } from '../lib/account';
import {
  useAccountUsage,
  useAccounts,
  useActiveCycle,
  useCycleAccountSnapshots,
  useUpdateCyclePrimaryAccount,
  useArchiveAccount,
  useCreateAccount,
  useDeleteAccount,
  useReactivateAccount,
  useUpdateAccount,
} from '../lib/queries';
import type { Account } from '../lib/queries';
import { Badge } from '../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

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

function getAccountBrand(acc: Account) {
  const nameLower = (acc.name || '').toLowerCase();
  if (nameLower.includes('bca')) {
    return { bg: '#0060AF', glyph: Landmark };
  }
  if (nameLower.includes('gopay')) {
    return { bg: '#00AED6', glyph: Wallet };
  }
  if (nameLower.includes('dana')) {
    return { bg: '#118EEA', glyph: Smartphone };
  }
  if (nameLower.includes('ovo')) {
    return { bg: '#4C3494', glyph: CreditCard };
  }
  if (nameLower.includes('cash') || acc.type === 'CASH') {
    return { bg: '#10B981', glyph: Banknote };
  }
  if (nameLower.includes('mandiri')) {
    return { bg: '#003D79', glyph: Landmark };
  }
  if (nameLower.includes('bri')) {
    return { bg: '#00529C', glyph: Landmark };
  }
  if (nameLower.includes('bni')) {
    return { bg: '#F15A24', glyph: Landmark };
  }
  if (nameLower.includes('jago')) {
    return { bg: '#F37021', glyph: Landmark };
  }
  switch (acc.type) {
    case 'BANK':
      return { bg: '#2563EB', glyph: Landmark };
    case 'E_WALLET':
      return { bg: '#0284C7', glyph: Wallet };
    case 'CREDIT_CARD':
      return { bg: '#4F46E5', glyph: CreditCard };
    case 'CASH':
      return { bg: '#10B981', glyph: Banknote };
    default:
      return { bg: '#475569', glyph: Wallet };
  }
}

function getAccountTypeSubline(acc: Account) {
  const last4 = acc.account_number ? acc.account_number.replace(/[\s-]/g, '').slice(-4) : '';
  if (acc.type === 'BANK') {
    return last4 ? `Rekening · ${last4}` : 'Rekening Bank';
  }
  if (acc.type === 'E_WALLET') {
    return 'E-Wallet';
  }
  if (acc.type === 'CASH') {
    return 'Uang Tunai';
  }
  if (acc.type === 'CREDIT_CARD') {
    return last4 ? `Kartu Kredit · ${last4}` : 'Kartu Kredit';
  }
  return acc.type;
}

export default function ManagedAccountScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const accsQ = useAccounts(householdId, { includeArchived: true });
  const activeCycleQ = useActiveCycle(householdId);
  const snapshotsQ = useCycleAccountSnapshots(householdId, activeCycleQ.data?.id);
  const updatePrimaryAccount = useUpdateCyclePrimaryAccount();
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
  const [topMenuVisible, setTopMenuVisible] = useState(false);

  // Bottom sheet state for J3 Archive Confirmation
  const [archiveTarget, setArchiveTarget] = useState<Account | null>(null);

  // Card action menu target
  const [menuTarget, setMenuTarget] = useState<Account | null>(null);

  // Check usage for the editing account
  const usageQ = useAccountUsage(draft.id ?? undefined);
  const isReferenced = usageQ.data?.isUsed ?? true;

  const allAccounts = useMemo(() => accsQ.data ?? [], [accsQ.data]);
  const activeAccounts = useMemo(
    () => allAccounts.filter((a) => a.is_active !== false),
    [allAccounts]
  );
  const archivedAccounts = useMemo(
    () => allAccounts.filter((a) => a.is_active === false),
    [allAccounts]
  );

  const snapshotsByAccount = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of snapshotsQ.data ?? []) {
      map[s.account_id] = s.closing_stated;
    }
    return map;
  }, [snapshotsQ.data]);

  const saving = createAccount.isPending || updateAccount.isPending;
  const primaryAccountId = activeCycleQ.data?.primary_account_id ?? null;

  async function selectPrimaryAccount(accountId: string) {
    if (!householdId || !activeCycleQ.data) return;
    try {
      await updatePrimaryAccount.mutateAsync({
        householdId,
        cycleId: activeCycleQ.data.id,
        accountId,
      });
    } catch (error: any) {
      Alert.alert('Gagal memilih rekening utama', error?.message ?? 'Coba lagi.');
    }
  }

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
  // FORM VIEW (Tambah / Ubah Akun)
  // ==========================================
  if (viewMode === 'form') {
    const isEdit = !!draft.id;
    const effectiveDefaultIcon = ACCOUNT_TYPE_DEFAULT_ICONS[draft.type] ?? 'wallet';
    const effectiveIcon = draft.icon ?? effectiveDefaultIcon;
    const maskedPreview =
      draft.accountNumber.trim().length >= 4
        ? maskAccountNumber(draft.accountNumber)
        : null;

    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          {/* Top Bar */}
          <View style={styles.topBar}>
            <Pressable onPress={() => setViewMode('list')} style={styles.navBtn}>
              <ArrowLeft size={20} color="#0B1527" />
            </Pressable>
            <Text style={styles.headerTitle}>{isEdit ? 'Ubah Akun' : 'Tambah Akun'}</Text>
            <View style={{ width: 36 }} />
          </View>

          {/* Form Fields Card */}
          <View style={styles.formCard}>
            {/* Field 1: Nama Akun */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>NAMA AKUN *</Text>
              <View style={styles.inputWithIcon}>
                <TextInput
                  value={draft.name}
                  onChangeText={(v) => setDraft({ ...draft, name: v })}
                  placeholder="Contoh: BCA, GoPay, Mandiri"
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
                      {copied ? 'Tersalin' : 'Salin'}
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
            </View>

            {/* Field 4: Nama Pemilik Rekening */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>NAMA PEMILIK REKENING (OPSIONAL)</Text>
              <TextInput
                value={draft.accountHolderName}
                onChangeText={(v) => setDraft({ ...draft, accountHolderName: v })}
                placeholder="Nama yang tertera di rekening"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
            </View>

            {/* Field 5: Icon Akun */}
            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>ICON AKUN</Text>
                {draft.icon && (
                  <Pressable onPress={() => setDraft({ ...draft, icon: null })}>
                    <Text style={styles.resetLink}>Default</Text>
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

            {/* Action Buttons */}
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
                ) : (
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
                )}
              </View>
            )}
          </View>
        </ScrollView>

        {renderArchiveBottomSheet()}
      </SafeAreaView>
    );
  }

  // ==========================================
  // LIST VIEW (Matches 12_kelola_akun.png)
  // ==========================================
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Top Header Bar */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.navBtn}>
            <ArrowLeft size={20} color="#0B1527" />
          </Pressable>
          <Text style={styles.headerTitle}>Akun</Text>
          <Pressable onPress={() => setTopMenuVisible(true)} style={styles.navBtn}>
            <MoreVertical size={20} color="#0B1527" />
          </Pressable>
        </View>

        {/* Centered "+ Tambah Akun" Pill */}
        <Pressable onPress={openCreateForm} style={styles.addAccountPill}>
          <Plus size={16} color="#0B1527" strokeWidth={2.5} />
          <Text style={styles.addAccountText}>Tambah Akun</Text>
        </Pressable>

        {/* Empty State */}
        {allAccounts.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconBox}>
              <Wallet size={28} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Belum ada akun</Text>
            <Text style={styles.emptySub}>
              Tambahkan rekening, kartu, atau e-wallet keluarga untuk mencatat mutasi pengeluaran.
            </Text>
          </View>
        ) : (
          <View style={styles.accountListCard}>
            {activeAccounts.map((acc, index) => {
              const brand = getAccountBrand(acc);
              const BrandGlyph = brand.glyph;
              const subline = getAccountTypeSubline(acc);
              const balance = snapshotsByAccount[acc.id] ?? 0;
              const isLast = index === activeAccounts.length - 1;

              return (
                <Pressable
                  key={acc.id}
                  onPress={() => openEditForm(acc)}
                  onLongPress={() => setMenuTarget(acc)}
                  style={[styles.accountRow, !isLast && styles.accountRowBordered]}
                >
                  {/* Colored Squircle Brand Icon */}
                  <View style={[styles.brandSquircle, { backgroundColor: brand.bg }]}>
                    <BrandGlyph size={20} color="#FFFFFF" />
                  </View>

                  {/* Account Name & Type/Masked */}
                  <View style={styles.accountInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.accountName} numberOfLines={1}>
                        {acc.name}
                      </Text>
                      {acc.id === primaryAccountId && (
                        <Badge label="Utama" tone="paid" />
                      )}
                    </View>
                    <Text style={styles.accountSub}>{subline}</Text>
                  </View>

                  {/* Right-aligned Balance */}
                  <Text style={styles.accountBalance}>
                    {formatRupiah(balance)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Archived Accounts Group */}
        {archivedAccounts.length > 0 && (
          <View style={styles.archivedSection}>
            <Text style={styles.archivedTitle}>
              DIARSIPKAN ({archivedAccounts.length})
            </Text>

            <View style={styles.accountListCard}>
              {archivedAccounts.map((acc, index) => {
                const brand = getAccountBrand(acc);
                const BrandGlyph = brand.glyph;
                const subline = getAccountTypeSubline(acc);
                const isLast = index === archivedAccounts.length - 1;

                return (
                  <View
                    key={acc.id}
                    style={[
                      styles.accountRow,
                      styles.accountRowArchived,
                      !isLast && styles.accountRowBordered,
                    ]}
                  >
                    <View style={[styles.brandSquircle, { backgroundColor: '#94A3B8' }]}>
                      <BrandGlyph size={20} color="#FFFFFF" />
                    </View>

                    <View style={styles.accountInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[styles.accountName, { color: Colors.textSecondary }]} numberOfLines={1}>
                          {acc.name}
                        </Text>
                        <Badge label="Arsip" tone="default" />
                      </View>
                      <Text style={styles.accountSub}>{subline}</Text>
                    </View>

                    <Pressable
                      onPress={() => executeReactivate(acc)}
                      style={styles.reactivateBtn}
                    >
                      <RotateCcw size={14} color={Colors.paidText} />
                      <Text style={styles.reactivateText}>Aktifkan</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Row Action Menu Modal */}
      {renderRowActionMenu()}

      {/* Top Header More Menu Modal */}
      {renderTopMenu()}

      {/* Frame J3 Archive Bottom Sheet */}
      {renderArchiveBottomSheet()}
    </SafeAreaView>
  );

  function renderTopMenu() {
    return (
      <Modal
        visible={topMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTopMenuVisible(false)}
      >
        <Pressable style={styles.modalScrim} onPress={() => setTopMenuVisible(false)}>
          <View style={styles.actionSheetContent}>
            <View style={styles.actionSheetHeader}>
              <Text style={styles.actionSheetTitle}>Opsi Akun</Text>
              <Pressable onPress={() => setTopMenuVisible(false)}>
                <X size={18} color={Colors.textSecondary} />
              </Pressable>
            </View>

            <Pressable
              onPress={() => {
                setTopMenuVisible(false);
                router.push('/account-snapshots');
              }}
              style={styles.actionSheetRow}
            >
              <Wallet size={18} color="#0B1527" />
              <Text style={styles.actionSheetRowText}>Snapshot Saldo Kas</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setTopMenuVisible(false);
                router.push('/account-summary');
              }}
              style={styles.actionSheetRow}
            >
              <Landmark size={18} color="#0B1527" />
              <Text style={styles.actionSheetRowText}>Ringkasan Zero-Based Kas</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    );
  }

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
              <Pressable onPress={() => setMenuTarget(null)}>
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

            {!isArchived && menuTarget.type === 'BANK' && menuTarget.id !== primaryAccountId && activeCycleQ.data && (
              <Pressable
                disabled={updatePrimaryAccount.isPending}
                onPress={() => {
                  const target = menuTarget;
                  setMenuTarget(null);
                  selectPrimaryAccount(target.id);
                }}
                style={styles.actionSheetRow}
              >
                <Check size={18} color={Colors.brandPrimary} />
                <Text style={[styles.actionSheetRowText, { color: Colors.brandPrimary }]}>
                  Jadikan Rekening Utama
                </Text>
              </Pressable>
            )}

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

  function renderArchiveBottomSheet() {
    if (!archiveTarget) return null;
    const sub = getAccountTypeSubline(archiveTarget);

    return (
      <Modal
        visible={!!archiveTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setArchiveTarget(null)}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setArchiveTarget(null)} />
          <View style={styles.sheetCard}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Arsipkan akun ini?</Text>
              <Pressable onPress={() => setArchiveTarget(null)}>
                <X size={20} color={Colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.sheetDescription}>
              &quot;{archiveTarget.name}&quot; tidak akan muncul lagi di pilihan transaksi baru. Mutasi lama yang memakainya tetap aman.
            </Text>

            <View style={styles.sheetPreviewCard}>
              <View style={[styles.brandSquircle, { backgroundColor: '#94A3B8' }]}>
                <Wallet size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.accountName}>{archiveTarget.name}</Text>
                <Text style={styles.accountSub}>{sub}</Text>
              </View>
            </View>

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
    backgroundColor: '#FFFFFF',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0B1527',
    textAlign: 'center',
  },
  addAccountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#F8FAFC',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignSelf: 'center',
    marginBottom: 20,
  },
  addAccountText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0B1527',
  },

  accountListCard: {
    backgroundColor: '#FFFFFF',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 14,
  },
  accountRowBordered: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  accountRowArchived: {
    opacity: 0.65,
  },
  brandSquircle: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountInfo: {
    flex: 1,
    gap: 2,
  },
  accountName: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#0B1527',
  },
  accountSub: {
    fontSize: 13,
    color: '#64748B',
  },
  accountBalance: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0B1527',
  },

  archivedSection: {
    marginTop: 24,
    gap: 10,
  },
  archivedTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  reactivateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.paidBg,
  },
  reactivateText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.paidText,
  },

  emptyCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
  },
  emptyIconBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1527',
  },
  emptySub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },

  // Form styles
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    gap: 16,
    marginTop: 8,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resetLink: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.brandPrimary,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 14,
    color: '#0B1527',
    backgroundColor: '#F8FAFC',
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    backgroundColor: '#F8FAFC',
  },
  inputWithAction: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingLeft: 12,
    paddingRight: 6,
    height: 44,
    backgroundColor: '#F8FAFC',
  },
  inputFlex: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: '#0B1527',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
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
    fontSize: 12,
    fontWeight: '600',
    color: Colors.paidText,
  },

  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeCard: {
    width: '48.5%',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  typeCardSelected: {
    backgroundColor: '#FFFFFF',
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
    borderRadius: 8,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeCardIconBoxSelected: {
    backgroundColor: '#EEF2FF',
  },
  typeCardLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
  typeCardLabelSelected: {
    fontWeight: '700',
    color: '#0B1527',
  },

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
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconChoiceSelected: {
    backgroundColor: '#FFFFFF',
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

  errBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.pendingBg,
    borderRadius: 8,
    padding: 10,
  },
  errText: {
    fontSize: 12,
    color: Colors.pendingText,
    flex: 1,
  },

  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  destructiveSection: {
    gap: 12,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  archiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 10,
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.pendingBorder,
    backgroundColor: Colors.pendingBg,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.pendingText,
  },

  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(11, 21, 39, 0.45)',
    justifyContent: 'flex-end',
  },
  actionSheetContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 12,
  },
  actionSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  actionSheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0B1527',
  },
  actionSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  actionSheetRowText: {
    fontSize: 14.5,
    fontWeight: '600',
    color: '#0B1527',
  },

  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 21, 39, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0B1527',
  },
  sheetDescription: {
    fontSize: 13.5,
    color: '#64748B',
    lineHeight: 19,
  },
  sheetPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
  },
  sheetActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
});
