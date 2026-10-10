import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Check from 'lucide-react-native/icons/check';
import Share2 from 'lucide-react-native/icons/share-2';
import { Colors, FontSize, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import { useActiveCycle, useMarkAsPaid, useTransactionLedger } from '../lib/queries';
import type { LedgerRow } from '../lib/queries';
import { PrimaryButton, SecondaryButton, TextButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

function previewText(rows: LedgerRow[]): string {
  const totalIn = rows.filter((r) => r.direction === 'INCOME').reduce((sum, r) => sum + r.planned_amount, 0);
  const totalOut = rows.filter((r) => r.direction === 'EXPENSE').reduce((sum, r) => sum + r.planned_amount, 0);
  const lines = rows.map((r) => `${r.direction === 'INCOME' ? '+' : '−'} ${r.name}: ${formatRupiah(r.planned_amount)}`);
  return [
    'Ringkasan transaksi Kitasaku',
    '',
    ...lines,
    '',
    `Total pemasukan: ${formatRupiah(totalIn)}`,
    `Total pengeluaran: ${formatRupiah(totalOut)}`,
    `Dipilih: ${rows.length} transaksi`,
  ].join('\n');
}

function previewSummary(rows: LedgerRow[]): string {
  const totalIn = rows.filter((r) => r.direction === 'INCOME').reduce((sum, r) => sum + r.planned_amount, 0);
  const totalOut = rows.filter((r) => r.direction === 'EXPENSE').reduce((sum, r) => sum + r.planned_amount, 0);
  const parts = [`${rows.length} transaksi`];
  if (totalIn > 0) parts.push(`masuk ${formatRupiah(totalIn)}`);
  if (totalOut > 0) parts.push(`keluar ${formatRupiah(totalOut)}`);
  return parts.join(' · ');
}

export default function BulkExecuteScreen() {
  const router = useRouter();
  const { household } = useAuth();
  const householdId = household?.id;
  const cycleQ = useActiveCycle(householdId);
  const ledgerQ = useTransactionLedger(householdId, cycleQ.data?.id, 'actual');
  const markPaid = useMarkAsPaid();
  const pending = useMemo(() => (ledgerQ.data ?? []).filter((r) => r.status === 'PENDING'), [ledgerQ.data]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedRows = pending.filter((r) => selected.has(r.id));
  const allSelected = pending.length > 0 && selectedRows.length === pending.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function execute() {
    if (selectedRows.length === 0) return;
    setErr(null);
    try {
      for (const row of selectedRows) {
        await markPaid.mutateAsync({
          txn: row,
          actualAmount: row.planned_amount,
          accountId: row.account_id,
          isFinal: false,
        });
      }
      router.back();
    } catch (e: any) {
      setErr(e?.message ?? 'Sebagian transaksi gagal dieksekusi. Coba lagi.');
    }
  }

  async function sharePreview() {
    await Share.share({
      title: 'Ringkasan transaksi Kitasaku',
      message: previewText(selectedRows),
    });
  }

  if (ledgerQ.isLoading || cycleQ.isLoading) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><Text style={styles.muted}>Memuat transaksi…</Text></View></SafeAreaView>;
  }
  if (ledgerQ.isError || cycleQ.isError) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><QueryError onRetry={() => { void ledgerQ.refetch(); void cycleQ.refetch(); }} /><PrimaryButton label="Kembali" onPress={() => router.back()} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.handle} />
        <Text style={styles.eyebrow}>EKSEKUSI BERSAMA</Text>
        <Text style={styles.title}>Pilih transaksi yang sudah terjadi</Text>
        <Text style={styles.muted}>Checklist transaksi yang ingin dicatat sebagai sudah dieksekusi. Nominal rencana akan dipakai.</Text>

        <Pressable style={styles.selectAll} onPress={() => setSelected(allSelected ? new Set() : new Set(pending.map((r) => r.id)))}>
          <Text style={styles.selectAllText}>{allSelected ? 'Batalkan semua pilihan' : 'Pilih semua transaksi'}</Text>
          <Text style={styles.count}>{selectedRows.length}/{pending.length}</Text>
        </Pressable>

        <View style={styles.list}>
          {pending.map((row) => {
            const active = selected.has(row.id);
            return (
              <Pressable key={row.id} onPress={() => toggle(row.id)} style={[styles.row, active && styles.rowActive]}>
                <View style={[styles.checkbox, active && styles.checkboxActive]}>{active && <Check size={16} color={Colors.white} strokeWidth={3} />}</View>
                <View style={styles.rowMain}>
                  <Text style={styles.rowName} numberOfLines={1}>{row.name}</Text>
                  <Text style={styles.rowMeta}>{row.direction === 'INCOME' ? 'Pemasukan' : 'Pengeluaran'} · {row.accounts?.name ?? 'Tanpa akun'}</Text>
                </View>
                <Text style={[styles.amount, row.direction === 'INCOME' && styles.income]}>{row.direction === 'INCOME' ? '+' : '−'}{formatRupiah(row.planned_amount)}</Text>
              </Pressable>
            );
          })}
          {pending.length === 0 && <Text style={styles.muted}>Tidak ada transaksi yang belum dieksekusi.</Text>}
        </View>

        {selectedRows.length > 0 && (
          <View style={styles.previewCard}>
            <View style={styles.previewMain}>
              <Text style={styles.previewTitle}>Ringkasan untuk keluarga</Text>
              <Text style={styles.previewBody}>{previewSummary(selectedRows)}</Text>
            </View>
            <Pressable onPress={() => setShowPreview(true)} style={styles.shareButton}>
              <Share2 size={15} color={Colors.textPrimary} />
              <Text style={styles.shareText}>Bagikan</Text>
            </Pressable>
          </View>
        )}

        <Modal visible={showPreview && selectedRows.length > 0} transparent animationType="fade" onRequestClose={() => setShowPreview(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.previewTitle}>Preview untuk keluarga</Text>
              <Text style={styles.fullPreview}>{previewText(selectedRows)}</Text>
              <Text style={styles.note}>Dibagikan lewat menu sistem perangkat. Dari sana pilih WhatsApp, simpan sebagai catatan, atau aplikasi lain.</Text>
              <View style={styles.previewActions}>
                <View style={{ flex: 1 }}><SecondaryButton label="Tutup" onPress={() => setShowPreview(false)} /></View>
                <Pressable onPress={sharePreview} style={styles.sharePrimary}>
                  <Share2 size={16} color={Colors.white} />
                  <Text style={styles.sharePrimaryText}>Bagikan</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {err && <Text style={styles.error}>{err}</Text>}
        <PrimaryButton label={markPaid.isPending ? 'Mengeksekusi…' : `Eksekusi ${selectedRows.length} transaksi`} onPress={execute} />
        <TextButton label="Kembali" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  container: { padding: 20, gap: 12, paddingBottom: 32 },
  center: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.borderStrong, alignSelf: 'center' },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  title: { color: Colors.textPrimary, fontSize: FontSize.sectionTitle, fontWeight: '700' },
  muted: { color: Colors.textMuted, fontSize: FontSize.body, lineHeight: 19 },
  selectAll: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 13 },
  selectAllText: { color: Colors.textPrimary, fontWeight: '700' },
  count: { color: Colors.textSecondary, fontWeight: '600' },
  list: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  rowActive: { backgroundColor: Colors.paidBg },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  rowMain: { flex: 1, gap: 2 },
  rowName: { color: Colors.textPrimary, fontWeight: '700' },
  rowMeta: { color: Colors.textMuted, fontSize: FontSize.caption },
  amount: { color: Colors.textPrimary, fontWeight: '700', fontVariant: ['tabular-nums'] },
  income: { color: Colors.paidText },
  previewCard: { backgroundColor: Colors.subtle, borderRadius: Radius.md, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewMain: { flex: 1, gap: 3 },
  previewTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: FontSize.body },
  previewBody: { color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 17 },
  fullPreview: { color: Colors.textPrimary, fontSize: FontSize.body, lineHeight: 21 },
  previewActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  // Secondary on the screen itself: sharing is never the reason this screen is open.
  shareButton: { height: 44, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.borderStrong, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 14 },
  shareText: { color: Colors.textPrimary, fontWeight: '700', fontSize: 13 },
  // Primary inside the share modal, where sharing IS the reason it is open.
  sharePrimary: { flex: 1, height: 48, borderRadius: Radius.md, backgroundColor: Colors.brandPrimary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 10 },
  sharePrimaryText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  modalBackdrop: { flex: 1, backgroundColor: Colors.overlayScrimLight, justifyContent: 'center', padding: 20 },
  modalCard: { borderWidth: 1, borderColor: Colors.brandPrimary, borderRadius: Radius.md, padding: 14, gap: 10, backgroundColor: Colors.surface, maxHeight: '85%' },
  error: { color: Colors.pendingText, backgroundColor: Colors.pendingBg, padding: 10, borderRadius: Radius.md },
  note: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 17 },
});
