import { Pressable, StyleSheet, Text } from 'react-native';
import Check from 'lucide-react-native/icons/check';
import { Colors, FontSize, Radius } from '../../constants/theme';

export function PrimaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

export function PayButton({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.pay, pressed && styles.pressed]}
    >
      <Check size={14} color={Colors.white} strokeWidth={2.5} />
      <Text style={styles.payText}>Bayar</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    backgroundColor: Colors.brandPrimary,
    borderRadius: Radius.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: Colors.white, fontSize: 15, fontWeight: '600' },
  secondary: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  secondaryText: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  pay: {
    backgroundColor: Colors.brandPrimary,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  payText: { color: Colors.white, fontSize: FontSize.body, fontWeight: '600' },
});
