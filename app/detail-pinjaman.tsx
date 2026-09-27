import { useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import ReceiptText from 'lucide-react-native/icons/receipt-text';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useActiveCycle,
  useAccounts,
  useAllocateDebtPayment,
  useObligationInstallments,
  useObligationPayments,
  useObligations,
  useSetRepaymentMode,
  useTransactionById,
} from '../lib/queries';
import {
  installmentProgressLabel,
  loanState,
  longDateFullLabel,
  nextOpenInstallment,
  normalizeObligationType,
  obligationBadge,
  obligationTypeLabel,
  paidAmount,
  progressPct,
  repaymentModeOf,
  REPAYMENT_MODES,
  type RepaymentMode,
} from '../lib/obligation';
import { Badge } from '../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

/**
 * Screen - Detail Pinjaman.
 *
 * The single-obligation view: what is left, what the plan is, what has been
 * paid, and the two things a person comes here to do — pay it, or change the
 * plan.
 *
 * Everything the header and hero say comes from lib/obligation.ts, the same
 * functions the Tanggungan card uses. That is the point of the module: the card
 * says "Berjalan • 20%" and this screen must not say something else about the
 * same row.
 *
 * The Mode Pembayaran card is the only write on this screen besides payment.
 * It stores the plan shape via `set_obligation_repayment_mode`; when nothing is
 * stored, the card shows the derived display default AND says it is a guess
 * (`derived`), because a plan nobody chose should not look chosen.
 */
export default function DetailPinjamanScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const cycleId = cycleQ.data?.id;
  const obligQ = useObligations(householdId);
  const instQ = useObligationInstallments(householdId, id);
  const payQ = useObligationPayments(householdId, id);
  const accsQ = useAccounts(householdId);
  const setMode = useSetRepaymentMode();
  const pay = useAllocateDebtPayment();

  const [err, setErr] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  // "Ubah Rencana Pembayaran" scrolls to the mode card rather than picking a
  // mode for the person. The y offset is measured on layout, not hardcoded,
  // because the summary card above it grows with interest/installment rows.
  const scrollRef = useRef<ScrollView>(null);
  const [modeY, setModeY] = useState(0);

  const obligation = useMemo(
    () => (obligQ.data ?? []).find((o) => o.id === id) ?? null,
    [obligQ.data, id]
  );
  const installments = useMemo(() => instQ.data ?? [], [instQ.data]);
  const payments = useMemo(() => payQ.data ?? [], [payQ.data]);

  // The loan's own receipt transaction, so the hero can name the account the
  // money landed in. Fetched by id because the receipt may sit in a cycle that
  // is no longer the active one.
  const sourceQ = useTransactionById(householdId, obligation?.source_transaction_id ?? undefined);

  const todayISO = new Date().toISOString().slice(0, 10);

  if (!obligation) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>
            {obligQ.isLoading ? 'Memuat…' : 'Kewajiban tidak ditemukan'}
          </Text>
          {!obligQ.isLoading && (
            <Text style={styles.missingBody}>
              Baris ini mungkin sudah lunas dan tidak lagi ada di daftar tanggungan aktif.
            </Text>
          )}
          <SecondaryButton label="Kembali" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const type = normalizeObligationType(obligation.type);
  const state = loanState(obligation, todayISO);
  const pct = progressPct(obligation.total_amount, obligation.remaining_amount);
  const badge = obligationBadge(state, pct);
  const paid = paidAmount(obligation.total_amount, obligation.remaining_amount);
  const settled = state === 'SETTLED' || state === 'CANCELLED';

  const schedule = repaymentModeOf(obligation);
  const nextInst = nextOpenInstallment(installments);
  const nextDueISO = nextInst?.due_date ?? obligation.due_date ?? null;
  const instalmentPlan = obligation.planned_installment_amount;

  // "Diterima 25 September 2026 • Dana masuk ke Mandiri" — the receipt side of
  // the loan, so the screen makes clear this money moved *in* at some point.
  const receivedISO = obligation.start_date ?? null;
  const receivedLabel = longDateFullLabel(receivedISO) ?? longDateFullLabel(obligation.created_at?.slice(0, 10));
  const receivedAccount = sourceQ.data?.accounts?.name ?? null;
  const heroSub = receivedLabel
    ? `Diterima ${receivedLabel}${receivedAccount ? ` • Dana masuk ke ${receivedAccount}` : ''}`
    : null;

  const nextOpenAmount =
    nextInst?.planned_amount ?? obligation.planned_installment_amount ?? obligation.remaining_amount;

  // Narrowed copy for use inside the handlers below: TypeScript cannot carry
  // the `if (!obligation) return` narrowing into a closure that runs later.
  const ob = obligation;

  async function chooseMode(mode: RepaymentMode) {
    setErr(null);
    if (!householdId) { setErr('Login dulu untuk mengubah rencana.'); return; }
    if (schedule.mode === mode && !schedule.derived) return;
    try {
      await setMode.mutateAsync({ householdId, obligationId: ob.id, mode });
    } catch (e: any) { setErr(e?.message ?? 'Gagal menyimpan rencana.'); }
  }

  async function payNow() {
    setErr(null);
    if (!householdId || !cycleId) { setErr('Buka siklus aktif dulu sebelum membayar.'); return; }
    const amount = Math.min(nextOpenAmount, ob.remaining_amount);
    if (!(amount > 0)) { setErr('Tidak ada sisa yang perlu dibayar.'); return; }
    try {
      await pay.mutateAsync({
        householdId, cycleId, obligationId: ob.id,
        amount,
        accountId: accsQ.data?.[0]?.id ?? null,
      });
      setPayOpen(false);
    } catch (e: any) { setErr(e?.message ?? 'Gagal mencatat pembayaran.'); }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={instQ.isFetching || payQ.isFetching}
            onRefresh={() => { void instQ.refetch(); void payQ.refetch(); void obligQ.refetch(); }}
          />
        }
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>{obligation.title}</Text>
              <Badge label={obligationTypeLabel(obligation.type)} />
            </View>
            <Text style={styles.sub}>
              {type === 'LOAN' ? 'Pemberi pinjaman' : 'Kepada'}: {obligation.recipient ?? 'Tidak dicatat'}
            </Text>
          </View>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.heroLabel}>
              {type === 'LOAN' ? 'SISA PINJAMAN' : 'SISA KEWAJIBAN'}
            </Text>
            <Text style={styles.heroPct}>{pct}% dibayar</Text>
          </View>
          <Text style={styles.heroAmount}>{formatRupiah(obligation.remaining_amount)}</Text>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.max(pct, settled ? 100 : 2)}%` as any,
                  backgroundColor: settled
                    ? Colors.paidText
                    : state === 'OVERDUE'
                      ? Colors.pendingBorder
                      : Colors.heroFooter,
                },
              ]}
            />
          </View>
          {!!heroSub && <Text style={styles.heroSub}>{heroSub}</Text>}
          <Badge label={badge.label} tone={badge.tone} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>RINGKASAN KEWAJIBAN</Text>
          <SummaryRow
            label="Total pokok"
            value={formatRupiah(Math.max(0, obligation.total_amount - (obligation.interest_fee_amount ?? 0)))}
          />
          {(obligation.interest_fee_amount ?? 0) > 0 && (
            <SummaryRow label="Bunga & biaya" value={formatRupiah(obligation.interest_fee_amount ?? 0)} />
          )}
          <SummaryRow label="Sudah dibayar" value={formatRupiah(paid)} />
          <SummaryRow label="Sisa pokok" value={formatRupiah(obligation.remaining_amount)} strong />
          <View style={styles.divider} />
          <SummaryRow
            label="Jadwal berikutnya"
            value={nextDueISO ? longDateFullLabel(nextDueISO) ?? '—' : 'Belum dijadwalkan'}
          />
          <SummaryRow
            label="Rencana cicilan"
            value={
              instalmentPlan && instalmentPlan > 0
                ? `${formatRupiah(instalmentPlan)} / siklus${obligation.installment_count ? ` (${obligation.installment_count}x)` : ''}`
                : 'Nominal manual'
            }
          />
          {!!installmentProgressLabel(installments) && (
            <SummaryRow label="Progres cicilan" value={installmentProgressLabel(installments)!} />
          )}
        </View>

        <View style={styles.card} onLayout={(e) => setModeY(e.nativeEvent.layout.y)}>
          <Text style={styles.sectionLabel}>Mode Pembayaran</Text>
          <View style={styles.modeRow}>
            {REPAYMENT_MODES.map((m) => {
              const active = schedule.mode === m.value;
              return (
                <Pressable
                  key={m.value}
                  onPress={() => chooseMode(m.value)}
                  style={[styles.modeOpt, active && styles.modeOptActive]}
                >
                  <Text style={[styles.modeText, active && styles.modeTextActive]} numberOfLines={1}>
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.modeHint}>
            {REPAYMENT_MODES.find((m) => m.value === schedule.mode)?.hint}
          </Text>
          {schedule.derived && (
            <Text style={styles.modeNote}>
              Belum pernah dipilih — ini perkiraan dari data yang ada. Ketuk salah satu untuk
              menetapkannya.
            </Text>
          )}
          {setMode.isPending && <Text style={styles.modeNote}>Menyimpan…</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Riwayat Pembayaran</Text>
          {payments.length === 0 ? (
            <View style={styles.empty}>
              <ReceiptText size={20} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>Belum ada pembayaran untuk pinjaman ini</Text>
              <Text style={styles.emptyBody}>
                Setiap cicilan atau pelunasan akan tercatat di sini dan otomatis mengurangi sisa
                pokok.
              </Text>
            </View>
          ) : (
            payments.map((p) => (
              <View key={p.id} style={styles.histRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.histName} numberOfLines={1}>
                    {p.accounts?.name ?? 'Tanpa akun'}
                  </Text>
                  <Text style={styles.histDate}>
                    {longDateFullLabel(p.release_date ?? p.created_at.slice(0, 10)) ?? 'Tanggal tidak dicatat'}
                    {p.is_final_payment ? ' • Pelunasan terakhir' : ''}
                  </Text>
                </View>
                <Text style={styles.histAmt}>{formatRupiah(p.actual_amount)}</Text>
              </View>
            ))
          )}
        </View>

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}

        {!settled && (
          <>
            {payOpen ? (
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>CATAT PEMBAYARAN</Text>
                <Text style={styles.payAmount}>
                  {formatRupiah(Math.min(nextOpenAmount, obligation.remaining_amount))}
                </Text>
                <Text style={styles.modeHint}>
                  {nextInst
                    ? `Cicilan berikutnya jatuh tempo ${longDateFullLabel(nextInst.due_date) ?? 'tanpa tanggal'}.`
                    : 'Nominal diambil dari sisa kewajiban.'}
                </Text>
                <PrimaryButton
                  label={pay.isPending ? 'Menyimpan…' : 'Konfirmasi Pembayaran'}
                  onPress={payNow}
                />
                <Pressable onPress={() => setPayOpen(false)}>
                  <Text style={styles.cancel}>Batal</Text>
                </Pressable>
              </View>
            ) : (
              <PrimaryButton label="Bayar Pinjaman" onPress={() => setPayOpen(true)} />
            )}
          </>
        )}
        <SecondaryButton
          label="Ubah Rencana Pembayaran"
          onPress={() => {
            setErr(null);
            // Take the person to the chooser rather than cycling the mode for
            // them: silently rewriting the plan on a button press would change
            // a decision nobody made. Scrolling is the honest version of
            // "go here and pick one".
            scrollRef.current?.scrollTo({ y: Math.max(0, modeY - 16), animated: true });
          }}
        />
        <Text style={styles.footNote}>
          Mengubah mode hanya mengubah rencana, bukan jumlah yang sudah dibayar.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.sumRow}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={[styles.sumValue, strong && styles.sumValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: {
    width: 34, height: 34, borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '700', flexShrink: 1 },
  sub: { color: Colors.textSecondary, fontSize: FontSize.body },

  hero: {
    backgroundColor: Colors.brandPrimary, borderRadius: Radius.lg, padding: 16, gap: 10,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroLabel: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 1 },
  heroPct: { color: Colors.borderStrong, fontSize: FontSize.caption, fontWeight: '600' },
  heroAmount: {
    color: Colors.white, fontSize: FontSize.heroNumeral, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  heroSub: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  track: { height: 6, borderRadius: 3, backgroundColor: Colors.heroFooter, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14, gap: 8,
  },
  sectionLabel: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  sumLabel: { color: Colors.textSecondary, fontSize: FontSize.body },
  sumValue: {
    color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600',
    fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right',
  },
  sumValueStrong: { fontSize: 15, fontWeight: '700' },
  divider: { height: 1, backgroundColor: Colors.borderSubtle, marginVertical: 4 },

  modeRow: { flexDirection: 'row', gap: 8 },
  modeOpt: {
    flex: 1, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingVertical: 10, alignItems: 'center', backgroundColor: Colors.surface,
  },
  modeOptActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  modeText: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '600' },
  modeTextActive: { color: Colors.white },
  modeHint: { color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 16 },
  modeNote: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },

  empty: { alignItems: 'center', gap: 6, paddingVertical: 16 },
  emptyTitle: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600', textAlign: 'center' },
  emptyBody: { color: Colors.textMuted, fontSize: FontSize.caption, textAlign: 'center', lineHeight: 16 },

  histRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle, paddingTop: 8,
  },
  histName: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600' },
  histDate: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 1 },
  histAmt: {
    color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },

  payAmount: {
    color: Colors.textPrimary, fontSize: FontSize.heroNumeral, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cancel: { color: Colors.textSecondary, fontWeight: '600', textAlign: 'center', paddingVertical: 6 },
  footNote: { color: Colors.textMuted, fontSize: FontSize.caption, textAlign: 'center' },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },

  missing: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  missingTitle: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '700' },
  missingBody: { color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 18 },
});
