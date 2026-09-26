import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { Badge } from '../../components/ui/Badge';
import { PrimaryButton } from '../../components/ui/Button';
import { supabase, requireSupabase } from '../../lib/supabase';
import { signInWithGoogle } from '../../lib/google-auth';

function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <Path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <Path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        fill="#FBBC05"
      />
      <Path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        fill="#EA4335"
      />
    </Svg>
  );
}

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'otp'>('email');
  const [busy, setBusy] = useState(false);
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
      setErr(e?.message ?? 'Gagal masuk dengan Google. Pastikan provider Google sudah aktif di Supabase.');
    } finally {
      setGoogleBusy(false);
    }
  }

  async function sendOtp() {
    setErr(null);
    if (!email.includes('@')) {
      setErr('Masukkan email yang valid dulu ya.');
      return;
    }
    setBusy(true);
    try {
      const sb = supabase ?? requireSupabase();
      const { error } = await sb.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setStage('otp');
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal mengirim kode. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setErr(null);
    if (code.trim().length < 6) {
      setErr('Kode OTP 6 digit — cek inbox / spam email kamu.');
      return;
    }
    setBusy(true);
    try {
      const sb = supabase ?? requireSupabase();
      const { error } = await sb.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email',
      });
      if (error) throw error;
      router.replace('/(auth)/setup-choice');
    } catch (e: any) {
      setErr(e?.message ?? 'Kode salah / kedaluwarsa. Minta kode baru.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Badge label="KITASAKU • KEUANGAN KELUARGA" />
        <Text style={styles.title}>Masuk untuk sinkron dengan pasangan</Text>
        <Text style={styles.sub}>
          Siklus, Tanggungan & Riwayat otomatis tersinkron di dua HP secara real-time.
        </Text>

        {/* Google Sign In Button */}
        <Pressable
          style={styles.googleBtn}
          onPress={handleGoogleSignIn}
          disabled={googleBusy || busy}
        >
          {googleBusy ? (
            <ActivityIndicator size="small" color={Colors.textPrimary} />
          ) : (
            <>
              <GoogleIcon size={20} />
              <Text style={styles.googleBtnText}>Lanjut dengan Google</Text>
            </>
          )}
        </Pressable>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>atau lewat email</Text>
          <View style={styles.dividerLine} />
        </View>

        <Text style={styles.label}>EMAIL</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="kamu@email.com"
          placeholderTextColor={Colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.input}
        />

        {stage === 'otp' && (
          <>
            <Text style={styles.label}>KODE OTP 6 DIGIT</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              maxLength={6}
              style={styles.input}
            />
          </>
        )}

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}

        {stage === 'email' ? (
          <PrimaryButton label={busy ? 'Mengirim kode…' : 'Kirim Kode Login'} onPress={sendOtp} />
        ) : (
          <View style={{ gap: 10 }}>
            <PrimaryButton
              label={busy ? 'Memverifikasi…' : 'Masuk'}
              onPress={verifyOtp}
            />
            <Pressable onPress={sendOtp}>
              <Text style={styles.resend}>Kirim ulang kode</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.note}>
          Aman dan terenkripsi langsung ke Supabase PostgreSQL Anda.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 20, gap: 12, flex: 1, justifyContent: 'center' },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '700', marginTop: 8 },
  sub: { color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 20 },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: 50,
    backgroundColor: Colors.canvas,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    marginTop: 8,
  },
  googleBtnText: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.borderSubtle,
  },
  dividerText: {
    color: Colors.textMuted,
    fontSize: FontSize.caption,
  },
  label: {
    color: Colors.textMuted,
    fontSize: FontSize.caption,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    height: 50,
    fontSize: 16,
    color: Colors.textPrimary,
    backgroundColor: Colors.canvas,
  },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
  resend: { color: Colors.textPrimary, fontWeight: '600', textAlign: 'center' },
  note: { color: Colors.textMuted, fontSize: FontSize.body, textAlign: 'center', marginTop: 8 },
});
