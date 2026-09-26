import { Tabs } from 'expo-router';
// Import icons via the official per-icon subpath (not the `lucide-react-native`
// barrel) so Metro doesn't pull 1800+ icon files into the bundle — this cuts
// build & download time, which made Expo Go fail with "download remote update".
import ChartPie from 'lucide-react-native/icons/chart-pie';
import Clock3 from 'lucide-react-native/icons/clock-3';
import House from 'lucide-react-native/icons/house';
import ReceiptText from 'lucide-react-native/icons/receipt-text';
import { Colors } from '../../constants/theme';
import { useAuth } from '../../lib/auth-context';
import { useHouseholdRealtime } from '../../lib/realtime';

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
          title: 'Anggaran',
          tabBarIcon: ({ color, size }) => <House size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="obligations"
        options={{
          title: 'Tanggungan',
          tabBarIcon: ({ color, size }) => <Clock3 size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="categories"
        options={{
          title: 'Kategori',
          tabBarIcon: ({ color, size }) => <ChartPie size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Riwayat',
          tabBarIcon: ({ color, size }) => <ReceiptText size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
