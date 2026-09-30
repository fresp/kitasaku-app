import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Copy from 'lucide-react-native/icons/copy';
import Check from 'lucide-react-native/icons/check';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import {
  cleanAccountNumber,
  formatAccountNumberDisplay,
  formatBankBadge,
  formatBeneficiaryHolder,
} from '../../lib/beneficiary';
import {
  useAccounts,
  useAllocateDebtPayment,
  useAllocateObligation,
  useObligationInstallments,
  useObligationPayments,
} from '../../lib/queries';
import type { Obligation } from '../../lib/queries';
import { isZeroBasedCashAccount } from '../../lib/account';
import { Badge } from './Badge';
import { PrimaryButton } from './Button';
import { ObligationCard } from './ObligationCard';

function parseAmount(text: string): number {
  return parseInt(text.replace(/[^0-9]/g, '') || '0', 10);
}

/**
 * One row of the Tanggungan list: the card plus whichever panel the person
 * opened under it.
 *
 * A component rather than an inline block because it owns two queries. The
 * installments and the payment history are both per-obligation, and a screen
 * that fetched them for N rows would have to fetch everything and filter — the
 * cycle's transactions only cover the current cycle, so a loan taken in May and
 * paid in June would show an empty history. Asking per obligation gets the
 * whole life of the loan.
 *
 * Both panels record real money and both go through the SQL RPCs, so the
 * obligation's `remaining_amount` is only ever decremented inside the database.
 */
export function ObligationRow({
  obligation,
  todayISO,
  householdId,
  cycleId,
  onPressDetail,
}: {
  obligation: Obligation;
  todayISO: string;
  householdId: string | undefined;
  cycleId: string | undefined;
  onPressDetail: () => void;
}) {
  const [panel, setPanel] = useState<'none' | 'pay' | 'allocate'>('none');
  const [amountText, setAmountText] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCopyBeneficiaryNumber() {
    if (!obligation.beneficiary?.account_number) return;
    const num = cleanAccountNumber(obligation.beneficiary.account_number);
    await Clipboard.setStringAsync(num);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // The card displays installment progress and the next due amount, so the
  // schedule must be available during the normal list render. Payment history
  // remains live for the card's latest-payment cue.
  const instQ = useObligationInstallments(householdId, obligation.id);
  const histQ = useObligationPayments(householdId, obligation.id);
  // Account choices are only rendered inside the action panel.
  const accsQ = useAccounts(householdId, { enabled: panel !== 'none' });
  const pay = useAllocateDebtPayment();
  const allocate = useAllocateObligation();

  const installments = useMemo(() => instQ.data ?? [], [instQ.data]);

  // Payments already booked against this obligation. The ledger is the record —
  // a cached "amount paid" column on the obligation would be one more thing
  // that can disagree with the transactions.
  const history = useMemo(
    () =>
      (histQ.data ?? []).map((t) => ({
        date: t.release_date ?? t.created_at.slice(0, 10),
        amount: t.actual_amount,
        account: t.accounts?.name ?? '',
      })),
    [histQ.data]
  );

  const accountOptions = (accsQ.data ?? []).filter((account) =>
    account.is_active !== false && isZeroBasedCashAccount(account)
  );
  const selectedAccount = accountOptions.some((account) => account.id === accountId)
    ? accountId
    : accountOptions[0]?.id ?? null;

  function openPanel(which: 'pay' | 'allocate', suggested: number) {
    setPanel(which);
    setAmountText(String(Math.max(0, Math.round(suggested))));
    setErr(null);
  }

  async function confirmPay() {
    setErr(null);
    const amount = parseAmount(amountText);
    if (!householdId || !cycleId) { setErr('Buka siklus aktif dulu sebelum mencatat pembayaran.'); return; }
    if (amount <= 0) { setErr('Nominal pembayaran harus lebih dari Rp 0.'); return; }
    if (amount > obligation.remaining_amount) {
      setErr(`Nominal melebihi sisa kewajiban ${formatRupiah(obligation.remaining_amount)}.`);
      return;
    }
    try {
      await pay.mutateAsync({
        householdId, cycleId, obligationId: obligation.id,
        amount, accountId: selectedAccount,
      });
      setPanel('none'); setAmountText('');
    } catch (e: any) { setErr(e?.message ?? 'Gagal mencatat pembayaran.'); }
  }

  async function confirmAllocate() {
    setErr(null);
    const amount = parseAmount(amountText);
    if (!householdId || !cycleId) { setErr('Buka siklus aktif dulu sebelum mengalokasikan.'); return; }
    if (amount <= 0) { setErr('Nominal alokasi harus lebih dari Rp 0.'); return; }
    if (amount > obligation.remaining_amount) {
      setErr(`Nominal melebihi sisa kewajiban ${formatRupiah(obligation.remaining_amount)}.`);
      return;
    }
    try {
      await allocate.mutateAsync({
        householdId, cycleId, obligationId: obligation.id,
        amount, categoryId: null, accountId: selectedAccount,
      });
      setPanel('none'); setAmountText('');
    } catch (e: any) { setErr(e?.message ?? 'Gagal mengalokasikan.'); }
  }

  return (
    <View style={{ gap: 8 }}>
      <ObligationCard
        obligation={obligation}
        todayISO={todayISO}
        installments={installments}
        history={history}
        onPressDetail={onPressDetail}
        onPressPay={(amount) => openPanel('pay', amount)}
        onPressAllocate={() => openPanel('allocate', obligation.remaining_amount)}
      />

      {panel !== 'none' && (
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>
            {panel === 'pay' ? 'CATAT PEMBAYARAN' : 'ALOKASIKAN KE ANGGARAN SIKLUS INI'}
          </Text>

          {panel === 'pay' && obligation.beneficiary && (
            <View style={styles.transferInfoCard}>
              <View style={styles.transferInfoTop}>
                <Badge
                  label={formatBankBadge(obligation.beneficiary.bank_name)}
                  tone="dark"
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.transferInfoName} numberOfLines={1}>
                    {obligation.beneficiary.name}
                  </Text>
                  <Text style={styles.transferInfoNumber}>
                    {formatAccountNumberDisplay(obligation.beneficiary.account_number)}
                    {formatBeneficiaryHolder(obligation.beneficiary.account_holder_name)
                      ? ` • ${formatBeneficiaryHolder(obligation.beneficiary.account_holder_name)}`
                      : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={handleCopyBeneficiaryNumber}
                  style={[styles.copyBtn, copied && styles.copyBtnCopied]}
                  accessibilityRole="button"
                >
                  {copied ? (
                    <>
                      <Check size={12} color={Colors.paidText} strokeWidth={2.5} />
                      <Text style={styles.copyTextCopied}>✓ Tersalin</Text>
                    </>
                  ) : (
                    <>
                      <Copy size={12} color={Colors.brandPrimary} />
                      <Text style={styles.copyText}>Salin</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}

          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder={`Sisa ${formatRupiah(obligation.remaining_amount)}`}
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            style={styles.input}
          />
          {accountOptions.length > 0 ? (
            <View style={styles.pills}>
              {accountOptions.map((a) => {
                const active = a.id === selectedAccount;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => setAccountId(a.id)}
                    style={[styles.pill, active && styles.pillActive]}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>
                      {a.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={styles.hint}>Tambahkan rekening BANK atau e-wallet aktif sebelum mencatat pembayaran atau alokasi.</Text>
          )}
          <Text style={styles.hint}>
            {panel === 'pay'
              ? 'Pembayaran langsung mengurangi sisa kewajiban dan tercatat di Riwayat.'
              : 'Ini hanya menyisihkan dana di anggaran bulan ini. Sisa kewajiban baru berkurang saat pembayarannya dicatat.'}
          </Text>
          {err && <Text style={styles.err}>{err}</Text>}
          <PrimaryButton
            label={
              panel === 'pay'
                ? pay.isPending ? 'Menyimpan…' : 'Konfirmasi Pembayaran'
                : allocate.isPending ? 'Menarik…' : 'Tarik ke Anggaran Bulan Ini'
            }
            onPress={panel === 'pay' ? confirmPay : confirmAllocate}
          />
          <Pressable onPress={() => { setPanel('none'); setAmountText(''); setErr(null); }}>
            <Text style={styles.cancel}>Batal</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderStrong, padding: 14, gap: 8,
  },
  panelLabel: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  transferInfoCard: {
    backgroundColor: Colors.canvas,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    padding: 10,
    marginBottom: 4,
  },
  transferInfoTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  transferInfoName: {
    fontSize: FontSize.body,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  transferInfoNumber: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: Radius.sm,
    backgroundColor: Colors.subtle,
  },
  copyBtnCopied: {
    backgroundColor: Colors.paidBg,
  },
  copyText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    color: Colors.brandPrimary,
  },
  copyTextCopied: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    color: Colors.paidText,
  },
  input: {
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary,
    backgroundColor: Colors.canvas, fontVariant: ['tabular-nums'],
  },
  pills: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: {
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.pill,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  pillActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  pillText: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600' },
  pillTextActive: { color: Colors.white },
  hint: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  err: { color: Colors.pendingText, fontSize: FontSize.caption },
  cancel: { color: Colors.textSecondary, fontWeight: '600', textAlign: 'center', paddingVertical: 6 },
});
