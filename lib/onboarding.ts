import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'kitasaku.welcome.seen';

// expo-secure-store has no web implementation (its stub is empty), so web falls
// back to localStorage — the same split lib/supabase.ts uses for the session.
// The value is not a secret, but reusing the one storage mechanism the app
// already depends on avoids adding a dependency for a single boolean.
async function read(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(KEY) ?? null;
    } catch {
      // localStorage may be blocked (private mode) — treat as "not seen yet",
      // which shows the welcome once per launch rather than never.
      return null;
    }
  }
  return SecureStore.getItemAsync(KEY);
}

// The Gate re-reads this on every navigation, so the answer is cached for the
// life of the process: without the cache, tapping "Mulai" would write the flag
// and then the Gate's next pass would still read the stale in-memory `false`
// and bounce the family straight back to the slide they just left.
let cached: boolean | null = null;

export async function hasSeenWelcome(): Promise<boolean> {
  if (cached === null) cached = (await read()) === '1';
  return cached;
}

export async function markWelcomeSeen(): Promise<void> {
  cached = true;
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.setItem(KEY, '1');
    } catch {
      // ignored — the in-memory flag still holds for this session
    }
    return;
  }
  await SecureStore.setItemAsync(KEY, '1');
}
