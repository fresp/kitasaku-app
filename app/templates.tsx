import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Plus from 'lucide-react-native/icons/plus';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Colors, FontSize, Radius } from '../constants/theme';
import { categoryIconName } from '../lib/category-icon';
import { BrandIcon } from '../components/ui/BrandIcon';
import { formatRupiah, formatRupiahShort } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useAccounts,
  useCategories,
  useCreateTemplate,
  useSetTemplateStatus,
  useTemplates,
  useUpdateTemplate,
} from '../lib/queries';
import type { Template } from '../lib/queries';
import { templateDueLabel } from '../lib/zero-based';
import { Badge } from '../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

/**
 * Screen 9 — Template Rutin.
 *
 * A template is a promise about future cycles, not a record of past spending,
 * so everything here edits the template only. Cloned transactions keep the
 * amount they were created with; changing a default affects the next cycle
 * that is opened, never one already running. The baseline figure is what the
 * next cycle will inherit, which is why it counts ACTIVE EXPENSE templates
 * only — an income template is not a commitment.
 */

function parseAmount(t: string): number {
  return parseInt(t.replace(/[^0-9]/g, '') || '0', 10);
}

interface Draft {
  id: string | null;
  name: string;
  amountText: string;
  dueDayText: string;
  categoryId: string | null;
  accountId: string | null;
}

const EMPTY_DRAFT: Draft = {
  id: null, name: '', amountText: '', dueDayText: '', categoryId: null, accountId: null,
};

export default function TemplatesScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const tmplQ = useTemplates(householdId);
  const catsQ = useCategories(householdId);
  const accsQ = useAccounts(householdId);
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const setStatus = useSetTemplateStatus();

  const [filter, setFilter] = useState<'ACTIVE' | 'COMPLETED'>('ACTIVE');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const all = useMemo(() => tmplQ.data ?? [], [tmplQ.data]);
  const list = useMemo(() => all.filter((t) => t.status === filter), [all, filter]);
  const activeList = all.filter((t) => t.status === 'ACTIVE');
  const activeCount = activeList.length;
  const doneCount = all.length - activeCount;
  const baseline = activeList
    .filter((t) => t.direction === 'EXPENSE')
    .reduce((s, t) => s + t.default_amount, 0);

  const categories = catsQ.data ?? [];
  const accounts = accsQ.data ?? [];
  const saving = createTemplate.isPending || updateTemplate.isPending;

  async function save() {
    setErr(null);
    if (!householdId || !draft) return;
    const amount = parseAmount(draft.amountText);
    const dueRaw = draft.dueDayText.trim();
    const dueDay = dueRaw === '' ? null : parseAmount(dueRaw);
    try {
      if (draft.id) {
        await updateTemplate.mutateAsync({
          id: draft.id,
          name: draft.name,
          defaultAmount: amount,
          dueDay,
          categoryId: draft.categoryId,
          accountId: draft.accountId,
        });
      } else {
        await createTemplate.mutateAsync({
          householdId,
          name: draft.name,
          defaultAmount: amount,
          dueDay,
          categoryId: draft.categoryId,
          accountId: draft.accountId,
          direction: 'EXPENSE',
        });
      }
      setDraft(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan template.');
    }
  }

  async function toggleStatus(t: Template) {
    setErr(null);
    try {
      await setStatus.mutateAsync({
        id: t.id,
        status: t.status === 'ACTIVE' ? 'COMPLETED' : 'ACTIVE',
      });
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal mengubah status template.');
    }
  }

  const editing = draft?.id ? all.find((t) => t.id === draft.id) : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>TEMPLATE RUTIN</Text>
            <Text style={styles.title}>Template transaksi rutin</Text>
          </View>
          <Pressable
            onPress={() => { setDraft(draft ? null : { ...EMPTY_DRAFT }); setErr(null); }}
            style={styles.addBtn}
          >
            <Plus size={14} color={Colors.textPrimary} />
            <Text style={styles.addText}>{draft ? 'Tutup' : 'Tambah'}</Text>
          </Pressable>
        </View>

        <View style={styles.baseline}>
          <Text style={styles.baselineEyebrow}>
            BASELINE BULANAN · {activeCount} TEMPLATE
          </Text>
          <View style={styles.baselineRow}>
            <Text style={styles.baselineAmount}>{formatRupiah(baseline)}</Text>
            <View style={styles.countPill}>
              <View style={styles.countDot} />
              <Text style={styles.countText}>{activeCount} aktif</Text>
            </View>
          </View>
          <Text style={styles.baselineNote}>
            Kebutuhan wajib yang otomatis di-clone saat siklus baru dibuka. Income tidak dihitung.
          </Text>
        </View>

        {draft && (
          <View style={styles.form}>
            <Text style={styles.formTitle}>
              {editing ? `Ubah ${editing.name}` : 'Template Baru'}
            </Text>
            <Text style={styles.formNote}>
              Perubahan hanya berlaku untuk siklus berikutnya. Transaksi yang sudah di-clone
              tidak ikut berubah.
            </Text>

            <Text style={styles.label}>NAMA POS</Text>
            <TextInput
              value={draft.name}
              onChangeText={(v) => setDraft({ ...draft, name: v })}
              placeholder="Wifi Rumah"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />

            <Text style={styles.label}>NOMINAL DEFAULT</Text>
            <TextInput
              value={draft.amountText}
              onChangeText={(v) => setDraft({ ...draft, amountText: v })}
              placeholder="385000"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              style={styles.input}
            />
            <Text style={styles.hint}>{formatRupiah(parseAmount(draft.amountText))}</Text>

            <Text style={styles.label}>JATUH TEMPO (TANGGAL, OPSIONAL)</Text>
            <TextInput
              value={draft.dueDayText}
              onChangeText={(v) => setDraft({ ...draft, dueDayText: v })}
              placeholder="5"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              style={styles.input}
            />
            <Text style={styles.hint}>
              {draft.dueDayText.trim() === ''
                ? 'Kosongkan kalau tanggalnya belum pasti.'
                : templateDueLabel(parseAmount(draft.dueDayText)) ?? 'Tanggal harus 1–31.'}
            </Text>

            <Text style={styles.label}>KATEGORI</Text>
            <View style={styles.chips}>
              {categories
                .filter((c) => c.type === 'EXPENSE')
                .map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    active={draft.categoryId === c.id}
                    onPress={() =>
                      setDraft({ ...draft, categoryId: draft.categoryId === c.id ? null : c.id })
                    }
                  />
                ))}
            </View>

            <Text style={styles.label}>AKUN</Text>
            <View style={styles.chips}>
              {accounts.map((a) => (
                <Chip
                  key={a.id}
                  label={a.name}
                  active={draft.accountId === a.id}
                  onPress={() =>
                    setDraft({ ...draft, accountId: draft.accountId === a.id ? null : a.id })
                  }
                />
              ))}
            </View>

            <PrimaryButton
              label={saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan Template'}
              onPress={save}
            />
            <SecondaryButton label="Batal" onPress={() => { setDraft(null); setErr(null); }} />
          </View>
        )}

        <View style={styles.tabs}>
          <Pressable
            onPress={() => setFilter('ACTIVE')}
            style={[styles.tab, filter === 'ACTIVE' && styles.tabOn]}
          >
            <Text style={[styles.tabText, filter === 'ACTIVE' && styles.tabTextOn]}>
              Aktif · {activeCount}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFilter('COMPLETED')}
            style={[styles.tab, filter === 'COMPLETED' && styles.tabOn]}
          >
            <Text style={[styles.tabText, filter === 'COMPLETED' && styles.tabTextOn]}>
              Selesai · {doneCount}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.section}>DAFTAR TEMPLATE</Text>

        {tmplQ.isLoading && <Text style={styles.muted}>Memuat template…</Text>}

        {list.map((t) => {
          const due = templateDueLabel(t.due_day);
          const meta = [
            t.categories?.name,
            t.accounts?.name,
            due,
          ].filter(Boolean).join(' · ');
          return (
            <View key={t.id} style={[styles.card, t.status === 'ACTIVE' && styles.cardActive]}>
              <View style={styles.cardTop}>
                <View style={styles.cardIcon}>
                  <BrandIcon
                    name={categoryIconName({
                      name: t.categories?.name ?? '',
                      type: t.direction,
                      icon: t.categories?.icon,
                    })}
                    size={19}
                    label=""
                  />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.cardName}>{t.name}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {meta || 'Tanpa kategori · Tanpa akun'}
                  </Text>
                </View>
                <Text style={styles.cardAmount}>{formatRupiahShort(t.default_amount)}</Text>
              </View>

              <View style={styles.cardBottom}>
                <Badge
                  label={t.status === 'ACTIVE' ? 'Aktif' : 'Selesai'}
                  tone={t.status === 'ACTIVE' ? 'alert' : 'default'}
                />
                <View style={{ flex: 1 }} />
                {t.status === 'ACTIVE' && (
                  <Pressable
                    onPress={() =>
                      setDraft({
                        id: t.id,
                        name: t.name,
                        amountText: String(t.default_amount),
                        dueDayText: t.due_day != null ? String(t.due_day) : '',
                        categoryId: t.category_id,
                        accountId: t.account_id,
                      })
                    }
                    hitSlop={8}
                  >
                    <Text style={styles.actionLink}>Edit</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => toggleStatus(t)} hitSlop={8}>
                  <Text style={styles.actionMuted}>
                    {t.status === 'ACTIVE' ? 'Tandai selesai' : 'Aktifkan lagi'}
                  </Text>
                </Pressable>
                <ChevronRight size={12} color={Colors.textMuted} />
              </View>
            </View>
          );
        })}

        {!tmplQ.isLoading && list.length === 0 && (
          <View style={styles.emptyBox}>
            <BrandIcon
              name={
                filter === 'ACTIVE'
                  ? 'empty-belum-ada-rencana'
                  : 'empty-data-tidak-ditemukan'
              }
              size={72}
              label=""
            />
            <Text style={styles.empty}>
              {filter === 'ACTIVE'
                ? 'Belum ada template aktif. Tambahkan pos rutin supaya siklus baru terisi otomatis.'
                : 'Belum ada template yang ditandai selesai.'}
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

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: {
    width: 32, height: 32, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.subtle, borderWidth: 1, borderColor: Colors.borderSubtle,
    borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 8,
  },
  addText: { color: Colors.textPrimary, fontSize: 12, fontWeight: '700' },
  baseline: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.lg, padding: 16, gap: 8 },
  baselineEyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  baselineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  baselineAmount: { color: Colors.white, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  countPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  countDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.paidBg },
  countText: { color: Colors.paidBg, fontSize: 11, fontWeight: '700' },
  baselineNote: { color: Colors.borderStrong, fontSize: FontSize.caption, lineHeight: 16 },
  form: {
    backgroundColor: Colors.canvas, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14, gap: 8,
  },
  formTitle: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700' },
  formNote: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },
  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1, marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  hint: { color: Colors.textSecondary, fontSize: FontSize.caption, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle,
    borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8,
  },
  chipOn: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: Colors.white, fontWeight: '700' },
  tabs: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, flexDirection: 'row', padding: 4, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: Radius.pill, alignItems: 'center' },
  tabOn: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle },
  tabText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '500' },
  tabTextOn: { color: Colors.textPrimary, fontWeight: '700' },
  section: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '600', letterSpacing: 0.8, marginTop: 4 },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 12, gap: 10,
  },
  cardActive: { borderColor: Colors.brandPrimary },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIcon: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.subtle,
    alignItems: 'center', justifyContent: 'center',
  },
  cardIconActive: { backgroundColor: Colors.brandPrimary },
  cardName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
  cardMeta: { color: Colors.textSecondary, fontSize: FontSize.caption },
  cardAmount: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionLink: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '700' },
  actionMuted: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700' },
  emptyBox: { paddingVertical: 16, alignItems: 'center', gap: 10 },
  empty: { color: Colors.textMuted, fontSize: FontSize.body },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
