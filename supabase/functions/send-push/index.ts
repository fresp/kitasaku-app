// send-push — delivers a Kitasaku notification row to the recipient's devices.
//
// Invoked by a Supabase Database Webhook on INSERT into public.notifications
// (see migration 033, manual verification step 5). The row is already the
// source of truth; push is only the courier, so every failure here is logged
// and swallowed rather than retried into duplicate pushes.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (provided by the platform),
//      PUSH_WEBHOOK_SECRET (set with `supabase secrets set`).

// Read from globalThis so the file type-checks both in the Supabase editor
// (where Deno's own types exist) and outside it, without redeclaring Deno.
type DenoLike = {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
const Deno = (globalThis as unknown as { Deno: DenoLike }).Deno;

type NotificationRow = {
  id: string;
  recipient_user_id: string;
  kind: string;
  title: string;
  body: string;
  obligation_id: string | null;
  payload: Record<string, unknown> | null;
  push_enabled: boolean;
};

type WebhookBody = { type: string; table: string; record: NotificationRow | null };

type ExpoTicket = { status: 'ok' | 'error'; details?: { error?: string } };

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const ANDROID_CHANNEL_ID = 'ruang-keluarga';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${Deno.env.get('SUPABASE_URL')}/rest/v1/${path}`;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return fetch(url, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return json(401, { error: 'unauthorized' });
  }

  let body: WebhookBody;
  try {
    body = (await req.json()) as WebhookBody;
  } catch {
    return json(400, { error: 'invalid json' });
  }
  const row = body.record;
  if (body.type !== 'INSERT' || body.table !== 'notifications' || !row) {
    return json(200, { skipped: 'not a notifications insert' });
  }
  if (!row.push_enabled) {
    return json(200, { skipped: 'push disabled by recipient' });
  }

  const tokensRes = await rest(
    `push_tokens?select=token&user_id=eq.${encodeURIComponent(row.recipient_user_id)}`,
  );
  if (!tokensRes.ok) {
    console.error('push_tokens read failed', tokensRes.status, await tokensRes.text());
    return json(200, { skipped: 'token read failed' });
  }
  const tokens = ((await tokensRes.json()) as { token: string }[]).map((t) => t.token);
  if (tokens.length === 0) {
    return json(200, { skipped: 'no devices' });
  }

  const data = {
    notification_id: row.id,
    kind: row.kind,
    obligation_id: row.obligation_id,
  };
  const messages = tokens.map((to) => ({
    to,
    title: row.title,
    body: row.body,
    data,
    sound: 'default',
    channelId: ANDROID_CHANNEL_ID,
  }));

  const pushRes = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!pushRes.ok) {
    console.error('expo push failed', pushRes.status, await pushRes.text());
    return json(200, { sent: 0 });
  }
  const tickets = ((await pushRes.json()) as { data?: ExpoTicket[] }).data ?? [];

  // Tickets come back in message order. A token Expo no longer recognises is
  // pruned so the next notification does not try it again.
  const dead = tickets
    .map((t, i) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? tokens[i] : null))
    .filter((t): t is string => t !== null);
  if (dead.length > 0) {
    const list = dead.map((t) => `"${t.replace(/"/g, '')}"`).join(',');
    await rest(`push_tokens?token=in.(${encodeURIComponent(list)})`, { method: 'DELETE' });
  }

  return json(200, { sent: tickets.filter((t) => t.status === 'ok').length, pruned: dead.length });
});
