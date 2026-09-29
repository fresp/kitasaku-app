import { Pressable, StyleSheet, Text, View } from 'react-native';
import CheckCheck from 'lucide-react-native/icons/check-check';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import Plus from 'lucide-react-native/icons/plus';
import Scale from 'lucide-react-native/icons/scale';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import {
  counterpartyLabel,
  installmentProgressLabel,
  loanBreakdownText,
  loanState,
  longDateLabel,
  normalizeObligationType,
  obligationBadge,
  obligationTypeLabel,
  overdueNote,
  paidAmount,
  paidCue,
  planInfo,
  principalInterestText,
  progressPct,
  type LoanState,
} from '../../lib/obligation';
import { Badge } from './Badge';
import type { ObligationInstallment } from '../../lib/queries';
import type { Beneficiary } from '../../lib/beneficiary';
import { formatBankBadge } from '../../lib/beneficiary';

/**
 * The Tanggungan card (design "Screen 3"), one component covering all four of
 * the design's variants: Belum dibayar, Berjalan • N%, Jatuh Tempo!, and Lunas
 * • 100%.
 *
 * All four are the same card with different state, which is exactly why they
 * are one component: four copies is how the overdue variant ends up missing
 * whatever the running variant learned. Every judgement it renders — which
 * state, which badge, whether the date is late — comes from lib/obligation.ts.
 *
 * The icon carries the state too (scale / alert / check-check), so the card is
 * readable without relying on the badge colour alone.
 */

export interface ObligationCardData {
  id: string;
  title: string;
  type: string;
  recipient: string | null;
  total_amount: number;
  remaining_amount: number;
  status: string;
  due_date?: string | null;
  interest_fee_amount?: number | null;
  installment_count?: number | null;
  planned_installment_amount?: number | null;
  /** Migration 008. Null means nobody chose a plan shape — see `planInfo`. */
  repayment_mode?: string | null;
  beneficiary_id?: string | null;
  beneficiary?: Beneficiary | null;
}

const STATE_ICON: Record<LoanState, typeof Scale> = {
  OPEN: Scale,
  RUNNING: Scale,
  OVERDUE: CircleAlert,
  SETTLED: CheckCheck,
  CANCELLED: Scale,
};

const STATE_ICON_COLOR: Record<LoanState, string> = {
  OPEN: Colors.textSecondary,
  RUNNING: Colors.loanText,
  OVERDUE: Colors.pendingBorder,
  SETTLED: Colors.paidText,
  CANCELLED: Colors.textMuted,
};

export function ObligationCard({
  obligation,
  todayISO,
  installments,
  history,
  onPressDetail,
  onPressPay,
  onPressAllocate,
}: {
  obligation: ObligationCardData;
  todayISO: string;
  installments: ObligationInstallment[];
  /** Payments already recorded against this obligation, newest first. */
  history: { date: string; amount: number; account: string }[];
  onPressDetail: () => void;
  onPressPay: (amount: number) => void;
  onPressAllocate: () => void;
}) {
  const state = loanState(obligation, todayISO);
  const pct = progressPct(obligation.total_amount, obligation.remaining_amount);
  const badge = obligationBadge(state, pct);
  const Icon = STATE_ICON[state];
  const cancelled = state === 'CANCELLED';
  const settled = state === 'SETTLED';
  const schedule = installmentProgressLabel(installments);
  const isLoan = normalizeObligationType(obligation.type) === 'LOAN';
  const plan = planInfo(obligation);
  const counterparty = obligation.beneficiary
    ? `Tujuan: ${obligation.beneficiary.name} (${formatBankBadge(obligation.beneficiary.bank_name)})`
    : counterpartyLabel(obligation.type, obligation.recipient);
  const dueLabel = longDateLabel(obligation.due_date);

  // A settled card shows how it finished; a live card shows what is still owed.
  const line2 = cancelled
    ? 'Dibatalkan — tidak ada pembayaran yang dicatat'
    : settled
      ? schedule
        ? `Lunas${dueLabel ? ` pada ${dueLabel}` : ''} • ${schedule}`
        : `Lunas${dueLabel ? ` pada ${dueLabel}` : ''}`
      : state === 'OVERDUE'
        ? overdueNote(obligation.due_date, todayISO)
        : counterparty;

  const line3 = cancelled
    ? `Total ${formatRupiah(obligation.total_amount)} • Rencana ditutup`
    : settled
      ? `Total ${formatRupiah(obligation.total_amount)} • Sisa kewajiban ${formatRupiah(Math.max(0, obligation.remaining_amount))}`
      : state === 'OVERDUE'
      ? overdueBreakdown(obligation, installments)
      : normalizeObligationType(obligation.type) === 'LOAN'
        ? loanBreakdownText(obligation)
        : principalInterestText(obligation);

  // The one live payment we can name a number for: an overdue card offers
  // "Bayar Sekarang • Rp X" rather than a bare button.
  const nextOpen = installments.find((i) => i.status !== 'SETTLED' && i.status !== 'CANCELLED');
  const payAmount = state === 'OVERDUE'
    ? (nextOpen?.planned_amount ?? obligation.planned_installment_amount ?? obligation.remaining_amount)
    : obligation.remaining_amount;

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.leftTags}>
          <View style={[styles.iconBox, { backgroundColor: iconBg(state) }]}>
            <Icon size={14} color={STATE_ICON_COLOR[state]} />
          </View>
          <Badge label={obligationTypeLabel(obligation.type)} />
          {obligation.beneficiary && (
            <Badge label={formatBankBadge(obligation.beneficiary.bank_name)} tone="dark" />
          )}
        </View>
        <Badge label={badge.label} tone={badge.tone} />
      </View>

      <View style={{ gap: 2 }}>
        <Text style={styles.title} numberOfLines={2}>{obligation.title}</Text>
        {!!line2 && <Text style={styles.sub} numberOfLines={2}>{line2}</Text>}
      </View>

      {!settled && !cancelled && (
        <View style={styles.amountRow}>
          <View>
            <Text style={styles.amountLabel}>{state === 'OVERDUE' ? 'Tagihan' : 'Sisa'}</Text>
            <Text style={styles.amountValue}>{formatRupiah(obligation.remaining_amount)}</Text>
          </View>
          <Text style={styles.paidHint}>
            Sudah dibayar {formatRupiah(paidAmount(obligation.total_amount, obligation.remaining_amount))}
          </Text>
        </View>
      )}

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.max(pct, settled || cancelled ? 100 : 2)}%` as any,
              backgroundColor: cancelled
                ? Colors.textMuted
                : settled
                  ? Colors.paidText
                  : state === 'OVERDUE'
                  ? Colors.pendingBorder
                  : Colors.loanBorder,
            },
          ]}
        />
      </View>

      {/* Design puts this row on the loan card between the track and the
          breakdown, and only on loans — the other variants have no plan. The
          due line is its own colour there because the deadline is the one thing
          on the row a person scans for. */}
      {isLoan && (
        <View style={styles.planRow}>
          <Text style={styles.planText} numberOfLines={1}>{plan.plan}</Text>
          {!!plan.due && <Text style={styles.planDue} numberOfLines={1}>{plan.due}</Text>}
          <Text style={styles.planInterest} numberOfLines={1}>{plan.interest}</Text>
        </View>
      )}

      <Text style={styles.breakdown}>{line3}</Text>

      {!settled && (
        <View style={styles.history}>
          <Text style={styles.historyText} numberOfLines={2}>
            {paidCue(history, pct)}
          </Text>
        </View>
      )}

      {!settled && (
        <View style={styles.actions}>
          <Pressable onPress={onPressDetail} style={styles.btn}>
            <Text style={styles.btnText}>Lihat Detail</Text>
          </Pressable>
          <Pressable
            onPress={() => onPressPay(payAmount)}
            style={[styles.btn, state === 'OVERDUE' && styles.btnDanger]}
          >
            <Text style={[styles.btnText, state === 'OVERDUE' && styles.btnTextDanger]}>
              {state === 'OVERDUE'
                ? `Bayar Sekarang • ${formatRupiah(payAmount)}`
                : 'Bayar Pinjaman'}
            </Text>
          </Pressable>
        </View>
      )}

      {settled ? (
        <Pressable onPress={onPressDetail} style={styles.btn}>
          <Text style={styles.btnText}>Lihat Detail</Text>
        </Pressable>
      ) : (
        <Pressable onPress={onPressAllocate} style={styles.allocRow}>
          <Plus size={13} color={Colors.textPrimary} />
          <Text style={styles.allocText}>Alokasikan ke bulan ini</Text>
        </Pressable>
      )}
    </View>
  );
}

function iconBg(state: LoanState): string {
  switch (state) {
    case 'OVERDUE': return Colors.pendingBg;
    case 'SETTLED': return Colors.paidBg;
    case 'RUNNING': return Colors.loanBg;
    default: return Colors.subtle;
  }
}

/**
 * The overdue card's breakdown. The design says "Tagihan cicilan ke-1: Rp
 * 2.000.000 • Sisa pokok Rp 10.000.000" — naming the specific installment is
 * the point, because that is the number the family has to find today.
 */
function overdueBreakdown(o: ObligationCardData, installments: ObligationInstallment[]): string {
  const next = installments.find((i) => i.status !== 'SETTLED' && i.status !== 'CANCELLED');
  if (next) {
    return `Tagihan cicilan: ${formatRupiah(next.planned_amount)} • Sisa kewajiban ${formatRupiah(o.remaining_amount)}`;
  }
  return `Sisa kewajiban ${formatRupiah(o.remaining_amount)} • ${obligationTypeLabel(o.type)} belum dibayar`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 16, gap: 10,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  leftTags: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  iconBox: { width: 26, height: 26, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  title: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700' },
  sub: { color: Colors.textSecondary, fontSize: FontSize.body },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8 },
  amountLabel: { color: Colors.textMuted, fontSize: FontSize.caption },
  amountValue: {
    color: Colors.textPrimary, fontSize: 20, fontWeight: '700',
    fontVariant: ['tabular-nums'], marginTop: 1,
  },
  paidHint: { color: Colors.textMuted, fontSize: FontSize.caption, fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, backgroundColor: Colors.subtle, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  planRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  planText: { color: Colors.textSecondary, fontSize: FontSize.caption, flexShrink: 1 },
  planDue: { color: Colors.financingText, fontSize: FontSize.caption, fontWeight: '600', flexShrink: 1 },
  planInterest: { color: Colors.textSecondary, fontSize: FontSize.caption, flexShrink: 1 },
  breakdown: { color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 16 },
  history: { backgroundColor: Colors.canvas, borderRadius: Radius.sm, padding: 9 },
  historyText: { color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingVertical: 10, alignItems: 'center', backgroundColor: Colors.surface,
  },
  btnDanger: { backgroundColor: Colors.pendingBorder, borderColor: Colors.pendingBorder },
  btnText: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600' },
  btnTextDanger: { color: Colors.white },
  allocRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 9, borderRadius: Radius.md, backgroundColor: Colors.subtle,
  },
  allocText: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600' },
});
