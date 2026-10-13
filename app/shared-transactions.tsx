import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import { Colors, Radius } from '../constants/theme';
import { formatRupiah } from '../lib/format';
import { useAuth } from '../lib/auth-context';
import {
  useHouseholdMembers,
  useMarkNotificationRead,
  useNotification,
  useTransactionsByIds,
} from '../lib/queries';
import { memberName, shareSummary } from '../lib/collaboration';
import { sharedNote, sharedTransactionIds } from '../lib/notifications';
import { longDateFullLabel } from '../lib/obligation';
import { PrimaryButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/QueryError';

/**
 * Kabar Pembayaran — what a member sees after tapping a TRANSACTIONS_SHARED
 * push. The items are read live from transactions, so an edit or a
 * cancellation after the kabar was sent shows truthfully rather than as the
 * message once claimed.
 */
export default function SharedTransactionsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { household } = useAuth();
  const householdId = household?.id;

  const notifQ = useNotification(id);
  const notif = notifQ.data ?? null;
  const ids = useMemo(() => sharedTransactionIds(notif?.payload), [notif]);
  const txnsQ = useTransactionsByIds(householdId, ids);
  const membersQ = useHouseholdMembers(householdId);
  const members = membersQ.data?.members ?? [];
  const markRead = useMarkNotificationRead();

  const notifId = notif?.id;
  const unread = !!notif && !notif.read_at;
  useEffect(() => {
    if (notifId && unread) markRead.mutate(notifId);
    // markRead is stable enough for a one-shot; re-running on its identity
    // would mark the same row repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifId, unread]);

  const rows = txnsQ.data ?? [];
  const summary = shareSummary(
    rows.map((t) => ({ direction: t.direction, amount: t.status === 'PAID' ? t.actual_amount : t.planned_amount })),
  );
  const who = memberName(members, notif?.actor_user_id) ?? 'Anggota';
  const note = sharedNote(notif?.payload);
  const sentAt = notif ? new Date(notif.created_at) : null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn} accessibilityLabel="Kembali">
          <ChevronLeft size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.topTitle}>Kabar Pembayaran</Text>
        <View style={styles.backBtn} />
      </View>
      <ScrollView contentContainerStyle={styles.container}>
        {notifQ.isError ? (
          <QueryError onRetry={() => void notifQ.refetch()} retrying={notifQ.isFetching} message="Kabar belum bisa dibaca. Datamu aman." />
        ) : notifQ.isLoading ? (
          <Text style={styles.muted}>Memuat kabar…</Text>
        ) : !notif ? (
          <View style={styles.center}>
            <Text style={styles.title}>Kabar tidak ditemukan</Text>
            <Text style={styles.muted}>Mungkin kabar ini ditujukan ke anggota lain.</Text>
            <PrimaryButton label="Kembali" onPress={() => router.back()} />
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{who.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.title}>{notif.title}</Text>
                {sentAt && (
                  <Text style={styles.meta}>
                    {longDateFullLabel(notif.created_at.slice(0, 10))} ·{' '}
                    {sentAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                )}
              </View>
            </View>

            {note && (
              <View style={styles.noteBubble}>
                <Text style={styles.noteText}>{note}</Text>
              </View>
            )}

            {txnsQ.isError ? (
              <QueryError onRetry={() => void txnsQ.refetch()} retrying={txnsQ.isFetching} />
            ) : (
              <View style={styles.card}>
                {txnsQ.isLoading && <Text style={[styles.muted, { paddingVertical: 12 }]}>Memuat transaksi…</Text>}
                {!txnsQ.isLoading && rows.length === 0 && (
                  <Text style={[styles.muted, { paddingVertical: 12 }]}>Transaksinya sudah tidak tersedia.</Text>
                )}
                {rows.map((t, idx) => {
                  const amount = t.status === 'PAID' ? t.actual_amount : t.planned_amount;
                  const cancelled = !!(t as { cancelled_at?: string | null }).cancelled_at;
                  return (
                    <View key={t.id} style={[styles.row, idx < rows.length - 1 && styles.rowBorder]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.rowName}>{t.name}</Text>
                        <Text style={styles.rowMeta}>
                          {[t.accounts?.name, t.release_date ? longDateFullLabel(t.release_date) : null,
                            cancelled ? 'Dibatalkan' : t.status === 'PAID' ? null : 'Belum dibayar']
                            .filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <Text style={[styles.rowAmt, t.direction === 'INCOME' && styles.income]}>
                        {t.direction === 'INCOME' ? '+' : ''}{formatRupiah(amount)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {rows.length > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{summary.totalIn > 0 && summary.totalOut === 0 ? 'Total masuk' : 'Total keluar'}</Text>
                <Text style={styles.totalValue}>
                  {formatRupiah(summary.totalIn > 0 && summary.totalOut === 0 ? summary.totalIn : summary.totalOut)}
                </Text>
              </View>
            )}

            <Pressable onPress={() => router.push('/(tabs)/history')} style={styles.secondaryBtn} accessibilityRole="button">
              <Text style={styles.secondaryText}>Lihat di Riwayat</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  container: { padding: 16, gap: 14, paddingBottom: 40 },
  center: { gap: 10, paddingTop: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.navy, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
  title: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  meta: { fontSize: 12, color: Colors.textSecondary },
  muted: { fontSize: 13, color: Colors.textMuted },
  noteBubble: { backgroundColor: Colors.subtle, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  noteText: { fontSize: 13, lineHeight: 19, color: Colors.textPrimary },
  card: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.subtle, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.subtle },
  rowName: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  rowMeta: { fontSize: 11, color: Colors.textSecondary },
  rowAmt: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  income: { color: Colors.paidText },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  totalLabel: { fontSize: 14, color: Colors.textSecondary },
  totalValue: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  secondaryBtn: {
    height: 50, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.borderSubtle,
    backgroundColor: Colors.canvas, alignItems: 'center', justifyContent: 'center',
  },
  secondaryText: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
});
