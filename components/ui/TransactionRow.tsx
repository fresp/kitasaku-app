import { StyleSheet, Text, View } from 'react-native';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import { canMarkAsPaid } from '../../lib/zero-based';
import type { FlowType } from '../../lib/zero-based';
import { Badge } from './Badge';
import { PayButton } from './Button';
import { DeltaBadge } from './DeltaBadge';

export interface RowItem {
  id: string;
  name: string;
  category: string;
  account: string;
  amount: number;
  dueLabel: string;
  status: 'PENDING' | 'PAID';
  deltaKind: 'up' | 'down' | 'same' | 'neutral';
  deltaText: string;
  obligationId?: string | null;
  flowType?: FlowType | null;
}

export function TransactionRow({
  item,
  onPay,
}: {
  item: RowItem;
  onPay?: (item: RowItem) => void;
}) {
  const isPaid = item.status === 'PAID';
  // Single gate: rows that `useMarkAsPaid` would reject must not offer the
  // action here either. Without this, a PAID debt-payment row reached through
  // the "Semua" tab would still show a pay button that only fails on tap.
  const payable = canMarkAsPaid({
    status: item.status,
    obligation_id: item.obligationId ?? null,
    flow_type: item.flowType ?? null,
  });
  return (
    <View style={styles.card}>
      <View style={[styles.stripe, { backgroundColor: isPaid ? Colors.paidText : Colors.pendingBorder }]} />
      <View style={styles.content}>
        <View style={styles.top}>
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.due} numberOfLines={1}>
              {item.dueLabel}
            </Text>
          </View>
          <Text style={styles.amount}>{formatRupiah(item.amount)}</Text>
        </View>
        <View style={styles.bottom}>
          <Badge label={item.category} />
          <Badge label={item.account} />
        </View>
        <View style={styles.actionRow}>
          <DeltaBadge kind={item.deltaKind} text={item.deltaText} />
          <View style={{ flex: 1 }} />
          {payable && <PayButton onPress={() => onPay?.(item)} />}
          {isPaid && <Badge label="✓ Lunas" tone="paid" />}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  stripe: { width: 3 },
  content: { flex: 1, padding: 12, gap: 8 },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  titleBlock: { flex: 1 },
  title: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '500' },
  due: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 2 },
  amount: {
    color: Colors.textPrimary,
    fontSize: FontSize.currencyLarge,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  bottom: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
});
