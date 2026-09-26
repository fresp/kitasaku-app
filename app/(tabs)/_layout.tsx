import { Tabs } from 'expo-router';
import { ChartPie, Clock3, House, ReceiptText } from 'lucide-react-native';
import { Colors } from '../../constants/theme';

export default function TabsLayout() {
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
