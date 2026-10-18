import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Colors, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { longDateFullLabel } from '../lib/obligation';
import { memberName } from '../lib/collaboration';
import { paymentBatchIdOf } from '../lib/notifications';
import { batchItemLabel, parseBatchItems } from '../lib/bulk-pay';
import { useAuth } from '../lib/auth-context';
import {
  useBatchTransactions,
  useHouseholdMembers,
  useMarkNotificationRead,
  useNotification,
  usePaymentBatch,
} from '../lib/queries';
import { PrimaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

/**
 * Detail Pembayaran: one bank debit and the rows it paid. Opened from a
 * batch in Riwayat (`id`) or from an OBLIGATIONS_BULK_PAID push
 * (`notification`, resolved to the batch). Labels come from the snapshot the
 * batch kept at payment time; amounts and status are read live.
 */
export default function PaymentBatchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; notification?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;

  const notifQ = useNotification(params.id ? undefined : params.notification);
  const batchId = params.id ?? paymentBatchIdOf(notifQ.data?.payload) ?? undefined;
  const batchQ = usePaymentBatch(householdId, batchId);
  const txnsQ = useBatchTransactions(householdId, batchId);
  const membersQ = useHouseholdMembers(householdId);
  const members = membersQ.data?.members ?? [];
  const markRead = useMarkNotificationRead();

  const notifId = notifQ.data?.id;
  const unread = !!notifQ.data && !notifQ.data.read_at;
  useEffect(() => {
    if (notifId && unread) markRead.mutate(notifId);
    // One-shot, same as Kabar Pembayaran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifId, unread]);

  const batch = batchQ.data ?? null;
  const snapshot = useMemo(() => parseBatchItems(batch?.items), [batch]);
  const txnById = useMemo(() => new Map((txnsQ.data ?? []).map((t) => [t.id, t])), [txnsQ.data]);
  const feeTxn = batch?.fee_transaction_id ? txnById.get(batch.fee_transaction_id) : undefined;

  const loading = (!params.id && notifQ.isLoading) || batchQ.isLoading;
  const failed = notifQ.isError || batchQ.isError;
  const recipients = (batch?.recipient_ids ?? []).map((id) => memberName(members, id) ?? 'Anggota');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn} accessibilityLabel="Kembali">
          <ChevronLeft size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.topTitle}>Detail pembayaran</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {failed ? (
          <QueryError
            onRetry={() => { void notifQ.refetch(); void batchQ.refetch(); }}
            retrying={notifQ.isFetching || batchQ.isFetching}
            message="Pembayaran belum bisa dibaca. Datamu aman."
          />
        ) : loading ? (
          <Text style={styles.cap}>Memuat pembayaran…</Text>
        ) : !batch ? (
          <View style={styles.center}>
            <Text style={styles.title}>Pembayaran tidak ditemukan</Text>
            <Text style={styles.cap}>Mungkin sudah tidak ada di ruang keluarga ini.</Text>
            <PrimaryButton label="Kembali" onPress={() => router.back()} />
          </View>
        ) : (
          <>
            <View style={{ gap: 4 }}>
              <Text style={styles.sub}>
                Bayar {batch.item_count} tanggungan · oleh {memberName(members, batch.created_by) ?? 'Anggota'}
              </Text>
              <Text style={styles.hero}>{formatRupiah(batch.total_debited)}</Text>
              <Text style={styles.cap}>
                Dari {batch.accounts?.name ?? 'rekening'} · {longDateFullLabel(batch.paid_at) ?? batch.paid_at}
              </Text>
            </View>

            {batch.note && (
              <View style={styles.note}>
                <Text style={styles.noteText}>“{batch.note}”</Text>
              </View>
            )}

            {txnsQ.isError ? (
              <QueryError onRetry={() => void txnsQ.refetch()} retrying={txnsQ.isFetching} />
            ) : (
              <View style={styles.list}>
                {snapshot.map((item, idx) => {
                  const live = txnById.get(item.transaction_id);
                  const requester = memberName(members, item.requested_by);
                  const sub = [
                    batchItemLabel(item),
                    requester ? `pengajuan ${requester}` : null,
                    live?.status === 'CANCELLED' ? 'dibatalkan' : null,
                  ].filter(Boolean).join(' · ');
                  return (
                    <Pressable
                      key={item.transaction_id}
                      onPress={live ? () => router.push({ pathname: '/transaction-edit', params: { id: live.id } }) : undefined}
                      disabled={!live}
                      style={[styles.li, (idx < snapshot.length - 1 || !!feeTxn) && styles.liBorder]}
                    >
                      <View style={styles.grow}>
                        <Text style={styles.liTitle}>{item.title}</Text>
                        <Text style={styles.liSub}>{sub}</Text>
                      </View>
                      <Text style={styles.liAmt}>{formatRupiah(live?.actual_amount ?? item.amount)}</Text>
                      {live && <ChevronRight size={16} color={Colors.textMuted} />}
                    </Pressable>
                  );
                })}
                {batch.fee_amount > 0 && (
                  <Pressable
                    onPress={feeTxn ? () => router.push({ pathname: '/transaction-edit', params: { id: feeTxn.id } }) : undefined}
                    disabled={!feeTxn}
                    style={[styles.li, styles.liFee]}
                  >
                    <View style={styles.grow}>
                      <Text style={styles.liTitle}>Biaya transfer</Text>
                      <Text style={styles.liSub}>{feeTxn?.categories?.name ?? 'Biaya Transfer'}</Text>
                    </View>
                    <Text style={styles.liAmt}>{formatRupiah(feeTxn?.actual_amount ?? batch.fee_amount)}</Text>
                    {feeTxn && <ChevronRight size={16} color={Colors.textMuted} />}
                  </Pressable>
                )}
              </View>
            )}

            {recipients.length > 0 && (
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Dikabari ke</Text>
                <Text style={styles.statValue}>{recipients.join(', ')}</Text>
              </View>
            )}
            <Text style={styles.cap}>
              Ketuk baris untuk melihat atau mengoreksi transaksinya. Pembayaran yang sudah tercatat tidak dibatalkan dari sini.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  container: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, gap: 18 },
  center: { gap: 10, paddingTop: 40 },
  title: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  sub: { fontSize: 13, color: Colors.textSecondary },
  hero: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5, color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  cap: { fontSize: 12, color: Colors.textSecondary },
  grow: { flex: 1, gap: 2 },
  note: { backgroundColor: Colors.canvas, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12 },
  noteText: { fontSize: 14, fontStyle: 'italic', color: Colors.textSecondary },
  list: { borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.lg, overflow: 'hidden' },
  li: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, minHeight: 56 },
  liBorder: { borderBottomWidth: 1, borderBottomColor: Colors.subtle },
  liFee: { backgroundColor: Colors.alertBg },
  liTitle: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  liSub: { fontSize: 12, color: Colors.textSecondary },
  liAmt: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  stat: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  statLabel: { fontSize: 13, color: Colors.textSecondary },
  statValue: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, flexShrink: 1, textAlign: 'right' },
});
