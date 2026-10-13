import { Pressable, StyleSheet, Text, View } from 'react-native';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiahShort } from '../../lib/format';
import { formatShortDate } from '../../lib/zero-based';
import { Badge } from '../ui/Badge';
import {
  specialBudgetStatus,
  specialBudgetStatusLabel,
  type SpecialBudget,
  type SpecialBudgetFigures,
} from '../../lib/special-budget';

/**
 * One Anggaran Khusus as a row: name, state, how much of the money that came
 * in is already spent, and what is left. Shared by Home and the list screen so
 * the two can never describe the same budget differently.
 */
export function SpecialBudgetRow({
  budget,
  figures,
  todayISO,
  onPress,
  isLast = false,
}: {
  budget: SpecialBudget;
  figures: SpecialBudgetFigures | undefined;
  todayISO: string;
  onPress: () => void;
  isLast?: boolean;
}) {
  const status = specialBudgetStatus(budget, todayISO);
  const remaining = status === 'CLOSED' ? 0 : figures?.remaining ?? 0;
  const deficit = remaining < 0;
  const statusBadge = deficit && status !== 'CLOSED'
    ? { label: 'Minus', tone: 'pending' as const }
    : specialBudgetStatusLabel(status);
  const fundsIn = figures?.fundsIn ?? 0;
  const spent = figures?.spent ?? 0;
  const pct = fundsIn > 0 ? Math.min(100, Math.round((spent / fundsIn) * 100)) : spent > 0 ? 100 : 0;
  const range = `${formatShortDate(budget.start_date) ?? budget.start_date} – ${formatShortDate(budget.end_date) ?? budget.end_date}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Anggaran khusus ${budget.name}`}
      style={[styles.row, !isLast && styles.divided]}
    >
      <View style={styles.head}>
        <View style={styles.titleBox}>
          <Text style={styles.name} numberOfLines={1}>{budget.name}</Text>
          <Text style={styles.range}>{range}</Text>
        </View>
        <Badge label={statusBadge.label} tone={statusBadge.tone} />
        <ChevronRight size={16} color={Colors.textMuted} />
      </View>
      {status !== 'CLOSED' && (
        <>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${pct}%` as any, backgroundColor: deficit ? Colors.pendingBorder : Colors.purple },
              ]}
            />
          </View>
          <View style={styles.foot}>
            <Text style={styles.footText}>
              Terpakai <Text style={styles.strong}>{formatRupiahShort(spent)}</Text> dari {formatRupiahShort(fundsIn)}
            </Text>
            <Text style={[styles.footText, deficit && styles.deficit]}>
              {deficit ? `Minus ${formatRupiahShort(-remaining)}` : `Sisa ${formatRupiahShort(remaining)}`}
            </Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 12, gap: 8 },
  divided: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleBox: { flex: 1, minWidth: 0 },
  name: { color: Colors.textPrimary, fontSize: FontSize.cardTitle - 1, fontWeight: '700' },
  range: { color: Colors.textSecondary, fontSize: FontSize.caption, marginTop: 2 },
  track: { height: 6, borderRadius: Radius.pill, backgroundColor: Colors.subtle, overflow: 'hidden' },
  fill: { height: 6, borderRadius: Radius.pill },
  foot: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  footText: { color: Colors.textSecondary, fontSize: FontSize.caption, fontVariant: ['tabular-nums'] },
  strong: { color: Colors.textPrimary, fontWeight: '700' },
  deficit: { color: Colors.pendingText, fontWeight: '700' },
});
