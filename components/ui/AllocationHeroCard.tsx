import { StyleSheet, Text, View } from 'react-native';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import type { ZeroBasedSummary, ZeroBasedStatus } from '../../lib/zero-based';
import { Badge } from './Badge';

/**
 * The Home hero: the cycle's zero-based equation, always stated in full
 * (source − allocation = unallocated) rather than as a single number. The
 * whole point of the method is that the three terms have to balance, so hiding
 * two of them behind a "detail" screen would make the headline unfalsifiable.
 *
 * Colour rule on the dark surface: a value is tinted by the role of the money,
 * and every tint here is legible on `brandPrimary`. design.pen tints the
 * savings/asset values with `$brand.primary` on a `$brand.primary` background,
 * which is invisible — the intent there is "neither a cost nor an income, so
 * neutral", which is what `borderStrong` expresses without disappearing.
 */

type Tone = { badge: string; color: string; helper: string; footer: string };

function presentStatus(summary: ZeroBasedSummary): Tone {
  switch (summary.status) {
    case 'FUNDING_GAP':
      return {
        badge: 'Funding gap',
        color: Colors.pendingText,
        helper: `Kebutuhan ${formatRupiah(summary.requiredAllocation)} melebihi sumber dana ${formatRupiah(summary.sourceFunds.total)}`,
        footer: `Funding gap ${formatRupiah(summary.fundingGap)} harus ditutup sebelum siklus dibuka`,
      };
    case 'UNALLOCATED':
      return {
        badge: 'Belum dialokasikan',
        color: Colors.alertText,
        helper: `Masih ada ${formatRupiah(summary.unallocatedFunds)} yang belum punya tujuan`,
        footer: `Belum dialokasikan ${formatRupiah(summary.unallocatedFunds)}`,
      };
    case 'COMPLETE':
    default:
      return {
        badge: 'Alokasi selesai',
        color: Colors.paidText,
        helper: 'Semua dana bulan ini sudah memiliki tujuan',
        footer: 'Alokasi selesai · Unallocated Funds = Rp 0',
      };
  }
}

function Value({
  label,
  value,
  desc,
  color,
  muted,
}: {
  label: string;
  value: number;
  desc: string;
  color: string;
  muted?: boolean;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.blockValue, { color: value > 0 ? color : Colors.textMuted }]} numberOfLines={1}>
        {formatRupiah(value)}
      </Text>
      <Text style={[styles.blockDesc, muted && { color: Colors.textMuted }]} numberOfLines={2}>
        {desc}
      </Text>
    </View>
  );
}

export function AllocationHeroCard({
  summary,
  cycleName,
  onPressDetail,
}: {
  summary: ZeroBasedSummary;
  cycleName: string;
  onPressDetail?: () => void;
}) {
  const tone = presentStatus(summary);
  const a = summary.allocations;
  const savingsAndInvestment = a.savings + a.investment;

  return (
    <View style={styles.hero}>
      <View style={styles.top}>
        <Text style={styles.eyebrow}>ZERO-BASED ALLOCATION · {cycleName.toUpperCase()}</Text>

        <View style={styles.metric}>
          <View style={styles.metricLabelRow}>
            <Text style={styles.metricLabel}>Dana belum dialokasikan</Text>
            <Badge label={tone.badge} tone={statusToTone(summary.status)} />
          </View>
          <Text style={styles.metricValue}>{formatRupiah(summary.unallocatedFunds)}</Text>
          <Text style={styles.metricHelper}>{tone.helper}</Text>
        </View>

        <View style={styles.formulaCard}>
          <View style={styles.formulaRow}>
            <View style={styles.formulaItem}>
              <Text style={styles.formulaLabel}>Total Sumber Dana</Text>
              <Text style={styles.formulaValue}>{formatRupiah(summary.sourceFunds.total)}</Text>
              <Text style={styles.formulaSub}>Income + Pendanaan + Aset</Text>
            </View>
            <Text style={styles.operator}>−</Text>
            <View style={styles.formulaItem}>
              <Text style={styles.formulaLabel}>Total Alokasi</Text>
              <Text style={[styles.formulaValue, { color: Colors.financingText }]}>
                {formatRupiah(a.total)}
              </Text>
              <Text style={styles.formulaSub}>Belanja + Utang + Aset</Text>
            </View>
            <Text style={styles.operator}>=</Text>
            <View style={styles.formulaItem}>
              <Text style={[styles.formulaLabel, { color: tone.color }]}>Unallocated Funds</Text>
              <Text style={[styles.formulaValue, { color: tone.color }]}>
                {formatRupiah(summary.unallocatedFunds)}
              </Text>
              <Text style={[styles.formulaSub, { color: tone.color }]}>
                {summary.status === 'COMPLETE' ? 'Allocation complete' : 'Belum selesai'}
              </Text>
            </View>
          </View>
          <View style={styles.cueRow}>
            <Text style={styles.cueBullet}>ⓘ</Text>
            <Text style={styles.cueText}>
              Prinsip Zero-Based: Total Sumber Dana ({formatRupiah(summary.sourceFunds.total)}) wajib
              dialokasikan penuh ke Belanja, Pelunasan Utang, &amp; Tabungan/Aset hingga tersisa Rp 0.
            </Text>
          </View>
        </View>

        <View style={styles.grid}>
          <Text style={styles.gridLabel}>Sumber dana</Text>
          <View style={styles.gridRow}>
            <Value
              label="Income Operasional"
              value={summary.sourceFunds.operatingIncome}
              desc="Gaji & pendapatan rutin"
              color={Colors.paidBg}
            />
            <Value
              label="Pemasukan Pendanaan"
              value={summary.sourceFunds.financingInflow}
              desc="Financing inflow (bukan income)"
              color={Colors.financingBorder}
            />
          </View>
          <View style={styles.gridRow}>
            <Value
              label="Pelepasan Aset"
              value={summary.sourceFunds.assetRelease}
              desc={summary.sourceFunds.assetRelease > 0 ? 'Aset dijual jadi kas' : 'Tidak ada pelepasan'}
              color={Colors.borderStrong}
              muted
            />
            <View style={styles.block} />
          </View>

          <View style={styles.divider} />

          <Text style={styles.gridLabel}>Alokasi dana</Text>
          <View style={styles.gridRow}>
            <Value
              label="Pengeluaran Riil"
              value={a.expense}
              desc="Belanja konsumtif & operasional"
              color={Colors.pendingBorder}
            />
            <Value
              label="Pembayaran Kewajiban"
              value={a.debtPayment}
              desc="Pelunasan pokok (mengurangi utang)"
              color={Colors.loanBorder}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.gridRow}>
            <Value
              label="Investasi & Tabungan"
              value={savingsAndInvestment}
              desc="Investasi & tabungan rutin"
              color={Colors.borderStrong}
              muted
            />
            <Value
              label="Dana Darurat"
              value={a.emergencyFund}
              desc="Dana darurat keluarga"
              color={Colors.borderStrong}
              muted
            />
          </View>
          <View style={styles.gridRow}>
            <Value
              label="Aset"
              value={a.asset}
              desc={a.asset > 0 ? 'Pembelian aset' : 'Tidak ada pembelian aset'}
              color={Colors.borderStrong}
              muted
            />
            <Value
              label="Aset lainnya"
              value={a.other}
              desc={a.other > 0 ? 'Pos lain' : 'Tidak ada alokasi lain siklus ini'}
              color={Colors.borderStrong}
              muted
            />
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.footLeft}>
          <View style={[styles.dot, { backgroundColor: tone.color }]} />
          <Text style={styles.footText} numberOfLines={1}>
            {tone.footer}
          </Text>
        </View>
        {onPressDetail && (
          <Text style={styles.footLink} onPress={onPressDetail}>
            Detail Alokasi ›
          </Text>
        )}
      </View>
    </View>
  );
}

function statusToTone(status: ZeroBasedStatus): 'paid' | 'alert' | 'pending' {
  if (status === 'FUNDING_GAP') return 'pending';
  if (status === 'UNALLOCATED') return 'alert';
  return 'paid';
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: Colors.brandPrimary,
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },
  top: { padding: 16, gap: 12 },
  eyebrow: {
    color: Colors.textMuted,
    fontSize: FontSize.microLabel,
    fontWeight: '700',
    letterSpacing: 1,
  },
  metric: { gap: 6 },
  metricLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  metricLabel: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', flex: 1 },
  metricValue: {
    color: Colors.white,
    fontSize: FontSize.heroNumeral,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricHelper: { color: Colors.textMuted, fontSize: FontSize.caption },
  formulaCard: {
    backgroundColor: Colors.overlayTint,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  formulaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  formulaItem: { flex: 1, gap: 2 },
  formulaLabel: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '500' },
  formulaValue: {
    color: Colors.white,
    fontSize: FontSize.body,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  formulaSub: { color: Colors.textSecondary, fontSize: 9.5 },
  operator: { color: Colors.textMuted, fontSize: 16, fontWeight: '700' },
  cueRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  cueBullet: { color: Colors.financingBorder, fontSize: FontSize.caption },
  cueText: { flex: 1, color: Colors.textMuted, fontSize: FontSize.microLabel, lineHeight: 14 },
  grid: { gap: 10 },
  gridLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.microLabel,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  gridRow: { flexDirection: 'row', gap: 10 },
  block: { flex: 1, gap: 2 },
  blockTitle: { color: Colors.textMuted, fontSize: 9.5, fontWeight: '600' },
  blockValue: {
    fontSize: FontSize.microValue,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  blockDesc: { color: Colors.textMuted, fontSize: 9.5 },
  divider: { height: 1, backgroundColor: Colors.heroFooter },
  footer: {
    backgroundColor: Colors.heroFooter,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  footLeft: { flexDirection: 'row', gap: 6, alignItems: 'center', flex: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  footText: { color: Colors.borderStrong, fontSize: FontSize.caption, fontWeight: '600', flex: 1 },
  footLink: { color: Colors.white, fontSize: FontSize.body, fontWeight: '600' },
});
