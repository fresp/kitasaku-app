import { useEffect, useState } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import Download from 'lucide-react-native/icons/download';
import Info from 'lucide-react-native/icons/info';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import X from 'lucide-react-native/icons/x';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { decideUpdateGate, parseBuildNumber } from '../../lib/app-version';
import { useAppRelease } from '../../lib/queries';
import { PrimaryButton, TextButton } from './Button';

// Startup already checks (checkAutomatically ON_LOAD); this only covers the
// app coming back from background after a while, which is how it is used.
const FOREGROUND_CHECK_INTERVAL_MS = 10 * 60_000;

function useForegroundUpdateCheck() {
  useEffect(() => {
    if (!Updates.isEnabled || __DEV__) return;
    let lastCheck = Date.now();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || Date.now() - lastCheck < FOREGROUND_CHECK_INTERVAL_MS) return;
      lastCheck = Date.now();
      (async () => {
        try {
          const result = await Updates.checkForUpdateAsync();
          if (result.isAvailable) await Updates.fetchUpdateAsync();
        } catch {
          // Offline or rate limited: the next foreground tries again.
        }
      })();
    });
    return () => sub.remove();
  }, []);
}

/**
 * OTA (JS-only) update already downloaded. Inline on Home, never blocking: the
 * update also applies by itself on the next cold start.
 */
export function OtaUpdateBanner() {
  useForegroundUpdateCheck();
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const updateId = downloadedUpdate?.updateId ?? 'pending';
  if (!Updates.isEnabled || !isUpdatePending || dismissedId === updateId) return null;

  const reload = async () => {
    setReloading(true);
    try {
      await Updates.reloadAsync();
    } catch {
      setReloading(false);
    }
  };

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <RefreshCw size={20} color={Colors.accentStrong} strokeWidth={2} />
      <View style={styles.bannerCopy}>
        <Text style={styles.bannerTitle}>Versi baru siap dipakai</Text>
        <Text style={styles.bannerBody}>Atau otomatis saat aplikasi dibuka lagi</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={reload}
        disabled={reloading}
        style={({ pressed }) => [styles.bannerButton, (pressed || reloading) && styles.pressed]}
      >
        <Text style={styles.bannerButtonText}>{reloading ? 'Memuat…' : 'Muat ulang'}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tutup"
        hitSlop={8}
        onPress={() => setDismissedId(updateId)}
        style={styles.bannerClose}
      >
        <X size={16} color={Colors.textSecondary} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

/**
 * New APK (native change). Soft sheet between min and latest; full blocking
 * screen below min. Mounted once over the navigator; `ready` keeps it behind
 * the splash.
 */
export function ApkUpdateGate({ ready }: { ready: boolean }) {
  const versionCode = parseBuildNumber(Application.nativeBuildVersion);
  const enabled = ready && Platform.OS === 'android' && versionCode != null && !__DEV__;
  const releaseQ = useAppRelease(enabled);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const insets = useSafeAreaInsets();
  const { refetch } = releaseQ;

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });
    return () => sub.remove();
  }, [enabled, refetch]);

  if (!enabled) return null;
  const gate = decideUpdateGate(versionCode, releaseQ.data ?? null, dismissed);
  if (gate.kind === 'none') return null;

  const { release } = gate;
  const download = () => {
    if (release.apkUrl) Linking.openURL(release.apkUrl).catch(() => {});
  };
  const currentName = Application.nativeApplicationVersion ?? String(versionCode);

  if (gate.kind === 'force') {
    return (
      <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
        <View style={[styles.force, { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 32 }]}>
          <View style={styles.forceBody}>
            <View style={styles.forceIcon}>
              <Download size={30} color={Colors.accent} strokeWidth={2} />
            </View>
            <View style={styles.forceCopy}>
              <Text style={styles.forceTitle}>Perlu update dulu, ya</Text>
              <Text style={styles.forceText}>
                Versi ini sudah tidak cocok dengan cara Kitasaku menyimpan data sekarang. Pasang versi terbaru supaya
                catatan keuangan kalian tetap rapi.
              </Text>
            </View>
            <View style={styles.versionCard}>
              <View style={styles.versionCell}>
                <Text style={styles.versionLabel}>Versi kamu</Text>
                <Text style={[styles.versionValue, { color: Colors.negative }]}>{currentName}</Text>
              </View>
              <View style={styles.versionCell}>
                <Text style={styles.versionLabel}>Terbaru</Text>
                <Text style={[styles.versionValue, { color: Colors.positive }]}>{release.latestVersionName}</Text>
              </View>
            </View>
            <View style={styles.forceNote}>
              <ShieldCheck size={18} color={Colors.positive} strokeWidth={2} />
              <Text style={styles.forceNoteText}>Data kalian tersimpan di server, tidak hilang saat update.</Text>
            </View>
          </View>
          <View style={styles.forceActions}>
            <Pressable
              accessibilityRole="button"
              onPress={download}
              disabled={!release.apkUrl}
              style={({ pressed }) => [styles.forceButton, (pressed || !release.apkUrl) && styles.pressed]}
            >
              <Text style={styles.forceButtonText}>Unduh versi {release.latestVersionName}</Text>
            </Pressable>
            <Text style={styles.forceHint}>
              {release.apkUrl ? 'Setelah terpasang, buka lagi Kitasaku' : 'Tautan unduhan belum tersedia'}
            </Text>
          </View>
        </View>
      </Modal>
    );
  }

  const postpone = () => setDismissed(release.latestVersionCode);
  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={postpone}>
      <Pressable style={styles.scrim} onPress={postpone} accessibilityLabel="Tutup" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} accessibilityViewIsModal>
        <View style={styles.handle} />
        <View style={styles.sheetHead}>
          <View style={styles.sheetIcon}>
            <Download size={24} color={Colors.accentStrong} strokeWidth={2} />
          </View>
          <View style={styles.sheetHeadCopy}>
            <Text style={styles.sheetTitle}>Kitasaku {release.latestVersionName} tersedia</Text>
            <Text style={styles.sheetSub}>Kamu masih di {currentName}</Text>
          </View>
        </View>
        {release.notes.length > 0 ? (
          <View style={styles.notes}>
            <Text style={styles.notesLabel}>YANG BARU</Text>
            {release.notes.map((line) => (
              <View key={line} style={styles.noteRow}>
                <Text style={styles.noteBullet}>•</Text>
                <Text style={styles.noteText}>{line}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.warn}>
          <Info size={18} color={Colors.financingText} strokeWidth={2} />
          <Text style={styles.warnText}>
            Pasang di atas versi lama, data tetap aman. Kalau Android minta izin “sumber tidak dikenal”, izinkan sekali
            saja.
          </Text>
        </View>
        <View style={styles.sheetActions}>
          {release.apkUrl ? <PrimaryButton label="Unduh & pasang" onPress={download} /> : null}
          <TextButton label="Nanti saja" onPress={postpone} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.72 },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 8,
    backgroundColor: Colors.accentSoft,
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: Radius.md,
    // Sits above the greeting inside Home's navy overview.
    marginBottom: 12,
  },
  bannerCopy: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textPrimary },
  bannerBody: { fontSize: FontSize.caption, color: Colors.textSecondary },
  bannerButton: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerButtonText: { fontSize: FontSize.body, fontWeight: '600', color: Colors.white },
  bannerClose: { width: 28, height: 36, alignItems: 'center', justifyContent: 'center' },

  scrim: { flex: 1, backgroundColor: Colors.overlayScrim },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingTop: 12,
    paddingHorizontal: 20,
    gap: 20,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.pill, backgroundColor: Colors.borderStrong },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sheetIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHeadCopy: { flex: 1, gap: 2 },
  sheetTitle: { fontSize: FontSize.sectionTitle, fontWeight: '700', color: Colors.textPrimary },
  sheetSub: { fontSize: FontSize.body, color: Colors.textSecondary },
  notes: { backgroundColor: Colors.subtle, borderRadius: Radius.md, paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  notesLabel: { fontSize: FontSize.caption, fontWeight: '600', color: Colors.textSecondary, letterSpacing: 0.5 },
  noteRow: { flexDirection: 'row', gap: 8 },
  noteBullet: { fontSize: FontSize.body, color: Colors.accentStrong },
  noteText: { flex: 1, fontSize: FontSize.body, lineHeight: 19, color: Colors.textPrimary },
  warn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: Colors.warningSoft,
    borderWidth: 1,
    borderColor: Colors.warningBorder,
    borderRadius: Radius.md,
  },
  warnText: { flex: 1, fontSize: 12, lineHeight: 17, color: Colors.textSecondary },
  sheetActions: { gap: 4 },

  force: { flex: 1, backgroundColor: Colors.navy, paddingHorizontal: 24 },
  forceBody: { flex: 1, gap: 24 },
  forceIcon: {
    width: 64,
    height: 64,
    borderRadius: Radius.lg,
    backgroundColor: Colors.navyRaised,
    borderWidth: 1,
    borderColor: Colors.borderOnDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forceCopy: { gap: 10 },
  forceTitle: { fontSize: FontSize.heroNumeral, lineHeight: 34, fontWeight: '700', color: Colors.textOnDark },
  forceText: { fontSize: 15, lineHeight: 22, color: Colors.textOnDarkSecondary },
  versionCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: Colors.navyRaised,
    borderWidth: 1,
    borderColor: Colors.borderOnDark,
    borderRadius: Radius.lg,
  },
  versionCell: { flex: 1, gap: 4 },
  versionLabel: { fontSize: FontSize.caption, color: Colors.textOnDarkMuted },
  versionValue: { fontSize: FontSize.currencyLarge, fontWeight: '600' },
  forceNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  forceNoteText: { flex: 1, fontSize: FontSize.body, lineHeight: 19, color: Colors.textOnDarkSecondary },
  forceActions: { gap: 12 },
  forceButton: {
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  forceButtonText: { fontSize: 15, fontWeight: '700', color: Colors.navy },
  forceHint: { textAlign: 'center', fontSize: 12, color: Colors.textOnDarkMuted },
});
