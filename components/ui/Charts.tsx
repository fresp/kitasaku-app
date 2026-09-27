import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { barPct, niceMax } from '../../lib/insight';

/**
 * Chart primitives for Screen 2C (Insight & Aset 2026).
 *
 * Plain `View`s, no charting dependency. Every chart in the design is a bar
 * chart on a fixed twelve-column axis, which is a flexbox layout: pulling in a
 * chart library would add a native dependency, a gesture system and an
 * animation model to draw rectangles whose heights are already known.
 *
 * What these own: the axis, the zero line, the tap target, and the "no cycle
 * this month" case. What they do NOT own: any money arithmetic. Every value
 * arrives pre-computed from lib/insight.ts, so a bar's height and the number
 * printed beside it cannot disagree.
 *
 * A month with no cycle renders a flat grey stub and a dimmed label. It is
 * deliberately not a zero-height bar: zero means "we spent nothing", and a
 * missing month means "we do not know". Drawing them the same way is how a
 * chart lies.
 */

export interface BarSeg {
  value: number;
  color: string;
}

export interface ChartColumn {
  month: number;
  label: string;
  hasData: boolean;
  /** Stacked upward from the baseline, drawn in order. */
  left: BarSeg[];
  /** Second bar beside `left`, same baseline — plan vs actual, income vs spend. */
  right: BarSeg[];
  /**
   * The design's "Net Cashflow Indicator": a short tick under the pair whose
   * width and colour say how far the month finished above or below water.
   */
  marker?: { value: number; color: string };
}

function Stack({ segs, max, width }: { segs: BarSeg[]; max: number; width: number }) {
  return (
    <View style={[styles.stack, { width }]}>
      {segs.map((s, i) => (
        <View
          key={i}
          style={{
            width,
            height: `${barPct(s.value, max)}%`,
            backgroundColor: s.color,
            borderTopLeftRadius: i === segs.length - 1 ? 3 : 0,
            borderTopRightRadius: i === segs.length - 1 ? 3 : 0,
          }}
        />
      ))}
    </View>
  );
}

/**
 * Bars standing side by side on one baseline.
 *
 * Covers the design's "Sumber Dana vs Alokasi", both trend charts, and the
 * liability timeline — they differ only in what goes in `left` and `right`
 * and how many segments each carries.
 *
 * One shared axis for both bars: inflow and outflow are the same currency and
 * answer the same question ("how big was it"), so separate scales would make a
 * 2jt outflow as tall as a 20jt inflow.
 */
export function GroupedBarChart({
  columns,
  height = 110,
  activeMonth,
  onPressMonth,
  barWidth = 7,
  barGap = 2,
  colGap = 2,
}: {
  columns: ChartColumn[];
  height?: number;
  activeMonth?: number | null;
  onPressMonth?: (month: number) => void;
  barWidth?: number;
  barGap?: number;
  colGap?: number;
}) {
  const max = niceMax(
    Math.max(
      1,
      ...columns.map((c) =>
        Math.max(
          c.left.reduce((s, b) => s + b.value, 0),
          c.right.reduce((s, b) => s + b.value, 0)
        )
      )
    )
  );
  const maxMarker = Math.max(
    1,
    ...columns.map((c) => Math.abs(c.marker?.value ?? 0))
  );

  return (
    <View style={[styles.chartRow, { gap: colGap }]}>
      {columns.map((col) => {
        const active = activeMonth === col.month;
        return (
          <Pressable
            key={col.month}
            onPress={onPressMonth ? () => onPressMonth(col.month) : undefined}
            disabled={!onPressMonth}
            style={[styles.col, active && styles.colActive]}
            accessibilityLabel={col.hasData ? col.label : `${col.label}, belum ada siklus`}
          >
            <View style={[styles.bars, { height, gap: barGap }]}>
              {col.left.length > 0 && <Stack segs={col.left} max={max} width={barWidth} />}
              {col.right.length > 0 && <Stack segs={col.right} max={max} width={barWidth} />}
              {col.left.length === 0 && col.right.length === 0 && !col.hasData && (
                <View style={styles.absent} />
              )}
            </View>
            {col.marker ? (
              <View
                style={[
                  styles.marker,
                  {
                    // Width rather than height: the tick reads along the
                    // baseline like a gauge, and scaling it horizontally keeps
                    // it distinguishable from the bars above it.
                    width: Math.max(4, 14 * (Math.abs(col.marker.value) / maxMarker)),
                    backgroundColor: col.marker.color,
                  },
                ]}
              />
            ) : (
              <View style={styles.markerSpacer} />
            )}
            <Text
              style={[
                styles.mLabel,
                active && styles.mLabelActive,
                !col.hasData && styles.mLabelDim,
              ]}
              numberOfLines={1}
            >
              {col.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Stacked bars from the baseline — the asset trend. Each column's total height
 * is the balance and its segments are what the balance is made of.
 */
export function StackedBarChart({
  columns,
  height = 120,
  activeMonth,
  onPressMonth,
  barWidth = 14,
}: {
  columns: ChartColumn[];
  height?: number;
  activeMonth?: number | null;
  onPressMonth?: (month: number) => void;
  barWidth?: number;
}) {
  return (
    <GroupedBarChart
      columns={columns}
      height={height}
      activeMonth={activeMonth}
      onPressMonth={onPressMonth}
      barWidth={barWidth}
      colGap={3}
    />
  );
}

/**
 * Signed variance bars around a zero line: up = over plan, down = under plan.
 *
 * The colour is semantic, not categorical — it says whether the variance was
 * good, and `favourable` is computed in `planVsActual`, where the direction of
 * "good" is known per metric. A green bar here means "this went well", not
 * "this was income".
 */
export function VarianceBarChart({
  columns,
  height = 90,
  activeMonth,
  onPressMonth,
  barWidth = 10,
}: {
  columns: ChartColumn[];
  height?: number;
  activeMonth?: number | null;
  onPressMonth?: (month: number) => void;
  barWidth?: number;
}) {
  const max = niceMax(
    Math.max(
      1,
      ...columns.map((c) =>
        Math.max(c.left.reduce((s, b) => s + b.value, 0), c.right.reduce((s, b) => s + b.value, 0))
      )
    )
  );
  const half = Math.round(height / 2);

  return (
    <View style={styles.varianceRow}>
      {columns.map((col) => {
        const up = col.left.reduce((s, b) => s + b.value, 0);
        const down = col.right.reduce((s, b) => s + b.value, 0);
        const active = activeMonth === col.month;
        return (
          <Pressable
            key={col.month}
            onPress={onPressMonth ? () => onPressMonth(col.month) : undefined}
            disabled={!onPressMonth}
            style={[styles.vCol, active && styles.colActive]}
            accessibilityLabel={col.label}
          >
            <View style={[styles.vHalf, { height: half }]}>
              {up > 0 && (
                <View
                  style={{
                    width: barWidth,
                    height: `${barPct(up, max)}%`,
                    backgroundColor: col.left[0]?.color ?? Colors.chartExpense,
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 3,
                  }}
                />
              )}
            </View>
            <View style={styles.zeroLine} />
            <View style={[styles.vHalf, styles.vHalfBottom, { height: half }]}>
              {down > 0 && (
                <View
                  style={{
                    width: barWidth,
                    height: `${barPct(down, max)}%`,
                    backgroundColor: col.right[0]?.color ?? Colors.chartIncome,
                    borderBottomLeftRadius: 3,
                    borderBottomRightRadius: 3,
                  }}
                />
              )}
            </View>
            <Text
              style={[styles.mLabel, active && styles.mLabelActive, !col.hasData && styles.mLabelDim]}
              numberOfLines={1}
            >
              {col.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Legend({ items, dot = 6 }: { items: { label: string; color: string }[]; dot?: number }) {
  return (
    <View style={styles.legend}>
      {items.map((it) => (
        <View key={it.label} style={styles.legendItem}>
          <View
            style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: it.color }}
          />
          <Text style={styles.legendLabel} numberOfLines={1}>
            {it.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The scale row above a chart: axis note on the left, a cue on the right. */
export function ChartScaleRow({
  left,
  right,
  leftColor,
  rightColor,
}: {
  left?: string;
  right?: string;
  leftColor?: string;
  rightColor?: string;
}) {
  return (
    <View style={styles.scaleRow}>
      <Text
        style={[styles.scaleText, leftColor ? { color: leftColor } : null]}
        numberOfLines={1}
      >
        {left ?? ''}
      </Text>
      <Text
        style={[styles.scaleText, { textAlign: 'right' }, rightColor ? { color: rightColor } : null]}
        numberOfLines={1}
      >
        {right ?? ''}
      </Text>
    </View>
  );
}

/** One labelled money figure. The design closes most sections with a 2×2 grid. */
export function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'paid' | 'pending' | 'alert' | 'dark';
}) {
  const bg =
    tone === 'paid' ? Colors.paidBg
    : tone === 'pending' ? Colors.pendingBg
    : tone === 'alert' ? Colors.alertBg
    : tone === 'dark' ? Colors.brandPrimary
    : Colors.subtle;
  const fg =
    tone === 'paid' ? Colors.paidText
    : tone === 'pending' ? Colors.pendingText
    : tone === 'alert' ? Colors.alertText
    : tone === 'dark' ? Colors.white
    : Colors.textPrimary;
  const labelColor = tone === 'default' ? Colors.textMuted : tone === 'dark' ? Colors.borderStrong : fg;
  return (
    <View style={[styles.statCard, { backgroundColor: bg }]}>
      <Text style={[styles.statLabel, { color: labelColor }]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={[styles.statValue, { color: fg }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.statGrid}>{children}</View>;
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.statRow}>{children}</View>;
}

/** A labelled progress track, used by the repayment progress box. */
export function ProgressTrack({
  pct,
  color,
}: {
  pct: number;
  color: string;
}) {
  return (
    <View style={styles.track}>
      <View
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          height: 6,
          backgroundColor: color,
          borderRadius: 3,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chartRow: { flexDirection: 'row', alignItems: 'flex-end' },
  col: { flex: 1, alignItems: 'center', paddingTop: 4, borderRadius: Radius.sm },
  colActive: { backgroundColor: Colors.subtle },
  bars: { width: '100%', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
  stack: { justifyContent: 'flex-end' },
  absent: { position: 'absolute', bottom: 0, width: '62%', height: 2, backgroundColor: Colors.chartGrid },
  marker: { height: 3, borderRadius: 2, marginTop: 5 },
  markerSpacer: { height: 3, marginTop: 5 },
  mLabel: { fontSize: FontSize.microLabel, color: Colors.textMuted, marginTop: 4 },
  mLabelActive: { color: Colors.textPrimary, fontWeight: '700' },
  mLabelDim: { color: Colors.borderStrong },

  varianceRow: { flexDirection: 'row', alignItems: 'center' },
  vCol: { flex: 1, alignItems: 'center', borderRadius: Radius.sm },
  vHalf: { width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  vHalfBottom: { justifyContent: 'flex-start' },
  zeroLine: { width: '100%', height: 1.5, backgroundColor: Colors.chartPlan },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendLabel: { fontSize: FontSize.caption, color: Colors.textSecondary },

  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  scaleText: { fontSize: FontSize.microLabel, color: Colors.textMuted, flexShrink: 1 },

  statCard: { flex: 1, borderRadius: Radius.md, padding: 10, gap: 3, minHeight: 58 },
  statLabel: { fontSize: FontSize.microLabel, letterSpacing: 0.2 },
  statValue: { fontSize: FontSize.body, fontWeight: '600' },
  statGrid: { gap: 8 },
  statRow: { flexDirection: 'row', gap: 8 },

  track: { height: 6, borderRadius: 3, backgroundColor: Colors.borderSubtle, overflow: 'hidden' },
});
