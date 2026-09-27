import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Check, Lock } from 'lucide-react-native';
import { Colors } from '../../constants/theme';
import { BrandIcon } from '../../components/ui/BrandIcon';
import { signInWithGoogle } from '../../lib/google-auth';

const VALUE_PROPS = [
  { id: 'payday', label: 'Siklus payday-to-payday' },
  { id: 'tagihan', label: 'Tandai tagihan lunas sekali sentuh' },
  { id: 'reimburse', label: 'Pool tanggungan reimburse antar-bulan' },
] as const;

export default function SignInScreen() {
  const router = useRouter();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setErr(null);
    setGoogleBusy(true);
    try {
      const res = await signInWithGoogle();
      if (res) {
        router.replace('/(auth)/setup-choice');
      }
    } catch (e: any) {
      setErr(
        e?.message ??
          'Gagal masuk dengan Google. Pastikan provider Google sudah aktif di Supabase.'
      );
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contentWrapper}>
          {/* Brand Hero */}
          <View style={styles.brandHero}>
            <View style={styles.logoLockup}>
              <BrandIcon name="brand-mark" size={52} label="" />
              <Text style={styles.logotype}>Kitasaku</Text>
            </View>
            <Text style={styles.tagline}>
              Satu dompet anggaran kelola bersama pasangan transparan real-time
            </Text>
          </View>

          {/* Value Props */}
          <View style={styles.valueProps}>
            {VALUE_PROPS.map((prop) => (
              <View key={prop.id} style={styles.propCard}>
                <View style={styles.checkBadge}>
                  <Check size={14} color={Colors.paidText} strokeWidth={2.5} />
                </View>
                <Text style={styles.propLabel}>{prop.label}</Text>
              </View>
            ))}
          </View>

          {/* Auth Block */}
          <View style={styles.authBlock}>
            <Pressable
              style={[styles.googleBtn, googleBusy && styles.googleBtnDisabled]}
              onPress={handleGoogleSignIn}
              disabled={googleBusy}
              accessibilityRole="button"
              accessibilityLabel="Lanjutkan dengan Google"
            >
              {googleBusy ? (
                <ActivityIndicator size="small" color={Colors.surface} />
              ) : (
                <>
                  <Text style={styles.gMark}>G</Text>
                  <Text style={styles.googleLabel}>Lanjutkan dengan Google</Text>
                </>
              )}
            </Pressable>

            {err && (
              <View style={styles.errBox}>
                <Text style={styles.errText}>{err}</Text>
              </View>
            )}
          </View>

          {/* Footer Secure */}
          <View style={styles.footerSecure}>
            <Lock size={12} color={Colors.textMuted} />
            <Text style={styles.secureNote}>
              Data keuangan keluarga dienkripsi aman
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  contentWrapper: {
    paddingTop: 20,
    paddingBottom: 12,
    paddingHorizontal: 16,
    gap: 20,
  },
  brandHero: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 28,
    paddingBottom: 4,
    paddingHorizontal: 8,
  },
  logoLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  logotype: {
    color: Colors.textPrimary,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  tagline: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  valueProps: {
    gap: 10,
  },
  propCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
  },
  checkBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.paidBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  propLabel: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '500',
  },
  authBlock: {
    gap: 12,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: Colors.brandPrimary,
    borderWidth: 1,
    borderColor: Colors.brandPrimary,
  },
  googleBtnDisabled: {
    opacity: 0.7,
  },
  gMark: {
    color: Colors.surface,
    fontSize: 16,
    fontWeight: '700',
  },
  googleLabel: {
    color: Colors.surface,
    fontSize: 14,
    fontWeight: '600',
  },
  errBox: {
    backgroundColor: Colors.pendingBg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.pendingBorder,
  },
  errText: {
    color: Colors.pendingText,
    fontSize: 13,
    textAlign: 'center',
  },
  footerSecure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 8,
  },
  secureNote: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
});
