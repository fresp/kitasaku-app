import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import AlertTriangle from 'lucide-react-native/icons/triangle-alert';
import Check from 'lucide-react-native/icons/check';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useActiveCycle, useCategories, useTransactionLedger, useUpdateCategory } from '../lib/queries';
import { budgetHealthStatus, formatShortDate } from '../lib/zero-based';
import { categoryIconName } from '../lib/category-icon';
import { Badge } from '../components/ui/Badge';
import { BrandIcon } from '../components/ui/BrandIcon';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

/**
 * Screen 10 — Detail Kategori.
 *
 * The "Ubah pagu" control edits the category's `monthly_budget`, which is a
 * plan for future cycles: changing it does not retroactively change what was
 * spent, so the health block keeps reporting against the pagu that was in force
 * for the transactions shown until the family reloads. The screen says so.
 */
export default function CategoryDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const cycleId = cycleQ.data?.id;
  const catsQ = useCategories(householdId);
  const ledgerQ = useTransactionLedger(householdId, cycleId, 'actual');
  const updateCategory = useUpdateCategory();

  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetText, setBudgetText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const cat = useMemo(() => (catsQ.data ?? []).find((c) => c.id === id), [catsQ.data, id]);

  // Only rows that were actually executed count against the pagu; a PENDING row
  // is a plan, and this screen answers "what has this category cost so far?".
  const items = useMemo(
    () => (ledgerQ.data ?? []).filter((t) => t.category_id === id && t.direction === 'EXPENSE'),
    [ledgerQ.data, id]
  );
  const paidItems = items.filter((t) => t.status === 'PAID');
  const spent = paidItems.reduce((s, t) => s + t.actual_amount, 0);
  const budget = cat?.monthly_budget ?? 0;
  const health = budgetHealthStatus(spent, budget);

  const cycleLabel = cycleQ.data?.name ?? 'Siklus aktif';
  const over = health.overAmount;

  async function saveBudget() {
    setErr(null);
    if (!cat) return;
    const next = parseInt(budgetText.replace(/[^0-9]/g, '') || '0', 10);
    try {
      await updateCategory.mutateAsync({ id: cat.id, monthlyBudget: next });
      setEditingBudget(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan pagu.');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={20} color={Colors.textPrimary} />
          </Pressable>
          <BrandIcon
            name={categoryIconName({
              name: cat?.name ?? '',
              type: cat?.type ?? 'EXPENSE',
              systemRole: cat?.system_role ?? null,
              icon: cat?.icon,
            })}
            size={22}
            label=""
          />
          <Text style={[styles.title, { flexShrink: 1 }]} numberOfLines={1}>
            {cat?.name ?? 'Kategori'}
          </Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => {
              setBudgetText(String(budget));
              setEditingBudget((v) => !v);
              setErr(null);
            }}
            style={styles.editBtn}
          >
            <Text style={styles.editText}>{editingBudget ? 'Tutup' : 'Ubah pagu'}</Text>
          </Pressable>
        </View>

        {cat?.is_system && (
          <View style={styles.systemNote}>
            <Text style={styles.systemNoteText}>
              Kategori sistem — dipakai ledger untuk klasifikasi. Namanya boleh diubah,
              tapi tidak bisa dihapus.
            </Text>
          </View>
        )}

        {editingBudget && (
          <View style={styles.form}>
            <Text style={styles.formLabel}>PAGU BULANAN</Text>
            <TextInput
              value={budgetText}
              onChangeText={setBudgetText}
              keyboardType="number-pad"
              placeholder="1800000"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />
            <Text style={styles.hint}>
              Pagu baru berlaku untuk siklus berikutnya: {formatRupiah(parseInt(budgetText.replace(/[^0-9]/g, '') || '0', 10))}
            </Text>
            <PrimaryButton
              label={updateCategory.isPending ? 'Menyimpan…' : 'Simpan Pagu'}
              onPress={saveBudget}
            />
            <SecondaryButton label="Batal" onPress={() => setEditingBudget(false)} />
          </View>
        )}

        <View style={styles.hero}>
          <Badge
            label={
              over > 0
                ? `MELEBIHI RENCANA (+${formatRupiah(over)})`
                : health.label
            }
            tone={health.tone}
          />
          <Text style={styles.spent}>{formatRupiah(spent)}</Text>
          <Text style={styles.limit}>
            {budget > 0
              ? `terpakai dari pagu ${formatRupiah(budget)} · ${health.ratioPct}%`
              : 'tanpa pagu — set pagu untuk mengukur realisasi'}
          </Text>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width: `${health.status === 'NO_BUDGET' ? 100 : Math.max(2, Math.min(100, health.ratioPct))}%` as any,
                  backgroundColor: health.status === 'OVER'
                    ? Colors.pendingBorder
                    : health.status === 'WATCH'
                      ? Colors.alertText
                      : Colors.paidText,
                },
              ]}
            />
          </View>
          <Text style={styles.heroSub}>
            {cycleLabel} · {paidItems.length} transaksi tercatat
            {items.length > paidItems.length ? ` (${items.length - paidItems.length} belum dieksekusi)` : ''}
          </Text>
        </View>

        <Text style={styles.section}>Daftar belanja kategori ini</Text>

        {ledgerQ.isLoading && <Text style={styles.muted}>Memuat transaksi…</Text>}

        {items.map((t) => {
          const executed = t.status === 'PAID';
          const date = formatShortDate(t.release_date);
          return (
            <View key={t.id} style={styles.row}>
              <View style={styles.iconBox}>
                <Text style={styles.iconGlyph}>{t.direction === 'INCOME' ? '↓' : '↑'}</Text>
              </View>
              <View style={styles.rowMid}>
                <Text style={styles.rowName} numberOfLines={1}>{t.name}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {date ?? 'Belum dieksekusi'} · {t.accounts?.name ?? 'Tanpa akun'}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowAmount}>
                  {formatRupiah(executed ? t.actual_amount : t.planned_amount)}
                </Text>
                {executed ? (
                  <View style={styles.paidPill}>
                    <Check size={10} color={Colors.paidText} strokeWidth={3} />
                    <Text style={styles.paidText}>Sudah dibayar</Text>
                  </View>
                ) : (
                  <Badge label="Belum bayar" tone="pending" />
                )}
              </View>
            </View>
          );
        })}

        {!ledgerQ.isLoading && items.length === 0 && (
          <View style={styles.emptyBox}>
            <BrandIcon name="empty-belum-ada-transaksi" size={72} label="" />
            <Text style={styles.muted}>Belum ada transaksi di kategori ini.</Text>
          </View>
        )}

        {over > 0 && (
          <View style={styles.insight}>
            <AlertTriangle size={18} color={Colors.alertText} />
            <Text style={styles.insightText}>
              Melampaui rencana {health.ratioPct}%. Sesuaikan pagu bulan depan, atau geser sisa
              kas dari kategori yang masih surplus.
            </Text>
          </View>
        )}

        {health.status === 'NO_BUDGET' && spent > 0 && (
          <View style={styles.insight}>
            <AlertTriangle size={18} color={Colors.alertText} />
            <Text style={styles.insightText}>
              Kategori ini belum punya pagu, jadi pengeluaran tidak bisa dinilai aman atau
              berlebih. Tetapkan pagu lewat tombol &ldquo;Ubah pagu&rdquo;.
            </Text>
          </View>
        )}

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: {
    width: 32, height: 32, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '600', flexShrink: 1 },
  editBtn: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle,
    borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8,
  },
  editText: { color: Colors.textPrimary, fontSize: 12, fontWeight: '600' },
  systemNote: {
    backgroundColor: Colors.financingBg, borderWidth: 1, borderColor: Colors.financingBorder,
    borderRadius: Radius.md, padding: 12,
  },
  systemNoteText: { color: Colors.financingText, fontSize: FontSize.caption, lineHeight: 17 },
  form: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14, gap: 8,
  },
  formLabel: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  input: {
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary,
    backgroundColor: Colors.canvas, fontVariant: ['tabular-nums'],
  },
  hint: { color: Colors.textSecondary, fontSize: FontSize.caption },
  hero: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 16, gap: 8,
  },
  spent: { color: Colors.textPrimary, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  limit: { color: Colors.textSecondary, fontSize: 13 },
  track: { height: 8, borderRadius: 4, backgroundColor: Colors.subtle, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  heroSub: { color: Colors.textMuted, fontSize: 12 },
  section: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
  row: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 12, flexDirection: 'row',
    alignItems: 'center', gap: 10,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.subtle,
    alignItems: 'center', justifyContent: 'center',
  },
  iconGlyph: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  rowMid: { flex: 1, gap: 2 },
  rowName: { color: Colors.textPrimary, fontSize: 14, fontWeight: '500' },
  rowMeta: { color: Colors.textMuted, fontSize: 12 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowAmount: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  paidPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  paidText: { color: Colors.paidText, fontSize: FontSize.microLabel, fontWeight: '600' },
  insight: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: Colors.alertBg, borderWidth: 1, borderColor: Colors.financingBorder,
    borderRadius: Radius.md, padding: 12,
  },
  insightText: { flex: 1, color: Colors.alertText, fontSize: 13, lineHeight: 18 },
  emptyBox: { alignItems: 'center', paddingVertical: 16, gap: 10 },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
});
