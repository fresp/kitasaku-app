import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, FontSize, Radius } from '../../constants/theme';

export interface SegmentItem {
  key: string;
  label: string;
  count?: number;
}

export function SegmentedTabs({
  items,
  activeKey,
  onChange,
}: {
  items: SegmentItem[];
  activeKey: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      {items.map((it) => {
        const active = it.key === activeKey;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {it.label}
              {typeof it.count === 'number' ? ` (${it.count})` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.subtle,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: Colors.surface },
  label: { color: Colors.textSecondary, fontSize: FontSize.body, fontWeight: '500' },
  labelActive: { color: Colors.textPrimary, fontWeight: '600' },
});
