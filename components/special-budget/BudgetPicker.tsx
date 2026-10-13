import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, FontSize, Radius } from '../../constants/theme';
import type { SpecialBudget } from '../../lib/special-budget';

/**
 * "Masuk ke": the cycle or one Anggaran Khusus. The cycle is always the first
 * chip and the default — picking a budget is a deliberate act, because a
 * long-running budget preselected would quietly swallow routine spending.
 */
export function BudgetPicker({
  budgets,
  value,
  onChange,
  cycleLabel,
  hint,
}: {
  budgets: SpecialBudget[];
  value: string | null;
  onChange: (budgetId: string | null) => void;
  cycleLabel: string;
  hint?: string | null;
}) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>Masuk ke</Text>
      <View style={styles.chips}>
        <Chip label={cycleLabel} active={value === null} dot={Colors.accent} onPress={() => onChange(null)} />
        {budgets.map((b) => (
          <Chip
            key={b.id}
            label={b.name}
            active={value === b.id}
            dot={Colors.purple}
            onPress={() => onChange(b.id)}
          />
        ))}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function Chip({ label, active, dot, onPress }: { label: string; active: boolean; dot: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  label: { color: Colors.textSecondary, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 0.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36,
    paddingHorizontal: 12, borderRadius: Radius.pill,
    borderWidth: 1, borderColor: Colors.borderSubtle, backgroundColor: Colors.surface,
  },
  chipActive: { borderColor: Colors.purple, borderWidth: 1.5, backgroundColor: Colors.purpleSoft },
  dot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600', maxWidth: 180 },
  chipTextActive: { color: Colors.textPrimary, fontWeight: '700' },
  hint: { color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 16 },
});
