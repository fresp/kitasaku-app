import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Plus from 'lucide-react-native/icons/plus';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import X from 'lucide-react-native/icons/x';
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
import {
  cyclePrimaryAccountId,
  plannedExpenseGroup,
  splitPlannedExpense,
  type PlannedExpenseGroup,
} from '../lib/account';
import { PrimaryButton } from '../components/ui/Button';

/**
 * Screen 9 — Template Rutin.
 *
 * A template is a promise about future cycles, not a record of past spending,
 * so everything here edits the template only. Cloned transactions keep the
 * amount they were created with; changing a default affects the next cycle
 * that is opened, never one already running.
 *
 * The editor is a sheet rather than a block above the list. It used to be
 * inline at the top, so editing the fifteenth row scrolled the form out of
 * sight and the family tapped "Edit" with nothing visibly happening.
 */

function parseAmount(t: string): number {
  return parseInt(t.replace(/[^0-9]/g, '') || '0', 10);
}

type Picker = 'none' | 'category' | 'account' | 'due';

interface Draft {
  id: string | null;
  name: string;
  amountText: string;
  dueDay: number | null;
  categoryId: string | null;
  accountId: string | null;
  direction: 'INCOME' | 'EXPENSE';
  /** What the row held when the sheet opened, so the amount can state its delta. */
  original: Template | null;
}

const EMPTY_DRAFT: Draft = {
  id: null, name: '', amountText: '', dueDay: null,
  categoryId: null, accountId: null, direction: 'EXPENSE', original: null,
};

/** The three pockets, in the order the list renders them. */
const GROUP_ORDER: PlannedExpenseGroup[] = ['primary', 'otherCash', 'card'];
const GROUP_LABEL: Record<PlannedExpenseGroup, string> = {
  primary: 'PENGELUARAN · AKUN PRIMER',
  otherCash: 'PENGELUARAN · AKUN KAS LAIN',
  card: 'PENGELUARAN · KARTU KREDIT',
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
  const [picker, setPicker] = useState<Picker>('none');
  const [err, setErr] = useState<string | null>(null);

  const all = useMemo(() => tmplQ.data ?? [], [tmplQ.data]);
  const list = useMemo(() => all.filter((t) => t.status === filter), [all, filter]);
  const activeList = useMemo(() => all.filter((t) => t.status === 'ACTIVE'), [all]);
  const doneCount = all.length - activeList.length;

  const categories = catsQ.data ?? [];
  const accounts = useMemo(() => accsQ.data ?? [], [accsQ.data]);
  const primaryAccountId = useMemo(() => cyclePrimaryAccountId(accounts), [accounts]);
  const saving = createTemplate.isPending || updateTemplate.isPending;

  // The baseline counts ACTIVE EXPENSE templates only — an income position is
  // not a commitment. The header used to print the count of *every* active
  // template beside it, so the list never added up to the figure above it.
  const expenseActive = useMemo(
    () => activeList.filter((t) => t.direction === 'EXPENSE'),
    [activeList]
  );
  const baselineSplit = splitPlannedExpense(
    expenseActive,
    primaryAccountId,
    (t) => t.default_amount
  );
  const incomeActive = useMemo(
    () => activeList.filter((t) => t.direction === 'INCOME'),
    [activeList]
  );
  const incomeTotal = incomeActive.reduce((s, t) => s + t.default_amount, 0);

  /** The visible list, split into the same pockets Buka Siklus uses. */
  const groups = useMemo(() => {
    const expense = list.filter((t) => t.direction === 'EXPENSE');
    const income = list.filter((t) => t.direction === 'INCOME');
    const byPocket = new Map<PlannedExpenseGroup, Template[]>();
    for (const t of expense) {
      const key = plannedExpenseGroup(t, primaryAccountId);
      byPocket.set(key, [...(byPocket.get(key) ?? []), t]);
    }
    const expenseGroups: { key: PlannedExpenseGroup | 'income'; label: string; rows: Template[] }[] =
      GROUP_ORDER.map((key) => ({
        key: key as PlannedExpenseGroup | 'income',
        label: GROUP_LABEL[key],
        rows: byPocket.get(key) ?? [],
      }));
    return expenseGroups
      .filter((g) => g.rows.length > 0)
      .concat(
        income.length > 0
          ? [{ key: 'income' as const, label: 'PEMASUKAN · TIDAK DIHITUNG BASELINE', rows: income }]
          : []
      );
  }, [list, primaryAccountId]);

  function openDraft(t: Template | null) {
    setErr(null);
    setPicker('none');
    setDraft(
      t
        ? {
            id: t.id,
            name: t.name,
            amountText: String(t.default_amount),
            dueDay: t.due_day ?? null,
            categoryId: t.category_id,
            accountId: t.account_id,
            direction: t.direction,
            original: t,
          }
        : { ...EMPTY_DRAFT }
    );
  }

  function closeDraft() {
    setDraft(null);
    setPicker('none');
    setErr(null);
  }

  async function save() {
    setErr(null);
    if (!householdId || !draft) return;
    const amount = parseAmount(draft.amountText);
    try {
      if (draft.id) {
        await updateTemplate.mutateAsync({
          id: draft.id,
          name: draft.name,
          defaultAmount: amount,
          dueDay: draft.dueDay,
          categoryId: draft.categoryId,
          accountId: draft.accountId,
          direction: draft.direction,
        });
      } else {
        await createTemplate.mutateAsync({
          householdId,
          name: draft.name,
          defaultAmount: amount,
          dueDay: draft.dueDay,
          categoryId: draft.categoryId,
          accountId: draft.accountId,
          direction: draft.direction,
        });
      }
      closeDraft();
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
      closeDraft();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal mengubah status template.');
    }
  }

  const draftAmount = draft ? parseAmount(draft.amountText) : 0;
  const draftDelta =
    draft?.original && draftAmount > 0 ? draftAmount - draft.original.default_amount : 0;
  const draftCategory = categories.find((c) => c.id === draft?.categoryId) ?? null;
  const draftAccount = accounts.find((a) => a.id === draft?.accountId) ?? null;
  const draftIsCard =
    draft != null &&
    draft.direction === 'EXPENSE' &&
    plannedExpenseGroup(
      { account_id: draft.accountId, accounts: draftAccount ? { type: draftAccount.type } : null },
      null
    ) === 'card';

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
          <Pressable onPress={() => openDraft(null)} style={styles.addBtn}>
            <Plus size={14} color={Colors.textPrimary} />
            <Text style={styles.addText}>Tambah</Text>
          </Pressable>
        </View>

        <View style={styles.baseline}>
          <Text style={styles.baselineEyebrow}>
            DI-CLONE KE SIKLUS BERIKUTNYA · {expenseActive.length} POS
          </Text>
          <Text style={styles.baselineAmount}>{formatRupiah(baselineSplit.total)}</Text>
          <Text style={styles.baselineNote}>
            {baselineSplit.amounts.card > 0
              ? `Termasuk ${formatRupiah(baselineSplit.amounts.card)} di kartu kredit, yang kasnya baru keluar saat tagihannya dibayar.`
              : 'Kebutuhan wajib yang otomatis di-clone saat siklus baru dibuka.'}
            {incomeActive.length > 0
              ? ` ${incomeActive.length} pos pemasukan (${formatRupiah(incomeTotal)}) tidak dihitung di sini.`
              : ''}
          </Text>
        </View>

        <View style={styles.tabs}>
          <Pressable
            onPress={() => setFilter('ACTIVE')}
            style={[styles.tab, filter === 'ACTIVE' && styles.tabOn]}
          >
            <Text style={[styles.tabText, filter === 'ACTIVE' && styles.tabTextOn]}>
              Aktif · {activeList.length}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFilter('COMPLETED')}
            style={[styles.tab, filter === 'COMPLETED' && styles.tabOn]}
          >
            <Text style={[styles.tabText, filter === 'COMPLETED' && styles.tabTextOn]}>
              Arsip · {doneCount}
            </Text>
          </Pressable>
        </View>

        {tmplQ.isLoading && <Text style={styles.muted}>Memuat template…</Text>}

        {groups.map((g) => {
          const subtotal = g.rows.reduce((s, t) => s + t.default_amount, 0);
          const isIncome = g.rows[0]?.direction === 'INCOME';
          return (
            <View key={g.label} style={{ gap: 8 }}>
              <View style={styles.groupHead}>
                <Text style={styles.groupName}>{g.label}</Text>
                <Text style={styles.groupSum}>{formatRupiah(subtotal)}</Text>
              </View>
              {g.rows.map((t) => {
                const due = templateDueLabel(t.due_day);
                const meta = [t.categories?.name, t.accounts?.name, due]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => openDraft(t)}
                    style={[styles.card, isIncome && styles.cardIncome]}
                  >
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
                      <View style={styles.cardMetaRow}>
                        {g.key === 'card' && (
                          <Text style={styles.cardPill}>KARTU</Text>
                        )}
                        <Text style={styles.cardMeta} numberOfLines={1}>
                          {meta || 'Tanpa kategori · Tanpa akun'}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.cardAmount, isIncome && styles.cardAmountIncome]}>
                      {formatRupiahShort(t.default_amount)}
                    </Text>
                    <ChevronRight size={14} color={Colors.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          );
        })}

        {!tmplQ.isLoading && list.length === 0 && (
          <View style={styles.emptyBox}>
            <BrandIcon
              name={filter === 'ACTIVE' ? 'empty-belum-ada-rencana' : 'empty-data-tidak-ditemukan'}
              size={72}
              label=""
            />
            <Text style={styles.empty}>
              {filter === 'ACTIVE'
                ? 'Belum ada template aktif. Tambahkan pos rutin supaya siklus baru terisi otomatis.'
                : 'Belum ada template yang diarsipkan.'}
            </Text>
          </View>
        )}

        {err && !draft && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}
      </ScrollView>

      {/* ---- Editor sheet ---- */}
      <Modal
        visible={draft !== null}
        transparent
        animationType="slide"
        onRequestClose={closeDraft}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.scrim}
        >
          <View style={styles.sheet}>
            <View style={styles.grab} />
            {draft && (
              <ScrollView
                contentContainerStyle={{ gap: 10, paddingBottom: 20 }}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.sheetHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetTitle}>
                      {draft.original ? draft.original.name : 'Template Baru'}
                    </Text>
                    <Text style={styles.sheetSub}>
                      Berlaku mulai siklus berikutnya. Transaksi yang sudah di-clone tidak
                      ikut berubah.
                    </Text>
                  </View>
                  <Pressable onPress={closeDraft} hitSlop={10}>
                    <X size={20} color={Colors.textPrimary} />
                  </Pressable>
                </View>

                <Text style={styles.label}>NAMA POS</Text>
                <TextInput
                  value={draft.name}
                  onChangeText={(v) => setDraft({ ...draft, name: v })}
                  placeholder="Wifi Rumah"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                />

                {/* The amount is the hero: it is the only field that moves the
                    baseline, and the delta line is what tells the family by how
                    much before they commit to it. */}
                <View style={styles.moneyBox}>
                  <Text style={styles.label}>NOMINAL DEFAULT</Text>
                  <TextInput
                    value={draft.amountText}
                    onChangeText={(v) => setDraft({ ...draft, amountText: v })}
                    placeholder="0"
                    placeholderTextColor={Colors.borderStrong}
                    keyboardType="number-pad"
                    style={styles.moneyInput}
                  />
                  <Text style={styles.moneyEcho}>{formatRupiah(draftAmount)}</Text>
                  {draft.original && draftDelta !== 0 && (
                    <Text style={styles.moneyWas}>
                      Sebelumnya {formatRupiah(draft.original.default_amount)} ·{' '}
                      {draftDelta > 0 ? 'naik' : 'turun'} {formatRupiah(Math.abs(draftDelta))}
                    </Text>
                  )}
                </View>

                <PickRow
                  label="Kategori"
                  value={draftCategory?.name ?? 'Belum dipilih'}
                  muted={!draftCategory}
                  onPress={() => setPicker('category')}
                />
                <PickRow
                  label="Akun"
                  value={draftAccount?.name ?? 'Belum dipilih'}
                  muted={!draftAccount}
                  pill={draftIsCard ? 'KARTU' : undefined}
                  onPress={() => setPicker('account')}
                />

                {draftIsCard && (
                  <View style={styles.warnBox}>
                    <TriangleAlert size={14} color={Colors.financingText} />
                    <Text style={styles.warnText}>
                      Pos di kartu kredit tidak memotong kas siklus ini — tagihannya yang
                      memotong, siklus berikutnya.
                    </Text>
                  </View>
                )}

                <PickRow
                  label="Jatuh tempo"
                  value={
                    draft.dueDay != null
                      ? templateDueLabel(draft.dueDay) ?? `Tgl ${draft.dueDay}`
                      : 'Belum ditentukan'
                  }
                  muted={draft.dueDay == null}
                  onPress={() => setPicker('due')}
                />

                <Text style={styles.label}>JENIS</Text>
                <View style={styles.seg}>
                  {(['EXPENSE', 'INCOME'] as const).map((d) => (
                    <Pressable
                      key={d}
                      onPress={() => setDraft({ ...draft, direction: d })}
                      style={[styles.segItem, draft.direction === d && styles.segItemOn]}
                    >
                      <Text
                        style={[
                          styles.segText,
                          draft.direction === d && styles.segTextOn,
                        ]}
                      >
                        {d === 'EXPENSE' ? 'Pengeluaran' : 'Pemasukan'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {draft.direction === 'INCOME' && (
                  <Text style={styles.hint}>
                    Pos pemasukan di-clone sebagai sumber dana, dan tidak dihitung ke
                    baseline.
                  </Text>
                )}

                {err && (
                  <View style={styles.errBox}>
                    <Text style={styles.errText}>{err}</Text>
                  </View>
                )}

                <PrimaryButton
                  label={saving ? 'Menyimpan…' : draft.original ? 'Simpan Perubahan' : 'Simpan Template'}
                  onPress={save}
                />

                {/* Archiving, not deleting: a template that has already cloned
                    transactions into past cycles is referenced by them.
                    Separated by a rule rather than stacked as a third button —
                    it is a different kind of act from saving an edit. */}
                {draft.original && (
                  <Pressable
                    onPress={() => draft.original && toggleStatus(draft.original)}
                    style={styles.archiveBtn}
                  >
                    <Text style={styles.archiveText}>
                      {draft.original.status === 'ACTIVE'
                        ? 'Arsipkan — berhenti di-clone'
                        : 'Aktifkan lagi'}
                    </Text>
                  </Pressable>
                )}
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---- Option pickers ---- */}
      <Modal
        visible={picker !== 'none'}
        transparent
        animationType="fade"
        onRequestClose={() => setPicker('none')}
      >
        <Pressable style={styles.scrim} onPress={() => setPicker('none')}>
          <Pressable style={styles.pickerSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grab} />
            <Text style={styles.sheetTitle}>
              {picker === 'category' ? 'Pilih kategori' : picker === 'account' ? 'Pilih akun' : 'Jatuh tempo'}
            </Text>
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingVertical: 6 }}>
              {picker === 'category' &&
                categories
                  .filter((c) => c.type === (draft?.direction ?? 'EXPENSE'))
                  .map((c) => (
                    <OptionRow
                      key={c.id}
                      label={c.name}
                      selected={draft?.categoryId === c.id}
                      onPress={() => {
                        if (draft) setDraft({ ...draft, categoryId: c.id });
                        setPicker('none');
                      }}
                    />
                  ))}
              {picker === 'account' &&
                accounts.map((a) => (
                  <OptionRow
                    key={a.id}
                    label={a.name}
                    sub={a.type}
                    selected={draft?.accountId === a.id}
                    onPress={() => {
                      if (draft) setDraft({ ...draft, accountId: a.id });
                      setPicker('none');
                    }}
                  />
                ))}
              {picker === 'due' && (
                <View style={styles.dayGrid}>
                  <Pressable
                    onPress={() => {
                      if (draft) setDraft({ ...draft, dueDay: null });
                      setPicker('none');
                    }}
                    style={[styles.dayCell, styles.dayCellWide, draft?.dueDay == null && styles.dayCellOn]}
                  >
                    <Text style={[styles.dayText, draft?.dueDay == null && styles.dayTextOn]}>
                      Belum ditentukan
                    </Text>
                  </Pressable>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <Pressable
                      key={d}
                      onPress={() => {
                        if (draft) setDraft({ ...draft, dueDay: d });
                        setPicker('none');
                      }}
                      style={[styles.dayCell, draft?.dueDay === d && styles.dayCellOn]}
                    >
                      <Text style={[styles.dayText, draft?.dueDay === d && styles.dayTextOn]}>
                        {d}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function PickRow({
  label,
  value,
  muted,
  pill,
  onPress,
}: {
  label: string;
  value: string;
  muted?: boolean;
  pill?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.pickRow}>
      <Text style={styles.pickLabel}>{label}</Text>
      <View style={styles.pickValueWrap}>
        {!!pill && <Text style={styles.cardPill}>{pill}</Text>}
        <Text style={[styles.pickValue, muted && styles.pickValueMuted]} numberOfLines={1}>
          {value}
        </Text>
        <ChevronRight size={14} color={Colors.textMuted} />
      </View>
    </Pressable>
  );
}

function OptionRow({
  label,
  sub,
  selected,
  onPress,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.optionRow, selected && styles.optionRowOn]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionText, selected && styles.optionTextOn]}>{label}</Text>
        {!!sub && <Text style={styles.optionSub}>{sub}</Text>}
      </View>
      {selected && <Text style={styles.optionCheck}>✓</Text>}
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

  baseline: { backgroundColor: Colors.brandPrimary, borderRadius: Radius.lg, padding: 16, gap: 5 },
  baselineEyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  baselineAmount: { color: Colors.white, fontSize: 23, fontWeight: '700', fontVariant: ['tabular-nums'] },
  baselineNote: { color: Colors.borderStrong, fontSize: FontSize.caption, lineHeight: 16 },

  tabs: { backgroundColor: Colors.subtle, borderRadius: Radius.pill, flexDirection: 'row', padding: 4, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: Radius.pill, alignItems: 'center' },
  tabOn: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle },
  tabText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '500' },
  tabTextOn: { color: Colors.textPrimary, fontWeight: '700' },

  groupHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 4 },
  groupName: {
    color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700',
    letterSpacing: 0.9, flex: 1,
  },
  groupSum: {
    color: Colors.textSecondary, fontSize: FontSize.caption, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  cardIncome: { opacity: 0.74 },
  cardIcon: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.subtle,
    alignItems: 'center', justifyContent: 'center',
  },
  cardName: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardMeta: { color: Colors.textSecondary, fontSize: FontSize.caption, flex: 1 },
  cardPill: {
    fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4,
    backgroundColor: Colors.financingBg, color: Colors.financingText,
    borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2,
    overflow: 'hidden',
  },
  cardAmount: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cardAmountIncome: { color: Colors.paidText },

  emptyBox: { paddingVertical: 16, alignItems: 'center', gap: 10 },
  empty: { color: Colors.textMuted, fontSize: FontSize.body, textAlign: 'center' },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },

  /* Sheets */
  scrim: { flex: 1, backgroundColor: Colors.overlayScrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 18, paddingBottom: 28, maxHeight: '88%',
  },
  pickerSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 18, paddingBottom: 28, gap: 6,
  },
  grab: {
    width: 44, height: 4, borderRadius: Radius.pill, backgroundColor: Colors.borderStrong,
    alignSelf: 'center', marginBottom: 12,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sheetTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
  sheetSub: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16, marginTop: 3 },

  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  input: {
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary,
    backgroundColor: Colors.canvas,
  },
  hint: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 16 },

  moneyBox: {
    borderWidth: 1.5, borderColor: Colors.brandPrimary, borderRadius: Radius.md,
    padding: 12, gap: 2, backgroundColor: Colors.surface, marginTop: 2,
  },
  moneyInput: {
    fontSize: 26, fontWeight: '800', color: Colors.textPrimary,
    fontVariant: ['tabular-nums'], padding: 0, marginTop: 2,
  },
  moneyEcho: { color: Colors.textSecondary, fontSize: FontSize.body, fontWeight: '600' },
  moneyWas: { color: Colors.financingText, fontSize: FontSize.caption, marginTop: 2 },

  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 13, paddingVertical: 13, backgroundColor: Colors.surface,
  },
  pickLabel: { color: Colors.textSecondary, fontSize: 12.5 },
  pickValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 'auto', flexShrink: 1 },
  pickValue: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  pickValueMuted: { color: Colors.textMuted, fontWeight: '500' },

  warnBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: Colors.financingBg, borderWidth: 1, borderColor: Colors.financingBorder,
    borderRadius: Radius.md, padding: 10,
  },
  warnText: { color: Colors.financingText, fontSize: FontSize.caption, lineHeight: 16, flex: 1 },

  seg: { flexDirection: 'row', backgroundColor: Colors.subtle, borderRadius: Radius.pill, padding: 3 },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: Radius.pill, alignItems: 'center' },
  segItemOn: { backgroundColor: Colors.brandPrimary },
  segText: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  segTextOn: { color: Colors.white, fontWeight: '700' },

  archiveBtn: {
    alignItems: 'center', paddingTop: 14, marginTop: 4,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
  archiveText: { color: Colors.textMuted, fontSize: 12.5, fontWeight: '700' },

  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 13, paddingHorizontal: 12, borderRadius: Radius.md,
  },
  optionRowOn: { backgroundColor: Colors.subtle },
  optionText: { color: Colors.textPrimary, fontSize: 14 },
  optionTextOn: { fontWeight: '700' },
  optionSub: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 1 },
  optionCheck: { color: Colors.accentStrong, fontSize: 15, fontWeight: '800' },

  dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 2 },
  dayCell: {
    width: 44, height: 44, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  dayCellWide: { width: '100%', height: 42 },
  dayCellOn: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  dayText: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  dayTextOn: { color: Colors.white, fontWeight: '800' },
});
