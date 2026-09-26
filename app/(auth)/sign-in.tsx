import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { Badge } from '../../components/ui/Badge';
import { PrimaryButton } from '../../components/ui/Button';
import { supabase, requireSupabase } from '../../lib/supabase';

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'otp'>('email');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
          Login sekali via email — data Siklus, Tanggungan & Riwayat otomatis sama di dua HP
          secara real-time.
        </Text>

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
          Tanpa password, tanpa Google Console. Nanti bisa tambah “Lanjut dengan Google” tanpa
          mengubah akun ini.
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
  label: {
    color: Colors.textMuted,
    fontSize: FontSize.caption,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 8,
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
