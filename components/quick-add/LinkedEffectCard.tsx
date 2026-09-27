import { StyleSheet, Text, View } from 'react-native';
import ArrowDownLeft from 'lucide-react-native/icons/arrow-down-left';
import Landmark from 'lucide-react-native/icons/landmark';
import TrendingUp from 'lucide-react-native/icons/trending-up';

import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';

/**
 * Design's "YANG AKAN DIBUAT" card, in both of its shapes:
 *
 *   - Screen 4  (loan)   "LINKED LIABILITY" — Pemasukan Pendanaan +Rp X and
 *                        Kewajiban Pinjaman Rp X, because one tap writes two
 *                        rows and the family should see both before committing.
 *   - Screen 4B (income) "LINKED EFFECT"    — the operational income, and an
 *                        explicit "Tidak ada (Rp 0)" on the debt line.
 *
 * The zero row is the point of the income variant, not filler: the family is
 * being told this money creates no obligation, which is exactly what
 * distinguishes income from a loan in this app.
 */

type LinkedEffectKind = 'loan' | 'income';

export function LinkedEffectCard({
  kind,
  amount,
  accountName,
}: {
  kind: LinkedEffectKind;
  amount: number;
  accountName?: string | null;
}) {
  const isLoan = kind === 'loan';

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>
        {isLoan ? 'YANG AKAN DIBUAT (LINKED LIABILITY)' : 'YANG AKAN DIBUAT (LINKED EFFECT)'}
      </Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.left}>
            <TrendingUp size={14} color={Colors.financingText} />
            <Text style={styles.rowLabel}>
              {isLoan
                ? 'Pemasukan Pendanaan'
                : `Pemasukan operasional${accountName ? ` (${accountName})` : ''}`}
            </Text>
          </View>
          <Text style={[styles.rowValue, styles.positive]}>+{formatRupiah(amount)}</Text>
        </View>

        <View style={styles.row}>
          <View style={styles.left}>
            {isLoan ? (
              <Landmark size={14} color={Colors.loanText} />
            ) : (
              <ArrowDownLeft size={14} color={Colors.textMuted} />
            )}
            <Text style={styles.rowLabel}>Kewajiban {isLoan ? 'Pinjaman' : 'utang'}</Text>
          </View>
          {isLoan ? (
            <Text style={styles.rowValue}>{formatRupiah(amount)}</Text>
          ) : (
            <Text style={styles.rowValueMuted}>Tidak ada (Rp 0)</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderStrong, padding: 10, gap: 8,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.subtle, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 8,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  rowLabel: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '600' },
  rowValue: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowValueMuted: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '600' },
  positive: { color: Colors.paidText },
});
