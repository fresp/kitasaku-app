import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
type TabRoute = TabBarProps['state']['routes'][number];
// Import icons via per-icon subpath to keep bundle size small
import House from 'lucide-react-native/icons/house';
import HandCoins from 'lucide-react-native/icons/hand-coins';
import RotateCcwClock from 'lucide-react-native/icons/rotate-ccw-clock';
import UserRound from 'lucide-react-native/icons/user-round';
import Plus from 'lucide-react-native/icons/plus';
import ArrowDown from 'lucide-react-native/icons/arrow-down';
import ArrowLeftRight from 'lucide-react-native/icons/arrow-left-right';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import X from 'lucide-react-native/icons/x';
import { Colors, FontSize, Radius } from '../../constants/theme';
import { useAuth } from '../../lib/auth-context';
import { useHouseholdRealtime } from '../../lib/realtime';

export default function TabsLayout() {
  const { household } = useAuth();
  useHouseholdRealtime(household?.id);

  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Transaksi',
        }}
      />
      <Tabs.Screen
        name="obligations"
        options={{
          title: 'Tanggungan',
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Lainnya',
        }}
      />
    </Tabs>
  );
}

function CustomTabBar({ state, descriptors, navigation }: TabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);

  const bottomInset = Math.max(insets.bottom, 12);
  const leftRoutes = state.routes.slice(0, 2);
  const rightRoutes = state.routes.slice(2, 4);

  const renderTab = (route: TabRoute, index: number) => {
    const isFocused = state.index === index;
    const { options } = descriptors[route.key];
    const label = options.title ?? route.name;

    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });

      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(route.name);
      }
    };

    const color = isFocused ? Colors.accent : Colors.textOnDarkSecondary;

    return (
      <Pressable
        key={route.key}
        accessibilityRole="button"
        accessibilityState={{ selected: isFocused }}
        accessibilityLabel={label}
        onPress={onPress}
        style={styles.tabItem}
      >
        {route.name === 'index' && <House size={20} color={color} />}
        {route.name === 'history' && <RotateCcwClock size={20} color={color} />}
        {route.name === 'obligations' && <HandCoins size={20} color={color} />}
        {route.name === 'profile' && <UserRound size={20} color={color} />}
        <Text style={[styles.tabLabel, { color }, isFocused && styles.tabLabelActive]}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <>
      <View pointerEvents="box-none" style={[styles.barContainer, { bottom: bottomInset }]}>
        <View style={styles.barInner}>
          <View style={styles.tabGroup}>
            {leftRoutes.map((route: TabRoute, idx: number) => renderTab(route, idx))}
          </View>

          {/* Spacer for center floating button */}
          <View style={styles.centerSpacer} />

          <View style={styles.tabGroup}>
            {rightRoutes.map((route: TabRoute, idx: number) => renderTab(route, idx + 2))}
          </View>
        </View>

        {/* Floating Center Button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tambah aktivitas"
          onPress={() => setMenuOpen(true)}
          style={styles.fabButton}
        >
          <Plus size={24} color={Colors.accent} strokeWidth={2.5} />
        </Pressable>
      </View>

      {/* Quick Action Modal */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.menuSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <View style={styles.menuHeader}>
              <Text style={styles.menuHeaderText}>Tambah aktivitas</Text>
              <Pressable
                onPress={() => setMenuOpen(false)}
                hitSlop={10}
                accessibilityLabel="Tutup menu tambah aktivitas"
              >
                <X size={20} color={Colors.textPrimary} />
              </Pressable>
            </View>
            <View style={styles.inlineMenu}>
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  router.push({ pathname: '/quick-add', params: { kind: 'out' } });
                }}
                style={styles.menuRow}
              >
                <View style={[styles.menuIcon, styles.menuIconRed]}>
                  <Plus size={17} color={Colors.negative} />
                </View>
                <View style={styles.menuCopy}>
                  <Text style={styles.menuTitle}>Tambah transaksi</Text>
                  <Text style={styles.menuSubtitle}>Catat pengeluaran belanja atau tagihan</Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </Pressable>

              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  router.push({ pathname: '/quick-add', params: { kind: 'in' } });
                }}
                style={styles.menuRow}
              >
                <View style={[styles.menuIcon, styles.menuIconGreen]}>
                  <ArrowDown size={17} color={Colors.accentStrong} />
                </View>
                <View style={styles.menuCopy}>
                  <Text style={styles.menuTitle}>Catat pemasukan</Text>
                  <Text style={styles.menuSubtitle}>Gaji, transfer masuk, refund, hasil usaha</Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </Pressable>

              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  router.push('/transfer');
                }}
                style={[styles.menuRow, { borderBottomWidth: 0 }]}
              >
                <View style={[styles.menuIcon, styles.menuIconBlue]}>
                  <ArrowLeftRight size={17} color={Colors.info} />
                </View>
                <View style={styles.menuCopy}>
                  <Text style={styles.menuTitle}>Relokasi</Text>
                  <Text style={styles.menuSubtitle}>Pindahkan saldo antar akun atau kas</Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  barContainer: {
    position: 'absolute',
    left: 14,
    right: 14,
    alignItems: 'center',
  },
  barInner: {
    width: '100%',
    height: 62,
    backgroundColor: Colors.navy,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  tabGroup: {
    flexDirection: 'row',
    flex: 1,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  centerSpacer: {
    width: 58,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    minWidth: 54,
  },
  tabLabel: {
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 3,
  },
  tabLabelActive: {
    fontWeight: '700',
  },
  fabButton: {
    position: 'absolute',
    top: -20,
    alignSelf: 'center',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: Colors.canvas,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlayScrim,
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.borderStrong,
    marginBottom: 4,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  menuHeaderText: {
    color: Colors.textPrimary,
    fontSize: FontSize.cardTitle,
    fontWeight: '700',
  },
  inlineMenu: {
    borderWidth: 1,
    borderColor: Colors.borderSubtle,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  menuRow: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconRed: {
    backgroundColor: Colors.negativeSoft,
  },
  menuIconGreen: {
    backgroundColor: Colors.accentSoft,
  },
  menuIconBlue: {
    backgroundColor: Colors.infoSoft,
  },
  menuCopy: {
    flex: 1,
  },
  menuTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  menuSubtitle: {
    color: Colors.textMuted,
    fontSize: FontSize.caption,
    marginTop: 2,
  },
});
