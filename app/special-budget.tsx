import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Plus from 'lucide-react-native/icons/plus';
import { Colors, FontSize, Radius } from '../constants/theme';
import { useAuth } from '../lib/auth-context';
import { formatRupiah, parseRupiahInput } from '../lib/format';
import { formatShortDate, defaultFlowType } from '../lib/zero-based';
import { isZeroBasedCashAccount } from '../lib/account';
import {
  useAccounts,
  useActiveCycle,
  useFundSpecialBudgetFromCycle,
  useSpecialBudgetFigures,
  useSpecialBudgets,
  useSpecialBudgetTransactions,
} from '../lib/queries';
import type { Txn } from '../lib/queries';
import {
  daysPastEnd,
  localISODate,
  specialBudgetStatus,
  specialBudgetStatusLabel,
} from '../lib/special-budget';
import { Badge } from '../components/ui/Badge';
import { MoneyInput } from '../components/ui/MoneyInput';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

const DESTINATION_COPY: Record<string, string> = {
  CYCLE: 'kembali ke siklus',
  ASSET: 'dipindah ke simpanan',
  NONE: 'tanpa sisa',
};

export default function SpecialBudgetDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;
  const budgetsQ = useSpecialBudgets(householdId);
  const figuresQ = useSpecialBudgetFigures(householdId);
  const txnsQ = useSpecialBudgetTransactions(householdId, id);
  const cycleQ = useActiveCycle(householdId);
  const accsQ = useAccounts(householdId);
  const fund = useFundSpecialBudgetFromCycle();

  const [fundOpen, setFundOpen] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const today = localISODate(new Date());
  const budget = budgetsQ.data?.find((b) => b.id === id);
  const figures = id ? figuresQ.data?.[id] : undefined;
  const cashAccounts = useMemo(
    () => (accsQ.data ?? []).filter((a) => a.is_active !== false && isZeroBasedCashAccount(a)),
    [accsQ.data]
  );
  const defaultAccountId =
    cashAccounts.find((a) => a.id === cycleQ.data?.primary_account_id)?.id ?? cashAccounts[0]?.id ?? null;
  const selectedAccountId = accountId ?? defaultAccountId;

  const failed = budgetsQ.isError || figuresQ.isError || txnsQ.isError || cycleQ.isError;
  const retry = () => {
    void budgetsQ.refetch();
    void figuresQ.refetch();
    void txnsQ.refetch();
    void cycleQ.refetch();
  };

  if (failed || budgetsQ.isLoading || !budget) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <TopBar onBack={() => router.back()} title="Anggaran Khusus" />
          {failed ? (
            <QueryError onRetry={retry} retrying={budgetsQ.isFetching || figuresQ.isFetching} />
          ) : budgetsQ.isLoading ? (
            <Text style={styles.muted}>Memuat anggaran khusus…</Text>
          ) : (
            <Text style={styles.muted}>Anggaran khusus tidak ditemukan.</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const status = specialBudgetStatus(budget, today);
  const closed = status === 'CLOSED';
  const statusBadge = specialBudgetStatusLabel(status);
  const fundsIn = figures?.fundsIn ?? 0;
  const spent = figures?.spent ?? 0;
  const remaining = figures?.remaining ?? 0;
  const deficit = !closed && remaining < 0;
  const sources = [
    { label: 'Pemasukan', value: figures?.fromIncome ?? 0 },
    { label: 'Dari siklus', value: figures?.fromCycle ?? 0 },
    { label: 'Dari simpanan', value: figures?.fromAssets ?? 0 },
    { label: 'Pinjaman', value: figures?.fromFinancing ?? 0 },
  ].filter((s) => s.value > 0);
  const range = `${formatShortDate(budget.start_date) ?? budget.start_date} – ${formatShortDate(budget.end_date) ?? budget.end_date}`;
  const cycle = cycleQ.data;
  const canFund = !closed && !!cycle && !cycle.closed_at;
  const amount = parseRupiahInput(amountText);

  async function submitFund() {
    setErr(null);
    if (!householdId || !cycle || !budget) return;
    if (!(amount > 0)) {
      setErr('Nominal harus lebih dari Rp 0.');
      return;
    }
    if (!selectedAccountId) {
      setErr('Pilih rekening bank atau e-wallet aktif.');
      return;
    }
    try {
      await fund.mutateAsync({
        householdId, budgetId: budget.id, cycleId: cycle.id, accountId: selectedAccountId, amount,
      });
      setAmountText('');
      setFundOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyisihkan dana.');
    }
  }

  const txns = txnsQ.data ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={figuresQ.isFetching || txnsQ.isFetching} onRefresh={retry} />}
      >
        <TopBar
          onBack={() => router.back()}
          title={budget.name}
          subtitle={`Anggaran khusus · ${range}`}
          right={!closed ? (
            <Pressable
              onPress={() => router.push({ pathname: '/special-budget-new', params: { id: budget.id } })}
              style={styles.editBtn}
              accessibilityRole="button"
            >
              <Text style={styles.editText}>Ubah</Text>
            </Pressable>
          ) : undefined}
        />
        <Badge label={deficit ? 'Minus' : statusBadge.label} tone={deficit ? 'pending' : statusBadge.tone} />

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{closed ? 'Ditutup' : deficit ? 'Kekurangan' : 'Sisa'}</Text>
          <Text style={styles.heroValue}>
            {closed
              ? formatRupiah(Math.abs(budget.closed_remaining ?? 0))
              : formatRupiah(Math.abs(remaining))}
          </Text>
          <Text style={styles.heroSub}>
            {closed
              ? `Sisa saat ditutup ${DESTINATION_COPY[budget.close_destination ?? 'NONE'] ?? ''}.`
              : deficit
                ? 'Belanja melebihi dana masuk; kekurangannya sudah memakai uang siklus.'
                : 'Ada di rekening, di luar angka siklus.'}
          </Text>
          <View style={styles.grid}>
            <View style={styles.gridCell}>
              <Text style={styles.gridLabel}>Dana masuk</Text>
              <Text style={[styles.gridValue, { color: Colors.positive }]}>{formatRupiah(fundsIn)}</Text>
            </View>
            <View style={styles.gridCell}>
              <Text style={styles.gridLabel}>Terpakai</Text>
              <Text style={[styles.gridValue, { color: Colors.negative }]}>{formatRupiah(spent)}</Text>
            </View>
          </View>
          {sources.length > 0 && (
            <Text style={styles.heroSub}>
              {sources.map((s) => `${s.label} ${formatRupiah(s.value)}`).join(' · ')}
            </Text>
          )}
        </View>

        {!closed && status === 'ENDED_OPEN' && (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Selesai {daysPastEnd(budget, today)} hari lalu</Text>
            <Text style={styles.noticeBody}>
              Tutup kalau sudah tidak ada transaksi susulan, atau ubah tanggal selesainya.
            </Text>
          </View>
        )}

        {canFund && (
          <View style={styles.card}>
            <Pressable
              onPress={() => setFundOpen((v) => !v)}
              style={styles.fundToggle}
              accessibilityRole="button"
            >
              <Plus size={16} color={Colors.textPrimary} />
              <Text style={styles.fundToggleText}>Tambah dana</Text>
            </Pressable>
            {fundOpen && (
              <View style={styles.fundBody}>
                <Text style={styles.noticeBody}>
                  Pemasukan (THR, bonus) atau pencairan simpanan: catat seperti biasa lalu pilih
                  “{budget.name}” di “Masuk ke”. Untuk menyisihkan dari siklus berjalan, isi di sini.
                </Text>
                <MoneyInput label={`DARI ${cycle!.name.toUpperCase()}`} value={amountText} onChangeText={setAmountText} />
                <View style={styles.chips}>
                  {cashAccounts.map((a) => (
                    <Pressable
                      key={a.id}
                      onPress={() => setAccountId(a.id)}
                      style={[styles.chip, selectedAccountId === a.id && styles.chipActive]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: selectedAccountId === a.id }}
                    >
                      <Text style={[styles.chipText, selectedAccountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.noticeBody}>
                  Tercatat sebagai alokasi di {cycle!.name}. Tidak ada uang yang berpindah rekening.
                </Text>
                {err && <Text style={styles.err}>{err}</Text>}
                <PrimaryButton
                  label={fund.isPending ? 'Menyimpan…' : `Sisihkan ${amount > 0 ? formatRupiah(amount) : ''}`.trim()}
                  onPress={fund.isPending ? undefined : submitFund}
                />
              </View>
            )}
          </View>
        )}

        <Text style={styles.section}>Transaksi</Text>
        {txnsQ.isLoading ? (
          <Text style={styles.muted}>Memuat transaksi…</Text>
        ) : txns.length === 0 ? (
          <Text style={styles.muted}>Belum ada transaksi di anggaran ini.</Text>
        ) : (
          <View style={styles.card}>
            {txns.map((t, i) => (
              <BudgetTxnRow
                key={t.id}
                txn={t}
                isLast={i === txns.length - 1}
                onPress={
                  t.cycle_id && t.cycle_id === cycle?.id
                    ? () => router.push({ pathname: '/transaction-edit', params: { id: t.id } })
                    : undefined
                }
              />
            ))}
          </View>
        )}

        {!closed && (
          <View style={styles.actions}>
            <View style={{ flex: 1 }}>
              <SecondaryButton
                label="Tutup"
                onPress={() => router.push({ pathname: '/special-budget-close', params: { id: budget.id } })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                label="Catat"
                onPress={() => router.push({ pathname: '/quick-add', params: { kind: 'out', budgetId: budget.id } })}
              />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TopBar({ onBack, title, subtitle, right }: { onBack: () => void; title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={onBack} style={styles.backBtn} accessibilityLabel="Kembali">
        <ArrowLeft size={18} color={Colors.textPrimary} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

function BudgetTxnRow({ txn, isLast, onPress }: { txn: Txn; isLast: boolean; onPress?: () => void }) {
  const flow = txn.flow_type ?? defaultFlowType(txn.direction, txn.obligation_id);
  const inflow = flow === 'OPERATING_INCOME' || flow === 'FINANCING_INFLOW' || flow === 'ASSET_RELEASE';
  const cancelled = txn.status === 'CANCELLED' || !!txn.cancelled_at;
  const meta = [
    formatShortDate(txn.release_date),
    flow === 'ASSET_ALLOCATION' ? 'Ke simpanan' : txn.categories?.name,
    txn.accounts?.name,
  ].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.txnRow, !isLast && styles.divided]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.txnName, cancelled && styles.cancelled]} numberOfLines={1}>{txn.name}</Text>
        <Text style={styles.txnMeta} numberOfLines={1}>{cancelled ? `Dibatalkan · ${meta}` : meta}</Text>
      </View>
      <Text style={[styles.txnAmount, { color: inflow ? Colors.paidText : Colors.pendingBorder }, cancelled && styles.cancelled]}>
        {inflow ? '+' : '−'}{formatRupiah(txn.actual_amount)}
      </Text>
    </Pressable>
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
  title: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700' },
  subtitle: { color: Colors.textSecondary, fontSize: FontSize.caption, marginTop: 2 },
  editBtn: {
    paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.borderSubtle, backgroundColor: Colors.surface,
  },
  editText: { color: Colors.textPrimary, fontSize: 12.5, fontWeight: '700' },
  hero: { backgroundColor: Colors.navy, borderRadius: Radius.lg, padding: 16, gap: 8 },
  heroLabel: { color: Colors.textOnDarkMuted, fontSize: FontSize.caption },
  heroValue: { color: Colors.textOnDark, fontSize: FontSize.heroNumeral, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroSub: { color: Colors.textOnDarkSecondary, fontSize: FontSize.caption, lineHeight: 16 },
  grid: { flexDirection: 'row', gap: 1, backgroundColor: Colors.borderOnDark, borderRadius: Radius.md, overflow: 'hidden', marginTop: 4 },
  gridCell: { flex: 1, backgroundColor: Colors.navyRaised, padding: 10, gap: 2 },
  gridLabel: { color: Colors.textOnDarkMuted, fontSize: FontSize.microLabel },
  gridValue: { fontSize: FontSize.microValue, fontWeight: '700', fontVariant: ['tabular-nums'] },
  notice: { backgroundColor: Colors.warningSoft, borderWidth: 1, borderColor: Colors.warningBorder, borderRadius: Radius.md, padding: 12, gap: 4 },
  noticeTitle: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },
  noticeBody: { color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 17 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle, paddingHorizontal: 14 },
  fundToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  fundToggleText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  fundBody: { gap: 10, paddingBottom: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.borderSubtle },
  chipActive: { borderColor: Colors.brandPrimary, borderWidth: 1.5 },
  chipText: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  chipTextActive: { color: Colors.textPrimary, fontWeight: '700' },
  section: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 4 },
  txnRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  divided: { borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  txnName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600' },
  txnMeta: { color: Colors.textSecondary, fontSize: FontSize.caption, marginTop: 2 },
  txnAmount: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cancelled: { textDecorationLine: 'line-through', color: Colors.textMuted },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  err: { color: Colors.pendingText, fontSize: FontSize.body },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
});
