import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Loader from 'lucide-react-native/icons/loader';
import { Colors } from '../../constants/theme';
import { BrandIcon } from './BrandIcon';

/**
 * "Screen 2A - Splash Screen" — design/design.pen, frame Z3M5B.
 *
 * This is the in-app half of the splash. expo-splash-screen's static raster can
 * only sit there, so it covers the cold start until the first paint and this
 * composition takes over from there — see `hideNativeSplash` and `Gate` in
 * app/_layout.tsx for the ordering.
 *
 * The two halves are not the same artwork: `assets/splash-icon.png` is a
 * *stacked* lockup (mark, wordmark, rule, tagline, "2026") and this frame is the
 * design's *horizontal* one (mark beside the wordmark). Both are on
 * `$bg.surface`, so the handoff swaps one white field for another and nothing
 * flashes, but the lockup does re-flow. Reconciling the raster is a separate
 * call — it is a binary this repo has no generator for (see assets/README.txt).
 *
 * Two pieces of the design frame are deliberately NOT drawn, because the design
 * draws device chrome and the device already supplies it:
 *
 *   - The 62-high "Status Bar" (09:41 + signal/wifi/battery). The real status
 *     bar renders in that exact place, with the real time, over this same white
 *     surface. Drawing a second one would double it.
 *   - The 134x5 "Home Indicator" bar. The system draws it, and the bottom
 *     safe-area inset reserves the room the design's 6/12 padding was mocking.
 *
 * The frame's own `cornerRadius: 48` + `$border.subtle` stroke are the design
 * canvas's phone bezel — 19 frames in the file carry them — so they are dropped
 * here the same way every other screen in this app drops them.
 */

// The design measures the brand lockup 140 below the top of a 62-high status
// bar; the safe-area inset stands in for that bar, so 140 is applied from the
// inset rather than from the bezel. On a notched device that lands the mark
// within a few points of the design's y=202.
const BODY_TOP_PADDING = 140;
const FADE_MS = 240;
const SPIN_MS = 1100;

export function AppSplash({
  visible,
  onFirstLayout,
}: {
  /** Drives the fade-out. The component unmounts itself once the fade ends. */
  visible: boolean;
  /** Called once, after the first paint — the point at which the native splash
   *  can be hidden without a flash of nothing. */
  onFirstLayout?: () => void;
}) {
  // Lazy useState, not useRef(...).current: the lint config runs the React
  // Compiler rules, which reject reading a ref during render, and an Animated
  // value is read during render by necessity (it is passed as a style prop).
  const [fade] = useState(() => new Animated.Value(1));
  const laidOut = useRef(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (visible) return;
    const anim = Animated.timing(fade, {
      toValue: 0,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start(({ finished }) => {
      if (finished) setGone(true);
    });
    return () => anim.stop();
  }, [visible, fade]);

  if (gone) return null;

  return (
    <Animated.View
      style={[
        styles.root,
        {
          opacity: fade,
          // Once the fade starts the underlying screen is already mounted and
          // interactive, so the veil must stop swallowing touches immediately
          // rather than at the end of the animation.
          //
          // Set through the style rather than the `pointerEvents` prop, which is
          // deprecated (and warns) on the web renderer; both platforms honor the
          // style form on this RN version.
          pointerEvents: visible ? 'auto' : 'none',
        },
      ]}
    >
      <SafeAreaView
        style={styles.safe}
        edges={['top', 'bottom']}
        onLayout={() => {
          if (laidOut.current) return;
          laidOut.current = true;
          onFirstLayout?.();
        }}
      >
        <View style={styles.body}>
          <View style={styles.brandLockup}>
            <View style={styles.logoRow}>
              {/* Decorative: the wordmark beside it is the readable name, and
                  labelling both would read "Kitasaku Kitasaku". */}
              <BrandIcon name="brand-mark" size={52} label="" />
              <Text style={styles.wordmark}>Kitasaku</Text>
            </View>
            <Text style={styles.tagline}>Satu rumah, satu ritme keuangan.</Text>
            <View style={styles.divider} />
          </View>

          <View style={styles.bottomGroup}>
            <View style={styles.loadingRow}>
              <Spinner />
              <Text style={styles.loadingText}>Menyiapkan ruang keluarga…</Text>
            </View>
            <Text style={styles.caption}>PAYDAY-TO-PAYDAY · 2026</Text>
          </View>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

/**
 * The design's 14px lucide `loader`, turning.
 *
 * React Native has no `useReducedMotion`, so the preference comes from
 * AccessibilityInfo. The icon is eight spokes at 45°, so a looping 0→360 sweep
 * has no visible seam and there is nothing to reverse on the way round.
 */
function Spinner() {
  const [spin] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setReduceMotion(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const anim = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: SPIN_MS,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [reduceMotion, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Loader size={14} color={Colors.textMuted} strokeWidth={2} />
    </Animated.View>
  );
}

// Font sizes are the design's own numbers (32, 14, 13, 11) rather than FontSize
// tokens: the scale in constants/theme.ts has no 32 or 14, and the design file
// is the source of truth. There is no font pipeline in this app, so the design's
// Inter / $font-body resolves to the platform font, as it does on every screen.
const styles = StyleSheet.create({
  // Spelled out rather than StyleSheet.absoluteFillObject: this RN version's
  // StyleSheet type does not declare it.
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: Colors.surface,
    zIndex: 10,
  },
  safe: { flex: 1, backgroundColor: Colors.surface },
  body: {
    flex: 1,
    paddingTop: BODY_TOP_PADDING,
    paddingBottom: 28,
    paddingHorizontal: 32,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandLockup: { alignItems: 'center', gap: 20 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  wordmark: { color: Colors.textPrimary, fontSize: 32, fontWeight: '800' },
  tagline: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  divider: { width: 48, height: 1, backgroundColor: Colors.borderStrong },
  bottomGroup: { alignItems: 'center', gap: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingText: { color: Colors.textMuted, fontSize: 13, fontWeight: '500' },
  caption: { color: Colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
});
