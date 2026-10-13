import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import { Colors, FontSize, Radius } from '../constants/theme';
import { useAuth } from '../lib/auth-context';
import { formatRupiah } from '../lib/format';
import { isZeroBasedCashAccount } from '../lib/account';
import {
  useAccounts,
  useActiveCycle,
  useAssets,
  useCloseSpecialBudget,
  useSpecialBudgetFigures,
  useSpecialBudgets,
} from '../lib/queries';
import { closeOptions, type SpecialBudgetCloseDestination } from '../lib/special-budget';
import { PrimaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

/**
 * Tutup Anggaran Khusus. Closing is terminal and settles the remainder in one
 * database transaction (close_special_budget). The figure confirmed here is
 * sent along, so a partner's write in between makes the close fail instead of
 * settling a number nobody looked at.
 */
export default function SpecialBudgetCloseScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;
  const budgetsQ = useSpecialBudgets(householdId);
  const figuresQ = useSpecialBudgetFigures(householdId);
  const cycleQ = useActiveCycle(householdId);
  const accsQ = useAccounts(householdId);
  const assetsQ = useAssets(householdId);
  const close = useCloseSpecialBudget();

  const [destination, setDestination] = useState<SpecialBudgetCloseDestination | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const budget = budgetsQ.data?.find((b) => b.id === id);
  const figures = id ? figuresQ.data?.[id] : undefined;
  const remaining = figures?.remaining ?? 0;
  const cycle = cycleQ.data;
  const cashAccounts = useMemo(
    () => (accsQ.data ?? []).filter((a) => a.is_active !== false && isZeroBasedCashAccount(a)),
    [accsQ.data]
  );
  const selectedAccountId =
    accountId ?? cashAccounts.find((a) => a.id === cycle?.primary_account_id)?.id ?? cashAccounts[0]?.id ?? null;
  const assets = assetsQ.data ?? [];
  const selectedAssetId = assetId ?? assets[0]?.id ?? null;

  const failed = budgetsQ.isError || figuresQ.isError || cycleQ.isError || accsQ.isError || assetsQ.isError;
  const loading = budgetsQ.isLoading || figuresQ.isLoading;

  if (failed || loading || !budget || budget.closed_at) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <TopBar onBack={() => router.back()} title="Tutup Anggaran Khusus" />
          {failed ? (
            <QueryError
              onRetry={() => {
                void budgetsQ.refetch();
                void figuresQ.refetch();
                void cycleQ.refetch();
                void accsQ.refetch();
                void assetsQ.refetch();
              }}
            />
          ) : (
            <Text style={styles.muted}>
              {loading ? 'Memuat…' : budget?.closed_at ? 'Anggaran ini sudah ditutup.' : 'Anggaran khusus tidak ditemukan.'}
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const options = closeOptions(remaining);
  const even = options[0] === 'NONE';
  const deficit = remaining < 0;
  const chosen: SpecialBudgetCloseDestination | null = even ? 'NONE' : destination;
  const needsCycle = chosen === 'CYCLE' && deficit;
  const blocked =
    (needsCycle && (!cycle || !!cycle.closed_at)) ||
    (chosen === 'ASSET' && (!selectedAssetId || !selectedAccountId)) ||
    (needsCycle && !selectedAccountId);

  async function submit() {
    setErr(null);
    if (!householdId || !budget) return;
    if (!chosen) {
      setErr(deficit ? 'Pilih dari mana kekurangannya ditutup.' : 'Pilih ke mana sisanya dipindahkan.');
      return;
    }
    if (blocked) {
      setErr(needsCycle && !cycle ? 'Belum ada siklus berjalan untuk menutup kekurangan.' : 'Lengkapi pilihan rekening dan simpanan.');
      return;
    }
    try {
      await close.mutateAsync({
        householdId,
        budgetId: budget.id,
        expectedRemaining: remaining,
        destination: chosen,
        cycleId: cycle && !cycle.closed_at ? cycle.id : null,
        accountId: chosen === 'NONE' || (chosen === 'CYCLE' && !deficit) ? null : selectedAccountId,
        assetId: chosen === 'ASSET' ? selectedAssetId : null,
      });
      router.back();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menutup anggaran khusus.');
    }
  }

  const cycleCopy = deficit
    ? `Kekurangan dicatat sebagai alokasi di ${cycle?.name ?? 'siklus berjalan'}.`
    : 'Uangnya tetap di rekening dan kembali bebas dipakai siklus. Tidak ada transaksi baru.';
  const assetCopy = deficit
    ? 'Kekurangan ditutup dengan pencairan simpanan ke rekening.'
    : 'Dicatat sebagai pindah ke simpanan: uangnya keluar dari rekening ke simpanan yang dipilih.';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <TopBar onBack={() => router.back()} title={`Tutup ${budget.name}`} />

        <View style={styles.card}>
          <Row label="Dana masuk" value={`+${formatRupiah(figures?.fundsIn ?? 0)}`} color={Colors.paidText} />
          <Row label="Terpakai" value={`−${formatRupiah(figures?.spent ?? 0)}`} color={Colors.pendingBorder} />
          {(figures?.movedOut ?? 0) > 0 && (
            <Row label="Ke simpanan" value={`−${formatRupiah(figures?.movedOut ?? 0)}`} color={Colors.textSecondary} />
          )}
          <View style={styles.rule} />
          <Row
            label={deficit ? 'Kekurangan' : 'Sisa'}
            value={formatRupiah(Math.abs(remaining))}
            strong
            color={deficit ? Colors.pendingText : Colors.textPrimary}
          />
        </View>

        {even ? (
          <Text style={styles.note}>Tidak ada sisa. Menutup hanya mengunci anggaran ini.</Text>
        ) : (
          <>
            <Text style={styles.section}>{deficit ? 'Kekurangan ditutup dari mana?' : 'Sisa ini pindah ke mana?'}</Text>
            <Option
              title={`Siklus${cycle ? ` · ${cycle.name}` : ''}`}
              body={cycleCopy}
              dot={Colors.accent}
              selected={destination === 'CYCLE'}
              onPress={() => setDestination('CYCLE')}
            />
            <Option
              title="Simpanan"
              body={assetCopy}
              dot={Colors.chartAsset}
              selected={destination === 'ASSET'}
              onPress={() => setDestination('ASSET')}
            >
              {destination === 'ASSET' && (
                <View style={{ gap: 8 }}>
                  {assets.length === 0 ? (
                    <Text style={styles.note}>Belum ada simpanan aktif. Tambahkan dulu di menu Aset.</Text>
                  ) : (
                    <Chips items={assets.map((a) => ({ id: a.id, label: a.name }))} value={selectedAssetId} onChange={setAssetId} />
                  )}
                </View>
              )}
            </Option>

            {(destination === 'ASSET' || needsCycle) && cashAccounts.length > 0 && (
              <View style={{ gap: 8 }}>
                <Text style={styles.label}>{deficit && destination === 'ASSET' ? 'Cair ke rekening' : 'Rekening'}</Text>
                <Chips items={cashAccounts.map((a) => ({ id: a.id, label: a.name }))} value={selectedAccountId} onChange={setAccountId} />
              </View>
            )}
          </>
        )}

        <Text style={styles.note}>
          Setelah ditutup, transaksi di anggaran ini terkunci. Transaksi susulan dicatat ke siklus.
        </Text>

        {err && <Text style={styles.err}>{err}</Text>}

        <PrimaryButton
          label={close.isPending ? 'Menutup…' : 'Tutup anggaran'}
          onPress={close.isPending ? undefined : submit}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function TopBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={onBack} style={styles.backBtn} accessibilityLabel="Kembali">
        <ArrowLeft size={18} color={Colors.textPrimary} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
    </View>
  );
}

function Row({ label, value, color, strong = false }: { label: string; value: string; color: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.rowStrong]}>{label}</Text>
      <Text style={[styles.rowValue, { color }, strong && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

function Option({
  title, body, dot, selected, onPress, children,
}: {
  title: string; body: string; dot: string; selected: boolean; onPress: () => void; children?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.option, selected && styles.optionActive]}
    >
      <View style={styles.optionHead}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Text style={styles.optionTitle}>{title}</Text>
      </View>
      <Text style={styles.note}>{body}</Text>
      {children}
    </Pressable>
  );
}

function Chips({ items, value, onChange }: { items: { id: string; label: string }[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <View style={styles.chips}>
      {items.map((it) => (
        <Pressable
          key={it.id}
          onPress={() => onChange(it.id)}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === it.id }}
          style={[styles.chip, value === it.id && styles.chipActive]}
        >
          <Text style={[styles.chipText, value === it.id && styles.chipTextActive]}>{it.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  title: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700', flexShrink: 1 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 14, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rowLabel: { color: Colors.textSecondary, fontSize: FontSize.body },
  rowStrong: { color: Colors.textPrimary, fontWeight: '700' },
  rowValue: { fontSize: FontSize.body, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowValueStrong: { fontSize: 20 },
  rule: { height: 1, backgroundColor: Colors.borderSubtle },
  section: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  option: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, padding: 12, gap: 6 },
  optionActive: { borderColor: Colors.brandPrimary, borderWidth: 1.5 },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionTitle: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { color: Colors.textSecondary, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 0.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.borderSubtle, backgroundColor: Colors.surface },
  chipActive: { borderColor: Colors.brandPrimary, borderWidth: 1.5 },
  chipText: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  chipTextActive: { color: Colors.textPrimary, fontWeight: '700' },
  note: { color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 17 },
  err: { color: Colors.pendingText, fontSize: FontSize.body },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
});
