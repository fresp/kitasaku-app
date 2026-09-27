import { Pressable, StyleSheet, Text, View } from 'react-native';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import { Colors, FontSize, Radius } from '../../constants/theme';

/**
 * The "the request failed" card, shared by every screen that reads money.
 *
 * Before this existed, a failed query fell through to the same empty state as a
 * genuinely empty cycle — so a dropped connection read as "Belum ada transaksi
 * di siklus ini", which is both false and reassuring. On a ledger that is the
 * worst possible failure: the family concludes there is nothing to pay.
 *
 * It is deliberately one component with one sentence, because the distinction
 * that matters is *failed* vs *empty*, not which table failed. `message` exists
 * only for the cases where the screen can say something more useful (a missing
 * transaction, say) — otherwise leave it out.
 */
export function QueryError({
  onRetry,
  message,
  retrying,
}: {
  onRetry: () => void;
  /** Overrides the default sentence. Keep it about the failed load, not a guess. */
  message?: string;
  retrying?: boolean;
}) {
  return (
    <View style={styles.box} accessibilityRole="alert">
      <Text style={styles.title}>Gagal memuat data</Text>
      <Text style={styles.body}>
        {message ??
          'Koneksi ke server terputus, jadi angka di layar ini belum bisa dipercaya. Datamu tidak hilang.'}
      </Text>
      <Pressable
        onPress={onRetry}
        disabled={retrying}
        style={styles.retry}
        accessibilityRole="button"
        accessibilityLabel="Coba muat ulang"
      >
        <RotateCcw size={13} color={Colors.textPrimary} />
        <Text style={styles.retryText}>{retrying ? 'Memuat…' : 'Coba lagi'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: Colors.pendingBg, borderWidth: 1, borderColor: '#FECACA',
    borderRadius: Radius.md, padding: 14, gap: 6,
  },
  title: { color: Colors.pendingText, fontSize: FontSize.body, fontWeight: '700' },
  body: { color: Colors.pendingText, fontSize: FontSize.caption, lineHeight: 17 },
  retry: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle,
    borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 7, marginTop: 4,
  },
  retryText: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '700' },
});
