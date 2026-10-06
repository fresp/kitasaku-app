import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Bell from 'lucide-react-native/icons/bell';
import Calendar from 'lucide-react-native/icons/calendar';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import CreditCard from 'lucide-react-native/icons/credit-card';
import FileText from 'lucide-react-native/icons/file-text';
import HelpCircle from 'lucide-react-native/icons/circle-question-mark';
import Info from 'lucide-react-native/icons/info';
import LayoutGrid from 'lucide-react-native/icons/layout-grid';
import Link2 from 'lucide-react-native/icons/link-2';
import LogOut from 'lucide-react-native/icons/log-out';
import MoreVertical from 'lucide-react-native/icons/ellipsis-vertical';
import PieChart from 'lucide-react-native/icons/chart-pie';
import Settings from 'lucide-react-native/icons/settings';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import User from 'lucide-react-native/icons/user';
import Users from 'lucide-react-native/icons/users';
import X from 'lucide-react-native/icons/x';
import { Colors, Radius } from '../../constants/theme';
import { useAuth } from '../../lib/auth-context';
import { useHouseholdMembers, useUpdateMyMemberProfile } from '../../lib/queries';
import { memberDisplayName, memberInitials, roleLabel } from '../../lib/profile';
import { Badge } from '../../components/ui/Badge';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';

export default function ProfileScreen() {
  const router = useRouter();
  const { household, membership, session, signOut, refresh } = useAuth();
  const householdId = household?.id;

  const membersQ = useHouseholdMembers(householdId);
  const updateMe = useUpdateMyMemberProfile();

  const [moreVisible, setMoreVisible] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const me = {
    displayName: membership?.display_name ?? null,
    role: membership?.role ?? 'PARTNER',
  };

  const members = membersQ.data?.members ?? [];
  const memberCount = members.length || (membership ? 1 : 0);
  const initials = memberInitials(me.displayName ?? me.role);
  const notifyOn = membership?.notify_partner_expense ?? true;

  async function saveName() {
    setErr(null);
    if (!householdId) {
      setErr('Login dulu untuk menyimpan nama.');
      return;
    }
    try {
      await updateMe.mutateAsync({ householdId, displayName: nameDraft });
      await refresh();
      setEditingName(false);
      setMoreVisible(false);
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Screen Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Lainnya</Text>
          <Pressable
            hitSlop={8}
            onPress={() => setMoreVisible(true)}
            style={styles.moreBtn}
          >
            <MoreVertical size={20} color={Colors.textPrimary} />
          </Pressable>
        </View>

        {/* Household Card */}
        <Pressable
          style={styles.householdCard}
          onPress={() => router.push('/household')}
        >
          <View style={styles.avatarSquircle}>
            <Users size={22} color="#4338CA" />
          </View>
          <View style={styles.householdInfo}>
            <Text style={styles.householdTitle} numberOfLines={1}>
              {household?.name ?? 'Keluarga Kita'}
            </Text>
            <Text style={styles.householdSubtitle}>
              {memberCount} anggota
            </Text>
          </View>
          <ChevronRight size={18} color="#94A3B8" />
        </Pressable>

        {/* Keuangan Section */}
        <Text style={styles.sectionTitle}>Keuangan</Text>
        <View style={styles.groupedCard}>
          <MenuRow
            icon={CreditCard}
            title="Akun"
            onPress={() => router.push('/manage-accounts')}
          />
          <MenuRow
            icon={LayoutGrid}
            title="Kategori"
            onPress={() => router.push('/manage-categories')}
          />
          <MenuRow
            icon={FileText}
            title="Template Transaksi"
            onPress={() => router.push('/templates')}
          />
          <MenuRow
            icon={TrendingUp}
            title="Aset"
            isLast
            onPress={() => router.push('/assets')}
          />
        </View>

        {/* Analisis Section */}
        <Text style={styles.sectionTitle}>Analisis</Text>
        <View style={styles.groupedCard}>
          <MenuRow
            icon={PieChart}
            title="Insight"
            onPress={() => router.push('/asset-insight')}
          />
          <MenuRow
            icon={Calendar}
            title="Riwayat Siklus"
            isLast
            onPress={() => router.push('/cycle-history')}
          />
        </View>

        {/* Pengaturan Section */}
        <Text style={styles.sectionTitle}>Pengaturan</Text>
        <View style={styles.groupedCard}>
          <MenuRow
            icon={Bell}
            title="Notifikasi"
            onPress={() => setActiveModal('notification')}
          />
          <MenuRow
            icon={Link2}
            title="Integrasi"
            onPress={() => setActiveModal('integration')}
          />
          <MenuRow
            icon={Settings}
            title="Pengaturan Aplikasi"
            onPress={() => setMoreVisible(true)}
          />
          <MenuRow
            icon={HelpCircle}
            title="Bantuan"
            onPress={() => setActiveModal('help')}
          />
          <MenuRow
            icon={Info}
            title="Tentang Kitasaku"
            isLast
            onPress={() => setActiveModal('about')}
          />
        </View>
      </ScrollView>

      {/* Settings / More Modal */}
      <Modal
        visible={moreVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMoreVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => {
            setMoreVisible(false);
            setEditingName(false);
          }}
        >
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pengaturan Akun</Text>
              <Pressable
                hitSlop={8}
                onPress={() => {
                  setMoreVisible(false);
                  setEditingName(false);
                }}
              >
                <X size={20} color={Colors.textSecondary} />
              </Pressable>
            </View>

            {/* Profile identity info */}
            <View style={styles.profileBadgeCard}>
              <View style={styles.profileAvatar}>
                <Text style={styles.profileAvatarText}>{initials}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.profileName} numberOfLines={1}>
                    {memberDisplayName(me.displayName, me.role)}
                  </Text>
                  <Badge label={roleLabel(me.role)} tone="paid" />
                </View>
                {session?.user?.email && (
                  <Text style={styles.profileEmail} numberOfLines={1}>
                    {session.user.email}
                  </Text>
                )}
              </View>
            </View>

            {editingName ? (
              <View style={styles.editNameBox}>
                <Text style={styles.inputLabel}>NAMA TAMPILAN</Text>
                <TextInput
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder="Nama panggilan Anda"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.input}
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      label={updateMe.isPending ? 'Menyimpan…' : 'Simpan'}
                      onPress={saveName}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <SecondaryButton
                      label="Batal"
                      onPress={() => setEditingName(false)}
                    />
                  </View>
                </View>
              </View>
            ) : (
              <Pressable
                style={styles.actionRow}
                onPress={() => {
                  setNameDraft(me.displayName ?? '');
                  setEditingName(true);
                }}
              >
                <User size={18} color={Colors.textPrimary} />
                <Text style={styles.actionRowText}>Ubah Nama Tampilan</Text>
                <ChevronRight size={16} color={Colors.textMuted} />
              </Pressable>
            )}

            <View style={styles.actionDivider} />

            {/* Notification Row */}
            <View style={styles.actionRow}>
              <Bell size={18} color={Colors.textPrimary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.actionRowText}>Notifikasi Pengeluaran</Text>
                <Text style={styles.actionRowSub}>Saat pasangan mencatat pengeluaran</Text>
              </View>
              <Switch
                value={notifyOn}
                onValueChange={toggleNotify}
                disabled={!householdId}
                trackColor={{ false: Colors.borderStrong, true: Colors.paidText }}
              />
            </View>

            <View style={styles.actionDivider} />

            {/* Sign Out Row */}
            <Pressable
              style={[styles.actionRow, { marginTop: 4 }]}
              onPress={() => {
                setMoreVisible(false);
                void signOut();
              }}
            >
              <LogOut size={18} color={Colors.pendingText} />
              <Text style={[styles.actionRowText, { color: Colors.pendingText }]}>
                Keluar dari Akun
              </Text>
            </Pressable>

            {err && (
              <View style={styles.errBox}>
                <Text style={styles.errText}>{err}</Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Info / Sub-modal */}
      <Modal
        visible={!!activeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveModal(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setActiveModal(null)}
        >
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {activeModal === 'notification'
                  ? 'Notifikasi'
                  : activeModal === 'integration'
                  ? 'Integrasi'
                  : activeModal === 'help'
                  ? 'Pusat Bantuan'
                  : 'Tentang Kitasaku'}
              </Text>
              <Pressable hitSlop={8} onPress={() => setActiveModal(null)}>
                <X size={20} color={Colors.textSecondary} />
              </Pressable>
            </View>

            {activeModal === 'notification' && (
              <View style={{ gap: 14 }}>
                <View style={styles.infoRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.infoLabel}>Notifikasi Transaksi Pasangan</Text>
                    <Text style={styles.infoSub}>
                      Kirim pemberitahuan saat ada pengeluaran baru di ruang keluarga
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
            )}

            {activeModal === 'integration' && (
              <View style={{ gap: 8 }}>
                <Text style={styles.infoText}>
                  Kitasaku terintegrasi secara instan dengan Supabase Cloud untuk sinkronisasi real-time antar perangkat pasangan.
                </Text>
                <Text style={[styles.infoText, { color: Colors.textMuted }]}>
                  Integrasi bank otomatis & ekspor spreadsheet Google Sheets akan hadir di pembaruan berikutnya.
                </Text>
              </View>
            )}

            {activeModal === 'help' && (
              <View style={{ gap: 8 }}>
                <Text style={styles.infoText}>
                  Ada pertanyaan seputar alokasi budget, pencatatan tanggungan, atau rekonsiliasi akun?
                </Text>
                <Text style={[styles.infoText, { color: Colors.brandPrimary, fontWeight: '600' }]}>
                  Hubungi tim bantuan di support@kitasaku.id
                </Text>
              </View>
            )}

            {activeModal === 'about' && (
              <View style={{ gap: 8 }}>
                <Text style={styles.infoText}>
                  Kitasaku v1.0.0 — Aplikasi Pengeluaran & Anggaran Keluarga.
                </Text>
                <Text style={[styles.infoText, { color: Colors.textMuted }]}>
                  Dibuat untuk memudahkan transparansi dan keteraturan finansial rumah tangga.
                </Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function MenuRow({
  icon: Icon,
  title,
  onPress,
  isLast = false,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  title: string;
  onPress?: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      style={[styles.menuRow, !isLast && styles.menuRowBordered]}
      onPress={onPress}
    >
      <View style={styles.menuIconContainer}>
        <Icon size={18} color="#0B1527" strokeWidth={1.8} />
      </View>
      <Text style={styles.menuTitle}>{title}</Text>
      <ChevronRight size={16} color="#94A3B8" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  container: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    color: '#0B1527',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  moreBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  householdCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 14,
    marginBottom: 10,
  },
  avatarSquircle: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  householdInfo: {
    flex: 1,
    gap: 2,
  },
  householdTitle: {
    color: '#0B1527',
    fontSize: 16,
    fontWeight: '700',
  },
  householdSubtitle: {
    color: '#64748B',
    fontSize: 13,
  },
  sectionTitle: {
    color: '#0B1527',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },
  groupedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuRowBordered: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  menuIconContainer: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTitle: {
    flex: 1,
    color: '#0B1527',
    fontSize: 14.5,
    fontWeight: '600',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 21, 39, 0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
    gap: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0B1527',
  },
  profileBadgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  profileAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  profileName: {
    color: '#0B1527',
    fontSize: 15,
    fontWeight: '700',
  },
  profileEmail: {
    color: '#64748B',
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  actionRowText: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '600',
    color: '#0B1527',
  },
  actionRowSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  actionDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  editNameBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#0B1527',
    backgroundColor: '#FFFFFF',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0B1527',
  },
  infoSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#334155',
  },
  errBox: {
    backgroundColor: Colors.pendingBg,
    borderRadius: 10,
    padding: 10,
  },
  errText: {
    color: Colors.pendingText,
    fontSize: 13,
  },
});
