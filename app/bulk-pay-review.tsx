import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import CirclePlus from 'lucide-react-native/icons/circle-plus';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import { Colors, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { longDateFullLabel } from '../lib/obligation';
import { memberName } from '../lib/collaboration';
import { useAuth } from '../lib/auth-context';
import {
  useAccounts,
  useActiveCycle,
  useBulkPayPreview,
  useHouseholdMembers,
  usePayObligationsBulk,
  useZeroBasedSummary,
} from '../lib/queries';
import {
  bulkPayNotification,
  bulkPayRecipients,
  decodeDraft,
  previewHeaderLine,
  previewItemLabel,
} from '../lib/bulk-pay';
import { PrimaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

/**
 * Cek sebelum bayar. Step 1 of 2: the server's verdict on the draft from
 * Quick Add (preview_pay_obligations_bulk). Step 2 is one atomic RPC.
 */
export default function BulkPayReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ draft?: string }>();
  const draft = useMemo(() => decodeDraft(params.draft), [params.draft]);
  const { household, session } = useAuth();
  const householdId = household?.id;
  const myUserId = session?.user.id;

  const accsQ = useAccounts(householdId);
  const cycleQ = useActiveCycle(householdId);
  const summaryQ = useZeroBasedSummary(householdId, cycleQ.data?.id, 'planned');
  const membersQ = useHouseholdMembers(householdId);
  const members = useMemo(() => membersQ.data?.members ?? [], [membersQ.data]);
  const pay = usePayObligationsBulk();
  const [err, setErr] = useState<string | null>(null);

  const args = useMemo(
    () =>
      draft && householdId
        ? {
            householdId,
            accountId: draft.accountId,
            paidAt: draft.paidAt,
            items: draft.items,
            totalDebited: draft.totalDebited,
            feeCategoryId: draft.feeCategoryId,
          }
        : null,
    [draft, householdId]
  );
  const previewQ = useBulkPayPreview(args);
  const preview = previewQ.data;

  const accountName = accsQ.data?.find((a) => a.id === draft?.accountId)?.name ?? 'rekening';
  const items = preview?.items ?? [];
  const fee = preview?.fee_amount ?? 0;
  const badCount = items.filter((i) => !i.ok).length;
  const canPay = !!preview && !preview.error && preview.all_ok && badCount === 0 && !previewQ.isFetching;

  const unallocatedAfter =
    summaryQ.data && preview && !preview.error
      ? summaryQ.data.unallocatedFunds - (preview.extra_allocation ?? 0)
      : null;

  const recipients = useMemo(() => {
    if (!preview || !draft || !myUserId) return [];
    return bulkPayRecipients({
      payerId: myUserId,
      requesters: preview.items.map((i) => i.requested_by),
      chosen: draft.notifyIds,
      itemCount: preview.items.length,
      fee,
    });
  }, [preview, draft, myUserId, fee]);

  async function submit() {
    if (!args || !draft || !canPay) return;
    setErr(null);
    try {
      const batchId = await pay.mutateAsync({ ...args, note: draft.note, notifyIds: draft.notifyIds });
      router.dismissAll();
      router.push({ pathname: '/payment-batch', params: { id: batchId } });
    } catch (e: any) {
      setErr(e?.message ?? 'Pembayaran gagal. Tidak ada yang dicatat — coba lagi.');
      void previewQ.refetch();
    }
  }

  if (!draft) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.title}>Data pembayaran tidak lengkap</Text>
          <Text style={styles.cap}>Buka lagi dari Tambah Transaksi.</Text>
          <PrimaryButton label="Kembali" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn} accessibilityLabel="Kembali">
          <ChevronLeft size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.topTitle}>Cek sebelum bayar</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={{ gap: 4 }}>
          <Text style={styles.sub}>Dari {accountName} · {longDateFullLabel(draft.paidAt) ?? draft.paidAt}</Text>
          <Text style={styles.hero}>{formatRupiah(draft.totalDebited)}</Text>
          {preview && !preview.error && (
            <Text style={styles.cap}>{previewHeaderLine(items.length, fee, preview.remainder_plans ?? 0)}</Text>
          )}
        </View>

        {previewQ.isError ? (
          <QueryError onRetry={() => void previewQ.refetch()} retrying={previewQ.isFetching} message="Pembayaran belum bisa dicek. Belum ada yang dicatat." />
        ) : previewQ.isLoading || !preview ? (
          <Text style={styles.cap}>Mengecek ke server…</Text>
        ) : (
          <>
            {preview.error && <Text style={styles.noticeErr}>{preview.error}</Text>}
            {!preview.error && badCount > 0 && (
              <Text style={styles.noticeErr}>
                {badCount} tanggungan belum bisa dibayar di sini. Kembali ke form dan keluarkan dari pilihan untuk melanjutkan.
              </Text>
            )}

            {items.length > 0 && (
              <View style={styles.list}>
                {items.map((i, idx) => (
                  <View
                    key={`${i.obligation_id}-${idx}`}
                    style={[styles.li, !i.ok && styles.liBad, (idx < items.length - 1 || fee > 0) && styles.liBorder]}
                  >
                    {i.ok ? (
                      <CircleCheck size={20} color={Colors.paidText} />
                    ) : (
                      <TriangleAlert size={20} color={Colors.pendingBorder} />
                    )}
                    <View style={styles.grow}>
                      <Text style={styles.liTitle}>{i.title ?? 'Tanggungan'}</Text>
                      <Text style={[styles.liSub, !i.ok && styles.liSubBad]}>{previewItemLabel(i)}</Text>
                    </View>
                    <Text style={styles.liAmt}>{formatRupiah(i.amount)}</Text>
                  </View>
                ))}
                {fee > 0 && (
                  <View style={[styles.li, styles.liFee]}>
                    <CirclePlus size={20} color={Colors.financingText} />
                    <View style={styles.grow}>
                      <Text style={styles.liTitle}>Biaya transfer</Text>
                      <Text style={styles.liSub}>
                        Pengeluaran · {preview.fee_category_name ?? 'Biaya Transfer'}
                        {preview.fee_category_new ? ' (baru)' : ''} · bukan tanggungan
                      </Text>
                    </View>
                    <Text style={styles.liAmt}>{formatRupiah(fee)}</Text>
                  </View>
                )}
              </View>
            )}

            {!preview.error && badCount === 0 && (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Dampak ke siklus</Text>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Rencana dieksekusi</Text>
                  <Text style={styles.statValue}>{preview.plans_executed ?? 0}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Alokasi tambahan</Text>
                  <Text style={styles.statValue}>{formatRupiah(preview.extra_allocation ?? 0)}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Belum dialokasikan setelahnya</Text>
                  <Text style={[styles.statValue, unallocatedAfter !== null && unallocatedAfter < 0 && styles.neg]}>
                    {unallocatedAfter === null ? '—' : formatRupiah(unallocatedAfter)}
                  </Text>
                </View>
              </View>
            )}

            {!preview.error && badCount === 0 && recipients.map((r) => {
              const notice = bulkPayNotification({
                payerName: memberName(members, myUserId) ?? 'Anggota',
                accountName,
                paidAt: draft.paidAt,
                totalDebited: draft.totalDebited,
                fee,
                note: draft.note,
                items: items.map((i) => ({
                  title: i.title,
                  amount: i.amount,
                  installmentCount: i.installment_count,
                  remainingAfter: i.remaining_after,
                  requestedBy: i.requested_by,
                })),
                recipientId: r,
              });
              return (
                <View key={r} style={{ gap: 8 }}>
                  <Text style={styles.panelTitle}>Notifikasi ke {memberName(members, r) ?? 'anggota'}</Text>
                  <View style={styles.notice}>
                    <Text style={styles.noticeTitle}>{notice.title}</Text>
                    <Text style={styles.noticeBody}>{notice.body}</Text>
                  </View>
                </View>
              );
            })}

            <Text style={styles.cap}>Kalau satu baris gagal saat diproses, tidak ada yang dibayar.</Text>
          </>
        )}

        {err && <Text style={styles.noticeErr}>{err}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        {preview && (preview.error || badCount > 0) ? (
          <Pressable onPress={() => router.back()} style={styles.cta} accessibilityRole="button">
            <Text style={styles.ctaText}>Kembali ke form</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={submit}
            disabled={!canPay || pay.isPending}
            style={[styles.cta, (!canPay || pay.isPending) && styles.ctaOff]}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>
              {pay.isPending ? 'Memproses…' : `Bayar ${draft.items.length} tanggungan`}
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  container: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, gap: 18 },
  center: { flex: 1, padding: 24, gap: 10, justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  sub: { fontSize: 13, color: Colors.textSecondary },
  hero: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  cap: { fontSize: 12, color: Colors.textSecondary },
  grow: { flex: 1, gap: 2 },
  noticeErr: {
    backgroundColor: Colors.pendingBg, color: Colors.pendingText, borderRadius: Radius.md,
    padding: 12, fontSize: 12.5, lineHeight: 18, overflow: 'hidden',
  },
  list: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.lg, overflow: 'hidden' },
  li: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  liBorder: { borderBottomWidth: 1, borderBottomColor: Colors.subtle },
  liBad: { backgroundColor: Colors.pendingBg },
  liFee: { backgroundColor: Colors.alertBg },
  liTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  liSub: { fontSize: 12, color: Colors.textSecondary },
  liSubBad: { color: Colors.pendingText },
  liAmt: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  panel: { backgroundColor: Colors.canvas, borderRadius: Radius.lg, padding: 16, gap: 10 },
  panelTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  stat: { flexDirection: 'row', justifyContent: 'space-between' },
  statLabel: { fontSize: 14, color: Colors.textSecondary },
  statValue: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  neg: { color: Colors.pendingText },
  notice: { backgroundColor: Colors.canvas, borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: 14, padding: 14, gap: 4 },
  noticeTitle: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  noticeBody: { fontSize: 12, lineHeight: 18, color: Colors.textSecondary },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  cta: { height: 52, borderRadius: Radius.lg, backgroundColor: Colors.navy, alignItems: 'center', justifyContent: 'center' },
  ctaOff: { opacity: 0.45 },
  ctaText: { color: Colors.white, fontSize: 16, fontWeight: '700' },
});
