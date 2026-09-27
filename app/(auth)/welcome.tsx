import { useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { BrandIcon } from '../../components/ui/BrandIcon';
import { PrimaryButton } from '../../components/ui/Button';
import { markWelcomeSeen } from '../../lib/onboarding';

/**
 * The three slides the design drew as "03 Onboarding Illustrations".
 *
 * The copy is the design's own — numeral, title, and description are lifted
 * verbatim from the asset library's Onboarding 01/02/03 cards, so the art and
 * the words that were written for it stay together. The design file has no
 * screen that assembles them (its Flow F is the sign-in form), so this screen
 * is the assembly: three cards laid out as the library shows them, one per
 * page, with the illustration in the rounded canvas plate the library uses.
 */
const SLIDES = [
  {
    art: 'onboarding-01-family-finance',
    numeral: '01',
    title: 'Atur Keuangan Keluarga lebih Mudah',
    desc: 'Kelola pemasukan, pengeluaran, dan tabungan bersama dalam satu tempat.',
  },
  {
    art: 'onboarding-02-expense-tracking',
    numeral: '02',
    title: 'Pantau Pengeluaran dengan Jelas',
    desc: 'Lihat kemana uang pergi dan kelola kebutuhan dengan lebih baik.',
  },
  {
    art: 'onboarding-03-shared-goal',
    numeral: '03',
    title: 'Wujudkan Tujuan Bersama',
    desc: 'Mulai dari hal kecil, untuk masa depan keluarga yang lebih tenang.',
  },
] as const;

export default function WelcomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const last = page === SLIDES.length - 1;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    // Rounded rather than floored: a page is "current" once its centre passes
    // the viewport centre, which is what the dots should agree with while a
    // finger is mid-drag.
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  async function finish() {
    await markWelcomeSeen();
    router.replace('/(auth)/sign-in');
  }

  function next() {
    if (last) {
      finish();
      return;
    }
    scroller.current?.scrollTo({ x: width * (page + 1), animated: true });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.brand}>Kitasaku</Text>
        <Pressable onPress={finish} accessibilityRole="button">
          <Text style={styles.skip}>Lewati</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        {SLIDES.map((s) => (
          <View key={s.art} style={[styles.slide, { width }]}>
            <View style={styles.artPlate}>
              <BrandIcon name={s.art} size={180} label="" />
            </View>
            <Text style={styles.numeral}>{s.numeral}</Text>
            <Text style={styles.title}>{s.title}</Text>
            <Text style={styles.desc}>{s.desc}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <View key={s.art} style={[styles.dot, i === page && styles.dotOn]} />
        ))}
      </View>

      <View style={styles.footer}>
        <PrimaryButton label={last ? 'Mulai' : 'Lanjut'} onPress={next} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  brand: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  skip: { color: Colors.textMuted, fontSize: FontSize.body, fontWeight: '600' },
  pager: { flex: 1 },
  slide: { paddingHorizontal: 20, paddingTop: 20, gap: 10 },
  // The library places each illustration on a 200-high canvas plate with a
  // 16pt radius; the art is 180 and centred inside it.
  artPlate: {
    height: 200,
    borderRadius: Radius.lg,
    backgroundColor: Colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  numeral: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  title: { color: Colors.textPrimary, fontSize: 20, fontWeight: '700', lineHeight: 27 },
  desc: { color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 20 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 16 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.borderStrong },
  dotOn: { backgroundColor: Colors.brandPrimary, width: 18 },
  footer: { paddingHorizontal: 20, paddingBottom: 12 },
});
