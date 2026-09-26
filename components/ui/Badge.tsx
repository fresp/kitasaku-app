import { StyleSheet, Text, View } from 'react-native';
import { Colors, FontSize, Radius } from '../../constants/theme';

type BadgeTone = 'default' | 'pending' | 'paid' | 'alert' | 'dark';

const toneStyles: Record<BadgeTone, { bg: string; text: string }> = {
  default: { bg: Colors.subtle, text: Colors.textSecondary },
  pending: { bg: Colors.pendingBg, text: Colors.pendingText },
  paid: { bg: Colors.paidBg, text: Colors.paidText },
  alert: { bg: Colors.alertBg, text: Colors.alertText },
  dark: { bg: Colors.brandPrimary, text: Colors.white },
};

export function Badge({ label, tone = 'default' }: { label: string; tone?: BadgeTone }) {
  const t = toneStyles[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text style={[styles.text, { color: t.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
