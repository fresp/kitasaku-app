// Notification routing (Phase 15). Pure: the push payload and the
// notifications row both resolve to the same screen.

export type NotificationKind =
  | 'OBLIGATION_CREATED'
  | 'OBLIGATION_PAYMENT'
  | 'OBLIGATION_CANCELLED'
  | 'OBLIGATION_SCHEDULE_CHANGED'
  | 'OBLIGATION_STATUS_CHANGED'
  | 'TRANSACTIONS_SHARED';

export interface NotificationRow {
  id: string;
  household_id: string;
  recipient_user_id: string;
  kind: NotificationKind;
  actor_user_id: string | null;
  obligation_id: string | null;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export type NotificationRoute =
  | { pathname: '/loan-detail'; params: { id: string } }
  | { pathname: '/shared-transactions'; params: { id: string } };

/** Accepts a notifications row or the `data` object of a push. */
export function routeForNotification(input: {
  kind?: unknown;
  obligation_id?: unknown;
  id?: unknown;
  notification_id?: unknown;
}): NotificationRoute | null {
  const kind = typeof input.kind === 'string' ? input.kind : '';
  const notificationId =
    typeof input.notification_id === 'string'
      ? input.notification_id
      : typeof input.id === 'string'
        ? input.id
        : null;
  if (kind === 'TRANSACTIONS_SHARED') {
    return notificationId ? { pathname: '/shared-transactions', params: { id: notificationId } } : null;
  }
  if (kind.startsWith('OBLIGATION_') && typeof input.obligation_id === 'string' && input.obligation_id) {
    return { pathname: '/loan-detail', params: { id: input.obligation_id } };
  }
  return null;
}

/** Transaction ids a TRANSACTIONS_SHARED row points at, ignoring junk. */
export function sharedTransactionIds(payload: Record<string, unknown> | null | undefined): string[] {
  const ids = payload?.transaction_ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

export function sharedNote(payload: Record<string, unknown> | null | undefined): string | null {
  const n = payload?.note;
  return typeof n === 'string' && n.trim() ? n.trim() : null;
}
