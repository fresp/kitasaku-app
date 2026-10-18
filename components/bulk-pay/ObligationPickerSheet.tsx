import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Check from 'lucide-react-native/icons/check';
import X from 'lucide-react-native/icons/x';
import { Colors, Radius } from '../../constants/theme';
import { formatRupiah } from '../../lib/format';
import { daysBetween, shortDateLabel } from '../../lib/obligation';
import { obligationListSubtitle } from '../../lib/collaboration';
import type { HouseholdMember } from '../../lib/household';
import type { Obligation, OpenInstallment } from '../../lib/queries';
import { orderOpenInstallments } from '../../lib/bulk-pay';

type Filter = 'all' | 'due';

/** Next date this obligation asks for money: its next open installment, else its own due date. */
export function nextDueDate(ob: Obligation, open: OpenInstallment[]): string | null {
  const next = orderOpenInstallments(open)[0];
  return next?.due_date ?? ob.due_date ?? null;
}

export function ObligationPickerSheet({
  visible,
  obligations,
  installmentsByObligation,
  members,
  selectedIds,
  today,
  onClose,
  onApply,
}: {
  visible: boolean;
  obligations: Obligation[];
  installmentsByObligation: Map<string, OpenInstallment[]>;
  members: HouseholdMember[];
  selectedIds: string[];
  today: string;
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  // Edits stay local until "Pakai", so closing the sheet keeps the form as it was.
  const [picked, setPicked] = useState<string[] | null>(null);
  const current = picked ?? selectedIds;

  const rows = useMemo(() => {
    return obligations.filter((o) => {
      if (filter === 'all') return true;
      const due = nextDueDate(o, installmentsByObligation.get(o.id) ?? []);
      if (!due) return false;
      const days = daysBetween(today, due);
      return days !== null && days <= 14;
    });
  }, [obligations, filter, installmentsByObligation, today]);

  function toggle(id: string) {
    setPicked(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  function close() {
    setPicked(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Pilih tanggungan</Text>
            <Pressable onPress={close} hitSlop={10} accessibilityLabel="Tutup">
              <X size={22} color={Colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.filters}>
            {([['all', 'Semua aktif'], ['due', 'Jatuh tempo ≤ 14 hari']] as [Filter, string][]).map(([key, label]) => (
              <Pressable
                key={key}
                onPress={() => setFilter(key)}
                style={[styles.filter, filter === key && styles.filterOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === key }}
              >
                <Text style={[styles.filterText, filter === key && styles.filterTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={styles.list}>
            {rows.length === 0 && (
              <Text style={styles.empty}>
                {filter === 'due' ? 'Tidak ada tanggungan yang jatuh tempo dalam 14 hari.' : 'Tidak ada tanggungan aktif.'}
              </Text>
            )}
            {rows.map((o) => {
              const on = current.includes(o.id);
              const open = installmentsByObligation.get(o.id) ?? [];
              const due = shortDateLabel(nextDueDate(o, open));
              const meta = [
                obligationListSubtitle(o.type, members, o.created_by),
                open.length > 0 ? `${open.length} × cicilan` : null,
                due ?? 'tanpa tanggal',
              ].filter(Boolean).join(' · ');
              return (
                <Pressable
                  key={o.id}
                  onPress={() => toggle(o.id)}
                  style={[styles.row, on && styles.rowOn]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <View style={[styles.box, on && styles.boxOn]}>
                    {on && <Check size={15} color={Colors.white} strokeWidth={3} />}
                  </View>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{o.title}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>
                  </View>
                  <Text style={styles.rowAmt}>{formatRupiah(o.remaining_amount)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.hint}>Nominal di kanan adalah sisa. Jumlah yang dibayar diatur per baris setelah ini.</Text>
          <Pressable
            onPress={() => {
              onApply(current);
              setPicked(null);
            }}
            disabled={current.length === 0}
            style={[styles.cta, current.length === 0 && styles.ctaOff]}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>
              {current.length === 0 ? 'Pilih minimal 1 tanggungan' : `Pakai ${current.length} tanggungan`}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: Colors.overlayScrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, gap: 14,
  },
  handle: { width: 40, height: 4, borderRadius: Radius.pill, backgroundColor: Colors.borderStrong, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 19, fontWeight: '700', color: Colors.textPrimary },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  filter: {
    minHeight: 36, paddingHorizontal: 14, borderRadius: Radius.pill, borderWidth: 1,
    borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  filterOn: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  filterText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  filterTextOn: { color: Colors.white },
  list: { gap: 10, paddingBottom: 4 },
  empty: { fontSize: 13, color: Colors.textMuted, paddingVertical: 16, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.lg,
  },
  rowOn: { borderWidth: 1.5, borderColor: Colors.navy, backgroundColor: Colors.canvas },
  box: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  rowMeta: { fontSize: 12, color: Colors.textSecondary },
  rowAmt: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 12, color: Colors.textSecondary },
  cta: { height: 52, borderRadius: Radius.lg, backgroundColor: Colors.navy, alignItems: 'center', justifyContent: 'center' },
  ctaOff: { backgroundColor: Colors.borderSubtle },
  ctaText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
});
