// Push registration and tap routing (Phase 15). Verified against the Expo SDK 57
// expo-notifications reference. Push needs a development build or EAS APK; in
// Expo Go on Android remote push is unavailable, so every step here fails soft:
// the notifications table stays the source of truth whether or not a push lands.

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { supabase } from './supabase';
import { routeForNotification } from './notifications';

export const ANDROID_CHANNEL_ID = 'ruang-keluarga';

let registeredToken: string | null = null;

if (Platform.OS !== 'web') {
  // Without a handler, notifications are not shown while the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Ruang Keluarga',
    description: 'Pengajuan tanggungan, pembayaran, dan kabar dari anggota ruang.',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

/** Asks permission once, then stores this device's Expo push token. */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || !supabase) return null;
  try {
    await ensureAndroidChannel();
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return null;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId() })).data;
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS,
    });
    if (error) throw error;
    registeredToken = token;
    return token;
  } catch (e) {
    console.warn('[push] registration skipped:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Called before sign-out so the next user on this phone does not get our pushes. */
export async function unregisterPush(): Promise<void> {
  if (!registeredToken || !supabase) return;
  const token = registeredToken;
  registeredToken = null;
  try {
    await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {
    // Best effort: a stale token is pruned by send-push on its next attempt.
  }
}

/** Registers once per signed-in user. */
export function usePushRegistration(userId: string | undefined): void {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || done.current === userId) return;
    done.current = userId;
    void registerForPush();
  }, [userId]);
}

/**
 * Opens the screen a tapped notification points at — including the tap that
 * launched the app from a killed state.
 */
export function useNotificationTapRouting(enabled: boolean): void {
  const router = useRouter();
  const lastResponse = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || Platform.OS === 'web' || !lastResponse) return;
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = lastResponse.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const route = routeForNotification(
      (lastResponse.notification.request.content.data ?? {}) as Record<string, unknown>,
    );
    if (route) router.push(route);
  }, [enabled, lastResponse, router]);
}
