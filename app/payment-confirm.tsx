import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { pendingTransactions } from '../lib/mockData';
import { useAuth } from '../lib/auth-context';
import { useAccounts, useActiveCycle, useMarkAsPaid, useTransactions } from '../lib/queries';
import { accountSubline } from '../lib/account';
import { canMarkAsPaid } from '../lib/zero-based';
import { Badge } from '../components/ui/Badge';
import { BrandIcon } from '../components/ui/BrandIcon';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

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

  const liveTxn = useMemo(
    () => (txnsQ.data ?? []).find((t) => t.id === id),
    [txnsQ.data, id]
  );
  const mock = pendingTransactions.find((t) => t.id === id) ?? pendingTransactions[1];

  const name = liveTxn?.name ?? mock.name;
  const category = liveTxn?.categories?.name ?? mock.category;
  const accountName = liveTxn?.accounts?.name ?? mock.account;
  const planned = liveTxn?.planned_amount ?? mock.amount;
  // A settled row must never be reachable here — the route is public, so a
  // stale link or a back-navigation could otherwise re-confirm it and
  // decrement the obligation twice.
  const payable = !liveTxn || canMarkAsPaid(liveTxn);

  const accountOptions = accsQ.data ?? [];
  const [accountId, setAccountId] = useState<string | null>(null);
  const [isFinal, setIsFinal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The amount actually paid is often not the planned amount. Empty means
  // "same as planned"; anything typed becomes the recorded actual.
  const [amountText, setAmountText] = useState('');
  const actualAmount = amountText.trim() === '' ? planned : parseAmount(amountText);

  const selectedAccountId = accountId ?? liveTxn?.account_id ?? null;
  const selectedAccountName =
    accountOptions.find((a) => a.id === selectedAccountId)?.name ?? accountName;
  const differs = actualAmount !== planned;

  async function confirm() {
    setErr(null);
    if (!liveTxn || !householdId) {
      router.back();
      return;
    }
    if (actualAmount <= 0) { setErr('Nominal pembayaran harus lebih dari Rp 0.'); return; }
    try {
      await markPaid.mutateAsync({
        txn: liveTxn,
        actualAmount,
        accountId: selectedAccountId,
        isFinal,
      });
      router.back();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan. Coba lagi.');
    }
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
        <Text style={styles.eyebrow}>KONFIRMASI PEMBAYARAN</Text>
        <Text style={styles.title}>{name}</Text>
        <Text style={styles.sub}>
          {category} • {selectedAccountName}
        </Text>

        <View style={styles.amountBlock}>
          <Text style={styles.amountLabel}>Nominal pembayaran</Text>
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
            {typeof mock.prevAmount === 'number' && !liveTxn && (
              <Badge label={`↓ Bulan lalu ${formatRupiah(mock.prevAmount)}`} tone="paid" />
            )}
            {liveTxn?.obligation_id && <Badge label="Dari pool tanggungan" tone="alert" />}
          </View>
        </View>

        <View style={styles.row}>
          <View>
            <Text style={styles.rowLabel}>Tanggal bayar</Text>
            <Text style={styles.rowValue}>
              {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </View>
          <Text style={styles.link}>Hari ini</Text>
        </View>

        <Text style={styles.sectionLabel}>Bayar dari</Text>
        <View style={styles.pills}>
          {accountOptions.length === 0 ? (
            <Badge label={selectedAccountName} />
          ) : (
            accountOptions.map((a) => {
              const active = a.id === selectedAccountId;
              const sub = accountSubline(a);
              return (
                <Pressable
                  key={a.id}
                  onPress={() => setAccountId(a.id)}
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
          <View style={{ flex: 1 }}>
            <SecondaryButton label="Batal" onPress={() => router.back()} />
          </View>
          <View style={{ flex: 2 }}>
            <PrimaryButton
              label={markPaid.isPending ? 'Menyimpan…' : 'Konfirmasi & Bayar'}
              onPress={confirm}
            />
          </View>
        </View>
        {!householdId && (
          <Text style={styles.note}>Mode offline — login untuk menyimpan ke Supabase.</Text>
        )}
      </ScrollView>
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
});
