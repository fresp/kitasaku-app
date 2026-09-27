import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Calendar from 'lucide-react-native/icons/calendar';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Landmark from 'lucide-react-native/icons/landmark';
import LogOut from 'lucide-react-native/icons/log-out';
import Palette from 'lucide-react-native/icons/palette';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import Sparkles from 'lucide-react-native/icons/sparkles';
import Users from 'lucide-react-native/icons/users';
import Wallet from 'lucide-react-native/icons/wallet';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { useAuth } from '../../lib/auth-context';
import { useActiveCycle, useUpdateMyMemberProfile } from '../../lib/queries';
import {
  memberDisplayName,
  memberInitials,
  paydayLabel,
  roleLabel,
} from '../../lib/profile';
import { Badge } from '../../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';

/**
 * Screen "My Profile".
 *
 * The identity block edits the caller's own display name — the only part of
 * this screen the user owns. Household facts (name, payday, members) live one
 * tap away in Ruang Keluarga, because changing the family's name from a screen
 * headed "My Profile" would be a surprise.
 *
 * Rows for features that do not exist yet are rendered as plainly unavailable
 * rather than as chevrons that lead nowhere: this is a money app, and a menu
 * that lies about what it opens is worse than a short menu.
 */

interface MenuRow {
  key: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  title: string;
  sub?: string;
  tone: 'paid' | 'alert' | 'default';
  onPress?: () => void;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { household, membership, session, signOut, refresh } = useAuth();
  const householdId = household?.id;

  const cycleQ = useActiveCycle(householdId);
  const updateMe = useUpdateMyMemberProfile();

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // The row is driven by `membership` from AuthProvider, which holds the
  // caller's own row — the same source the roster RPC reads, so the name here
  // and the name in Ruang Keluarga can never disagree.
  const me = {
    displayName: membership?.display_name ?? null,
    role: membership?.role ?? 'PARTNER',
  };

  const initials = memberInitials(me.displayName ?? me.role);
  const notifyOn = membership?.notify_partner_expense ?? true;
  const realtimeOn = !!householdId;

  async function saveName() {
    setErr(null);
    if (!householdId) {
      setErr('Login dulu untuk menyimpan nama.');
      return;
    }
    try {
      await updateMe.mutateAsync({ householdId, displayName: nameDraft });
      await refresh();
      setEditing(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan nama.');
    }
  }

  async function toggleNotify(next: boolean) {
    setErr(null);
    if (!householdId) return;
    try {
      await updateMe.mutateAsync({ householdId, notifyPartnerExpense: next });
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan preferensi.');
    }
  }

  const financeRows: MenuRow[] = [
    {
      key: 'insight',
      icon: Landmark,
      title: 'Insight & Aset 2026',
      sub: 'Analisis tren bulanan, cashflow, aset likuid & kewajiban',
      tone: 'paid',
      onPress: () => router.push('/asset-insight'),
    },
    {
      key: 'categories',
      icon: Sparkles,
      title: 'Kelola Kategori',
      sub: 'Atur kategori pengeluaran dan ikon',
      tone: 'alert',
      onPress: () => router.push('/manage-categories'),
    },
  ];

  const householdRows: MenuRow[] = [
    {
      key: 'household',
      icon: Users,
      title: 'Ruang Keluarga',
      sub: household
        ? `${household.name} · ${household.payday_day ? paydayLabel(household.payday_day, 'meta') : 'payday belum diatur'}`
        : 'Belum terhubung',
      tone: 'default',
      onPress: () => router.push('/household'),
    },
    {
      key: 'invite',
      icon: Users,
      title: 'Undang Pasangan',
      sub: 'Bagikan kode atau QR untuk bergabung',
      tone: 'default',
      onPress: () => router.push({ pathname: '/household', params: { focus: 'invite' } }),
    },
  ];

  const accountRows: (MenuRow & { soon?: boolean })[] = [
    {
      key: 'managed-account',
      icon: Wallet,
      title: 'Kelola Akun',
      sub: 'Atur rekening, kartu, dan e-wallet keluarga',
      tone: 'default',
      onPress: () => router.push('/manage-accounts'),
      soon: false,
    },
    { key: 'appearance', icon: Palette, title: 'Preferensi tampilan', tone: 'default', soon: true },
    { key: 'security', icon: ShieldCheck, title: 'Keamanan & privasi', tone: 'default', soon: true },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>AKUN &amp; RUANG KELUARGA</Text>
          <Text style={styles.title}>My Profile</Text>
          <Text style={styles.supporting}>
            Kelola akun, kategori, dan insight keuangan keluarga.
          </Text>
        </View>

        <Pressable
          onPress={() => {
            setNameDraft(me.displayName ?? '');
            setEditing((v) => !v);
            setErr(null);
          }}
          style={styles.identity}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {memberDisplayName(me.displayName, me.role)}
              </Text>
              <Badge label={roleLabel(me.role)} tone="paid" />
            </View>
            <Text style={styles.householdName} numberOfLines={1}>
              {household?.name ?? 'Belum ada ruang keluarga'}
            </Text>
          </View>
          <ChevronRight size={16} color={Colors.textMuted} />
        </Pressable>

        {editing && (
          <View style={styles.form}>
            <Text style={styles.label}>NAMA SAYA</Text>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder="Andra"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />
            <Text style={styles.hint}>
              Nama ini yang muncul di Ruang Keluarga — pasangan melihat nama yang kamu tulis
              sendiri, bukan alamat email.
            </Text>
            <PrimaryButton
              label={updateMe.isPending ? 'Menyimpan…' : 'Simpan Nama'}
              onPress={saveName}
            />
            <SecondaryButton label="Batal" onPress={() => { setEditing(false); setErr(null); }} />
          </View>
        )}

        <View style={styles.summary}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.summaryLabel}>SIKLUS AKTIF</Text>
            <Text style={styles.summaryValue}>
              {cycleQ.data?.name ?? 'Belum ada siklus'}
            </Text>
          </View>
          <View style={styles.summaryRight}>
            <Calendar size={14} color={Colors.textMuted} />
            <Text style={styles.summaryMeta}>
              {paydayLabel(household?.payday_day, 'row')}
            </Text>
          </View>
        </View>

        <Text style={styles.section}>KEUANGAN</Text>
        <View style={styles.group}>
          {financeRows.map((r, i) => (
            <MenuRowView key={r.key} row={r} first={i === 0} />
          ))}
        </View>

        <Text style={styles.section}>RUANG KELUARGA</Text>
        <View style={styles.group}>
          {householdRows.map((r, i) => (
            <MenuRowView key={r.key} row={r} first={i === 0} />
          ))}
          <View style={[styles.row, styles.rowBordered]}>
            <View style={styles.iconBox}>
              <Users size={16} color={Colors.textSecondary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.rowTitle}>Notifikasi &amp; Sinkronisasi</Text>
              <Text style={styles.rowSub}>
                {realtimeOn ? 'Real-time aktif' : 'Real-time nonaktif'} ·{' '}
                {notifyOn ? 'notifikasi pengeluaran pasangan aktif' : 'notifikasi dimatikan'}
              </Text>
            </View>
            <Switch
              value={notifyOn}
              onValueChange={toggleNotify}
              disabled={!householdId}
              trackColor={{ false: Colors.borderStrong, true: Colors.paidText }}
            />
          </View>
        </View>

        <Text style={styles.section}>AKUN</Text>
        <View style={styles.group}>
          {accountRows.map((r, i) => (
            <MenuRowView key={r.key} row={r} first={i === 0} soon={r.soon} />
          ))}
        </View>

        <Pressable onPress={() => void signOut()} style={styles.signOut}>
          <LogOut size={16} color={Colors.pendingText} />
          <Text style={styles.signOutText}>Keluar dari akun</Text>
        </Pressable>

        {session?.user?.email && (
          <Text style={styles.footer}>{session.user.email}</Text>
        )}

        {err && (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * A menu row. `soon` renders the row without a chevron and without a press
 * handler — the design's list shape is preserved, but nothing claims to open.
 */
function MenuRowView({ row, first, soon }: { row: MenuRow; first: boolean; soon?: boolean }) {
  const Icon = row.icon;
  const disabled = soon || !row.onPress;
  const boxStyle =
    row.tone === 'paid' ? styles.iconBoxPaid : row.tone === 'alert' ? styles.iconBoxAlert : styles.iconBox;
  const iconColor =
    row.tone === 'paid' ? Colors.paidText : row.tone === 'alert' ? Colors.alertText : Colors.textSecondary;

  return (
    <Pressable
      onPress={disabled ? undefined : row.onPress}
      disabled={disabled}
      style={[styles.row, !first && styles.rowBordered, soon && styles.rowSoon]}
    >
      <View style={boxStyle}>
        <Icon size={16} color={iconColor} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle}>{row.title}</Text>
        {row.sub && <Text style={styles.rowSub}>{row.sub}</Text>}
      </View>
      {soon ? <Badge label="Segera" tone="default" /> : <ChevronRight size={16} color={Colors.textMuted} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  header: { gap: 2 },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700' },
  supporting: { color: Colors.textSecondary, fontSize: FontSize.body, marginTop: 2 },

  identity: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14,
  },
  avatar: {
    width: 48, height: 48, borderRadius: Radius.pill, backgroundColor: Colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: Colors.white, fontSize: 18, fontWeight: '700' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700', flexShrink: 1 },
  householdName: { color: Colors.textSecondary, fontSize: FontSize.body },

  form: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14, gap: 8,
  },
  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  input: {
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary,
    backgroundColor: Colors.canvas,
  },
  hint: { color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 16 },

  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14,
  },
  summaryLabel: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  summaryValue: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '600' },
  summaryRight: { alignItems: 'flex-end', gap: 2, flexShrink: 1 },
  summaryMeta: { color: Colors.textSecondary, fontSize: FontSize.caption, textAlign: 'right' },

  section: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 1, marginTop: 4 },
  group: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  rowBordered: { borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  rowSoon: { opacity: 0.55 },
  iconBox: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.subtle,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  iconBoxPaid: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.paidBg,
    borderWidth: 1, borderColor: Colors.paidBg, alignItems: 'center', justifyContent: 'center',
  },
  iconBoxAlert: {
    width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.alertBg,
    borderWidth: 1, borderColor: Colors.alertBg, alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  rowSub: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 15 },

  signOut: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.pendingBg, borderRadius: Radius.md, paddingVertical: 14, marginTop: 4,
  },
  signOutText: { color: Colors.pendingText, fontSize: 13.5, fontWeight: '700' },
  footer: { color: Colors.textMuted, fontSize: FontSize.caption, textAlign: 'center' },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
