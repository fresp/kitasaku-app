import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { Badge } from '../../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';
import { createHousehold, joinHouseholdByCode, previewHouseholdByCode, type HouseholdPreview } from '../../lib/household';
import { seedCycleWindow, seedHouseholdDefaults } from '../../lib/seed';
import { useAuth } from '../../lib/auth-context';

export default function SetupChoiceScreen() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  // Starts empty. Pre-filling "Keluarga Andra" meant a family that tapped
  // "Buat Baru" without reading the field created a household named after a
  // stranger; the placeholder says what shape to type without becoming a value.
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<HouseholdPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // What `seedHouseholdDefaults` is about to create. The old hint promised
  // "Siklus Okt 2026" — a month that was correct in October 2026 and a lie in
  // every month after.
  const seedWindow = useMemo(() => seedCycleWindow(), []);

  useEffect(() => {
    if (mode !== 'join') return;
    const normalized = code.trim().toUpperCase();
    if (normalized.length < 5) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const p = await previewHouseholdByCode(normalized);
        if (!cancelled) setPreview(p);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [code, mode]);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      if (mode === 'create') {
        if (name.trim().length < 3) throw new Error('Nama ruang keluarga minimal 3 huruf.');
        const hh = await createHousehold(name.trim());
        await seedHouseholdDefaults(hh.id);
        await refresh();
        router.replace({ pathname: '/(auth)/invite' });
        return;
      } else {
        if (code.trim().length < 5) throw new Error('Masukkan kode undangan dari pasangan.');
        await joinHouseholdByCode(code);
      }
      await refresh();
      router.replace('/(tabs)');
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Badge label="SETUP RUANG KELUARGA" />
        <Text style={styles.title}>Buat baru atau gabung?</Text>
        <Text style={styles.sub}>
          Satu HP bikin ruang keluarga, HP pasangan cukup masukkan kode undangan — datanya sama
          persis.
        </Text>

        <View style={styles.toggle}>
          <Pressable
            onPress={() => setMode('create')}
            style={[styles.opt, mode === 'create' && styles.optActive]}
          >
            <Text style={[styles.optText, mode === 'create' && styles.optTextActive]}>
              Buat Baru
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('join')}
            style={[styles.opt, mode === 'join' && styles.optActive]}
          >
            <Text style={[styles.optText, mode === 'join' && styles.optTextActive]}>
              Gabung
            </Text>
          </Pressable>
        </View>

        {mode === 'create' ? (
          <>
            <Text style={styles.label}>NAMA RUANG KELUARGA</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="mis. Keluarga Wijaya"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />
            <Text style={styles.hint}>
              {seedWindow
                ? `${seedWindow.name} + kategori & akun standar otomatis dibuatkan. Tanggal siklusnya bisa diubah di Ruang Keluarga.`
                : 'Kategori & akun standar otomatis dibuatkan.'}
            </Text>
          </>
        ) : (
          <>
            {/* The example is deliberately generic. The code is generated from
                the household name (`lib/household.ts`), so every family's
                prefix differs — pinning "KEL-782" told everyone whose family
                is not called "Keluarga …" that they had the wrong code. */}
            <Text style={styles.label}>KODE UNDANGAN (mis. ABC-123)</Text>
            <TextInput
              value={code}
              onChangeText={(t) => {
                setCode(t.toUpperCase());
                setPreview(null);
              }}
              placeholder="ABC-123"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
              style={styles.input}
            />
            {checking && <Text style={styles.hint}>Mengecek kode…</Text>}
            {!checking && preview && (
              <View style={styles.preview}>
                <Text style={styles.previewTitle}>✓ {preview.name}</Text>
                <Text style={styles.hint}>
                  {preview.active_count > 0
                    ? `${preview.active_count} anggota • Bergabung sebagai Pasangan`
                    : 'Kode valid • Bergabung sebagai Pasangan'}
                </Text>
              </View>
            )}
            {!checking && code.trim().length >= 5 && !preview && (
              <Text style={styles.hintBad}>Kode tidak ditemukan. Cek lagi ya.</Text>
            )}
            <Text style={styles.hint}>Minta kodenya via WhatsApp dari pasangan kamu.</Text>
          </>
        )}

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}

        <PrimaryButton
          label={busy ? 'Memproses…' : mode === 'create' ? 'Buat Ruang Keluarga' : 'Gabung Sekarang'}
          onPress={submit}
        />
        <SecondaryButton label="Nanti Saja (mode offline)" onPress={() => router.replace('/(tabs)')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 20, gap: 12, flex: 1, justifyContent: 'center' },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '700', marginTop: 8 },
  sub: { color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 20 },
  toggle: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, flexDirection: 'row', padding: 4 },
  opt: { flex: 1, paddingVertical: 10, borderRadius: Radius.pill, alignItems: 'center' },
  optActive: { backgroundColor: Colors.surface },
  optText: { color: Colors.textMuted, fontWeight: '600' },
  optTextActive: { color: Colors.textPrimary },
  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
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
  hint: { color: Colors.textMuted, fontSize: FontSize.body },
  hintBad: { color: Colors.pendingText, fontSize: FontSize.body, fontWeight: '600' },
  preview: { backgroundColor: Colors.paidBg, borderRadius: Radius.md, padding: 12, gap: 2 },
  previewTitle: { color: Colors.paidText, fontSize: 15, fontWeight: '700' },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
