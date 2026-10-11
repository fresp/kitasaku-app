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
import ArrowLeftRight from 'lucide-react-native/icons/arrow-left-right';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import X from 'lucide-react-native/icons/x';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useAccounts, useActiveCycle, useCreateTransfer } from '../lib/queries';
import { PrimaryButton, TextButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

function parseAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

/**
 * Relokasi antar akun — three decisions, so it presents as a sheet rather than
 * a page you navigate away to. The route is registered with
 * `presentation: 'modal'` (app/_layout.tsx), and the body is laid out to match:
 * the amount is the hero, and the two accounts are rows showing what is picked
 * rather than two rows of chips.
 */
export default function TransferScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const accountsQ = useAccounts(householdId);
  const createTransfer = useCreateTransfer();

  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const [name, setName] = useState('Relokasi antar akun');
  const [amountText, setAmountText] = useState('');
  const [fromAccountId, setFromAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [auditMode, setAuditMode] = useState(false);
  const [picker, setPicker] = useState<'none' | 'from' | 'to'>('none');

  const selectedFrom = fromAccountId ?? accounts[0]?.id ?? null;
  const selectedTo = toAccountId ?? accounts.find((a) => a.id !== selectedFrom)?.id ?? null;
  const fromAccount = accounts.find((a) => a.id === selectedFrom) ?? null;
  const toAccount = accounts.find((a) => a.id === selectedTo) ?? null;
  const amount = parseAmount(amountText);
  const canSubmit =
    !!householdId &&
    (auditMode || !!cycleQ.data?.id) &&
    !!selectedFrom &&
    !!selectedTo &&
    selectedFrom !== selectedTo &&
    amount > 0;

  function swap() {
    setFromAccountId(selectedTo);
    setToAccountId(selectedFrom);
  }

  async function submit() {
    setErr(null);
    if (!householdId) { setErr('Login dulu untuk mencatat relokasi.'); return; }
    if (!auditMode && !cycleQ.data?.id) { setErr('Belum ada siklus aktif. Aktifkan mode audit untuk mencatat relokasi historis.'); return; }
    if (!name.trim() || name.trim().length < 3) { setErr('Nama relokasi minimal 3 huruf.'); return; }
    if (amount <= 0) { setErr('Nominal relokasi harus lebih dari Rp 0.'); return; }
    if (!selectedFrom || !selectedTo) { setErr('Pilih akun asal dan tujuan.'); return; }
    if (selectedFrom === selectedTo) { setErr('Akun asal dan tujuan harus berbeda.'); return; }

    try {
      await createTransfer.mutateAsync({
        householdId,
        cycleId: auditMode ? null : cycleQ.data!.id,
        name: name.trim(),
        amount,
        fromAccountId: selectedFrom,
        toAccountId: selectedTo,
      });
      router.back();
    } catch (e: any) {
      setErr(e?.message ?? 'Relokasi belum tersimpan.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.grab} />

        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Pindah antar akun</Text>
            <Text style={styles.sub}>
              {cycleQ.data ? cycleQ.data.name : 'Belum ada siklus aktif'}
            </Text>
          </View>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Tutup">
            <X size={20} color={Colors.textPrimary} />
          </Pressable>
        </View>

        {accountsQ.isError && (
          <QueryError
            onRetry={() => accountsQ.refetch()}
            retrying={accountsQ.isFetching}
            message="Daftar akun belum bisa dibaca. Relokasi belum dapat dicatat."
          />
        )}
        {cycleQ.isError && (
          <QueryError
            onRetry={() => cycleQ.refetch()}
            retrying={cycleQ.isFetching}
            message="Siklus aktif belum bisa dibaca."
          />
        )}

        <View style={styles.moneyBox}>
          <Text style={styles.label}>NOMINAL</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder="0"
            placeholderTextColor={Colors.borderStrong}
            keyboardType="number-pad"
            style={styles.moneyInput}
          />
          <Text style={styles.moneyEcho}>{formatRupiah(amount)}</Text>
        </View>

        <PickRow
          label="Dari"
          value={fromAccount?.name ?? 'Belum dipilih'}
          sub={fromAccount?.type}
          muted={!fromAccount}
          onPress={() => setPicker('from')}
        />
        <Pressable onPress={swap} style={styles.swapBtn} accessibilityLabel="Tukar akun">
          <ArrowLeftRight size={15} color={Colors.textSecondary} />
          <Text style={styles.swapText}>Tukar</Text>
        </Pressable>
        <PickRow
          label="Ke"
          value={toAccount?.name ?? 'Belum dipilih'}
          sub={toAccount?.type}
          muted={!toAccount}
          onPress={() => setPicker('to')}
        />

        {accounts.length < 2 && (
          <Text style={styles.muted}>
            Tambahkan minimal dua akun aktif untuk membuat relokasi.
          </Text>
        )}

        <Text style={styles.label}>NAMA RELOKASI</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="mis. Pindah dana ke e-wallet"
          placeholderTextColor={Colors.textMuted}
          style={styles.input}
        />

        <View style={styles.infoCard}>
          <ArrowLeftRight size={16} color={Colors.textSecondary} />
          <Text style={styles.infoText}>
            Relokasi hanya memindahkan uang antar akun keluarga. Ini bukan income, bukan
            pengeluaran, dan tidak menambah total alokasi rumah tangga.
          </Text>
        </View>

        <Pressable
          onPress={() => setAuditMode((value) => !value)}
          style={[styles.auditToggle, auditMode && styles.auditToggleActive]}
        >
          <Text style={[styles.auditTitle, auditMode && styles.auditTitleActive]}>
            Relokasi audit non-siklus
          </Text>
          <Text style={styles.muted}>
            {auditMode
              ? 'Mode audit aktif · cycle_id akan kosong.'
              : 'Gunakan untuk mencatat perpindahan historis tanpa membebani siklus aktif.'}
          </Text>
        </Pressable>

        {!cycleQ.isLoading && !cycleQ.data && !auditMode && (
          <Text style={styles.warning}>
            Belum ada siklus aktif. Relokasi saat ini harus menunggu siklus dibuka.
          </Text>
        )}

        {err && <Text style={styles.error}>{err}</Text>}

        <PrimaryButton
          label={createTransfer.isPending ? 'Menyimpan…' : 'Simpan Relokasi'}
          onPress={canSubmit && !createTransfer.isPending ? submit : undefined}
        />
        <TextButton label="Batal" onPress={() => router.back()} />
      </ScrollView>

      <Modal
        visible={picker !== 'none'}
        transparent
        animationType="fade"
        onRequestClose={() => setPicker('none')}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.scrim}
        >
          <Pressable style={{ flex: 1 }} onPress={() => setPicker('none')} />
          <View style={styles.pickerSheet}>
            <View style={styles.grab} />
            <Text style={styles.title}>
              {picker === 'from' ? 'Akun asal' : 'Akun tujuan'}
            </Text>
            <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ paddingVertical: 6 }}>
              {accounts.map((a) => {
                // The other side's account is shown but not selectable, rather
                // than hidden: a disappearing row reads as a missing account.
                const blocked =
                  picker === 'from' ? a.id === selectedTo : a.id === selectedFrom;
                const selected = picker === 'from' ? a.id === selectedFrom : a.id === selectedTo;
                return (
                  <Pressable
                    key={a.id}
                    disabled={blocked}
                    onPress={() => {
                      if (picker === 'from') setFromAccountId(a.id);
                      else setToAccountId(a.id);
                      setPicker('none');
                    }}
                    style={[
                      styles.optionRow,
                      selected && styles.optionRowOn,
                      blocked && styles.optionRowOff,
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, selected && styles.optionTextOn]}>
                        {a.name}
                      </Text>
                      <Text style={styles.optionSub}>
                        {blocked ? `${a.type} · dipakai sisi lain` : a.type}
                      </Text>
                    </View>
                    {selected && <Text style={styles.optionCheck}>✓</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function PickRow({
  label,
  value,
  sub,
  muted,
  onPress,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.pickRow}>
      <Text style={styles.pickLabel}>{label}</Text>
      <View style={styles.pickValueWrap}>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.pickValue, muted && styles.pickValueMuted]} numberOfLines={1}>
            {value}
          </Text>
          {!!sub && <Text style={styles.pickSub}>{sub}</Text>}
        </View>
        <ChevronRight size={14} color={Colors.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 18, gap: 10, paddingBottom: 36 },
  grab: {
    width: 44, height: 4, borderRadius: Radius.pill, backgroundColor: Colors.borderStrong,
    alignSelf: 'center', marginBottom: 10,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
  sub: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 2 },

  label: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.7 },
  input: {
    height: 44, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 12, color: Colors.textPrimary, backgroundColor: Colors.canvas,
    fontSize: FontSize.body,
  },
  moneyBox: {
    borderWidth: 1.5, borderColor: Colors.brandPrimary, borderRadius: Radius.md,
    padding: 12, gap: 2, backgroundColor: Colors.surface, marginTop: 2,
  },
  moneyInput: {
    fontSize: 28, fontWeight: '800', color: Colors.textPrimary,
    fontVariant: ['tabular-nums'], padding: 0, marginTop: 2,
  },
  moneyEcho: { color: Colors.textSecondary, fontSize: FontSize.body, fontWeight: '600' },

  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 13, paddingVertical: 13, backgroundColor: Colors.surface,
  },
  pickLabel: { color: Colors.textSecondary, fontSize: 12.5 },
  pickValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 'auto', flexShrink: 1 },
  pickValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  pickValueMuted: { color: Colors.textMuted, fontWeight: '500' },
  pickSub: { color: Colors.textMuted, fontSize: FontSize.caption },
  swapBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 12,
  },
  swapText: { color: Colors.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12,
    backgroundColor: Colors.subtle, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle, marginTop: 4,
  },
  infoText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 17 },
  auditToggle: {
    gap: 3, padding: 12, backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  auditToggleActive: { backgroundColor: Colors.paidBg, borderColor: Colors.paidText },
  auditTitle: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },
  auditTitleActive: { color: Colors.paidText },

  muted: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  warning: { color: Colors.alertText, backgroundColor: Colors.alertBg, borderRadius: Radius.md, padding: 12, fontSize: FontSize.body },
  error: { color: Colors.pendingText, backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12, fontSize: FontSize.body },

  scrim: { flex: 1, backgroundColor: Colors.overlayScrim, justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 18, paddingBottom: 28, gap: 6,
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 13, paddingHorizontal: 12, borderRadius: Radius.md,
  },
  optionRowOn: { backgroundColor: Colors.subtle },
  optionRowOff: { opacity: 0.4 },
  optionText: { color: Colors.textPrimary, fontSize: 14 },
  optionTextOn: { fontWeight: '700' },
  optionSub: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 1 },
  optionCheck: { color: Colors.accentStrong, fontSize: 15, fontWeight: '800' },
});
