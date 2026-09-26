import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase, requireSupabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export async function signInWithGoogle() {
  const sb = supabase ?? requireSupabase();

  const redirectTo = makeRedirectUri({
    scheme: 'kitasaku',
    path: 'auth/callback',
  });

  console.log('[Auth] Google OAuth Redirect URI yang dikirim ke Supabase:', redirectTo);

  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data?.url) throw new Error('Tidak ada URL autentikasi Google.');

  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  console.log('[Auth] WebBrowser result:', res);

  if (res.type === 'success' && res.url) {
    const url = res.url;
    const hashIndex = url.indexOf('#');
    const queryIndex = url.indexOf('?');

    const parseParams = (str: string) => {
      const map: Record<string, string> = {};
      str.split('&').forEach((part) => {
        const [k, v] = part.split('=');
        if (k && v) {
          map[decodeURIComponent(k)] = decodeURIComponent(v);
        }
      });
      return map;
    };

    const queryParams =
      queryIndex !== -1 ? parseParams(url.slice(queryIndex + 1).split('#')[0]) : {};
    const hashParams = hashIndex !== -1 ? parseParams(url.slice(hashIndex + 1)) : {};
    const params = { ...queryParams, ...hashParams };

    if (params.error_description || params.error) {
      throw new Error(params.error_description || params.error);
    }

    if (params.code) {
      const { data: sessionData, error: sessionErr } =
        await sb.auth.exchangeCodeForSession(params.code);
      if (sessionErr) throw sessionErr;
      return sessionData;
    }

    if (params.access_token && params.refresh_token) {
      const { data: sessionData, error: sessionErr } = await sb.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      });
      if (sessionErr) throw sessionErr;
      return sessionData;
    }
  }

  return null;
}
