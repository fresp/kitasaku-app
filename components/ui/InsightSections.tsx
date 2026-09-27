import { StyleSheet, Text, View } from 'react-native';
import AlertTriangle from 'lucide-react-native/icons/triangle-alert';
import Info from 'lucide-react-native/icons/info';
import Sparkles from 'lucide-react-native/icons/sparkles';
import TrendingDown from 'lucide-react-native/icons/trending-down';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import Landmark from 'lucide-react-native/icons/landmark';
import CircleCheckBig from 'lucide-react-native/icons/circle-check-big';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import { Colors, FontSize, Radius } from '../../constants/theme';
import type { CategoryMove, InsightKind, TrendInsight } from '../../lib/insight';
import { formatRupiah } from '../../lib/format';

/**
 * The individual blocks Screen 2C is made of.
 *
 * Split from the screen because the screen is already long and because several
 * of these appear in more than one section: the "insight row" is the same
 * object in the summary and in the closing callouts, and a hand-rolled copy in
 * each place is how one ends up with different padding.
 *
 * Nothing here does money arithmetic. Every number arrives pre-computed and
 * pre-formatted from lib/insight.ts, so a row's figure and the chart above it
 * cannot disagree.
 */

/** A white section card with the design's 16px padding and 12px gap. */
export function SectionCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function SectionHeader({
  title,
  subtitle,
  trailing,
}: {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.titleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {trailing}
      </View>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
    </View>
  );
}

// ============ Insight rows (Section 1) ============

type IconKind = 'trending-up' | 'alert' | 'landmark' | 'check' | 'shield';

const KIND_STYLE: Record<InsightKind, { icon: IconKind; bg: string; fg: string }> = {
  income: { icon: 'trending-up', bg: Colors.paidBg, fg: Colors.paidText },
  overspend: { icon: 'alert', bg: Colors.pendingBg, fg: Colors.pendingBorder },
  financing: { icon: 'landmark', bg: Colors.financingBg, fg: Colors.alertText },
  debt: { icon: 'check', bg: Colors.alertBg, fg: Colors.chartLiability },
  asset: { icon: 'shield', bg: Colors.paidBg, fg: Colors.chartAsset },
};

function InsightIcon({ kind }: { kind: InsightKind }) {
  const s = KIND_STYLE[kind];
  const size = 14;
  const color = s.fg;
  return (
    <View style={[styles.iconBox, { backgroundColor: s.bg }]}>
      {s.icon === 'trending-up' && <TrendingUp size={size} color={color} />}
      {s.icon === 'alert' && <AlertTriangle size={size} color={color} />}
      {s.icon === 'landmark' && <Landmark size={size} color={color} />}
      {s.icon === 'check' && <CircleCheckBig size={size} color={color} />}
      {s.icon === 'shield' && <ShieldCheck size={size} color={color} />}
    </View>
  );
}

export function InsightRow({ insight }: { insight: TrendInsight }) {
  return (
    <View style={styles.insightRow}>
      <InsightIcon kind={insight.kind} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.insightTitle}>{insight.title}</Text>
        <Text style={styles.insightBody}>{insight.body}</Text>
      </View>
    </View>
  );
}

/** The section-1 shell: title, count badge, subtitle, then the rows. */
export function TrendSummary({
  insights,
  subtitle,
}: {
  insights: TrendInsight[];
  subtitle: string;
}) {
  return (
    <SectionCard>
      <SectionHeader
        title="Ringkasan Tren"
        subtitle={subtitle}
        trailing={
          insights.length > 0 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countLabel}>{insights.length} Insight Utama</Text>
            </View>
          ) : undefined
        }
      />
      {insights.length === 0 ? (
        <Text style={styles.empty}>
          Belum cukup data untuk menyimpulkan tren. Selesaikan satu siklus dulu.
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {insights.map((i) => (
            <InsightRow key={i.kind} insight={i} />
          ))}
        </View>
      )}
    </SectionCard>
  );
}

// ============ Banners and callouts ============

export function RuleBanner({
  text,
  tone = 'alert',
  icon = 'info',
}: {
  text: string;
  tone?: 'alert' | 'paid' | 'pending';
  icon?: 'info' | 'alert';
}) {
  const bg = tone === 'paid' ? Colors.paidBg : tone === 'pending' ? Colors.pendingBg : Colors.alertBg;
  const fg =
    tone === 'paid' ? Colors.paidText : tone === 'pending' ? Colors.pendingText : Colors.financingText;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      {icon === 'alert' ? (
        <AlertTriangle size={14} color={Colors.financingText} />
      ) : (
        <Info size={14} color={fg} />
      )}
      <Text style={[styles.bannerText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function InsightCallout({
  text,
  tone = 'paid',
}: {
  text: string;
  tone?: 'paid' | 'pending';
}) {
  const bg = tone === 'paid' ? Colors.paidBg : Colors.pendingBg;
  const fg = tone === 'paid' ? Colors.paidText : Colors.pendingText;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      {tone === 'paid' ? (
        <Sparkles size={14} color={fg} />
      ) : (
        <AlertTriangle size={14} color={Colors.pendingBorder} />
      )}
      <Text style={[styles.bannerText, { color: fg }]}>{text}</Text>
    </View>
  );
}

// ============ Month-over-month lists (Section 4) ============

/**
 * One category's movement between two months.
 *
 * `reason` is optional and usually absent: the ledger records what was spent,
 * not why. The design shows hand-written explanations ("tagihan listrik tempo
 * ganda"), which are true of one family's October and would be a fabrication on
 * anyone else's. When there is no reason the row simply omits the line.
 */
export function MoverList({
  title,
  movers,
  tone,
  emptyText,
}: {
  title: string;
  movers: CategoryMove[];
  tone: 'up' | 'down';
  emptyText: string;
}) {
  const up = tone === 'up';
  const accent = up ? Colors.pendingBorder : Colors.paidText;
  const titleColor = up ? Colors.pendingText : Colors.paidText;
  const rowBg = up ? Colors.pendingBg : Colors.paidBg;

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.moverHead}>
        {up ? <TrendingUp size={14} color={accent} /> : <TrendingDown size={14} color={accent} />}
        <Text style={[styles.moverTitle, { color: titleColor }]}>{title}</Text>
      </View>
      {movers.length === 0 ? (
        <Text style={styles.empty}>{emptyText}</Text>
      ) : (
        movers.map((m) => (
          <View key={m.categoryId} style={[styles.moverRow, { backgroundColor: rowBg }]}>
            <View style={styles.moverTop}>
              <Text style={styles.moverName} numberOfLines={1}>
                {m.name}
              </Text>
              <DeltaPill
                text={
                  m.pct === null
                    ? 'Baru bulan ini'
                    : `${up ? '↑' : '↓'} ${formatRupiah(Math.abs(m.delta))} (${up ? '+' : '−'}${Math.abs(m.pct)}%)`
                }
                tone={up ? 'pending' : 'paid'}
              />
            </View>
            <Text style={styles.moverAmounts} numberOfLines={1}>
              {`Bln ini: ${formatRupiah(m.current)} · Bln lalu: ${formatRupiah(m.previous)}`}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

/** A small tinted pill carrying a signed figure. */
export function DeltaPill({
  text,
  tone,
}: {
  text: string;
  tone: 'paid' | 'pending' | 'alert' | 'default';
}) {
  const bg =
    tone === 'paid' ? Colors.paidBg
    : tone === 'pending' ? Colors.pendingBg
    : tone === 'alert' ? Colors.alertBg
    : Colors.subtle;
  const fg =
    tone === 'paid' ? Colors.paidText
    : tone === 'pending' ? Colors.pendingBorder
    : tone === 'alert' ? Colors.alertText
    : Colors.textSecondary;
  return (
    <View style={[styles.deltaPill, { backgroundColor: bg }]}>
      <Text style={[styles.deltaText, { color: fg }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 14,
    gap: 12,
  },
  sectionHead: { gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: {
    fontSize: FontSize.sectionTitle,
    fontWeight: '700',
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  sectionSub: { fontSize: FontSize.caption, color: Colors.textSecondary, lineHeight: 16 },

  iconBox: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightRow: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: Colors.subtle,
    borderRadius: Radius.md,
    padding: 10,
  },
  insightTitle: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  insightBody: { fontSize: FontSize.caption, color: Colors.textSecondary, lineHeight: 16 },

  countBadge: {
    backgroundColor: Colors.subtle,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  countLabel: { fontSize: FontSize.microLabel, color: Colors.textSecondary, fontWeight: '600' },

  banner: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderRadius: Radius.md,
    padding: 10,
  },
  bannerText: { flex: 1, fontSize: FontSize.caption, lineHeight: 17 },

  moverHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moverTitle: { fontSize: FontSize.body, fontWeight: '600', flexShrink: 1 },
  moverRow: { borderRadius: Radius.md, padding: 10, gap: 4 },
  moverTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  moverName: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary, flexShrink: 1 },
  moverAmounts: { fontSize: FontSize.caption, color: Colors.textSecondary },

  deltaPill: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  deltaText: { fontSize: FontSize.microLabel, fontWeight: '600' },

  empty: { fontSize: FontSize.caption, color: Colors.textMuted, lineHeight: 16 },
});
