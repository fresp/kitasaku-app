// Kolaborasi ruang (Phase 15) — pure helpers for who submitted a tanggungan,
// its activity trail, and the opt-in "kabar" a member sends about transactions.
// Contract: docs/phase-15-kolaborasi-ruang.md. Screens stay thin; every label
// a member reads is decided here so it can be tested.

import { formatRupiah } from './format';
import { obligationTypeLabel } from './obligation';

export interface MemberRef {
  user_id: string;
  display_name: string | null;
  email?: string | null;
  is_me?: boolean;
}

export type ObligationEventKind =
  | 'CREATED'
  | 'PAYMENT'
  | 'SCHEDULE_CHANGED'
  | 'CANCELLED'
  | 'STATUS_CHANGED'
  | 'TOPUP';

export interface ObligationEvent {
  id: string;
  obligation_id: string;
  kind: ObligationEventKind;
  actor_user_id: string | null;
  transaction_id: string | null;
  account_id: string | null;
  amount: number | null;
  remaining_after: number | null;
  is_final: boolean | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export type TimelineTone = 'info' | 'paid' | 'neutral' | 'cancelled';

export interface TimelineItem {
  id: string;
  title: string;
  subtitle: string | null;
  tone: TimelineTone;
  at: string;
}

/** Matches SQL member_label: display name, else the email's local part. */
export function memberName(members: MemberRef[], userId: string | null | undefined): string | null {
  if (!userId) return null;
  const m = members.find((x) => x.user_id === userId);
  if (!m) return null;
  const name = m.display_name?.trim();
  if (name) return name;
  const local = m.email?.split('@')[0]?.trim();
  return local || 'Anggota';
}

function actorName(members: MemberRef[], userId: string | null | undefined): string {
  return memberName(members, userId) ?? 'Seseorang';
}

/** "Diajukan oleh" value. Rows from before migration 033 have no requester. */
export function requesterLabel(members: MemberRef[], createdBy: string | null | undefined): string {
  if (!createdBy) return 'Tidak tercatat';
  return memberName(members, createdBy) ?? 'Anggota';
}

/** Obligation list subtitle: "Reimburse · dari Rani", or just the type. */
export function obligationListSubtitle(
  type: string | null | undefined,
  members: MemberRef[],
  createdBy: string | null | undefined,
): string {
  const label = obligationTypeLabel(type);
  const who = memberName(members, createdBy);
  return who ? `${label} · dari ${who}` : label;
}

const CANCEL_REASONS: Record<string, string> = {
  WRONG_INPUT: 'salah input',
  DUPLICATE: 'tercatat dobel',
  NOT_HAPPENED: 'tidak jadi',
  OTHER: 'lainnya',
};

export function cancellationReasonLabel(reason: string | null | undefined): string | null {
  const r = (reason ?? '').trim();
  if (!r) return null;
  return CANCEL_REASONS[r] ?? r;
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Belum dibayar',
  UNPAID: 'Belum dibayar',
  PARTIAL: 'Berjalan',
  SETTLED: 'Lunas',
  CANCELLED: 'Dibatalkan',
};

function statusLabel(s: unknown): string {
  const key = typeof s === 'string' ? s : '';
  return STATUS_LABELS[key] ?? (key || '—');
}

function payloadString(payload: Record<string, unknown> | null, key: string): string | null {
  const v = payload?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** One line of the Aktivitas tab. */
export function timelineItem(event: ObligationEvent, members: MemberRef[]): TimelineItem {
  const who = actorName(members, event.actor_user_id);
  const base = { id: event.id, at: event.created_at };
  switch (event.kind) {
    case 'CREATED': {
      const type = obligationTypeLabel(payloadString(event.payload, 'type'));
      return {
        ...base,
        title: `Diajukan oleh ${who}`,
        subtitle: event.amount != null ? `${type} ${formatRupiah(event.amount)}` : type,
        tone: 'info',
      };
    }
    case 'PAYMENT': {
      const account = payloadString(event.payload, 'account_name');
      const amount = formatRupiah(event.amount ?? 0);
      const from = account ? ` dari ${account}` : '';
      if (event.is_final) {
        return { ...base, title: `Dilunasi oleh ${who}`, subtitle: `${amount}${from}`, tone: 'paid' };
      }
      return {
        ...base,
        title: `Dibayar sebagian oleh ${who}`,
        subtitle: `${amount}${from} · sisa ${formatRupiah(event.remaining_after ?? 0)}`,
        tone: 'paid',
      };
    }
    case 'TOPUP': {
      // Migration 036: more debt on the same tanggungan, with or without money in.
      const account = payloadString(event.payload, 'account_name');
      const note = payloadString(event.payload, 'note');
      const parts = [
        `+${formatRupiah(event.amount ?? 0)}`,
        account ? `masuk ke ${account}` : null,
        `sisa ${formatRupiah(event.remaining_after ?? 0)}`,
      ].filter(Boolean);
      return {
        ...base,
        title: `Pokok ditambah oleh ${who}`,
        subtitle: parts.join(' · ') + (note ? ` — ${note}` : ''),
        tone: 'info',
      };
    }
    case 'SCHEDULE_CHANGED':
      return { ...base, title: `Jadwal diubah oleh ${who}`, subtitle: null, tone: 'neutral' };
    case 'CANCELLED': {
      const reason = cancellationReasonLabel(event.reason);
      const note = payloadString(event.payload, 'note');
      const parts = [reason ? `Alasan: ${reason}` : null, note].filter(Boolean);
      return {
        ...base,
        title: `Dibatalkan oleh ${who}`,
        subtitle: parts.length ? parts.join(' — ') : null,
        tone: 'cancelled',
      };
    }
    case 'STATUS_CHANGED':
    default:
      return {
        ...base,
        title: `Status diubah oleh ${who}`,
        subtitle: `${statusLabel(event.payload?.from)} → ${statusLabel(event.payload?.to)}`,
        tone: 'neutral',
      };
  }
}

/** Oldest first: the trail reads as the story of the tanggungan. */
export function buildTimeline(events: ObligationEvent[], members: MemberRef[]): TimelineItem[] {
  return [...events]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((e) => timelineItem(e, members));
}

// ---------------------------------------------------------------------------
// Kabar transaksi

/** Default recipients of the "Kabari" card: every other member. */
export function defaultShareRecipients(members: MemberRef[], myUserId: string | null | undefined): string[] {
  return members.filter((m) => !m.is_me && m.user_id !== myUserId).map((m) => m.user_id);
}

/** "Rani akan diberi tahu" / "Rani dan Dimas akan diberi tahu". */
export function recipientsSentence(members: MemberRef[], recipientIds: string[]): string | null {
  const names = recipientIds.map((id) => memberName(members, id)).filter((n): n is string => !!n);
  if (names.length === 0) return null;
  const joined =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} dan ${names[names.length - 1]}`;
  return `${joined} akan diberi tahu`;
}

export interface ShareableRow {
  direction: 'INCOME' | 'EXPENSE' | string;
  amount: number;
}

export interface ShareSummary {
  count: number;
  totalIn: number;
  totalOut: number;
  text: string;
}

/** "3 transaksi · keluar Rp 1.547.500" — same figures the SQL kabar uses. */
export function shareSummary(rows: ShareableRow[]): ShareSummary {
  const totalIn = rows.filter((r) => r.direction === 'INCOME').reduce((s, r) => s + r.amount, 0);
  const totalOut = rows.filter((r) => r.direction !== 'INCOME').reduce((s, r) => s + r.amount, 0);
  const parts = [`${rows.length} transaksi`];
  if (totalOut > 0) parts.push(`keluar ${formatRupiah(totalOut)}`);
  if (totalIn > 0) parts.push(`masuk ${formatRupiah(totalIn)}`);
  return { count: rows.length, totalIn, totalOut, text: parts.join(' · ') };
}

export const SHARE_NOTE_MAX = 280;

export function normalizeShareNote(note: string | null | undefined): string | null {
  const t = (note ?? '').trim();
  return t ? t.slice(0, SHARE_NOTE_MAX) : null;
}

// ---------------------------------------------------------------------------
// Eksekusi Bersama: verify step

export interface BulkPreviewRow {
  transaction_id: string;
  ok: boolean;
  reason: string | null;
}

export interface BulkPreviewResult {
  allOk: boolean;
  problems: Record<string, string>;
}

/**
 * The execute button only enables when every selected row passed. A row the
 * server did not report on (selection changed meanwhile) counts as unchecked.
 */
export function summarizeBulkPreview(selectedIds: string[], rows: BulkPreviewRow[]): BulkPreviewResult {
  const byId = new Map(rows.map((r) => [r.transaction_id, r]));
  const problems: Record<string, string> = {};
  let allOk = selectedIds.length > 0;
  for (const id of selectedIds) {
    const r = byId.get(id);
    if (!r) {
      allOk = false;
      continue;
    }
    if (!r.ok) {
      allOk = false;
      problems[id] = r.reason ?? 'Tidak bisa dieksekusi.';
    }
  }
  return { allOk, problems };
}

// ---------------------------------------------------------------------------
// Payments made before migration 033 have no PAYMENT event. They still belong
// in the Aktivitas tab, so they are folded in from the payment rows.

export interface PaymentRowRef {
  id: string;
  actual_amount: number;
  executed_by?: string | null;
  release_date?: string | null;
  created_at: string;
  is_final_payment?: boolean | null;
  accounts?: { name?: string | null } | null;
}

export function activityTimeline(
  events: ObligationEvent[],
  payments: PaymentRowRef[],
  members: MemberRef[],
): TimelineItem[] {
  const covered = new Set(events.map((e) => e.transaction_id).filter((x): x is string => !!x));
  const legacy: TimelineItem[] = payments
    .filter((p) => !covered.has(p.id))
    .map((p) => {
      const who = memberName(members, p.executed_by);
      const account = p.accounts?.name?.trim();
      return {
        id: `payment-${p.id}`,
        title: `${p.is_final_payment ? 'Pelunasan' : 'Dibayar'}${who ? ` oleh ${who}` : ''}`,
        subtitle: `${formatRupiah(p.actual_amount)}${account ? ` dari ${account}` : ''}`,
        tone: 'paid' as const,
        at: p.release_date && p.created_at.slice(0, 10) !== p.release_date ? `${p.release_date}T00:00:00Z` : p.created_at,
      };
    });
  return [...buildTimeline(events, members), ...legacy].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );
}
