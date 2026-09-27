import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { hasSeenWelcome } from '../lib/onboarding';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function Gate() {
  const { session, membership, loading } = useAuth();
  const rawSegments = useSegments();
  const segments = rawSegments as unknown as string[];
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      // Re-read on every navigation instead of holding the answer in state:
      // tapping "Mulai" writes the flag and pushes to sign-in in the same tick,
      // so a `seenWelcome` captured in state would still say false when this
      // effect re-ran for the new route and would bounce the family back to the
      // slide they just finished. `hasSeenWelcome` caches, so this is a boolean
      // read, not storage I/O.
      const seen = await hasSeenWelcome();
      if (cancelled) return;
      SplashScreen.hideAsync().catch(() => {});
      const inAuth = segments[0] === '(auth)';
      const onWelcome = segments[1] === 'welcome';
      if (!session) {
        // The three onboarding illustrations are the family's first sight of the
        // app, so they come before sign-in — and only once: `seen` is what
        // WelcomeScreen's "Mulai"/"Lewati" writes.
        const wanted = seen ? '/(auth)/sign-in' : '/(auth)/welcome';
        if (!inAuth) router.replace(wanted);
        else if (seen && onWelcome) router.replace('/(auth)/sign-in');
        else if (!seen && !onWelcome) router.replace('/(auth)/welcome');
      } else if (!membership) {
        if (
          segments[1] !== 'setup-choice' &&
          segments[1] !== 'sign-in' &&
          segments[1] !== 'invite'
        ) {
          router.replace('/(auth)/setup-choice');
        }
      } else {
        if (inAuth) router.replace('/(tabs)');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, membership, loading, rawSegments]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="new-cycle" options={{ presentation: 'card' }} />
      <Stack.Screen name="templates" options={{ presentation: 'card' }} />
      <Stack.Screen name="category-detail" options={{ presentation: 'card' }} />
      <Stack.Screen name="kelola-kategori" options={{ presentation: 'card' }} />
      <Stack.Screen name="ruang-keluarga" options={{ presentation: 'card' }} />
      <Stack.Screen name="budget-health" options={{ presentation: 'card' }} />
      <Stack.Screen name="detail-pinjaman" options={{ presentation: 'card' }} />
      <Stack.Screen name="funding-gap" options={{ presentation: 'card' }} />
      <Stack.Screen name="insight-aset" options={{ presentation: 'card' }} />
      <Stack.Screen name="allocation" options={{ presentation: 'card' }} />
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
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="dark" />
          <Gate />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
