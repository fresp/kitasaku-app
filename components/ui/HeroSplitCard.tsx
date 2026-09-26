import { StyleSheet, Text, View } from 'react-native';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';

export function HeroSplitCard({
  kasRiil,
  estimasiSisa,
  estimasiSub,
  footLeft,
}: {
  kasRiil: number;
  estimasiSisa: number;
  estimasiSub: string;
  footLeft: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>ARUS KAS SIKLUS INI</Text>
      <View style={styles.split}>
        <View style={styles.col}>
          <Text style={styles.label}>Saldo Kas Riil</Text>
          <Text style={styles.value}>{formatRupiah(kasRiil)}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.col}>
          <Text style={styles.label}>Estimasi Sisa Akhir</Text>
          <Text style={styles.value}>{formatRupiah(estimasiSisa)}</Text>
          <Text style={styles.sub}>{estimasiSub}</Text>
        </View>
      </View>
      <View style={styles.footer}>
        <Text style={styles.footLeft} numberOfLines={1}>
          {footLeft}
        </Text>
        <Text style={styles.footRight}>Detail →</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.brandPrimary,
    borderRadius: Radius.lg,
    padding: 16,
  },
  eyebrow: {
    color: Colors.textMuted,
    fontSize: FontSize.caption,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 12,
  },
  split: { flexDirection: 'row' },
  col: { flex: 1 },
  label: { color: Colors.borderStrong, fontSize: FontSize.body },
  value: {
    color: Colors.white,
    fontSize: FontSize.heroNumeral,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  sub: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 2 },
  divider: { width: 1, backgroundColor: Colors.heroFooter, marginHorizontal: 12 },
  footer: {
    marginTop: 14,
    backgroundColor: Colors.heroFooter,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  footLeft: { color: '#A7F3D0', fontSize: FontSize.body, flex: 1 },
  footRight: { color: Colors.white, fontSize: FontSize.body, fontWeight: '600' },
});
