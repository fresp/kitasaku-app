import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth-context';
import { hasSeenWelcome } from '../lib/onboarding';
import { AppSplash } from '../components/ui/AppSplash';

// Hold the OS splash until AppSplash has painted, then hand off to it — see the
// comment on `hideNativeSplash` below. Without the hold, the cold start flashes
// the bare white root view between the native splash and the first frame.
SplashScreen.preventAutoHideAsync();

let nativeSplashHidden = false;
function hideNativeSplash() {
  if (nativeSplashHidden) return;
  nativeSplashHidden = true;
  SplashScreen.hideAsync().catch(() => {});
}

const queryClient = new QueryClient();

function Gate() {
  const { session, membership, loading } = useAuth();
  const rawSegments = useSegments();
  const router = useRouter();
  const [splashVisible, setSplashVisible] = useState(true);

  useEffect(() => {
    if (loading) return;
    // Derived inside the effect so the dependency list can name the real input
    // (`rawSegments`) rather than a value rebuilt on every render.
    const segments = rawSegments as unknown as string[];
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
      // Fallback only: the splash releases the native one itself on first
      // layout, which is a frame earlier than this. This covers the case where
      // that layout callback never fires.
      hideNativeSplash();
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
      // The first destination is on screen underneath, so the splash can go.
      // Later passes are no-ops — nothing ever sets this back to true.
      setSplashVisible(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session, membership, loading, rawSegments, router]);

  return (
    <>
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
      {/* Sits over the navigator rather than in it, so it is not a route the
          Gate can navigate away from mid-fade. */}
      <AppSplash visible={splashVisible} onFirstLayout={hideNativeSplash} />
    </>
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
