import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Plus from 'lucide-react-native/icons/plus';
import Pencil from 'lucide-react-native/icons/pencil';
import Trash2 from 'lucide-react-native/icons/trash';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '../lib/queries';
import type { Category, CategorySystemRole } from '../lib/queries';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

/**
 * Screen "Kelola Kategori".
 *
 * System categories are split out of the user's list and shown first, because
 * they are not really the family's data — they are the app's vocabulary, and
 * burying them among custom rows invites an attempt to delete one. They can be
 * renamed but not removed; migration 006 enforces that with a trigger, and this
 * screen only mirrors the rule so the failure is a disabled control instead of
 * a database error.
 */

const SYSTEM_ROLE_HINT: Record<CategorySystemRole, string> = {
  DEBT_PAYMENT: 'Kewajiban · Tidak dapat dihapus',
  FINANCING_INFLOW: 'Financing inflow · Tidak dapat dihapus',
};

const TYPE_LABELS: Record<'EXPENSE' | 'INCOME' | 'INVESTMENT', string> = {
  EXPENSE: 'Pengeluaran',
  INCOME: 'Pemasukan',
  INVESTMENT: 'Investasi',
};

interface Draft {
  id: string | null;
  name: string;
  budgetText: string;
  type: 'EXPENSE' | 'INCOME' | 'INVESTMENT';
  isSystem: boolean;
}

const EMPTY_DRAFT: Draft = {
  id: null, name: '', budgetText: '', type: 'EXPENSE', isSystem: false,
};

function parseAmount(t: string): number {
  return parseInt(t.replace(/[^0-9]/g, '') || '0', 10);
}

export default function KelolaKategoriScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const catsQ = useCategories(householdId);
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const all = useMemo(() => catsQ.data ?? [], [catsQ.data]);
  const systemCats = all.filter((c) => c.is_system);
  const customCats = all.filter((c) => !c.is_system);

  const saving = createCategory.isPending || updateCategory.isPending;

  async function save() {
    setErr(null);
    if (!householdId || !draft) return;
    try {
      if (draft.id) {
        await updateCategory.mutateAsync({
          id: draft.id,
          name: draft.name,
          monthlyBudget: parseAmount(draft.budgetText),
          type: draft.type,
        });
      } else {
        await createCategory.mutateAsync({
          householdId,
          name: draft.name,
          monthlyBudget: parseAmount(draft.budgetText),
          type: draft.type,
        });
      }
      setDraft(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan kategori.');
    }
  }

  async function remove(c: Category) {
    setErr(null);
    setConfirmDelete(null);
    try {
      await deleteCategory.mutateAsync({ id: c.id, isSystem: c.is_system });
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menghapus kategori.');
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <Text style={styles.crumb}>My Profile / Kelola Kategori</Text>
        </View>

        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>MY PROFILE · PREFERENSI</Text>
            <Text style={styles.title}>Kelola Kategori</Text>
          </View>
          <Pressable
            onPress={() => { setDraft(draft ? null : { ...EMPTY_DRAFT }); setErr(null); }}
            style={styles.addBtn}
          >
            <Plus size={14} color={Colors.white} />
            <Text style={styles.addText}>{draft ? 'Tutup' : 'Tambah'}</Text>
          </Pressable>
        </View>
        <Text style={styles.supporting}>
          Atur kategori yang digunakan saat mencatat transaksi.
        </Text>

        {draft && (
          <View style={styles.form}>
            <Text style={styles.formTitle}>
              {draft.id ? `Ubah ${draft.name}` : 'Kategori Baru'}
            </Text>

            <Text style={styles.label}>NAMA KATEGORI</Text>
            <TextInput
              value={draft.name}
              onChangeText={(v) => setDraft({ ...draft, name: v })}
              placeholder="Hobi"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />

            {!draft.isSystem && (
              <>
                <Text style={styles.label}>JENIS</Text>
                <View style={styles.chips}>
                  {(['EXPENSE', 'INCOME', 'INVESTMENT'] as const).map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => setDraft({ ...draft, type: t })}
                      style={[styles.chip, draft.type === t && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, draft.type === t && styles.chipTextOn]}>
                        {TYPE_LABELS[t]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.label}>PAGU BULANAN</Text>
            <TextInput
              value={draft.budgetText}
              onChangeText={(v) => setDraft({ ...draft, budgetText: v })}
              placeholder="500000"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              style={styles.input}
            />
            <Text style={styles.hint}>
              {parseAmount(draft.budgetText) > 0
                ? formatRupiah(parseAmount(draft.budgetText))
                : 'Biarkan 0 kalau kategori ini tidak dipagui.'}
            </Text>

            <PrimaryButton
              label={saving ? 'Menyimpan…' : draft.id ? 'Simpan Perubahan' : 'Simpan Kategori'}
              onPress={save}
            />
            <SecondaryButton label="Batal" onPress={() => { setDraft(null); setErr(null); }} />
          </View>
        )}

        <Text style={styles.section}>KATEGORI YANG DIGUNAKAN</Text>

        <View style={styles.list}>
          {systemCats.map((c, i) => (
            <View key={c.id} style={[styles.row, i > 0 && styles.rowBordered]}>
              <View style={[styles.iconBox, c.system_role === 'FINANCING_INFLOW' && styles.iconBoxFinancing]}>
                <Text
                  style={[
                    styles.iconGlyph,
                    c.system_role === 'FINANCING_INFLOW' && styles.iconGlyphFinancing,
                  ]}
                >
                  {c.type === 'INCOME' ? '↓' : '↑'}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{c.name}</Text>
                  <View style={[styles.systemBadge, c.system_role === 'FINANCING_INFLOW' && styles.systemBadgeFinancing]}>
                    <Text
                      style={[
                        styles.systemBadgeText,
                        c.system_role === 'FINANCING_INFLOW' && styles.systemBadgeTextFinancing,
                      ]}
                    >
                      Sistem
                    </Text>
                  </View>
                </View>
                <Text
                  style={[
                    styles.type,
                    c.system_role === 'FINANCING_INFLOW' && { color: Colors.financingText },
                  ]}
                >
                  {c.system_role ? SYSTEM_ROLE_HINT[c.system_role] : 'Sistem · Tidak dapat dihapus'}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setDraft({
                    id: c.id, name: c.name, budgetText: String(c.monthly_budget),
                    type: c.type as Draft['type'], isSystem: true,
                  });
                  setErr(null);
                }}
                hitSlop={10}
              >
                <Pencil size={16} color={Colors.textMuted} />
              </Pressable>
            </View>
          ))}

          {customCats.map((c, i) => (
            <View key={c.id} style={[styles.row, (i > 0 || systemCats.length > 0) && styles.rowBordered]}>
              <View style={styles.iconBox}>
                <Text style={styles.iconGlyph}>{c.type === 'INCOME' ? '↓' : '↑'}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name}>{c.name}</Text>
                <Text style={styles.type}>
                  {TYPE_LABELS[c.type as Draft['type']] ?? c.type}
                  {c.monthly_budget > 0 ? ` · pagu ${formatRupiah(c.monthly_budget)}` : ' · tanpa pagu'}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setDraft({
                    id: c.id, name: c.name, budgetText: String(c.monthly_budget),
                    type: c.type as Draft['type'], isSystem: false,
                  });
                  setErr(null);
                }}
                hitSlop={10}
                style={styles.rowAction}
              >
                <Pencil size={16} color={Colors.textMuted} />
              </Pressable>
              {confirmDelete === c.id ? (
                <Pressable onPress={() => remove(c)} hitSlop={10} style={styles.rowAction}>
                  <Text style={styles.confirmText}>Yakin?</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setConfirmDelete(c.id)} hitSlop={10} style={styles.rowAction}>
                  <Trash2 size={16} color={Colors.textMuted} />
                </Pressable>
              )}
            </View>
          ))}
        </View>

        {!catsQ.isLoading && customCats.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>Belum ada kategori tambahan</Text>
            <Text style={styles.emptySub}>
              Tambahkan pos khusus seperti Hobi, Liburan, atau Renovasi.
            </Text>
            <Pressable onPress={() => setDraft({ ...EMPTY_DRAFT })} style={styles.emptyCta}>
              <Text style={styles.emptyCtaText}>Buat kategori pertama</Text>
            </Pressable>
          </View>
        )}

        {catsQ.isLoading && <Text style={styles.muted}>Memuat kategori…</Text>}

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
    width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  crumb: { color: Colors.textSecondary, fontSize: FontSize.caption },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.brandPrimary,
    borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 9,
  },
  addText: { color: Colors.white, fontSize: 11.5, fontWeight: '600' },
  supporting: { color: Colors.textSecondary, fontSize: 13 },
  form: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14, gap: 8,
  },
  formTitle: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700' },
  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1, marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary,
    backgroundColor: Colors.canvas,
  },
  hint: { color: Colors.textSecondary, fontSize: FontSize.caption, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    backgroundColor: Colors.subtle, borderRadius: Radius.pill,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  chipOn: { backgroundColor: Colors.brandPrimary },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: Colors.white },
  section: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 4 },
  list: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  rowBordered: { borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  iconBox: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.subtle,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  iconBoxFinancing: { backgroundColor: Colors.financingBg, borderColor: Colors.financingBorder },
  iconGlyph: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  iconGlyphFinancing: { color: Colors.financingText },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  type: { color: Colors.textMuted, fontSize: FontSize.caption },
  systemBadge: {
    backgroundColor: Colors.subtle, borderWidth: 1, borderColor: Colors.borderSubtle,
    borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2,
  },
  systemBadgeFinancing: { backgroundColor: Colors.financingBg, borderColor: Colors.financingBorder },
  systemBadgeText: { color: Colors.textSecondary, fontSize: 9.5, fontWeight: '700' },
  systemBadgeTextFinancing: { color: Colors.financingText },
  rowAction: { padding: 4 },
  confirmText: { color: Colors.pendingText, fontSize: FontSize.caption, fontWeight: '700' },
  emptyBox: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 16, gap: 6, alignItems: 'center',
  },
  emptyTitle: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  emptySub: { color: Colors.textMuted, fontSize: FontSize.caption, textAlign: 'center' },
  emptyCta: {
    marginTop: 4, backgroundColor: Colors.subtle, borderWidth: 1,
    borderColor: Colors.borderStrong, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  emptyCtaText: { color: Colors.textPrimary, fontSize: 11.5, fontWeight: '600' },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
});
