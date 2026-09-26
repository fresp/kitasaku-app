import { Tabs } from 'expo-router';
import { ChartPie, Clock3, House, ReceiptText } from 'lucide-react-native';
import { Colors } from '../../constants/theme';
import { useAuth } from '../../lib/auth-context';
import { useHouseholdRealtime } from '../../lib/realtime';

export default function TabsLayout() {
  // Dipasang di level layout (bukan per-tab) supaya langganan realtime tetap hidup
  // saat pengguna pindah tab. Kalau hanya di Home, tab lain tidak ikut ter-refresh.
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
        name="tanggungan"
        options={{
          title: 'Tanggungan',
          tabBarIcon: ({ color, size }) => <Clock3 size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="kategori"
        options={{
          title: 'Kategori',
          tabBarIcon: ({ color, size }) => <ChartPie size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="riwayat"
        options={{
          title: 'Riwayat',
          tabBarIcon: ({ color, size }) => <ReceiptText size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
