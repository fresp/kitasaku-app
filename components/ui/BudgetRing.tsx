import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Colors, FontSize } from '../../constants/theme';

/**
 * The Budget Health ring. Drawn with react-native-svg (already a dependency for
 * the sign-in screen) rather than a chart library: it is one arc, and pulling a
 * charting package in for a single circle would cost more than it gives.
 *
 * The ring is a progress indicator, so it is capped at 100% — a category at
 * 202% of its pagu should not draw a ring that wraps around twice and reads as
 * "more than complete". The overrun is carried by the label and the colour
 * instead, which is where the real information is.
 */
export function BudgetRing({
  pct,
  color,
  size = 96,
  strokeWidth = 8,
}: {
  pct: number;
  color: string;
  size?: number;
  strokeWidth?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (clamped / 100) * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={Colors.chartGrid}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          // Start at 12 o'clock instead of 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.label}>
        <Text style={styles.pct}>{Math.min(999, Math.round(pct))}%</Text>
        <Text style={styles.sub}>Terpakai</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { position: 'absolute', alignItems: 'center' },
  pct: { color: Colors.textPrimary, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sub: { color: Colors.textMuted, fontSize: FontSize.caption },
});
