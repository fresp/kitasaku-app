import { Tabs } from 'expo-router';
// Import icons via the official per-icon subpath (not the `lucide-react-native`
// barrel) so Metro doesn't pull 1800+ icon files into the bundle — this cuts
// build & download time, which made Expo Go fail with "download remote update".
import House from 'lucide-react-native/icons/house';
import HandCoins from 'lucide-react-native/icons/hand-coins';
import RotateCcwClock from 'lucide-react-native/icons/rotate-ccw-clock';
import UserRound from 'lucide-react-native/icons/user-round';
import { Colors } from '../../constants/theme';
import { useAuth } from '../../lib/auth-context';
import { useHouseholdRealtime } from '../../lib/realtime';

/**
 * The design's bottom nav is four destinations: Home, Tanggungan, Riwayat,
 * My Profile (`BottomNavigation / main-4` in design.pen). Budget Health moved
 * to `app/budget-health.tsx` and Kelola Kategori stays at `app/manage-categories.tsx`
 * — both reached from the screens that need them, which is where the design
 * puts them too (Budget Health from Tanggungan, Kelola Kategori from My
 * Profile's breadcrumb).
 *
 * Icons match the design's per-item lucide choices: house, hand-coins,
 * history (exported as `rotate-ccw-clock` in lucide 1.48 — there is no
 * `history` file), user-round.
 */
export default function TabsLayout() {
  // Mounted at the layout level (not per-tab) so the realtime subscription stays
  // alive when the user switches tabs. If it lived only in Home, other tabs
  // would not get refreshed.
  const { household } = useAuth();
  useHouseholdRealtime(household?.id);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.textPrimary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.borderSubtle,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <House size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="obligations"
        options={{
          title: 'Tanggungan',
          tabBarIcon: ({ color, size }) => <HandCoins size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Riwayat',
          tabBarIcon: ({ color, size }) => <RotateCcwClock size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'My Profile',
          tabBarIcon: ({ color, size }) => <UserRound size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
