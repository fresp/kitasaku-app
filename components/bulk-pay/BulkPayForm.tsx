import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import Calendar from 'lucide-react-native/icons/calendar';
import CalendarClock from 'lucide-react-native/icons/calendar-clock';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Lock from 'lucide-react-native/icons/lock';
import Minus from 'lucide-react-native/icons/minus';
import Plus from 'lucide-react-native/icons/plus';
import Receipt from 'lucide-react-native/icons/receipt';
import Wallet from 'lucide-react-native/icons/wallet';
import X from 'lucide-react-native/icons/x';
import { Colors, Radius } from '../../constants/theme';
import { formatRupiah, parseRupiahInput } from '../../lib/format';
import { longDateFullLabel, normalizeObligationType, shortDateLabel } from '../../lib/obligation';
import { memberName, obligationListSubtitle } from '../../lib/collaboration';
import { isZeroBasedCashAccount } from '../../lib/account';
import type { HouseholdMember } from '../../lib/household';
import type { Account, Category, Obligation, OpenInstallment } from '../../lib/queries';
import { QueryError } from '../ui/QueryError';
import {
  BULK_PAY_MAX_ITEMS,
  BULK_PAY_NOTE_MAX,
  defaultDraftItem,
  deriveFee,
  draftItemAmount,
  draftItemProblem,
  encodeDraft,
  installmentRangeLabel,
  orderOpenInstallments,
  payBadge,
  type BulkPayDraftItem,
} from '../../lib/bulk-pay';
import { ObligationPickerSheet, nextDueDate } from './ObligationPickerSheet';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function typeIcon(type: string) {
  const t = normalizeObligationType(type);
  if (t === 'REIMBURSEMENT') return <Wallet size={18} color={Colors.loanText} />;
  if (t === 'LOAN' || t === 'INSTALLMENT') return <CalendarClock size={18} color={Colors.info} />;
  return <Receipt size={18} color={Colors.loanText} />;
}

/**
 * Quick Add > Pengeluaran > Bayar tanggungan. Collects the draft and hands it
 * to the review screen; nothing is written here.
 */
export function BulkPayForm({
  obligations,
  obligationsError,
  onRetryObligations,
  installments,
  accounts,
  categories,
  members,
  myUserId,
  cycleAvailable,
}: {
  obligations: Obligation[];
  obligationsError: boolean;
  onRetryObligations: () => void;
  installments: OpenInstallment[];
  accounts: Account[];
  categories: Category[];
  members: HouseholdMember[];
  myUserId: string | undefined;
  cycleAvailable: boolean;
}) {
  const router = useRouter();
  const today = todayISO();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, BulkPayDraftItem>>({});
  const [amountTexts, setAmountTexts] = useState<Record<string, string>>({});
  const [totalText, setTotalText] = useState<string | null>(null);
  const [feeCategoryId, setFeeCategoryId] = useState<string | null>(null);
  const [paidAt, setPaidAt] = useState(today);
  const [dateEditing, setDateEditing] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [notifyOthers, setNotifyOthers] = useState(false);
  const [chosenOthers, setChosenOthers] = useState<string[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [feePickerOpen, setFeePickerOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = useMemo(
    () => obligations.filter((o) => o.remaining_amount > 0 && o.status !== 'SETTLED' && o.status !== 'CANCELLED'),
    [obligations]
  );
  const byId = useMemo(() => new Map(open.map((o) => [o.id, o])), [open]);
  const installmentsByObligation = useMemo(() => {
    const m = new Map<string, OpenInstallment[]>();
    for (const i of installments) {
      const list = m.get(i.obligation_id) ?? [];
      list.push(i);
      m.set(i.obligation_id, list);
    }
    return m;
  }, [installments]);

  const cashAccounts = useMemo(() => accounts.filter((a) => isZeroBasedCashAccount(a)), [accounts]);
  const account = cashAccounts.find((a) => a.id === accountId) ?? cashAccounts[0] ?? null;
  const feeCategories = useMemo(
    () => categories.filter((c) => c.type === 'EXPENSE' && !c.system_role),
    [categories]
  );
  const feeCategory = feeCategoryId ? feeCategories.find((c) => c.id === feeCategoryId) ?? null : null;

  // Rows whose obligation disappeared (settled on the partner's phone) drop out.
  const rows = selectedIds
    .map((id) => {
      const ob = byId.get(id);
      if (!ob) return null;
      const inst = installmentsByObligation.get(id) ?? [];
      const draft = drafts[id] ?? defaultDraftItem(ob, inst.length);
      return { ob, inst, draft, amount: draftItemAmount(draft, inst) };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const amounts = rows.map((r) => r.amount);
  const subtotal = amounts.reduce((s, a) => s + a, 0);
  const totalDebited = totalText === null ? subtotal : parseRupiahInput(totalText);
  const fee = deriveFee(amounts, totalDebited);

  const requesters = new Set(
    rows.map((r) => r.ob.created_by).filter((u): u is string => !!u && u !== myUserId)
  );
  const summaryBatch = rows.length > 1 || fee.fee > 0;
  const autoRecipients = summaryBatch ? [...requesters] : [];
  const others = members.filter((m) => !m.is_me && m.user_id !== myUserId && !autoRecipients.includes(m.user_id));
  const chosen = (chosenOthers ?? others.map((m) => m.user_id)).filter((id) => others.some((m) => m.user_id === id));
  const notifyIds = notifyOthers ? chosen : [];

  function applyPicked(ids: string[]) {
    setSelectedIds(ids.slice(0, BULK_PAY_MAX_ITEMS));
    setPickerOpen(false);
    setErr(null);
  }

  function setDraft(id: string, next: BulkPayDraftItem) {
    setDrafts((d) => ({ ...d, [id]: next }));
  }

  function remove(id: string) {
    setSelectedIds((ids) => ids.filter((x) => x !== id));
  }

  function review() {
    setErr(null);
    if (!cycleAvailable) { setErr('Belum ada siklus aktif. Buka siklus dulu sebelum membayar tanggungan.'); return; }
    if (rows.length === 0) { setErr('Pilih minimal 1 tanggungan.'); return; }
    for (const r of rows) {
      const problem = draftItemProblem(r.draft, r.ob, r.inst.length);
      if (problem) { setErr(`${r.ob.title}: ${problem}`); return; }
    }
    if (fee.error) { setErr(fee.error); return; }
    if (!account) { setErr('Tambahkan rekening bank atau e-wallet aktif dulu.'); return; }
    if (!longDateFullLabel(paidAt) || paidAt > today) { setErr('Tanggal tidak valid atau berada di masa depan.'); return; }
    router.push({
      pathname: '/bulk-pay-review',
      params: {
        draft: encodeDraft({
          accountId: account.id,
          paidAt,
          items: rows.map((r) => r.draft),
          totalDebited,
          feeCategoryId: fee.fee > 0 ? feeCategoryId : null,
          note: note.trim(),
          notifyIds,
        }),
      },
    });
  }

  if (obligationsError) {
    return <QueryError onRetry={onRetryObligations} message="Daftar tanggungan belum bisa dibaca. Datamu aman." />;
  }

  return (
    <View style={styles.wrap}>
      {!cycleAvailable && (
        <Text style={styles.warning}>Belum ada siklus aktif. Pembayaran tanggungan dicatat di siklus aktif.</Text>
      )}

      <View style={styles.block}>
        <View style={styles.between}>
          <Text style={styles.label}>Tanggungan dipilih ({rows.length})</Text>
          <Pressable onPress={() => setPickerOpen(true)} hitSlop={8} style={styles.linkHit}>
            <Text style={styles.link}>{rows.length === 0 ? 'Pilih tanggungan' : 'Ubah pilihan'}</Text>
          </Pressable>
        </View>

        {rows.length === 0 && (
          <Pressable onPress={() => setPickerOpen(true)} style={styles.emptyCard} accessibilityRole="button">
            <Text style={styles.emptyText}>
              {open.length === 0 ? 'Tidak ada tanggungan aktif.' : 'Ketuk untuk memilih tanggungan yang dibayar.'}
            </Text>
          </Pressable>
        )}

        {rows.map(({ ob, inst, draft, amount }) => {
          const due = shortDateLabel(nextDueDate(ob, inst));
          const problem = draftItemProblem(draft, ob, inst.length);
          const sub = [
            obligationListSubtitle(ob.type, members, ob.created_by),
            inst.length > 0
              ? `${formatRupiah(orderOpenInstallments(inst)[0]?.planned_amount ?? 0)} × ${inst.length} sisa`
              : `sisa ${formatRupiah(ob.remaining_amount)}`,
            due ? (inst.length > 0 ? `berikutnya ${due}` : due) : 'tanpa tanggal',
          ].join(' · ');
          const partial = draft.kind === 'amount' && amount < ob.remaining_amount;
          return (
            <View key={ob.id} style={[styles.card, partial && styles.cardPartial, !!problem && styles.cardBad]}>
              <View style={styles.cardHead}>
                <View style={styles.icon}>{typeIcon(ob.type)}</View>
                <View style={styles.grow}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{ob.title}</Text>
                  <Text style={styles.itemSub}>{sub}</Text>
                </View>
                <Pressable onPress={() => remove(ob.id)} hitSlop={10} style={styles.removeBtn} accessibilityLabel={`Hapus ${ob.title} dari pilihan`}>
                  <X size={16} color={Colors.textMuted} />
                </Pressable>
              </View>

              {draft.kind === 'installments' ? (
                <>
                  <View style={styles.between}>
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() => setDraft(ob.id, { ...draft, installmentCount: Math.max(1, draft.installmentCount - 1) })}
                        disabled={draft.installmentCount <= 1}
                        style={styles.stepBtn}
                        accessibilityLabel="Kurangi cicilan"
                      >
                        <Minus size={18} color={draft.installmentCount <= 1 ? Colors.textMuted : Colors.textPrimary} />
                      </Pressable>
                      <Text style={styles.stepValue}>{draft.installmentCount} cicilan</Text>
                      <Pressable
                        onPress={() => setDraft(ob.id, { ...draft, installmentCount: Math.min(inst.length, draft.installmentCount + 1) })}
                        disabled={draft.installmentCount >= inst.length}
                        style={styles.stepBtn}
                        accessibilityLabel="Tambah cicilan"
                      >
                        <Plus size={18} color={draft.installmentCount >= inst.length ? Colors.textMuted : Colors.textPrimary} />
                      </Pressable>
                    </View>
                    <Text style={styles.amt}>{formatRupiah(amount)}</Text>
                  </View>
                  <Text style={styles.cap}>
                    {[
                      // Exact range comes from the server on review; this is the
                      // tenor minus what is still open, when the tenor is known.
                      ob.installment_count != null && ob.installment_count >= inst.length
                        ? installmentRangeLabel(
                            ob.installment_count - inst.length + 1,
                            ob.installment_count - inst.length + draft.installmentCount
                          )
                        : null,
                      `sisa ${inst.length - draft.installmentCount} cicilan setelah ini.`,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </>
              ) : (
                <>
                  <View style={styles.row}>
                    <View style={[styles.input, partial && styles.inputOn]}>
                      <Text style={styles.prefix}>Rp</Text>
                      <TextInput
                        value={amountTexts[ob.id] ?? formatRupiah(draft.amount, { withPrefix: false })}
                        onChangeText={(t) => {
                          setAmountTexts((m) => ({ ...m, [ob.id]: t }));
                          setDraft(ob.id, { obligationId: ob.id, kind: 'amount', amount: parseRupiahInput(t) });
                        }}
                        onBlur={() => setAmountTexts((m) => {
                          const next = { ...m };
                          delete next[ob.id];
                          return next;
                        })}
                        keyboardType="number-pad"
                        style={styles.inputField}
                        accessibilityLabel={`Nominal ${ob.title}`}
                      />
                    </View>
                    <Text style={[styles.badge, payBadge(amount, ob.remaining_amount) === 'Lunas' ? styles.badgePaid : styles.badgePart]}>
                      {payBadge(amount, ob.remaining_amount)}
                    </Text>
                  </View>
                  {partial && (
                    <View style={styles.between}>
                      <Text style={styles.cap}>Sisa setelah bayar {formatRupiah(Math.max(0, ob.remaining_amount - amount))}</Text>
                      <Pressable
                        onPress={() => {
                          setAmountTexts((m) => {
                            const next = { ...m };
                            delete next[ob.id];
                            return next;
                          });
                          setDraft(ob.id, { obligationId: ob.id, kind: 'amount', amount: ob.remaining_amount });
                        }}
                        hitSlop={8}
                      >
                        <Text style={styles.linkSm}>Bayar penuh</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              )}
              {problem && <Text style={styles.problem}>{problem}</Text>}
            </View>
          );
        })}
      </View>

      {rows.length > 0 && (
        <View style={styles.totalCard}>
          <View style={styles.between}>
            <Text style={styles.muted}>Subtotal {rows.length} tanggungan</Text>
            <Text style={styles.strong}>{formatRupiah(subtotal)}</Text>
          </View>
          <View style={styles.block}>
            <Text style={styles.label}>Total keluar dari rekening</Text>
            <View style={styles.bigInput}>
              <Text style={styles.bigPrefix}>Rp</Text>
              <TextInput
                value={totalText ?? formatRupiah(subtotal, { withPrefix: false })}
                onChangeText={setTotalText}
                onBlur={() => {
                  if (totalText !== null && parseRupiahInput(totalText) === subtotal) setTotalText(null);
                  else if (totalText !== null) setTotalText(formatRupiah(parseRupiahInput(totalText), { withPrefix: false }));
                }}
                keyboardType="number-pad"
                style={styles.bigField}
                accessibilityLabel="Total keluar dari rekening"
              />
            </View>
            <Text style={styles.cap}>Samakan dengan nominal di mutasi bank.</Text>
          </View>
          {fee.error ? (
            <Text style={styles.problem}>{fee.error}</Text>
          ) : fee.fee > 0 ? (
            <View style={styles.fee}>
              <View style={styles.grow}>
                <Text style={styles.feeTitle}>Biaya tambahan {formatRupiah(fee.fee)}</Text>
                <Text style={styles.feeSub}>Dicatat terpisah · kategori {feeCategory?.name ?? 'Biaya Transfer'}</Text>
              </View>
              <Pressable onPress={() => setFeePickerOpen(true)} hitSlop={8} style={styles.linkHit}>
                <Text style={styles.link}>Ubah kategori</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}

      <View style={styles.block}>
        <Text style={styles.label}>Tanggal</Text>
        {dateEditing ? (
          <TextInput
            value={paidAt}
            onChangeText={setPaidAt}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={Colors.textMuted}
            autoFocus
            style={styles.selector}
            onSubmitEditing={() => setDateEditing(false)}
            onBlur={() => setDateEditing(false)}
          />
        ) : (
          <Pressable style={styles.selector} onPress={() => setDateEditing(true)}>
            <View style={styles.selectorLeft}>
              <Calendar size={18} color={Colors.textPrimary} />
              <Text style={styles.selectorValue}>{longDateFullLabel(paidAt) ?? paidAt}</Text>
            </View>
            <Text style={styles.link}>Ubah</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Akun Pembayaran</Text>
        <Pressable style={styles.selector} onPress={() => setAccountPickerOpen(true)}>
          <Text style={styles.selectorValue}>{account?.name ?? 'Belum ada rekening'}</Text>
          <ChevronDown size={18} color={Colors.textMuted} />
        </Pressable>
        <Text style={styles.cap}>Satu akun untuk semua tanggungan. Hanya rekening &amp; e-wallet.</Text>
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Catatan (opsional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Dipakai untuk ringkasan pembayaran..."
          placeholderTextColor={Colors.textMuted}
          maxLength={BULK_PAY_NOTE_MAX}
          multiline
          style={styles.notes}
        />
      </View>

      {(autoRecipients.length > 0 || others.length > 0) && rows.length > 0 && (
        <View style={styles.notifyCard}>
          <Text style={styles.label}>Notifikasi</Text>
          {autoRecipients.length > 0 && (
            <>
              <View style={styles.chips}>
                {autoRecipients.map((id) => (
                  <View key={id} style={styles.chipLocked}>
                    <Lock size={12} color={Colors.textSecondary} />
                    <Text style={styles.chipLockedText}>{memberName(members, id) ?? 'Anggota'} · pengaju</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.cap}>Pengaju otomatis dapat satu ringkasan pembayaran.</Text>
            </>
          )}
          {others.length > 0 && (
            <>
              <View style={[styles.between, autoRecipients.length > 0 && styles.divider]}>
                <View style={styles.grow}>
                  <Text style={styles.notifyTitle}>Kabari anggota lain</Text>
                  <Text style={styles.cap}>Kirim ringkasan yang sama ke anggota yang bukan pengaju.</Text>
                </View>
                <Switch
                  value={notifyOthers}
                  onValueChange={setNotifyOthers}
                  trackColor={{ true: Colors.paidText, false: Colors.borderStrong }}
                  accessibilityLabel="Kabari anggota lain"
                />
              </View>
              {notifyOthers && (
                <View style={styles.chips}>
                  {others.map((m) => {
                    const on = chosen.includes(m.user_id);
                    return (
                      <Pressable
                        key={m.user_id}
                        onPress={() => setChosenOthers(on ? chosen.filter((x) => x !== m.user_id) : [...chosen, m.user_id])}
                        style={[styles.chip, on && styles.chipOn]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{memberName(members, m.user_id) ?? 'Anggota'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </View>
      )}

      {err && (
        <View style={styles.errBox}>
          <Text style={styles.errText}>{err}</Text>
        </View>
      )}

      <Pressable
        onPress={review}
        style={[styles.cta, (rows.length === 0 || !!fee.error) && styles.ctaOff]}
        accessibilityRole="button"
      >
        <Text style={styles.ctaText}>
          {rows.length === 0 ? 'Cek & bayar' : `Cek & bayar · ${formatRupiah(fee.error ? subtotal : totalDebited)}`}
        </Text>
      </Pressable>

      <ObligationPickerSheet
        visible={pickerOpen}
        obligations={open}
        installmentsByObligation={installmentsByObligation}
        members={members}
        selectedIds={rows.map((r) => r.ob.id)}
        today={today}
        onClose={() => setPickerOpen(false)}
        onApply={applyPicked}
      />

      <Modal visible={accountPickerOpen} transparent animationType="fade" onRequestClose={() => setAccountPickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAccountPickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Pilih Akun Pembayaran</Text>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 8 }}>
              {cashAccounts.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => { setAccountId(a.id); setAccountPickerOpen(false); }}
                  style={[styles.option, a.id === account?.id && styles.optionOn]}
                >
                  <Text style={styles.optionName}>{a.name}</Text>
                  <Text style={styles.cap}>{a.type === 'E_WALLET' ? 'E-wallet' : 'Rekening'}</Text>
                </Pressable>
              ))}
              {cashAccounts.length === 0 && <Text style={styles.cap}>Belum ada rekening bank atau e-wallet aktif.</Text>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={feePickerOpen} transparent animationType="fade" onRequestClose={() => setFeePickerOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setFeePickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Kategori biaya tambahan</Text>
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8 }}>
              {!feeCategories.some((c) => c.name.trim().toLowerCase() === 'biaya transfer') && (
                <Pressable
                  onPress={() => { setFeeCategoryId(null); setFeePickerOpen(false); }}
                  style={[styles.option, feeCategoryId === null && styles.optionOn]}
                >
                  <Text style={styles.optionName}>Biaya Transfer</Text>
                  <Text style={styles.cap}>Dibuat otomatis saat dibayar</Text>
                </Pressable>
              )}
              {feeCategories.map((c) => {
                const isDefault = c.name.trim().toLowerCase() === 'biaya transfer';
                const on = feeCategoryId === c.id || (feeCategoryId === null && isDefault);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => { setFeeCategoryId(isDefault ? null : c.id); setFeePickerOpen(false); }}
                    style={[styles.option, on && styles.optionOn]}
                  >
                    <Text style={styles.optionName}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  block: { gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: '#64748B', fontSize: 12, fontWeight: '600' },
  muted: { color: Colors.textSecondary, fontSize: 14 },
  strong: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cap: { color: Colors.textSecondary, fontSize: 12 },
  link: { color: '#2563EB', fontSize: 13, fontWeight: '700' },
  linkSm: { color: '#2563EB', fontSize: 12, fontWeight: '700' },
  linkHit: { minHeight: 32, justifyContent: 'center' },
  warning: { color: Colors.alertText, backgroundColor: Colors.alertBg, borderRadius: 10, padding: 10, fontSize: 11 },
  emptyCard: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.borderStrong, borderRadius: Radius.lg,
    padding: 16, alignItems: 'center',
  },
  emptyText: { color: Colors.textSecondary, fontSize: 13 },
  card: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.lg, padding: 14, gap: 10 },
  cardPartial: { borderWidth: 1.5, borderColor: Colors.alertText },
  cardBad: { borderWidth: 1.5, borderColor: Colors.pendingBorder },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.loanBg, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  itemSub: { fontSize: 12.5, color: Colors.textSecondary },
  removeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 12,
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
  },
  inputOn: { borderWidth: 1.5, borderColor: Colors.textPrimary },
  prefix: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
  inputField: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'], paddingVertical: 0 },
  badge: { fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.pill, overflow: 'hidden' },
  badgePaid: { color: Colors.paidText, backgroundColor: Colors.paidBg },
  badgePart: { color: Colors.financingText, backgroundColor: Colors.financingBg },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, height: 44 },
  stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 76, textAlign: 'center', fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  amt: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  problem: { color: Colors.pendingText, fontSize: 12 },
  totalCard: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.lg, padding: 16, gap: 12 },
  bigInput: {
    flexDirection: 'row', alignItems: 'center', gap: 8, height: 56, paddingHorizontal: 14,
    borderWidth: 1.5, borderColor: Colors.textPrimary, borderRadius: 14,
  },
  bigPrefix: { color: Colors.textSecondary, fontSize: 18, fontWeight: '700' },
  bigField: { flex: 1, fontSize: 22, fontWeight: '800', color: Colors.textPrimary, fontVariant: ['tabular-nums'], paddingVertical: 0 },
  fee: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: Radius.md, backgroundColor: Colors.financingBg },
  feeTitle: { fontSize: 13, fontWeight: '700', color: Colors.financingText },
  feeSub: { fontSize: 12, color: Colors.financingText },
  selector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 48, paddingHorizontal: 14,
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: 14, backgroundColor: Colors.surface,
    fontSize: 14, color: Colors.textPrimary,
  },
  selectorLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  selectorValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
  notes: {
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: 14, padding: 12, minHeight: 74,
    fontSize: 13.5, color: Colors.textPrimary, textAlignVertical: 'top',
  },
  notifyCard: { backgroundColor: Colors.canvas, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.lg, padding: 14, gap: 10 },
  notifyTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  divider: { borderTopWidth: 1, borderTopColor: Colors.borderSubtle, paddingTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipLocked: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 32, borderRadius: Radius.pill,
    backgroundColor: Colors.subtle, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.borderStrong,
  },
  chipLockedText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  chip: {
    paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: Radius.pill,
    borderWidth: 1, borderColor: Colors.borderSubtle, backgroundColor: Colors.surface,
  },
  chipOn: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  chipTextOn: { color: Colors.white },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: 11, padding: 11 },
  errText: { color: Colors.pendingText, fontSize: 12 },
  cta: { backgroundColor: Colors.navy, borderRadius: 16, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ctaOff: { opacity: 0.55 },
  ctaText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: Colors.overlayScrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 32, gap: 12 },
  sheetTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  option: { padding: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderSubtle, gap: 2 },
  optionOn: { borderColor: Colors.accentStrong, backgroundColor: Colors.accentSoft },
  optionName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
});
