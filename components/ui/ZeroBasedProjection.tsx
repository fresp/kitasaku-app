import type { ReactNode } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import type { CycleReadiness } from '../../lib/zero-based';

/**
 * The zero-based projection card, shared by Buka Siklus (`new-cycle.tsx`) and
 * Funding Gap (`funding-gap.tsx`).
 *
 * These two screens are the same arithmetic seen from two sides, and they used
 * to be two hand-written row lists. Buka Siklus was missing the
 * `+ Financing Inflow / Asset Release` and `− Alokasi Tabungan & Aset Likuid`
 * rows entirely, so its gate was computed over a smaller set of commitments
 * than Funding Gap's — a family with savings allocations could see "siap
 * dibuka" on one screen and a funding gap on the other.
 *
 * The verdict is not recomputed here. `readiness` comes from `cycleReadiness()`
 * in lib/zero-based.ts, so the number in the last row and the flag that enables
 * the button are the same object.
 */
export interface ZeroBasedProjectionSource {
  /**
   * The operating-income block, one row per line the screen wants to show.
   * Funding Gap passes a single "Total Sumber Dana (Income Operasional)";
   * Buka Siklus passes the payday figure and the cloned routine income
   * positions as two rows. Their sum is operating income either way.
   */
  incomeLines: { label: string; value: number }[];
  /** Loans received. Money in, but not income. */
  financingInflow: number;
  /** Released assets. Also money in, also not income. */
  assetRelease: number;
}

export interface ZeroBasedProjectionAllocations {
  expense: number;
  expenseCount: number;
  debtPayment: number;
  debtCount: number;
  /** ASSET + SAVINGS + INVESTMENT + EMERGENCY_FUND, summed. */
  savingsAssets: number;
  savingsCount: number;
  /**
   * `OTHER` allocations. Every `AllocationType` except these three buckets is
   * one of them, so leaving this row out would make the displayed rows sum to
   * less than `requiredAllocation` — the family would be looking at a list that
   * does not add up to the verdict underneath it.
   */
  other: number;
  otherCount: number;
}

export function ZeroBasedProjection({
  title,
  source,
  allocations,
  readiness,
  strategies,
  note,
  style,
}: {
  title: string;
  source: ZeroBasedProjectionSource;
  allocations: ZeroBasedProjectionAllocations;
  readiness: CycleReadiness;
  /** Escape routes, rendered under the divider when the cycle cannot open. */
  strategies?: ReactNode;
  /** Copy under the verdict line. */
  note?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.projection, style]}>
      <Text style={styles.projLabel}>{title}</Text>

      {source.incomeLines.map((l) => (
        <ProjRow key={l.label} label={l.label} value={l.value} />
      ))}
      {/* Always rendered, even at Rp 0: the row is what tells the family that
          borrowed money is a different kind of money. Hiding it when empty is
          how it went missing from Buka Siklus in the first place. */}
      <ProjRow
        label="+ Financing Inflow / Asset Release"
        value={source.financingInflow + source.assetRelease}
      />
      <ProjRow
        label={`− Pengeluaran rutin (${allocations.expenseCount} pos)`}
        value={-allocations.expense}
      />
      <ProjRow
        label={`− Pembayaran kewajiban (${allocations.debtCount})`}
        value={-allocations.debtPayment}
      />
      <ProjRow
        label={`− Alokasi Tabungan & Aset Likuid (${allocations.savingsCount})`}
        value={-allocations.savingsAssets}
      />
      {allocations.other > 0 && (
        <ProjRow
          label={`− Alokasi lainnya (${allocations.otherCount})`}
          value={-allocations.other}
        />
      )}

      <View style={styles.divider} />

      {readiness.canOpen ? (
        <>
          <ProjRow
            label="= Dana belum dialokasikan"
            value={readiness.unallocatedFunds}
            tone={readiness.unallocatedFunds > 0 ? 'warn' : 'ok'}
          />
          <View style={styles.bannerOk}>
            <Text style={styles.bannerOkText}>
              {readiness.unallocatedFunds > 0
                ? `Alokasi lengkap · ${formatRupiah(readiness.unallocatedFunds)} belum punya tujuan`
                : 'Alokasi lengkap · Unallocated Funds Rp 0'}
            </Text>
          </View>
        </>
      ) : (
        <>
          <ProjRow
            label="= Funding Gap (Kebutuhan Pendanaan)"
            value={readiness.fundingGap}
            tone="gap"
          />
          <View style={styles.bannerGap}>
            <TriangleAlert size={14} color={Colors.pendingText} />
            <Text style={styles.bannerGapText}>
              Funding gap · {formatRupiah(readiness.fundingGap)} more is needed for this cycle
            </Text>
          </View>
        </>
      )}

      {!!note && <Text style={styles.projNote}>{note}</Text>}
      {!!strategies && <View style={styles.strategies}>{strategies}</View>}
    </View>
  );
}

function ProjRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'gap' | 'warn' | 'ok';
}) {
  // `ok` uses paidBg, not paidText: this card sits on brandPrimary (navy), and
  // the mid-green of paidText loses most of its contrast there.
  const color =
    tone === 'gap'
      ? Colors.pendingBorder
      : tone === 'warn'
        ? Colors.financingBorder
        : tone === 'ok'
          ? Colors.paidBg
          : Colors.white;
  return (
    <View style={styles.projRow}>
      <Text style={styles.projRowLabel}>{label}</Text>
      <Text style={[styles.projRowValue, { color }]}>{signedRupiah(value)}</Text>
    </View>
  );
}

/** `−Rp 1.500.000` for negatives. The sign is part of the label column's job in
 * the design, and a bare `-` next to a formatted amount reads as a typo. */
function signedRupiah(value: number): string {
  return value < 0 ? `−${formatRupiah(Math.abs(value))}` : formatRupiah(value);
}

const styles = StyleSheet.create({
  projection: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.lg, padding: 14, gap: 5 },
  projLabel: {
    color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700',
    letterSpacing: 1, marginBottom: 4,
  },
  projRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    gap: 8, paddingVertical: 2,
  },
  projRowLabel: { color: Colors.borderStrong, fontSize: FontSize.caption, flex: 1 },
  projRowValue: { fontSize: FontSize.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: Colors.heroFooter, marginVertical: 5 },
  projNote: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16, marginTop: 2 },
  strategies: {
    marginTop: 8, paddingTop: 10, gap: 6,
    borderTopWidth: 1, borderTopColor: Colors.heroFooter,
  },

  bannerGap: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: Colors.pendingBg, borderRadius: Radius.sm, padding: 10, marginTop: 4,
  },
  bannerGapText: { color: Colors.pendingText, fontSize: FontSize.caption, fontWeight: '600', flex: 1 },
  bannerOk: {
    backgroundColor: Colors.paidBg, borderRadius: Radius.sm, padding: 10, marginTop: 4,
  },
  bannerOkText: { color: Colors.paidText, fontSize: FontSize.caption, fontWeight: '600' },
});
