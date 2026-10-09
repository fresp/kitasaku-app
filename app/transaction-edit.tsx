import { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Calendar from 'lucide-react-native/icons/calendar';
import CreditCard from 'lucide-react-native/icons/credit-card';
import FileText from 'lucide-react-native/icons/file-text';
import Folder from 'lucide-react-native/icons/folder';
import Pencil from 'lucide-react-native/icons/pencil';
import Trash2 from 'lucide-react-native/icons/trash';
import Wallet from 'lucide-react-native/icons/wallet';
import X from 'lucide-react-native/icons/x';
import { Colors, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { longDateFullLabel } from '../lib/obligation';
import { isZeroBasedCashAccount } from '../lib/account';
import {
  useAccounts,
  useActiveCycle,
  useCancelPendingTransaction,
  useCategories,
  useTransactionLedger,
  useUpdateTransaction,
} from '../lib/queries';
import { useAuth } from '../lib/auth-context';
import { categoryIconName } from '../lib/category-icon';
import { BrandIcon } from '../components/ui/BrandIcon';
import { PrimaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

function parseAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function TransactionEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const ledgerQ = useTransactionLedger(householdId, cycleQ.data?.id, 'actual');
  const catsQ = useCategories(householdId);
  const accsQ = useAccounts(householdId);
  const update = useUpdateTransaction();
  const cancelTxn = useCancelPendingTransaction();

  const txn = useMemo(
    () => (ledgerQ.data ?? []).find((row) => row.id === id),
    [ledgerQ.data, id]
  );

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [amountText, setAmountText] = useState<string | null>(null);
  const [releaseDate, setReleaseDate] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null | undefined>(undefined);
  const [accountId, setAccountId] = useState<string | null | undefined>(undefined);
  const [dateEditing, setDateEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const currentName = name ?? txn?.name ?? '';
  const currentAmount =
    amountText === null
      ? txn?.status === 'PAID'
        ? txn.actual_amount
        : txn?.planned_amount ?? 0
      : parseAmount(amountText);
  const currentDate = releaseDate ?? txn?.release_date ?? todayISO();
  const currentCategoryId = categoryId === undefined ? txn?.category_id ?? null : categoryId;
  const currentAccountId = accountId === undefined ? txn?.account_id ?? null : accountId;
  const categories = (catsQ.data ?? []).filter(
    (c) => c.type === (txn?.direction === 'INCOME' ? 'INCOME' : 'EXPENSE')
  );
  // Rows here belong to the active cycle, so only BANK / E_WALLET apply (migration 028).
  const accounts = (accsQ.data ?? []).filter(isZeroBasedCashAccount);
  const loading = ledgerQ.isLoading || cycleQ.isLoading;
  const failed = ledgerQ.isError || cycleQ.isError;

  const isIncome = txn?.direction === 'INCOME';
  const isPaid = txn?.status === 'PAID';
  const isPending = txn?.status === 'PENDING';
  const displayDate = longDateFullLabel(txn?.release_date ?? todayISO()) ?? txn?.release_date ?? '-';

  async function save() {
    if (!txn) return;
    setErr(null);
    if (currentDate > todayISO()) {
      setErr('Tanggal transaksi tidak boleh di masa depan.');
      return;
    }
    try {
      await update.mutateAsync({
        id: txn.id,
        name: currentName,
        amount: currentAmount,
        releaseDate: currentDate,
        categoryId: currentCategoryId,
        accountId: currentAccountId,
        status: txn.status as 'PENDING' | 'PAID',
      });
      setIsEditing(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal memperbarui transaksi.');
    }
  }

  function handleDelete() {
    if (!txn || !householdId) return;

    if (isPaid) {
      Alert.alert(
        'Transaksi Sudah Lunas',
        'Transaksi yang telah dieksekusi memengaruhi saldo kas akun. Gunakan tombol Ubah untuk merevisi catatan atau nominal jika terjadi koreksi data.',
        [{ text: 'Tutup', style: 'cancel' }]
      );
      return;
    }

    Alert.alert(
      'Batalkan Rencana Transaksi?',
      `Rencana transaksi "${txn.name}" akan dibatalkan dan dipindahkan ke arsip.`,
      [
        { text: 'Kembali', style: 'cancel' },
        {
          text: 'Batalkan Transaksi',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelTxn.mutateAsync({
                householdId,
                transactionId: txn.id,
                reason: 'NOT_HAPPENED',
                note: 'Dibatalkan oleh pengguna dari layar detail transaksi.',
              });
              router.back();
            } catch (e: any) {
              Alert.alert('Gagal', e?.message ?? 'Gagal membatalkan transaksi.');
            }
          },
        },
      ]
    );
  }

  if (failed || loading) {
    return (
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <View style={styles.centerBox}>
            {failed ? (
              <QueryError
                onRetry={() => {
                  void ledgerQ.refetch();
                  void cycleQ.refetch();
                }}
              />
            ) : (
              <Text style={styles.mutedText}>Memuat detail transaksi…</Text>
            )}
            <PrimaryButton label="Kembali" onPress={() => router.back()} />
          </View>
        </View>
      </View>
    );
  }

  if (!txn) {
    return (
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <View style={styles.centerBox}>
            <Text style={styles.errorTitle}>Transaksi tidak ditemukan</Text>
            <PrimaryButton label="Kembali" onPress={() => router.back()} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.scrim}>
      <Pressable
        style={styles.scrimTap}
        onPress={() => router.back()}
        accessibilityLabel="Tutup detail transaksi"
      />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.handle} />

        {/* Top Header Row with Close Icon */}
        <View style={styles.topBar}>
          <Text style={styles.topBarTitle}>
            {isEditing ? 'Ubah Transaksi' : 'Detail Transaksi'}
          </Text>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn}>
            <X size={20} color={Colors.textPrimary} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {isEditing ? (
            /* Edit Form View */
            <View style={styles.editSection}>
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Nama Transaksi</Text>
                <TextInput
                  value={currentName}
                  onChangeText={setName}
                  style={styles.inputCard}
                  placeholder="Nama transaksi"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>

              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Nominal</Text>
                <View style={styles.nominalBox}>
                  <Text style={styles.nominalPrefix}>Rp</Text>
                  <TextInput
                    value={
                      amountText ??
                      formatRupiah(currentAmount, { withPrefix: false })
                    }
                    onChangeText={setAmountText}
                    style={styles.nominalInput}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.textMuted}
                  />
                </View>
              </View>

              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Tanggal Transaksi</Text>
                {dateEditing ? (
                  <View style={{ gap: 6 }}>
                    <TextInput
                      value={currentDate}
                      onChangeText={setReleaseDate}
                      onSubmitEditing={() => setDateEditing(false)}
                      autoFocus
                      style={styles.inputCard}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={Colors.textMuted}
                    />
                  </View>
                ) : (
                  <Pressable
                    style={styles.dateSelector}
                    onPress={() => setDateEditing(true)}
                  >
                    <View style={styles.dateLeft}>
                      <Calendar size={18} color={Colors.textPrimary} />
                      <Text style={styles.dateValue}>
                        {longDateFullLabel(currentDate) ?? currentDate}
                      </Text>
                    </View>
                    <Text style={styles.editDateLink}>Ubah</Text>
                  </Pressable>
                )}
              </View>

              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>Kategori</Text>
                <View style={styles.chipsWrap}>
                  {categories.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => setCategoryId(c.id)}
                      style={[
                        styles.chip,
                        currentCategoryId === c.id && styles.chipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          currentCategoryId === c.id && styles.chipTextActive,
                        ]}
                      >
                        {c.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>
                  {isIncome ? 'Masuk ke Akun' : 'Akun'}
                </Text>
                <View style={styles.chipsWrap}>
                  {accounts.map((a) => (
                    <Pressable
                      key={a.id}
                      onPress={() => setAccountId(a.id)}
                      style={[
                        styles.chip,
                        currentAccountId === a.id && styles.chipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          currentAccountId === a.id && styles.chipTextActive,
                        ]}
                      >
                        {a.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {err && (
                <View style={styles.errBox}>
                  <Text style={styles.errText}>{err}</Text>
                </View>
              )}

              <View style={styles.editActions}>
                <Pressable
                  onPress={() => setIsEditing(false)}
                  style={styles.cancelEditBtn}
                >
                  <Text style={styles.cancelEditBtnText}>Batal</Text>
                </Pressable>
                <Pressable
                  onPress={save}
                  disabled={update.isPending}
                  style={styles.saveEditBtn}
                >
                  <Text style={styles.saveEditBtnText}>
                    {update.isPending ? 'Menyimpan…' : 'Simpan Perubahan'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            /* Clean Detail View (matching 06_detail_transaksi.png) */
            <View style={styles.detailSection}>
              {/* Centered Category Icon Badge */}
              <View
                style={[
                  styles.heroIconBox,
                  isIncome ? styles.heroIconBoxIncome : styles.heroIconBoxExpense,
                ]}
              >
                <BrandIcon
                  name={categoryIconName({
                    name: txn.categories?.name ?? '',
                    type: isIncome ? 'INCOME' : 'EXPENSE',
                    icon: txn.categories?.icon,
                  })}
                  size={32}
                  label=""
                />
              </View>

              {/* Transaction Title & Nominal */}
              <Text style={styles.heroTitle}>{txn.name}</Text>
              <Text
                style={[
                  styles.heroAmount,
                  isIncome ? styles.heroAmountIncome : styles.heroAmountExpense,
                ]}
              >
                {isIncome ? '+' : '−'}
                {formatRupiah(txn.displayAmount)}
              </Text>
              <Text style={styles.heroDate}>{displayDate}</Text>

              {/* Status Pill Badge */}
              <View style={styles.statusPillRow}>
                <View
                  style={[
                    styles.statusPill,
                    isPaid
                      ? styles.statusPillPaid
                      : isPending
                      ? styles.statusPillPending
                      : styles.statusPillCancelled,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      isPaid
                        ? styles.statusPillTextPaid
                        : isPending
                        ? styles.statusPillTextPending
                        : styles.statusPillTextCancelled,
                    ]}
                  >
                    {isPaid ? 'Lunas' : isPending ? 'Belum lunas (Rencana)' : 'Dibatalkan'}
                  </Text>
                </View>
              </View>

              {/* Structured Metadata List */}
              <View style={styles.metaListCard}>
                <View style={styles.metaRow}>
                  <View style={styles.metaRowLeft}>
                    <Folder size={18} color={Colors.textSecondary} />
                    <Text style={styles.metaLabel}>Kategori</Text>
                  </View>
                  <Text style={styles.metaValue}>
                    {txn.categories?.name ?? 'Tanpa kategori'}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.metaRowLeft}>
                    <Wallet size={18} color={Colors.textSecondary} />
                    <Text style={styles.metaLabel}>Akun</Text>
                  </View>
                  <Text style={styles.metaValue}>
                    {txn.accounts?.name ?? 'Tanpa akun'}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.metaRowLeft}>
                    <CreditCard size={18} color={Colors.textSecondary} />
                    <Text style={styles.metaLabel}>Metode / Alur</Text>
                  </View>
                  <Text style={styles.metaValue}>
                    {isIncome ? 'Pemasukan Kas' : 'Pengeluaran'}
                  </Text>
                </View>

                <View style={[styles.metaRow, { borderBottomWidth: 0 }]}>
                  <View style={styles.metaRowLeft}>
                    <FileText size={18} color={Colors.textSecondary} />
                    <Text style={styles.metaLabel}>Catatan</Text>
                  </View>
                  <Text style={styles.metaValue}>{txn.name || '-'}</Text>
                </View>
              </View>

              {/* Bottom Action Bar (Ubah & Hapus) */}
              <View style={styles.bottomActionBar}>
                <Pressable
                  onPress={() => setIsEditing(true)}
                  style={styles.editActionBtn}
                >
                  <Pencil size={18} color={Colors.textPrimary} />
                  <Text style={styles.editActionText}>Ubah</Text>
                </Pressable>

                <Pressable
                  onPress={handleDelete}
                  style={styles.deleteActionBtn}
                >
                  <Trash2 size={18} color={Colors.negative} />
                  <Text style={styles.deleteActionText}>Hapus</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
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
    maxHeight: '94%',
    overflow: 'hidden',
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.borderStrong,
    alignSelf: 'center',
    marginTop: 12,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  closeBtn: {
    padding: 4,
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 36,
  },

  /* Detail Section */
  detailSection: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
  },
  heroIconBox: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroIconBoxExpense: {
    backgroundColor: '#FEE2E2',
  },
  heroIconBoxIncome: {
    backgroundColor: '#ECFDF5',
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0B1527',
  },
  heroAmount: {
    fontSize: 26,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  heroAmountExpense: {
    color: '#0B1527',
  },
  heroAmountIncome: {
    color: '#10B981',
  },
  heroDate: {
    fontSize: 13,
    color: '#64748B',
  },
  statusPillRow: {
    marginVertical: 4,
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  statusPillPaid: {
    backgroundColor: '#ECFDF5',
  },
  statusPillPending: {
    backgroundColor: '#FEF3C7',
  },
  statusPillCancelled: {
    backgroundColor: '#F1F5F9',
  },
  statusPillText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  statusPillTextPaid: {
    color: '#10B981',
  },
  statusPillTextPending: {
    color: '#D97706',
  },
  statusPillTextCancelled: {
    color: '#64748B',
  },

  /* Metadata Card */
  metaListCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginTop: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  metaRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  metaLabel: {
    fontSize: 13.5,
    fontWeight: '500',
    color: '#64748B',
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0B1527',
  },

  /* Bottom Action Bar */
  bottomActionBar: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
    marginTop: 16,
  },
  editActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
  },
  editActionText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0B1527',
  },
  deleteActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FEE2E2',
  },
  deleteActionText: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#EF4444',
  },

  /* Edit Form Styles */
  editSection: {
    gap: 14,
    paddingTop: 6,
  },
  fieldBlock: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  inputCard: {
    backgroundColor: '#FAFBFD',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: 13,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  nominalBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFBFD',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 54,
  },
  nominalPrefix: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginRight: 6,
  },
  nominalInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  dateSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAFBFD',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: 13,
    paddingHorizontal: 14,
    height: 48,
  },
  dateLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dateValue: {
    fontSize: 13.5,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  editDateLink: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.info,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#F1F5F9',
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: Colors.navy,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  chipTextActive: {
    color: Colors.white,
    fontWeight: '700',
  },
  errBox: {
    backgroundColor: Colors.pendingBg,
    borderRadius: 10,
    padding: 10,
  },
  errText: {
    color: Colors.pendingText,
    fontSize: 12,
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  cancelEditBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelEditBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  saveEditBtn: {
    flex: 1.5,
    backgroundColor: Colors.navy,
    borderRadius: 14,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveEditBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.white,
  },
  centerBox: {
    padding: 32,
    alignItems: 'center',
    gap: 16,
  },
  mutedText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
});
