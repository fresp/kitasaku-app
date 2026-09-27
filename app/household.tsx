import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import Check from 'lucide-react-native/icons/check';
import Copy from 'lucide-react-native/icons/copy';
import Pencil from 'lucide-react-native/icons/pencil';
import QrCode from 'lucide-react-native/icons/qr-code';
import Share2 from 'lucide-react-native/icons/share-2';
import { Colors, FontSize, Radius } from '../constants/theme';
import { BrandIcon } from '../components/ui/BrandIcon';
import { useAuth } from '../lib/auth-context';
import { buildInviteMessage } from '../lib/household';
import { useHouseholdMembers, useUpdateHousehold, useUpdateMyMemberProfile } from '../lib/queries';
import {
  householdMeta,
  joinedMonthLabel,
  memberCountLabel,
  memberDisplayName,
  memberInitials,
  paydayLabel,
  roleLabel,
  rosterLabel,
} from '../lib/profile';
import { Badge } from '../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../components/ui/Button';

/**
 * Screen 14 — Ruang Keluarga.
 *
 * Three jobs: name the family, hand over the invite code, and show who is in
 * it. The code is the only authority-bearing value on the screen, so it gets
 * the copy/WhatsApp/QR treatment; the name and payday are ordinary edits.
 *
 * The roster comes from a household-scoped SECURITY DEFINER RPC because the
 * client cannot read `auth.users` (where the emails live) and the 001 policy
 * on household_members exposes only the caller's own row. When that RPC is
 * missing the hook reports `partial` and this screen says so out loud — a
 * roster that silently shows one member when there are two would look like the
 * partner had left.
 */

export default function HouseholdScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string }>();
  const { household, membership, refresh } = useAuth();
  const householdId = household?.id;

  const membersQ = useHouseholdMembers(householdId);
  const updateHousehold = useUpdateHousehold();
  const updateMe = useUpdateMyMemberProfile();

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(household?.name ?? '');
  const [paydayDraft, setPaydayDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // "Undang Pasangan" on My Profile opens this screen with focus=invite. The
  // param is read once as the initial value rather than synced in an effect:
  // the route param for a pushed screen does not change while it is mounted,
  // and an effect that setState'd on mount would just cause a second render.
  const [showQr, setShowQr] = useState(params.focus === 'invite');

  const code = household?.invite_code ?? null;
  const members = membersQ.data?.members ?? [];
  const partial = membersQ.data?.partial ?? false;
  const memberCount = members.length || (membership ? 1 : 0);

  const message = useMemo(
    () => (code ? buildInviteMessage(household?.name ?? 'Ruang Keluarga', code) : ''),
    [code, household?.name]
  );

  const myNotify = membership?.notify_partner_expense ?? true;

  async function copyCode() {
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyalin kode.');
    }
  }

  async function shareWhatsApp() {
    if (!code) return;
    try {
      const url = `whatsapp://send?text=${encodeURIComponent(message)}`;
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
      else await Share.share({ message });
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal membuka WhatsApp.');
    }
  }

  async function saveName() {
    setErr(null);
    if (!householdId) return;
    try {
      await updateHousehold.mutateAsync({
        id: householdId,
        name: nameDraft,
        // Only send the payday when a value was typed. An empty box must not
        // clear a payday the family already set.
        paydayDay: paydayDraft.trim() === '' ? undefined : parseInt(paydayDraft, 10),
      });
      await refresh();
      setEditingName(false);
      setPaydayDraft('');
    } catch (e: any) {
      setErr(e?.message ?? 'Gagal menyimpan ruang keluarga.');
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

  const meta = householdMeta([
    household ? household.name : null,
    paydayLabel(household?.payday_day, 'meta'),
    joinedMonthLabel(household?.created_at),
  ]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.nav}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={18} color={Colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>PENGATURAN  •  HOUSEHOLD</Text>
            <Text style={styles.title}>Ruang Keluarga</Text>
          </View>
        </View>

        {!householdId && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Belum terhubung ke ruang keluarga. Login dulu supaya kode undangan muncul di sini.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.familyBox}>
              <BrandIcon name="context-family" size={40} label="" />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {household?.name ?? 'Belum ada ruang keluarga'}
                </Text>
                <Pressable
                  onPress={() => {
                    setNameDraft(household?.name ?? '');
                    setEditingName((v) => !v);
                    setErr(null);
                  }}
                  hitSlop={10}
                >
                  <Pencil size={14} color={Colors.textMuted} />
                </Pressable>
              </View>
              <Text style={styles.meta}>{meta || 'Belum ada data household'}</Text>
            </View>
          </View>

          {editingName && (
            <View style={styles.form}>
              <Text style={styles.label}>NAMA RUANG KELUARGA</Text>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="Keluarga Andra"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
              />
              <Text style={styles.label}>TANGGAL PAYDAY (1–31)</Text>
              <TextInput
                value={paydayDraft}
                onChangeText={setPaydayDraft}
                placeholder={household?.payday_day ? String(household.payday_day) : '25'}
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                style={styles.input}
              />
              <Text style={styles.hint}>
                Payday menentukan batas siklus (payday-to-payday). Kosongkan kalau belum mau
                diatur — nilai yang sudah ada tidak akan terhapus.
              </Text>
              <PrimaryButton
                label={updateHousehold.isPending ? 'Menyimpan…' : 'Simpan'}
                onPress={saveName}
              />
              <SecondaryButton
                label="Batal"
                onPress={() => { setEditingName(false); setPaydayDraft(''); setErr(null); }}
              />
            </View>
          )}
        </View>

        <View style={styles.invite}>
          <Text style={styles.inviteH}>UNDANG PASANGAN (ISTRI)</Text>
          <Text style={styles.inviteD}>
            Bagikan kode ini agar pasangan bisa melihat &amp; mencatat anggaran yang sama
            real-time.
          </Text>

          <View style={styles.codeBox}>
            <Text style={styles.code}>{code ?? '——'}</Text>
            <Pressable onPress={copyCode} style={styles.copyBtn} disabled={!code}>
              {copied ? (
                <Check size={13} color={Colors.white} />
              ) : (
                <Copy size={13} color={Colors.white} />
              )}
              <Text style={styles.copyText}>{copied ? 'Tersalin' : 'Salin Kode'}</Text>
            </Pressable>
          </View>

          <View style={styles.actionRow}>
            <Pressable onPress={shareWhatsApp} style={[styles.action, styles.actionPrimary]} disabled={!code}>
              <Share2 size={14} color={Colors.white} />
              <Text style={styles.actionPrimaryText}>Via WhatsApp</Text>
            </Pressable>
            <Pressable onPress={() => setShowQr((v) => !v)} style={styles.action} disabled={!code}>
              <QrCode size={14} color={Colors.textPrimary} />
              <Text style={styles.actionText}>{showQr ? 'Sembunyikan QR' : 'Tampilkan QR'}</Text>
            </Pressable>
          </View>

          {showQr && code && (
            <View style={styles.qrBox}>
              <QrPanel value={code} />
              <Text style={styles.qrHint}>
                Pasangan cukup memindai kode ini, atau ketik manual: {code}
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.section}>{rosterLabel(memberCount)}</Text>

        {membersQ.isLoading && <Text style={styles.muted}>Memuat anggota…</Text>}

        {members.length > 0 && (
          <View style={styles.group}>
            {members.map((m, i) => (
              <View key={m.id} style={[styles.member, i > 0 && styles.rowBordered]}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>
                    {memberInitials(m.display_name ?? m.role)}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {memberDisplayName(m.display_name, m.role, m.is_me)}
                    </Text>
                    <Badge
                      label={m.is_me ? roleLabel(m.role) : m.role === 'OWNER' ? 'Owner' : 'Pasangan'}
                      tone="paid"
                    />
                  </View>
                  <Text style={styles.memberMeta} numberOfLines={1}>
                    {m.email ? `${m.email}  •  ` : ''}
                    {m.is_me ? 'Anda' : 'Terhubung real-time'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {partial && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Daftar anggota belum lengkap: database belum menjalankan migration 007, jadi hanya
              baris kamu sendiri yang bisa dibaca. Anggota lain tetap bisa mencatat transaksi —
              mereka hanya belum tampil di sini.
            </Text>
          </View>
        )}

        <View style={styles.group}>
          <View style={styles.member}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.memberName}>Notifikasi Pengeluaran Pasangan</Text>
              <Text style={styles.memberMeta}>Instan saat pasangan mencatat belanjaan.</Text>
            </View>
            <Switch
              value={myNotify}
              onValueChange={toggleNotify}
              disabled={!householdId}
              trackColor={{ false: Colors.borderStrong, true: Colors.paidText }}
            />
          </View>
        </View>

        <Text style={styles.footNote}>
          {memberCountLabel(memberCount)} di ruang keluarga ini · {household?.name ?? '—'}
        </Text>

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
 * The QR panel, rendered only once someone taps "Tampilkan QR" — the family
 * usually hands the code over by WhatsApp, and there is no reason to draw a
 * symbol nobody is looking at.
 *
 * What is encoded is the invite CODE, not a deep link: the code is what
 * `join_household_by_code` accepts, while a `kitasaku://` URL would only work
 * for someone who already has the app installed and nothing at all for anyone
 * scanning with their camera app. A short uppercase string also keeps the QR at
 * a low version, so it stays scannable from a partner's phone screen.
 */
function QrPanel({ value }: { value: string }) {
  return (
    <View style={styles.qrSurface}>
      <QRCode value={value} size={168} backgroundColor={Colors.surface} color={Colors.textPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.canvas },
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: {
    width: 32, height: 32, borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.borderSubtle, alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '700' },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14, gap: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  familyBox: {
    width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.subtle,
    alignItems: 'center', justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: Colors.textPrimary, fontSize: FontSize.cardTitle, fontWeight: '700', flexShrink: 1 },
  meta: { color: Colors.textMuted, fontSize: FontSize.caption, lineHeight: 15 },

  form: { gap: 8, borderTopWidth: 1, borderTopColor: Colors.borderSubtle, paddingTop: 12 },
  label: { color: Colors.textMuted, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 1 },
  input: {
    borderWidth: 1, borderColor: Colors.borderSubtle, borderRadius: Radius.md,
    paddingHorizontal: 12, height: 46, fontSize: 15, color: Colors.textPrimary,
    backgroundColor: Colors.canvas,
  },
  hint: { color: Colors.textSecondary, fontSize: FontSize.caption, lineHeight: 16 },

  invite: {
    backgroundColor: Colors.subtle, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.borderSubtle, padding: 14, gap: 10,
  },
  inviteH: { color: Colors.textPrimary, fontSize: FontSize.caption, fontWeight: '700', letterSpacing: 0.8 },
  inviteD: { color: Colors.textSecondary, fontSize: FontSize.body, lineHeight: 18 },
  codeBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, paddingHorizontal: 14, paddingVertical: 10,
  },
  code: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700', letterSpacing: 2 },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.brandPrimary,
    borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 9,
  },
  copyText: { color: Colors.white, fontSize: FontSize.caption, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle,
    borderRadius: Radius.md, paddingVertical: 11,
  },
  actionPrimary: { backgroundColor: Colors.brandPrimary, borderColor: Colors.brandPrimary },
  actionText: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '600' },
  actionPrimaryText: { color: Colors.white, fontSize: FontSize.body, fontWeight: '600' },
  qrBox: { alignItems: 'center', gap: 8, paddingTop: 4 },
  qrSurface: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, padding: 12,
    borderWidth: 1, borderColor: Colors.borderSubtle,
  },
  qrHint: { color: Colors.textSecondary, fontSize: FontSize.caption, textAlign: 'center' },

  section: { color: Colors.textMuted, fontSize: FontSize.microLabel, fontWeight: '700', letterSpacing: 1, marginTop: 4 },
  group: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.borderSubtle, overflow: 'hidden',
  },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  rowBordered: { borderTopWidth: 1, borderTopColor: Colors.borderSubtle },
  memberAvatar: {
    width: 36, height: 36, borderRadius: Radius.pill, backgroundColor: Colors.subtle,
    alignItems: 'center', justifyContent: 'center',
  },
  memberAvatarText: { color: Colors.textPrimary, fontSize: FontSize.body, fontWeight: '700' },
  memberName: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  memberMeta: { color: Colors.textMuted, fontSize: FontSize.caption },

  notice: {
    backgroundColor: Colors.alertBg, borderRadius: Radius.md, padding: 12,
    borderWidth: 1, borderColor: Colors.alertBg,
  },
  noticeText: { color: Colors.alertText, fontSize: FontSize.body, lineHeight: 18 },
  footNote: { color: Colors.textMuted, fontSize: FontSize.caption, textAlign: 'center' },
  muted: { color: Colors.textMuted, fontSize: FontSize.body },
  errBox: { backgroundColor: Colors.pendingBg, borderRadius: Radius.md, padding: 12 },
  errText: { color: Colors.pendingText, fontSize: FontSize.body },
});
