import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import CheckCircle2 from 'lucide-react-native/icons/check-circle-2';
import AlertTriangle from 'lucide-react-native/icons/alert-triangle';
import Landmark from 'lucide-react-native/icons/landmark';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useActiveCycle,
  useCategories,
  useCycleReconciliation,
  useCycleReconciliationPreview,
  useFinalizeCycleReconciliation,
} from '../lib/queries';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

function parseAmount(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

export default function ReconciliationScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const cycle = cycleQ.data;
  const categoriesQ = useCategories(householdId);
  const savedQ = useCycleReconciliation(householdId, cycle?.id);
  const [closingText, setClosingText] = useState('');
  const [closingTouched, setClosingTouched] = useState(false);
  const savedClosingText = savedQ.data?.closing_stated != null ? String(savedQ.data.closing_stated) : '';
  const formClosingText = closingTouched ? closingText : savedClosingText;
  const closing = parseAmount(formClosingText);
  const previewQ = useCycleReconciliationPreview(householdId, cycle?.id, closing);
  const finalize = useFinalizeCycleReconciliation();
  const [err, setErr] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<{ sweptAmount: number; sweptAccountCount: number; sweepSkipped: boolean } | null>(null);
  const sweepPolicy = household?.sweep_policy ?? 'OFFERED';
  const [sweepRequested, setSweepRequested] = useState(false);

  const untrackedCategoryId = useMemo(
    () => categoriesQ.data?.find((c) => c.system_role === 'UNTRACKED')?.id ?? null,
    [categoriesQ.data]
  );

  const result = previewQ.data;
  const preview = result?.preview;
  const saved = savedQ.data;
  const issues = result?.issues ?? [];
  // A previously saved row is authoritative. The form becomes read-only and
  // must not offer a second write for the same cycle.
  // The RPC computes current-cycle deltas atomically. Do not block here based on
  // a guessed client-side candidate list: REQUIRED must still allow a close when
  // there is nothing to sweep, and the database is the authority in races.
  const blocked = issues.length > 0 || closing === null || !result?.primaryAccount || !!saved;
  const isLoading = cycleQ.isLoading || categoriesQ.isLoading || savedQ.isLoading || previewQ.isLoading;
  const displayDelta = saved?.delta ?? preview?.delta;
  const displayRecordedNet = saved?.recorded_net ?? preview?.recordedNet;
  const displayOpening = saved?.opening_stated ?? preview?.openingStated;

  async function submit() {
    setErr(null);
    if (!householdId || !cycle?.id) {
      setErr('Belum ada siklus aktif untuk direkonsiliasi.');
      return;
    }
    if (saved) {
      setErr('Siklus ini sudah direkonsiliasi.');
      return;
    }
    if (!result?.primaryAccount || !preview || blocked) {
      setErr('Selesaikan temuan di atas sebelum menyimpan rekonsiliasi.');
      return;
    }
    try {
      const closed = await finalize.mutateAsync({
        householdId,
        cycleId: cycle.id,
        accountId: result.primaryAccount.id,
        openingStated: preview.openingStated,
        closingStated: preview.closingStated!,
        recordedNet: preview.recordedNet,
        delta: preview.delta ?? 0,
        categoryId: untrackedCategoryId,
        sweepRequested,
      });
      setCloseResult({
        sweptAmount: closed.swept_amount,
        sweptAccountCount: closed.swept_account_count,
        sweepSkipped: closed.sweep_skipped,
      });
      await savedQ.refetch();
    } catch (e: any) {
      setErr(e?.message ?? 'Rekonsiliasi belum tersimpan.');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={cycleQ.isFetching || previewQ.isFetching || savedQ.isFetching}
            onRefresh={() => {
              void cycleQ.refetch();
              void savedQ.refetch();
              void previewQ.refetch();
            }}
          />
        }
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={20} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>TUTUP SIKLUS · REKONSILIASI</Text>
            <Text style={styles.title}>Cek Saldo Akun</Text>
          </View>
        </View>

        {previewQ.isError && <QueryError onRetry={() => previewQ.refetch()} retrying={previewQ.isFetching} message="Proyeksi rekonsiliasi belum bisa dibaca. Datamu tidak hilang." />}
        {cycleQ.isError && <QueryError onRetry={() => cycleQ.refetch()} retrying={cycleQ.isFetching} message="Siklus aktif belum bisa dibaca." />}

        {!cycle && !cycleQ.isLoading && <Text style={styles.muted}>Belum ada siklus aktif.</Text>}
        {cycle && !cycle.primary_account_id && (
          <View style={styles.warningCard}>
            <AlertTriangle size={20} color={Colors.alertText} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Akun primer belum dipilih</Text>
              <Text style={styles.body}>Pilih rekening BANK sebagai acuan sebelum saldo bisa dicocokkan.</Text>
            </View>
          </View>
        )}

        {cycle && result?.primaryAccount && (
          <View style={styles.accountCard}>
            <View style={styles.iconCircle}><Landmark size={18} color={Colors.textPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>AKUN PRIMER</Text>
              <Text style={styles.accountName}>{result.primaryAccount.name}</Text>
              <Text style={styles.muted}>Bank · {cycle.name}</Text>
            </View>
          </View>
        )}

        {saved && (
          <View style={styles.successCard}>
            <CheckCircle2 size={21} color={Colors.paidText} />
            <View style={{ flex: 1 }}>
              <Text style={styles.successTitle}>Rekonsiliasi sudah tersimpan</Text>
              <Text style={styles.body}>
                Saldo akhir {formatRupiah(saved.closing_stated)} · {saved.delta === 0 ? 'cocok' : `selisih ${formatRupiah(Math.abs(saved.delta))}`}
              </Text>
            </View>
          </View>
        )}

        {!saved && cycle && result?.primaryAccount && (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>SALDO AKHIR MENURUT BANK</Text>
              <TextInput
                value={formClosingText}
                onChangeText={(value) => {
                  setClosingTouched(true);
                  setClosingText(value);
                }}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                style={styles.amountInput}
              />
              <Text style={styles.muted}>Masukkan angka saldo saat siklus benar-benar ditutup.</Text>
            </View>

            {preview && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Pratinjau rekonsiliasi</Text>
                <Metric label="Saldo awal" value={displayOpening === null || displayOpening === undefined ? 'Belum ada jangkar' : formatRupiah(displayOpening)} />
                <Metric label="Pergerakan tercatat" value={formatSigned(displayRecordedNet ?? 0)} />
                <Metric label="Selisih" value={displayDelta === null || displayDelta === undefined ? 'Menunggu saldo akhir' : formatSigned(displayDelta)} tone={displayDelta === 0 ? 'good' : 'warn'} />
                {preview.openingStated === null && <Text style={styles.note}>Ini siklus pertama. Saldo ini disimpan sebagai jangkar; selisih baru dihitung pada siklus berikutnya.</Text>}
                {cycle && !saved && (
                  <View style={styles.sweepCard}>
                    <Text style={styles.cardTitle}>Sapu akun saat tutup</Text>
                    <Text style={styles.note}>
                      {sweepPolicy === 'REQUIRED'
                        ? 'Wajib: selesaikan pemindahan delta positif akun kas sekunder ke akun primer.'
                        : 'Ditawarkan: delta positif akun kas sekunder dapat dipindahkan ke akun primer, atau dilewati.'}
                    </Text>
                    <Pressable
                      onPress={() => setSweepRequested((value) => !value)}
                      style={[styles.sweepToggle, sweepRequested && styles.sweepToggleActive]}
                    >
                      <Text style={[styles.sweepToggleText, sweepRequested && styles.sweepToggleTextActive]}>
                        {sweepRequested ? 'Sapu akun dipilih' : 'Sapu akun sekarang'}
                      </Text>
                    </Pressable>
                    {sweepPolicy === 'REQUIRED' && !sweepRequested && (
                      <Text style={styles.warningText}>Pilih sapu akun untuk menutup siklus.</Text>
                    )}
                  </View>
                )}
              </View>
            )}
            {closeResult && (
              <View style={styles.successCard}>
                <CheckCircle2 size={21} color={Colors.paidText} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.successTitle}>Siklus berhasil ditutup</Text>
                  <Text style={styles.body}>
                    {closeResult.sweepSkipped
                      ? 'Sapu akun dilewati sesuai pilihan.'
                      : `${closeResult.sweptAccountCount} akun disapu · ${formatRupiah(closeResult.sweptAmount)}`}
                  </Text>
                </View>
              </View>
            )}

            {issues.length > 0 && (
              <View style={styles.warningCard}>
                <AlertTriangle size={20} color={Colors.alertText} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.cardTitle}>Belum bisa ditutup</Text>
                  {issues.map((issue) => (
                    <Text key={issue.kind} style={styles.body}>{issueLabel(issue.kind, issue.count)}</Text>
                  ))}
                  <Text style={styles.note}>Perbaiki transaksi tersebut dulu. Jangan menutupinya dengan penyesuaian saldo.</Text>
                </View>
              </View>
            )}

            {err && <Text style={styles.error}>{err}</Text>}
            <PrimaryButton label={finalize.isPending ? 'Menutup…' : 'Tutup Siklus'} onPress={blocked || finalize.isPending ? undefined : submit} />
            <SecondaryButton label="Batal" onPress={() => router.back()} />
          </>
        )}

        {isLoading && <Text style={styles.muted}>Memuat data rekonsiliasi…</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.body}>{label}</Text>
      <Text style={[styles.metricValue, tone === 'good' && styles.good, tone === 'warn' && styles.warn]}>{value}</Text>
    </View>
  );
}

function formatSigned(value: number): string {
  return `${value < 0 ? '−' : '+'}${formatRupiah(Math.abs(value))}`;
}

function issueLabel(kind: 'PENDING' | 'NULL_ACCOUNT' | 'OUTSIDE_CYCLE_PRIMARY', count: number): string {
  if (kind === 'PENDING') return `${count} transaksi belum dieksekusi.`;
  if (kind === 'NULL_ACCOUNT') return `${count} transaksi belum memiliki akun.`;
  return `${count} transaksi akun primer berada di luar siklus.`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 16, gap: 12, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.subtle },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700', marginTop: 2 },
  accountCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: Radius.md, backgroundColor: Colors.subtle, borderWidth: 1, borderColor: Colors.borderSubtle },
  iconCircle: { width: 38, height: 38, borderRadius: Radius.pill, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  accountName: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700', marginTop: 2 },
  card: { gap: 10, padding: 16, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle },
  label: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.7 },
  cardTitle: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700' },
  body: { color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 19 },
  muted: { color: Colors.textMuted, fontSize: FontSize.caption },
  amountInput: { color: Colors.textPrimary, fontSize: 28, fontWeight: '700', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: Colors.borderStrong },
  metric: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 5 },
  metricValue: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700', textAlign: 'right' },
  good: { color: Colors.paidText },
  warn: { color: Colors.alertText },
  note: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  warningCard: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: Radius.md, backgroundColor: Colors.alertBg, borderWidth: 1, borderColor: Colors.financingBorder },
  successCard: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: Radius.md, backgroundColor: Colors.paidBg, borderWidth: 1, borderColor: Colors.borderSubtle },
  successTitle: { color: Colors.paidText, fontSize: FontSize.cardTitle, fontWeight: '700' },
  error: { color: Colors.pendingText, fontSize: FontSize.body },
  sweepCard: { gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  sweepToggle: { borderWidth: 1, borderColor: Colors.borderStrong, borderRadius: Radius.md, padding: 11, backgroundColor: Colors.canvas },
  sweepToggleActive: { borderColor: Colors.paidText, backgroundColor: Colors.paidBg },
  sweepToggleText: { color: Colors.textSecondary, fontSize: FontSize.body, fontWeight: '700', textAlign: 'center' },
  sweepToggleTextActive: { color: Colors.paidText },
  warningText: { color: Colors.alertText, fontSize: FontSize.caption },
});
