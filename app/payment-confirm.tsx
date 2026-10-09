import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { CANCELLATION_REASONS, useAccounts, useActiveCycle, useCancelPendingTransaction, useMarkAsPaid, useSettlePendingOutsideCycle, useTransactions } from '../lib/queries';
import { accountSubline, isZeroBasedCashAccount } from '../lib/account';
import { canMarkAsPaid } from '../lib/zero-based';
import { Badge } from '../components/ui/Badge';
import { BrandIcon } from '../components/ui/BrandIcon';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

function parseAmount(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

export default function PaymentConfirmScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const txnsQ = useTransactions(householdId, cycleQ.data?.id);
  const accsQ = useAccounts(householdId);
  const markPaid = useMarkAsPaid();
  const settleOutside = useSettlePendingOutsideCycle();
  const cancelTxn = useCancelPendingTransaction();

  const liveTxn = useMemo(
    () => (txnsQ.data ?? []).find((t) => t.id === id),
    [txnsQ.data, id]
  );

  // This screen used to substitute a mock transaction whenever the real one was
  // not in the cache, so an unrecognised id rendered "Flexy Cash · Rp 1.294.840"
  // as if the family had planned it. Every field below now comes from the row
  // that was actually asked for, or the screen says it could not find it.
  const name = liveTxn?.name ?? '';
  const category = liveTxn?.categories?.name ?? '';
  const accountName = liveTxn?.accounts?.name ?? '';
  const planned = liveTxn?.planned_amount ?? 0;
  // A settled row must never be reachable here — the route is public, so a
  // stale link or a back-navigation could otherwise re-confirm it and
  // decrement the obligation twice.
  const payable = !!liveTxn && canMarkAsPaid(liveTxn);
  // "Not loaded yet" and "not there" are different answers, and only one of
  // them is worth a retry button.
  const loadFailed = txnsQ.isError || cycleQ.isError || accsQ.isError;
  const loading = !loadFailed && txnsQ.isLoading;

  const accountOptions = (accsQ.data ?? []).filter((account) =>
    account.is_active !== false && isZeroBasedCashAccount(account)
  );
  // Credit card / cash accounts are audit-only (migration 028). A plan made on
  // one can only be settled outside the cycle, never booked against bank cash.
  const outsideOptions = (accsQ.data ?? []).filter((account) =>
    account.is_active !== false && !isZeroBasedCashAccount(account)
  );
  const plannedOutside = outsideOptions.some((account) => account.id === liveTxn?.account_id);
  const canSettleOutside = !!liveTxn && liveTxn.direction === 'EXPENSE'
    && liveTxn.flow_type === 'EXPENSE' && !liveTxn.obligation_id && outsideOptions.length > 0;
  const [outsideMode, setOutsideMode] = useState<boolean | null>(null);
  const isOutside = canSettleOutside && (outsideMode ?? plannedOutside);
  const [outsideAccountId, setOutsideAccountId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [isFinal, setIsFinal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The amount actually paid is often not the planned amount. Empty means
  // "same as planned"; anything typed becomes the recorded actual.
  const [amountText, setAmountText] = useState('');
  const [releaseDate, setReleaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const actualAmount = amountText.trim() === '' ? planned : parseAmount(amountText);
  const selectedDate = new Date(`${releaseDate}T00:00:00`);

  function onDateValueChange(_event: { nativeEvent: { timestamp: number } }, date: Date) {
    setReleaseDate(date.toISOString().slice(0, 10));
    setDatePickerVisible(false);
  }

  const selectedAccountId = accountId ?? (accountOptions.some((account) => account.id === liveTxn?.account_id)
    ? liveTxn?.account_id ?? null
    : null);
  const selectedOutsideId = outsideAccountId ?? (plannedOutside ? liveTxn?.account_id ?? null : null);
  const shownOptions = isOutside ? outsideOptions : accountOptions;
  const shownAccountId = isOutside ? selectedOutsideId : selectedAccountId;
  const selectedAccountName =
    shownOptions.find((a) => a.id === shownAccountId)?.name ?? (isOutside || !plannedOutside ? accountName : 'Pilih rekening');
  const isIncome = liveTxn?.direction === 'INCOME';
  const differs = actualAmount !== planned;

  async function confirm() {
    setErr(null);
    if (!liveTxn || !householdId) {
      router.back();
      return;
    }
    if (actualAmount <= 0) { setErr('Nominal pembayaran harus lebih dari Rp 0.'); return; }
    if (!shownAccountId) {
      setErr(isOutside ? 'Pilih kartu kredit atau akun tunai.' : 'Pilih rekening bank atau e-wallet.');
      return;
    }
    // The DB refuses this too (migration 028 section 5): executing a plan that
    // sits on a credit card would rewrite it to a bank account and make the
    // cycle reconcile short. Say what to do instead of surfacing the RPC error.
    if (plannedOutside && !isOutside) {
      setErr(`Rencana ini memakai ${accountName}. Catat di luar siklus, atau ubah akun rencana ke rekening bank/e-wallet lewat Ubah.`);
      return;
    }
    try {
      if (isOutside) {
        await settleOutside.mutateAsync({
          txn: liveTxn,
          actualAmount,
          accountId: shownAccountId,
          isFinal,
          releaseDate,
        });
        router.back();
        return;
      }
      await markPaid.mutateAsync({
        txn: liveTxn,
        actualAmount,
        accountId: selectedAccountId,
        isFinal,
        releaseDate,
      });
      router.back();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan. Coba lagi.');
    }
  }

  async function cancel() {
    setErr(null);
    if (!liveTxn || !householdId) return;
    if (!cancelReason) { setErr('Pilih alasan pembatalan.'); return; }
    try {
      await cancelTxn.mutateAsync({
        householdId,
        transactionId: liveTxn.id,
        reason: cancelReason as Parameters<typeof cancelTxn.mutateAsync>[0]['reason'],
        note: cancelNote,
      });
      setCancelOpen(false);
      router.back();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal membatalkan rencana.');
    }
  }

  const cancelModal = (
    <Modal
      visible={cancelOpen}
      transparent
      animationType="slide"
      onRequestClose={() => setCancelOpen(false)}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Batalkan rencana?</Text>
          <Text style={styles.modalBody}>
            Rencana ini tidak akan dieksekusi, tetapi catatan dan alasan pembatalannya tetap tersimpan di riwayat audit.
          </Text>
          <Text style={styles.sectionLabel}>Alasan</Text>
          <View style={styles.reasonList}>
            {CANCELLATION_REASONS.map((item) => (
              <Pressable
                key={item.value}
                onPress={() => setCancelReason(item.value)}
                style={[styles.reason, cancelReason === item.value && styles.reasonActive]}
              >
                <Text style={[styles.reasonText, cancelReason === item.value && styles.reasonTextActive]}>
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
            multiline
            maxLength={500}
            style={styles.noteInput}
          />
          <Text style={styles.charCount}>{cancelNote.length}/500</Text>
          {err && <Text style={styles.errText}>{err}</Text>}
          <View style={styles.modalActions}>
            <View style={{ flex: 1 }}><SecondaryButton label="Kembali" onPress={() => setCancelOpen(false)} /></View>
            <View style={{ flex: 1 }}><PrimaryButton label={cancelTxn.isPending ? 'Menyimpan…' : 'Batalkan rencana'} onPress={cancel} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (loadFailed || loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.settledBox}>
          {loadFailed ? (
            <QueryError
              onRetry={() => {
                txnsQ.refetch();
                cycleQ.refetch();
                accsQ.refetch();
              }}
              retrying={txnsQ.isFetching}
              message="Transaksi ini belum bisa dibaca dari server, jadi nominalnya belum tentu benar. Datamu tidak hilang."
            />
          ) : (
            <Text style={styles.settledBody}>Memuat transaksi…</Text>
          )}
          <View style={styles.settledAction}>
            <PrimaryButton label="Kembali" onPress={() => router.back()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!liveTxn) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.settledBox}>
          <BrandIcon name="empty-data-tidak-ditemukan" size={84} label="" />
          <Text style={styles.settledTitle}>Transaksi tidak ditemukan</Text>
          <Text style={styles.settledBody}>
            Transaksi ini tidak ada di siklus aktif — mungkin sudah dihapus, atau tautannya sudah
            kedaluwarsa.
          </Text>
          <View style={styles.settledAction}>
            <PrimaryButton label="Kembali" onPress={() => router.back()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!payable) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.settledBox}>
          <BrandIcon name="context-payment" size={84} label="" />
          <Text style={styles.settledTitle}>Transaksi ini sudah lunas</Text>
          <Text style={styles.settledBody}>
            Tidak ada yang perlu dibayar lagi. Sisa tanggungan sudah diperbarui saat pembayaran
            pertama dicatat.
          </Text>
          <View style={styles.settledAction}>
            <PrimaryButton label="Kembali" onPress={() => router.back()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.handle} />
        <Text style={styles.eyebrow}>{isIncome ? 'KONFIRMASI PENERIMAAN' : 'KONFIRMASI PEMBAYARAN'}</Text>
        <Text style={styles.title}>{name}</Text>
        <Text style={styles.sub}>
          {category} • {selectedAccountName}
        </Text>

        <View style={styles.amountBlock}>
          <Text style={styles.amountLabel}>{isIncome ? 'Nominal diterima' : 'Nominal pembayaran'}</Text>
          <Text style={styles.amountValue}>{formatRupiah(actualAmount)}</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder={`Rencana ${formatRupiah(planned)}`}
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            style={styles.amountInput}
          />
          <Text style={styles.amountHint}>
            {amountText.trim() === ''
              ? 'Kosongkan untuk memakai nominal rencana.'
              : differs
                ? `Beda ${formatRupiah(Math.abs(actualAmount - planned))} dari rencana.`
                : 'Sama dengan nominal rencana.'}
          </Text>
          <View style={styles.guideRow}>
            <Badge label={`Rencana ${formatRupiah(planned)}`} />
            {liveTxn.obligation_id && <Badge label="Dari pool tanggungan" tone="alert" />}
          </View>
        </View>

        <Pressable style={styles.row} onPress={() => setDatePickerVisible(true)}>
          <View>
            <Text style={styles.rowLabel}>{isIncome ? 'Tanggal diterima' : 'Tanggal bayar'}</Text>
            <Text style={styles.rowValue}>
              {new Date(`${releaseDate}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </View>
          <Text style={styles.link}>Pilih tanggal</Text>
        </Pressable>

        {datePickerVisible && (
          <DateTimePicker
            value={selectedDate}
            mode="date"
            maximumDate={new Date()}
            onValueChange={onDateValueChange}
            onDismiss={() => setDatePickerVisible(false)}
          />
        )}

        <Text style={styles.sectionLabel}>{isIncome ? 'Masuk ke akun' : 'Bayar dari'}</Text>
        <View style={styles.pills}>
          {shownOptions.length === 0 ? (
            <Badge label={selectedAccountName} />
          ) : (
            shownOptions.map((a) => {
              const active = a.id === shownAccountId;
              const sub = accountSubline(a);
              return (
                <Pressable
                  key={a.id}
                  onPress={() => (isOutside ? setOutsideAccountId(a.id) : setAccountId(a.id))}
                  style={[styles.pill, active && styles.pillActive]}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>
                    {active ? `✓ ${a.name}` : a.name}
                  </Text>
                  <Text style={[styles.pillSub, active && styles.pillSubActive]}>
                    {sub}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>

        {canSettleOutside && (
          <View style={styles.toggleCard}>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Dibayar pakai kartu kredit / tunai</Text>
              <Switch
                value={isOutside}
                onValueChange={(next) => { setErr(null); setOutsideMode(next); }}
                trackColor={{ true: Colors.paidText, false: Colors.borderStrong }}
              />
            </View>
            <Text style={styles.toggleExplainer}>
              {isOutside
                ? 'Dicatat sebagai riwayat di luar siklus. Rencana ini ditutup dan alokasinya dilepas, jadi tidak mengurangi saldo siklus.'
                : plannedOutside
                  ? `Rencana ini memakai ${accountName}, jadi tidak bisa dibayar dari rekening siklus. Biarkan aktif, atau ubah akun rencana ke rekening bank/e-wallet lewat Ubah.`
                  : 'Aktifkan kalau ternyata dibayar pakai kartu kredit atau tunai.'}
            </Text>
          </View>
        )}

        {!!liveTxn?.recurring_template_id && (
          <View style={styles.toggleCard}>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Ini Pembayaran Terakhir</Text>
              <Switch
                value={isFinal}
                onValueChange={setIsFinal}
                trackColor={{ true: Colors.paidText, false: Colors.borderStrong }}
              />
            </View>
            <Text style={styles.toggleExplainer}>
              Tandai selesai di master template rutin, tidak akan di-clone ke siklus bulan depan.
            </Text>
          </View>
        )}

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}

        <View style={styles.ctaRow}>
          <View style={{ flex: 2 }}>
            <PrimaryButton
              label={markPaid.isPending || settleOutside.isPending
                ? 'Menyimpan…'
                : isIncome ? 'Konfirmasi & Terima' : isOutside ? 'Catat di Luar Siklus' : 'Konfirmasi & Bayar'}
              onPress={confirm}
            />
          </View>
          <View style={{ flex: 1 }}>
            <SecondaryButton
              label="Ubah"
              onPress={() => router.push({ pathname: '/transaction-edit', params: { id: liveTxn.id } })}
            />
          </View>
        </View>
        <Pressable onPress={() => { setErr(null); setCancelOpen(true); }} style={styles.cancelLink}>
          <Text style={styles.cancelLinkText}>Batalkan rencana</Text>
        </Pressable>
        {!householdId && (

          <Text style={styles.note}>Mode offline — login untuk menyimpan ke Supabase.</Text>
        )}
      </ScrollView>
      {cancelModal}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 20, gap: 12, paddingBottom: 32 },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.borderStrong, alignSelf: 'center',
  },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '600', letterSpacing: 1 },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '600' },
  sub: { color: Colors.textSecondary, fontSize: FontSize.body },
  amountBlock: { backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 14, gap: 6 },
  amountLabel: { color: Colors.textSecondary, fontSize: FontSize.body },
  amountValue: {
    color: Colors.textPrimary, fontSize: FontSize.heroNumeral,
    fontWeight: '700', fontVariant: ['tabular-nums'],
  },
  guideRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  amountInput: {
    borderWidth: 1, borderColor: Colors.borderStrong, borderRadius: Radius.md,
    paddingHorizontal: 14, height: 48, fontSize: 16, color: Colors.textPrimary,
    backgroundColor: Colors.surface, fontVariant: ['tabular-nums'],
  },
  amountHint: { color: Colors.textMuted, fontSize: FontSize.body },
  settledBox: { flex: 1, padding: 24, gap: 12, justifyContent: 'center', alignItems: 'center' },
  settledAction: { alignSelf: 'stretch', marginTop: 4 },
  settledTitle: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '600' },
  settledBody: { color: Colors.textSecondary, fontSize: FontSize.body },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, padding: 12,
  },
  rowLabel: { color: Colors.textMuted, fontSize: FontSize.body },
  rowValue: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600', marginTop: 2 },
  link: { color: Colors.textPrimary, fontWeight: '600' },
  sectionLabel: { color: Colors.textPrimary, fontWeight: '600', fontSize: 15 },
  pills: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: {
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 2,
    backgroundColor: Colors.surface,
  },
  pillActive: {
    backgroundColor: Colors.brandPrimary,
    borderColor: Colors.brandPrimary,
  },
  pillText: {
    color: Colors.textPrimary,
    fontWeight: '600',
    fontSize: 14,
  },
  pillTextActive: {
    color: Colors.white,
  },
  pillSub: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  pillSubActive: {
    color: Colors.white + 'D9',
  },
  toggleCard: { backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 14, gap: 6 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleLabel: { color: Colors.textPrimary, fontWeight: '600', fontSize: 15 },
  toggleExplainer: { color: Colors.textSecondary, fontSize: FontSize.body },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
  note: { color: Colors.textMuted, fontSize: FontSize.body, textAlign: 'center' },
  ctaRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelLink: { alignItems: 'center', paddingVertical: 8 },
  cancelLinkText: { color: Colors.pendingText, fontWeight: '600' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15, 23, 42, 0.35)' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg, padding: 20, gap: 10 },
  modalTitle: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '700' },
  modalBody: { color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 19 },
  reasonList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reason: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  reasonActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  reasonText: { color: Colors.textSecondary, fontWeight: '600' },
  reasonTextActive: { color: Colors.white },
  noteInput: { minHeight: 76, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, padding: 12, color: Colors.textPrimary, textAlignVertical: 'top' },
  charCount: { color: Colors.textMuted, fontSize: FontSize.caption, textAlign: 'right' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
