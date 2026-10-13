// Push registration and tap routing (Phase 15). Verified against the Expo SDK 57
// expo-notifications and expo-constants references.
//
// Expo Go on Android throws as soon as expo-notifications is imported (remote
// push was removed from Expo Go in SDK 53), which would take the whole tab
// layout down. The module is therefore loaded lazily and never in Expo Go:
// there the app runs without push, while development builds and EAS APKs get
// the full behaviour. The notifications table stays the source of truth either
// way, so a missing push never loses anything.

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useRouter } from 'expo-router';
import { supabase } from './supabase';
import { routeForNotification } from './notifications';

export const ANDROID_CHANNEL_ID = 'ruang-keluarga';

type NotificationsModule = typeof import('expo-notifications');

const pushSupported =
  Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

let cached: NotificationsModule | null | undefined;

function notifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (!pushSupported) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-notifications') as NotificationsModule;
    // Without a handler, notifications are not shown while the app is open.
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    cached = mod;
  } catch (e) {
    console.warn('[push] expo-notifications unavailable:', e instanceof Error ? e.message : e);
    cached = null;
  }
  return cached;
}

let registeredToken: string | null = null;

function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

/** Asks permission once, then stores this device's Expo push token. */
export async function registerForPush(): Promise<string | null> {
  const N = notifications();
  if (!N || !supabase) return null;
  try {
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'Ruang Keluarga',
        description: 'Pengajuan tanggungan, pembayaran, dan kabar dari anggota ruang.',
        importance: N.AndroidImportance.HIGH,
      });
    }
    let perm = await N.getPermissionsAsync();
    if (!perm.granted) perm = await N.requestPermissionsAsync();
    if (!perm.granted) return null;
    const token = (await N.getExpoPushTokenAsync({ projectId: easProjectId() })).data;
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
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const N = notifications();
    if (!enabled || !N) return;

    const open = (response: import('expo-notifications').NotificationResponse | null) => {
      if (!response || response.actionIdentifier !== N.DEFAULT_ACTION_IDENTIFIER) return;
      const id = response.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;
      const route = routeForNotification(
        (response.notification.request.content.data ?? {}) as Record<string, unknown>,
      );
      if (route) router.push(route);
    };

    // Cold start: the tap that launched the app arrived before this mounted.
    void N.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = N.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [enabled, router]);
}
