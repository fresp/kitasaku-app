import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import X from 'lucide-react-native/icons/x';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { isZeroBasedCashAccount } from '../lib/account';
import { useAuth } from '../lib/auth-context';
import {
  useAccounts,
  useActiveCycle,
  useCycleAccountSnapshots,
  useRecordCycleAccountSnapshot,
} from '../lib/queries';
import { PrimaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

function parseAmount(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Snapshot Rekening Kas.
 *
 * Every cash account needs a stated closing balance, so the screen is a list
 * of accounts with the one each already has. It used to be a row of chips with
 * a single form underneath, which meant tapping through the accounts one at a
 * time to find out which were still missing — the one question the screen
 * exists to answer.
 */
export default function AccountSnapshotsScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const accountsQ = useAccounts(householdId);
  const snapshotsQ = useCycleAccountSnapshots(householdId, cycleQ.data?.id);
  const saveSnapshot = useRecordCycleAccountSnapshot();

  const accounts = useMemo(
    () =>
      (accountsQ.data ?? []).filter(
        (account) => account.is_active !== false && isZeroBasedCashAccount(account)
      ),
    [accountsQ.data]
  );
  const savedByAccount = useMemo(
    () => new Map((snapshotsQ.data ?? []).map((s) => [s.account_id, s])),
    [snapshotsQ.data]
  );

  const cycleId = cycleQ.data?.id ?? null;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const editingAccount = accounts.find((a) => a.id === editingId) ?? null;
  const editingSaved = editingId ? savedByAccount.get(editingId) ?? null : null;
  const closing = parseAmount(text);
  const amountInvalid = text.length > 0 && closing === null;

  const ready =
    !!householdId && !!cycleId &&
    !cycleQ.isLoading && !cycleQ.isError &&
    !accountsQ.isLoading && !accountsQ.isError &&
    !snapshotsQ.isLoading && !snapshotsQ.isError;

  const missingCount = accounts.filter((a) => !savedByAccount.has(a.id)).length;

  function openEditor(accountId: string) {
    const saved = savedByAccount.get(accountId);
    setEditingId(accountId);
    setText(saved ? String(saved.closing_stated) : '');
    setErr(null);
  }

  function closeEditor() {
    setEditingId(null);
    setText('');
    setErr(null);
  }

  async function submit() {
    setErr(null);
    if (!householdId || !cycleId || !editingAccount) {
      setErr('Pilih rekening kas dan pastikan ada siklus aktif.');
      return;
    }
    if (closing === null) {
      setErr('Masukkan saldo akhir sebagai bilangan bulat.');
      return;
    }
    try {
      await saveSnapshot.mutateAsync({
        householdId,
        cycleId,
        accountId: editingAccount.id,
        closingStated: closing,
      });
      closeEditor();
    } catch (e: any) {
      setErr(e?.message ?? 'Snapshot saldo belum tersimpan.');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <ArrowLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>SALDO YANG DINYATAKAN</Text>
            <Text style={styles.title}>Snapshot Rekening Kas</Text>
          </View>
        </View>

        <Text style={styles.note}>
          Catat hanya saldo akhir yang terlihat pada bank/e-wallet. Saldo awal siklus
          berikutnya hanya tersedia bila siklus terdahulu memiliki snapshot rekening yang
          sama.
        </Text>

        {accountsQ.isError && (
          <QueryError onRetry={() => accountsQ.refetch()} retrying={accountsQ.isFetching} message="Daftar rekening belum bisa dibaca." />
        )}
        {cycleQ.isError && (
          <QueryError onRetry={() => cycleQ.refetch()} retrying={cycleQ.isFetching} message="Siklus aktif belum bisa dibaca." />
        )}
        {snapshotsQ.isError && (
          <QueryError onRetry={() => snapshotsQ.refetch()} retrying={snapshotsQ.isFetching} message="Snapshot siklus belum bisa dibaca." />
        )}
        {!cycleQ.data && !cycleQ.isLoading && !cycleQ.isError && (
          <Text style={styles.warning}>Belum ada siklus aktif.</Text>
        )}

        {ready && accounts.length > 0 && (
          <View style={styles.statusCard}>
            <Text style={styles.statusLabel}>{cycleQ.data?.name}</Text>
            <Text style={styles.statusValue}>
              {missingCount === 0
                ? `${accounts.length} rekening sudah dicatat`
                : `${missingCount} dari ${accounts.length} rekening belum dicatat`}
            </Text>
          </View>
        )}

        {accountsQ.isLoading ? (
          <Text style={styles.note}>Memuat rekening…</Text>
        ) : (
          accounts.map((account) => {
            const saved = savedByAccount.get(account.id);
            return (
              <Pressable
                key={account.id}
                onPress={() => ready && openEditor(account.id)}
                style={styles.row}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowName}>{account.name}</Text>
                  <Text style={styles.note}>{account.type}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={[styles.rowValue, !saved && styles.rowValueMissing]}>
                    {saved ? formatRupiah(saved.closing_stated) : 'Belum dicatat'}
                  </Text>
                  {!!saved && (
                    <Text style={styles.note}>
                      {new Date(saved.noted_at).toLocaleDateString('id-ID')}
                    </Text>
                  )}
                </View>
                <ChevronRight size={14} color={Colors.textMuted} />
              </Pressable>
            );
          })
        )}

        {!accountsQ.isLoading && !accountsQ.isError && accounts.length === 0 && (
          <Text style={styles.note}>Belum ada rekening BANK atau e-wallet aktif.</Text>
        )}
      </ScrollView>

      <Modal
        visible={editingAccount !== null}
        transparent
        animationType="slide"
        onRequestClose={closeEditor}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.scrim}
        >
          <View style={styles.sheet}>
            <View style={styles.grab} />
            {editingAccount && (
              <>
                <View style={styles.sheetHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetTitle}>{editingAccount.name}</Text>
                    <Text style={styles.sheetSub}>
                      {editingAccount.type} · {cycleQ.data?.name ?? 'tanpa siklus'}
                    </Text>
                  </View>
                  <Pressable onPress={closeEditor} hitSlop={10}>
                    <X size={20} color={Colors.textPrimary} />
                  </Pressable>
                </View>

                <View style={styles.moneyBox}>
                  <Text style={styles.label}>SALDO AKHIR</Text>
                  <TextInput
                    value={text}
                    onChangeText={(v) => { setText(v); setErr(null); }}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={Colors.borderStrong}
                    editable={!saveSnapshot.isPending}
                    style={styles.moneyInput}
                  />
                  <Text style={styles.moneyEcho}>
                    {closing === null ? 'Rp 0' : formatRupiah(closing)}
                  </Text>
                  {!!editingSaved && closing !== null && closing !== editingSaved.closing_stated && (
                    <Text style={styles.moneyWas}>
                      Sebelumnya {formatRupiah(editingSaved.closing_stated)}.
                    </Text>
                  )}
                </View>

                <Text style={styles.note}>
                  Tidak ada angka saldo yang akan dibuat otomatis dari transaksi — ini
                  harus angka yang benar-benar terlihat di rekening.
                </Text>

                {amountInvalid && (
                  <Text style={styles.error}>Nominal harus berupa bilangan bulat yang aman.</Text>
                )}
                {err && <Text style={styles.error}>{err}</Text>}

                <PrimaryButton
                  label={
                    saveSnapshot.isPending
                      ? 'Menyimpan…'
                      : editingSaved
                        ? 'Simpan perubahan'
                        : 'Simpan snapshot'
                  }
                  onPress={
                    closing !== null && !amountInvalid && !saveSnapshot.isPending
                      ? submit
                      : undefined
                  }
                />
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 10, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: {
    width: 36, height: 36, borderRadius: Radius.pill, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '700', marginTop: 2 },

  statusCard: {
    backgroundColor: Colors.brandPrimary, borderRadius: Radius.md, padding: 13, gap: 3,
  },
  statusLabel: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  statusValue: { color: Colors.white, fontSize: 15, fontWeight: '700' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  rowName: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  rowValue: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowValueMissing: { color: Colors.textMuted, fontWeight: '500' },

  label: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.7 },
  note: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  warning: { color: Colors.alertText, backgroundColor: Colors.alertBg, borderRadius: Radius.md, padding: 12, fontSize: FontSize.body },
  error: { color: Colors.pendingText, backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 10, fontSize: FontSize.caption },

  scrim: { flex: 1, backgroundColor: Colors.overlayScrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 18, paddingBottom: 28, gap: 9,
  },
  grab: {
    width: 44, height: 4, borderRadius: Radius.pill, backgroundColor: Colors.borderStrong,
    alignSelf: 'center', marginBottom: 10,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sheetTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
  sheetSub: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 3 },

  moneyBox: {
    borderWidth: 1.5, borderColor: Colors.brandPrimary, borderRadius: Radius.md,
    padding: 12, gap: 2, backgroundColor: Colors.surface,
  },
  moneyInput: {
    fontSize: 26, fontWeight: '800', color: Colors.textPrimary,
    fontVariant: ['tabular-nums'], padding: 0, marginTop: 2,
  },
  moneyEcho: { color: Colors.textSecondary, fontSize: FontSize.body, fontWeight: '600' },
  moneyWas: { color: Colors.financingText, fontSize: FontSize.caption, marginTop: 2 },
});
