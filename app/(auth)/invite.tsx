import { Pressable, SafeAreaView, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { Badge } from '../../components/ui/Badge';
import { PrimaryButton } from '../../components/ui/Button';
import { buildInviteMessage } from '../../lib/household';
import { useAuth } from '../../lib/auth-context';

export default function InviteScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const code = household?.invite_code ?? '—';
  const name = household?.name ?? 'Ruang Keluarga';

  const message = buildInviteMessage(name, code);

  async function shareWhatsApp() {
    const url = `whatsapp://send?text=${encodeURIComponent(message)}`;
    const can = await Linking.canOpenURL(url);
    if (can) {
      await Linking.openURL(url);
    } else {
      await Share.share({ message });
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Badge label="UNDANG PASANGAN" tone="paid" />
        <Text style={styles.title}>Ruang keluarga siap!</Text>
        <Text style={styles.sub}>
          Bagikan kode ini ke istri — dia cukup login lalu pilih “Gabung Ruang Keluarga”.
        </Text>

        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>KODE UNDANGAN</Text>
          <Text style={styles.code}>{code}</Text>
          <Text style={styles.codeSub}>{name}</Text>
        </View>

        <PrimaryButton label="Kirim via WhatsApp" onPress={shareWhatsApp} />
        <Pressable onPress={() => Share.share({ message })}>
          <Text style={styles.alt}>Bagikan via aplikasi lain</Text>
        </Pressable>
        <Pressable onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.alt}>Masuk ke Anggaran →</Text>
        </Pressable>

        <Text style={styles.note}>
          Murni share teks — tanpa WhatsApp API, tanpa biaya, tanpa review.
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
  codeCard: {
    backgroundColor: Colors.brandPrimary,
    borderRadius: Radius.lg,
    padding: 20,
    alignItems: 'center',
    gap: 4,
  },
  codeLabel: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  code: { color: Colors.white, fontSize: 36, fontWeight: '700', letterSpacing: 2 },
  codeSub: { color: Colors.borderStrong, fontSize: FontSize.body },
  alt: { color: Colors.textPrimary, fontWeight: '600', textAlign: 'center' },
  note: { color: Colors.textMuted, fontSize: FontSize.body, textAlign: 'center', marginTop: 8 },
});
