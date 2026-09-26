import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../lib/auth-context';

const queryClient = new QueryClient();

function Gate() {
  const { session, membership, loading } = useAuth();
  const rawSegments = useSegments();
  const segments = rawSegments as unknown as string[];
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === '(auth)';
    if (!session) {
      if (!inAuth) router.replace('/(auth)/sign-in');
    } else if (!membership) {
      if (segments[1] !== 'setup-choice' && segments[1] !== 'sign-in' && segments[1] !== 'invite') {
        router.replace('/(auth)/setup-choice');
      }
    } else {
      if (inAuth) router.replace('/(tabs)');
    }
  }, [session, membership, loading, rawSegments]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="new-cycle" options={{ presentation: 'card' }} />
      <Stack.Screen name="templates" options={{ presentation: 'card' }} />
      <Stack.Screen name="category-detail" options={{ presentation: 'card' }} />
      <Stack.Screen
        name="payment-confirm"
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="quick-add"
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <Gate />
      </AuthProvider>
    </QueryClientProvider>
  );
}
