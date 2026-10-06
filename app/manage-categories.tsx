import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import Plus from 'lucide-react-native/icons/plus';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Trash2 from 'lucide-react-native/icons/trash';
import X from 'lucide-react-native/icons/x';
import Utensils from 'lucide-react-native/icons/utensils';
import Home from 'lucide-react-native/icons/house';
import Car from 'lucide-react-native/icons/car';
import Zap from 'lucide-react-native/icons/zap';
import GraduationCap from 'lucide-react-native/icons/graduation-cap';
import Heart from 'lucide-react-native/icons/heart';
import Sparkles from 'lucide-react-native/icons/sparkles';
import ShoppingBag from 'lucide-react-native/icons/shopping-bag';
import CircleDollarSign from 'lucide-react-native/icons/circle-dollar-sign';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import Layers from 'lucide-react-native/icons/layers';

import { Colors, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useActiveCycle,
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useTransactions,
  useUpdateCategory,
} from '../lib/queries';
import type { Category } from '../lib/queries';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

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
  icon: string | null;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  name: '',
  budgetText: '',
  type: 'EXPENSE',
  isSystem: false,
  icon: null,
};

function parseAmount(t: string): number {
  return parseInt(t.replace(/[^0-9]/g, '') || '0', 10);
}

function getCategoryVisual(name: string, type?: string) {
  const n = (name || '').toLowerCase();
  if (n.includes('makan') || n.includes('kuliner') || n.includes('food') || n.includes('minum')) {
    return { bg: '#FEE2E2', color: '#EF4444', glyph: Utensils };
  }
  if (n.includes('rumah') || n.includes('kos') || n.includes('home')) {
    return { bg: '#DCFCE7', color: '#10B981', glyph: Home };
  }
  if (n.includes('trans') || n.includes('bensin') || n.includes('ojol') || n.includes('parkir') || n.includes('mobil')) {
    return { bg: '#FFEDD5', color: '#F97316', glyph: Car };
  }
  if (n.includes('util') || n.includes('listrik') || n.includes('air') || n.includes('wifi') || n.includes('tagihan') || n.includes('pulsa')) {
    return { bg: '#E0F2FE', color: '#0284C7', glyph: Zap };
  }
  if (n.includes('didik') || n.includes('sekolah') || n.includes('kursus') || n.includes('buku') || n.includes('kuliah')) {
    return { bg: '#EDE9FE', color: '#8B5CF6', glyph: GraduationCap };
  }
  if (n.includes('sehat') || n.includes('obat') || n.includes('dokter') || n.includes('medis') || n.includes('klinik')) {
    return { bg: '#FCE7F3', color: '#EC4899', glyph: Heart };
  }
  if (n.includes('hibur') || n.includes('game') || n.includes('nonton') || n.includes('hobi') || n.includes('liburan')) {
    return { bg: '#FEF3C7', color: '#F59E0B', glyph: Sparkles };
  }
  if (n.includes('belanja') || n.includes('grocer') || n.includes('pasar') || n.includes('mall')) {
    return { bg: '#E0E7FF', color: '#4F46E5', glyph: ShoppingBag };
  }
  if (n.includes('kewajiban') || n.includes('hutang') || n.includes('cicil') || type === 'DEBT_PAYMENT') {
    return { bg: '#FEE2E2', color: '#DC2626', glyph: CircleDollarSign };
  }
  if (n.includes('invest') || n.includes('saham') || n.includes('reksa') || type === 'INVESTMENT') {
    return { bg: '#D1FAE5', color: '#059669', glyph: TrendingUp };
  }
  return { bg: '#F1F5F9', color: '#475569', glyph: Layers };
}

const PRESET_ICONS = [
  { label: 'Makanan', visual: { bg: '#FEE2E2', color: '#EF4444', glyph: Utensils } },
  { label: 'Rumah', visual: { bg: '#DCFCE7', color: '#10B981', glyph: Home } },
  { label: 'Transport', visual: { bg: '#FFEDD5', color: '#F97316', glyph: Car } },
  { label: 'Utilitas', visual: { bg: '#E0F2FE', color: '#0284C7', glyph: Zap } },
  { label: 'Pendidikan', visual: { bg: '#EDE9FE', color: '#8B5CF6', glyph: GraduationCap } },
  { label: 'Kesehatan', visual: { bg: '#FCE7F3', color: '#EC4899', glyph: Heart } },
  { label: 'Hiburan', visual: { bg: '#FEF3C7', color: '#F59E0B', glyph: Sparkles } },
  { label: 'Belanja', visual: { bg: '#E0E7FF', color: '#4F46E5', glyph: ShoppingBag } },
];

export default function ManageCategoriesScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;

  const catsQ = useCategories(householdId);
  const activeCycleQ = useActiveCycle(householdId);
  const txnsQ = useTransactions(householdId, activeCycleQ.data?.id);

  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const all = useMemo(() => catsQ.data ?? [], [catsQ.data]);

  // Transaction count per category
  const txCountByCat = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of txnsQ.data ?? []) {
      if (t.category_id) {
        map[t.category_id] = (map[t.category_id] ?? 0) + 1;
      }
    }
    return map;
  }, [txnsQ.data]);

  const saving = createCategory.isPending || updateCategory.isPending;

  function openCreate() {
    setDraft({ ...EMPTY_DRAFT });
    setErr(null);
    setConfirmDelete(null);
  }

  function openEdit(c: Category) {
    setDraft({
      id: c.id,
      name: c.name,
      budgetText: c.monthly_budget > 0 ? String(c.monthly_budget) : '',
      type: (c.type as Draft['type']) || 'EXPENSE',
      isSystem: !!c.is_system,
      icon: c.icon ?? null,
    });
    setErr(null);
    setConfirmDelete(null);
  }

  async function save() {
    setErr(null);
    if (!householdId || !draft) return;
    if (!draft.name.trim() || draft.name.trim().length < 2) {
      setErr('Nama kategori minimal 2 huruf.');
      return;
    }

    try {
      if (draft.id) {
        await updateCategory.mutateAsync({
          id: draft.id,
          name: draft.name.trim(),
          monthlyBudget: parseAmount(draft.budgetText),
          type: draft.type,
          icon: draft.icon,
        });
      } else {
        await createCategory.mutateAsync({
          householdId,
          name: draft.name.trim(),
          monthlyBudget: parseAmount(draft.budgetText),
          type: draft.type,
          icon: draft.icon,
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
      setDraft(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menghapus kategori.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Top Header Bar */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.navBtn}>
            <ChevronLeft size={22} color="#0B1527" />
          </Pressable>
          <Text style={styles.headerTitle}>Kategori</Text>
          <Pressable onPress={openCreate} style={styles.navBtn}>
            <Plus size={20} color="#0B1527" />
          </Pressable>
        </View>

        {/* Centered "+ Tambah Kategori" Pill */}
        <Pressable onPress={openCreate} style={styles.addCategoryPill}>
          <Plus size={16} color="#0B1527" strokeWidth={2.5} />
          <Text style={styles.addCategoryText}>Tambah Kategori</Text>
        </Pressable>

        {/* Categories List */}
        <View style={styles.listContainer}>
          {all.map((c, index) => {
            const visual = getCategoryVisual(c.name, c.type);
            const VisualGlyph = visual.glyph;
            const count = txCountByCat[c.id] ?? 0;
            const isLast = index === all.length - 1;

            return (
              <Pressable
                key={c.id}
                onPress={() => openEdit(c)}
                style={[styles.categoryRow, !isLast && styles.categoryRowBordered]}
              >
                {/* Pastel Squircle Category Icon */}
                <View style={[styles.categorySquircle, { backgroundColor: visual.bg }]}>
                  <VisualGlyph size={22} color={visual.color} />
                </View>

                {/* Category Info */}
                <View style={styles.categoryInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.categoryName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {c.is_system && (
                      <View style={styles.systemTag}>
                        <Text style={styles.systemTagText}>Sistem</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.categoryCount}>
                    {count} transaksi
                  </Text>
                </View>

                {/* Right Chevron */}
                <ChevronRight size={18} color="#94A3B8" />
              </Pressable>
            );
          })}
        </View>

        {catsQ.isLoading && (
          <Text style={styles.loadingText}>Memuat kategori…</Text>
        )}
      </ScrollView>

      {/* Add / Edit Category Modal Sheet */}
      <Modal
        visible={!!draft}
        transparent
        animationType="slide"
        onRequestClose={() => setDraft(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setDraft(null)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {draft?.id ? 'Ubah Kategori' : 'Tambah Kategori'}
              </Text>
              <Pressable onPress={() => setDraft(null)}>
                <X size={20} color={Colors.textSecondary} />
              </Pressable>
            </View>

            {draft && (
              <View style={{ gap: 14 }}>
                {/* Field: Nama Kategori */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.inputLabel}>NAMA KATEGORI *</Text>
                  <TextInput
                    value={draft.name}
                    onChangeText={(v) => setDraft({ ...draft, name: v })}
                    placeholder="Contoh: Makanan, Transportasi, Hiburan"
                    placeholderTextColor={Colors.textMuted}
                    style={styles.input}
                    autoFocus={!draft.id}
                  />
                </View>

                {/* Field: Jenis Kategori */}
                {!draft.isSystem && (
                  <View style={styles.fieldGroup}>
                    <Text style={styles.inputLabel}>JENIS</Text>
                    <View style={styles.typeRow}>
                      {(['EXPENSE', 'INCOME', 'INVESTMENT'] as const).map((t) => {
                        const selected = draft.type === t;
                        return (
                          <Pressable
                            key={t}
                            onPress={() => setDraft({ ...draft, type: t })}
                            style={[styles.typeChip, selected && styles.typeChipSelected]}
                          >
                            <Text
                              style={[
                                styles.typeChipText,
                                selected && styles.typeChipTextSelected,
                              ]}
                            >
                              {TYPE_LABELS[t]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* Field: Pagu Bulanan */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.inputLabel}>PAGU BULANAN (OPSIONAL)</Text>
                  <TextInput
                    value={draft.budgetText}
                    onChangeText={(v) => setDraft({ ...draft, budgetText: v })}
                    placeholder="Contoh: 1500000"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                  <Text style={styles.inputHelper}>
                    {parseAmount(draft.budgetText) > 0
                      ? `Pagu: ${formatRupiah(parseAmount(draft.budgetText))}`
                      : 'Kosongkan jika kategori ini tidak memiliki batasan pagu bulanan.'}
                  </Text>
                </View>

                {/* Preset Icon Preview */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.inputLabel}>IKON KATEGORI</Text>
                  <View style={styles.iconChoiceRow}>
                    {PRESET_ICONS.map((p) => {
                      const IconGlyph = p.visual.glyph;
                      const isCurrent = (draft.name || '').toLowerCase().includes(p.label.toLowerCase());
                      return (
                        <Pressable
                          key={p.label}
                          onPress={() => {
                            if (!draft.name) {
                              setDraft({ ...draft, name: p.label });
                            }
                          }}
                          style={[
                            styles.presetIconTile,
                            isCurrent && styles.presetIconTileActive,
                          ]}
                        >
                          <View style={[styles.presetIconBox, { backgroundColor: p.visual.bg }]}>
                            <IconGlyph size={18} color={p.visual.color} />
                          </View>
                          <Text style={styles.presetIconLabel}>{p.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {err && (
                  <View style={styles.errBox}>
                    <Text style={styles.errText}>{err}</Text>
                  </View>
                )}

                {/* Action Buttons */}
                <View style={styles.actionRow}>
                  <View style={{ flex: 1 }}>
                    <SecondaryButton
                      label="Batal"
                      onPress={() => setDraft(null)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      label={saving ? 'Menyimpan…' : 'Simpan'}
                      onPress={save}
                    />
                  </View>
                </View>

                {/* Destructive Action */}
                {draft.id && !draft.isSystem && (
                  <View style={{ marginTop: 4 }}>
                    {confirmDelete === draft.id ? (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <SecondaryButton
                            label="Batal Hapus"
                            onPress={() => setConfirmDelete(null)}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Pressable
                            style={styles.confirmDeleteBtn}
                            onPress={() => {
                              const target = all.find((c) => c.id === draft.id);
                              if (target) remove(target);
                            }}
                          >
                            <Text style={styles.confirmDeleteText}>Yakin Hapus</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => setConfirmDelete(draft.id)}
                        style={styles.deleteBtn}
                      >
                        <Trash2 size={16} color={Colors.pendingText} />
                        <Text style={styles.deleteBtnText}>Hapus Kategori</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0B1527',
    textAlign: 'center',
  },
  addCategoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#F8FAFC',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignSelf: 'center',
    marginBottom: 20,
  },
  addCategoryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0B1527',
  },

  listContainer: {
    backgroundColor: '#FFFFFF',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 14,
  },
  categoryRowBordered: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  categorySquircle: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryInfo: {
    flex: 1,
    gap: 2,
  },
  categoryName: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#0B1527',
  },
  categoryCount: {
    fontSize: 13,
    color: '#94A3B8',
  },
  systemTag: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  systemTagText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },

  loadingText: {
    textAlign: 'center',
    color: '#94A3B8',
    marginTop: 20,
    fontSize: 13,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 21, 39, 0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    gap: 16,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0B1527',
  },

  fieldGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 14,
    color: '#0B1527',
    backgroundColor: '#F8FAFC',
  },
  inputHelper: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },

  typeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typeChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  typeChipSelected: {
    backgroundColor: '#EEF2FF',
    borderColor: Colors.brandPrimary,
  },
  typeChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  typeChipTextSelected: {
    color: Colors.brandPrimary,
  },

  iconChoiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  presetIconTile: {
    alignItems: 'center',
    gap: 4,
    width: '22%',
    paddingVertical: 4,
  },
  presetIconTileActive: {
    opacity: 1,
  },
  presetIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetIconLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },

  errBox: {
    backgroundColor: Colors.pendingBg,
    borderRadius: 8,
    padding: 10,
  },
  errText: {
    fontSize: 12,
    color: Colors.pendingText,
  },

  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.pendingBorder,
    backgroundColor: Colors.pendingBg,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.pendingText,
  },
  confirmDeleteBtn: {
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.alertBg,
    borderWidth: 1,
    borderColor: Colors.pendingBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.alertText,
  },
});
