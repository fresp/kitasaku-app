import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Calendar from 'lucide-react-native/icons/calendar';
import { Colors, FontSize, Radius } from '../constants/theme';
import { useAuth } from '../lib/auth-context';
import { longDateFullLabel } from '../lib/obligation';
import { useCreateSpecialBudget, useSpecialBudgets, useUpdateSpecialBudget } from '../lib/queries';
import { localISODate, validateSpecialBudgetInput } from '../lib/special-budget';
import { PrimaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

type Field = 'start' | 'end';

/**
 * Buka (or, with ?id, ubah) an Anggaran Khusus. Only a name and two dates:
 * money is added afterwards, when it actually arrives, so nothing here asks
 * where the money will come from.
 */
export default function SpecialBudgetFormScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;
  const budgetsQ = useSpecialBudgets(householdId);
  const existing = id ? budgetsQ.data?.find((b) => b.id === id) : undefined;
  const create = useCreateSpecialBudget();
  const update = useUpdateSpecialBudget();

  const today = localISODate(new Date());
  const [name, setName] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [picking, setPicking] = useState<Field | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const currentName = name ?? existing?.name ?? '';
  const currentStart = startDate ?? existing?.start_date ?? today;
  const currentEnd = endDate ?? existing?.end_date ?? today;
  const saving = create.isPending || update.isPending;

  async function save() {
    setErr(null);
    if (!householdId) {
      setErr('Login dulu untuk membuka anggaran khusus.');
      return;
    }
    const input = { name: currentName, startDate: currentStart, endDate: currentEnd };
    const invalid = validateSpecialBudgetInput(input);
    if (invalid) {
      setErr(invalid);
      return;
    }
    try {
      if (existing) {
        await update.mutateAsync({ householdId, budgetId: existing.id, ...input });
        router.back();
      } else {
        const created = await create.mutateAsync({ householdId, ...input });
        router.replace({ pathname: '/special-budget', params: { id: created.id } });
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan anggaran khusus.');
    }
  }

  if (id && budgetsQ.isError) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <QueryError onRetry={() => void budgetsQ.refetch()} retrying={budgetsQ.isFetching} />
        </View>
      </SafeAreaView>
    );
  }

  const pickerValue = new Date(`${picking === 'end' ? currentEnd : currentStart}T00:00:00`);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Kembali">
            <ArrowLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>{existing ? 'Ubah Anggaran Khusus' : 'Buka Anggaran Khusus'}</Text>
        </View>

        {!existing && (
          <View style={styles.explain}>
            <Place dot={Colors.accent} title="Siklus" body="untuk kebutuhan rutin bulan ini." />
            <Place
              dot={Colors.purple}
              title="Anggaran khusus"
              body="untuk belanja di luar rutin yang ada tanggalnya. Uangnya tetap di rekening asal."
              highlight
            />
            <Place dot={Colors.chartAsset} title="Simpanan" body="disimpan, tanpa tanggal." />
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>Nama</Text>
          <TextInput
            value={currentName}
            onChangeText={setName}
            placeholder="Contoh: Lebaran 2027, Liburan Bandung"
            placeholderTextColor={Colors.textMuted}
            maxLength={60}
            style={styles.input}
          />
        </View>

        <View style={styles.dates}>
          <DateField label="Mulai" iso={currentStart} onPress={() => setPicking('start')} />
          <DateField label="Selesai" iso={currentEnd} onPress={() => setPicking('end')} />
        </View>

        {picking && (
          <DateTimePicker
            value={pickerValue}
            mode="date"
            onValueChange={(_e: unknown, date: Date) => {
              const iso = localISODate(date);
              if (picking === 'start') {
                setStartDate(iso);
                if (iso > currentEnd) setEndDate(iso);
              } else {
                setEndDate(iso);
              }
              setPicking(null);
            }}
            onDismiss={() => setPicking(null)}
          />
        )}

        <Text style={styles.note}>
          Tanggal selesai hanya penanda. Anggaran tidak tertutup otomatis; transaksi susulan tetap
          bisa dicatat sampai kamu menutupnya.
        </Text>

        {!existing && (
          <Text style={styles.note}>
            Dana diisi setelah dibuka: tandai pemasukan (THR, bonus) atau pencairan simpanan saat
            mencatat, atau sisihkan dari siklus berjalan.
          </Text>
        )}

        {err && <Text style={styles.err}>{err}</Text>}

        <PrimaryButton
          label={saving ? 'Menyimpan…' : existing ? 'Simpan perubahan' : 'Buka anggaran'}
          onPress={saving ? undefined : save}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Place({ dot, title, body, highlight = false }: { dot: string; title: string; body: string; highlight?: boolean }) {
  return (
    <View style={[styles.place, highlight && styles.placeHighlight]}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={styles.placeText}>
        <Text style={styles.placeTitle}>{title}</Text> {body}
      </Text>
    </View>
  );
}

function DateField({ label, iso, onPress }: { label: string; iso: string; onPress: () => void }) {
  return (
    <View style={styles.dateBox}>
      <Text style={styles.label}>{label}</Text>
      <Pressable onPress={onPress} style={styles.dateBtn} accessibilityRole="button" accessibilityLabel={`Tanggal ${label.toLowerCase()}`}>
        <Calendar size={16} color={Colors.textPrimary} />
        <Text style={styles.dateText}>{longDateFullLabel(iso) ?? iso}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 14, paddingBottom: 40 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  title: { color: Colors.textPrimary, fontSize: 20, fontWeight: '700', flexShrink: 1 },
  explain: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle,
    borderRadius: Radius.lg, padding: 12, gap: 6,
  },
  place: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 4, paddingHorizontal: 6 },
  placeHighlight: { backgroundColor: Colors.purpleSoft, borderRadius: Radius.sm },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  placeText: { flex: 1, color: Colors.textSecondary, fontSize: 12.5, lineHeight: 18 },
  placeTitle: { color: Colors.textPrimary, fontWeight: '700' },
  field: { gap: 6 },
  label: { color: Colors.textSecondary, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 0.4 },
  input: {
    height: 48, borderWidth: 1, borderColor: Colors.borderStrong, borderRadius: Radius.md,
    paddingHorizontal: 12, fontSize: 15, fontWeight: '600', color: Colors.textPrimary, backgroundColor: Colors.surface,
  },
  dates: { flexDirection: 'row', gap: 8 },
  dateBox: { flex: 1, gap: 6 },
  dateBtn: {
    height: 48, borderWidth: 1, borderColor: Colors.borderStrong, borderRadius: Radius.md,
    paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface,
  },
  dateText: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  note: { color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 17 },
  err: { color: Colors.pendingText, fontSize: FontSize.body },
});
