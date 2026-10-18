// Bayar tanggungan sekaligus (Phase 16). Pure: the server recomputes every
// amount, so everything here is for the form, the review screen and Riwayat.
// bulkPayNotification mirrors bulk_pay_notification_body() in migration 034;
// change both together.

import { formatRupiah } from './format';

export const BULK_PAY_MAX_ITEMS = 50;
export const BULK_PAY_NOTE_MAX = 280;

/** One selected obligation in the form. Exactly one of the two inputs is used. */
export type BulkPayDraftItem =
  | { obligationId: string; kind: 'amount'; amount: number }
  | { obligationId: string; kind: 'installments'; installmentCount: number };

export interface BulkPayObligationRef {
  id: string;
  remaining_amount: number;
}

export interface OpenInstallmentRef {
  planned_amount: number;
  paid_amount: number;
  due_date: string | null;
  created_at: string;
  id: string;
}

/** Open installments in the order the server pays them (029/030/034). */
export function orderOpenInstallments<T extends OpenInstallmentRef>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.due_date !== b.due_date) {
      if (a.due_date === null) return 1;
      if (b.due_date === null) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** What the next `count` open installments still owe. Display only. */
export function installmentsAmount(openInstallments: OpenInstallmentRef[], count: number): number {
  return orderOpenInstallments(openInstallments)
    .slice(0, Math.max(0, count))
    .reduce((sum, i) => sum + Math.max(0, i.planned_amount - Math.max(0, i.paid_amount)), 0);
}

export function defaultDraftItem(ob: BulkPayObligationRef, openInstallmentCount: number): BulkPayDraftItem {
  return openInstallmentCount > 0
    ? { obligationId: ob.id, kind: 'installments', installmentCount: 1 }
    : { obligationId: ob.id, kind: 'amount', amount: ob.remaining_amount };
}

/** Amount of a draft row as the form shows it. */
export function draftItemAmount(item: BulkPayDraftItem, openInstallments: OpenInstallmentRef[]): number {
  return item.kind === 'amount' ? item.amount : installmentsAmount(openInstallments, item.installmentCount);
}

/** Client-side check for one row; the server repeats it. Null when fine. */
export function draftItemProblem(
  item: BulkPayDraftItem,
  ob: BulkPayObligationRef,
  openInstallmentCount: number
): string | null {
  if (item.kind === 'installments') {
    if (openInstallmentCount === 0) return 'Tanggungan ini tidak punya cicilan terbuka.';
    if (!Number.isInteger(item.installmentCount) || item.installmentCount < 1 || item.installmentCount > openInstallmentCount) {
      return `Jumlah cicilan harus 1 sampai ${openInstallmentCount}.`;
    }
    return null;
  }
  if (!Number.isInteger(item.amount) || item.amount < 1) return 'Isi nominal lebih dari Rp 0.';
  if (item.amount > ob.remaining_amount) return `Nominal melebihi sisa ${formatRupiah(ob.remaining_amount)}.`;
  return null;
}

export type PayBadge = 'Lunas' | 'Sebagian';

export function payBadge(amount: number, remaining: number): PayBadge {
  return amount >= remaining ? 'Lunas' : 'Sebagian';
}

export interface FeeDerivation {
  subtotal: number;
  fee: number;
  /** Set when the total cannot be accepted. */
  error: string | null;
}

/**
 * The bank debit is the source of truth; the fee is whatever it adds on top
 * of the items. A smaller debit is a partial payment, which belongs on the
 * item rows, not here.
 */
export function deriveFee(itemAmounts: number[], totalDebited: number): FeeDerivation {
  const subtotal = itemAmounts.reduce((s, a) => s + Math.max(0, a), 0);
  if (!Number.isFinite(totalDebited) || totalDebited < subtotal) {
    return {
      subtotal,
      fee: 0,
      error: 'Total keluar dari rekening tidak boleh lebih kecil dari subtotal. Atur bayar sebagian di baris tanggungannya.',
    };
  }
  return { subtotal, fee: totalDebited - subtotal, error: null };
}

/** Everything the review screen needs, passed as one route param. */
export interface BulkPayDraft {
  accountId: string;
  paidAt: string;
  items: BulkPayDraftItem[];
  totalDebited: number;
  feeCategoryId: string | null;
  note: string;
  notifyIds: string[];
}

export function encodeDraft(draft: BulkPayDraft): string {
  return JSON.stringify(draft);
}

/** Null for anything that is not a well-formed draft (stale link, junk). */
export function decodeDraft(raw: unknown): BulkPayDraft | null {
  if (typeof raw !== 'string' || !raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  const str = (x: unknown) => typeof x === 'string' && x.length > 0;
  if (!str(d.accountId) || !str(d.paidAt) || !Number.isInteger(d.totalDebited) || !Array.isArray(d.items)) return null;
  const items: BulkPayDraftItem[] = [];
  for (const raw of d.items) {
    const it = raw as Record<string, unknown>;
    if (!it || !str(it.obligationId)) return null;
    if (it.kind === 'amount' && Number.isInteger(it.amount)) {
      items.push({ obligationId: it.obligationId as string, kind: 'amount', amount: it.amount as number });
    } else if (it.kind === 'installments' && Number.isInteger(it.installmentCount)) {
      items.push({ obligationId: it.obligationId as string, kind: 'installments', installmentCount: it.installmentCount as number });
    } else {
      return null;
    }
  }
  if (items.length === 0 || items.length > BULK_PAY_MAX_ITEMS) return null;
  return {
    accountId: d.accountId as string,
    paidAt: d.paidAt as string,
    items,
    totalDebited: d.totalDebited as number,
    feeCategoryId: str(d.feeCategoryId) ? (d.feeCategoryId as string) : null,
    note: typeof d.note === 'string' ? d.note.slice(0, BULK_PAY_NOTE_MAX) : '',
    notifyIds: Array.isArray(d.notifyIds) ? d.notifyIds.filter(str) as string[] : [],
  };
}

/** Payload for preview_pay_obligations_bulk / pay_obligations_bulk. */
export function toRpcItems(items: BulkPayDraftItem[]): { obligation_id: string; amount?: number; installment_count?: number }[] {
  return items.map((item) =>
    item.kind === 'amount'
      ? { obligation_id: item.obligationId, amount: item.amount }
      : { obligation_id: item.obligationId, installment_count: item.installmentCount }
  );
}

// ---------------------------------------------------------------------------
// Preview (server verdict)

export type BulkPayMode = 'EXECUTE' | 'EXECUTE_SPLIT' | 'NEW_PAYMENT';

export interface BulkPayPreviewItem {
  obligation_id: string;
  title: string;
  ok: boolean;
  reason: string | null;
  mode: BulkPayMode | null;
  amount: number;
  installment_count: number | null;
  installment_from: number | null;
  installment_to: number | null;
  remaining_before: number;
  remaining_after: number;
  remainder: number;
  extra_allocation: number;
  requested_by: string | null;
}

export interface BulkPayPreview {
  error: string | null;
  all_ok: boolean;
  items: BulkPayPreviewItem[];
  subtotal?: number;
  total_debited?: number;
  fee_amount?: number;
  fee_category_id?: string | null;
  fee_category_name?: string | null;
  fee_category_new?: boolean;
  plans_executed?: number;
  remainder_plans?: number;
  extra_allocation?: number;
}

/** Second line of a review row. */
export function previewItemLabel(item: BulkPayPreviewItem): string {
  if (!item.ok) return item.reason ?? 'Tidak bisa dibayar.';
  const installments = item.installment_count != null;
  const head = installments
    ? `${item.installment_count} cicilan`
    : item.remaining_after <= 0
      ? 'Lunas'
      : 'Sebagian';
  if (item.mode === 'EXECUTE_SPLIT') {
    return `${head} · sisa ${formatRupiah(item.remainder)} tetap direncanakan`;
  }
  const how = item.mode === 'NEW_PAYMENT' ? 'alokasi baru' : 'rencana siklus dieksekusi';
  const rest = item.remaining_after > 0 ? ` · sisa ${formatRupiah(item.remaining_after)}` : '';
  return `${head} · ${how}${rest}`;
}

/** "1 aktivitas di Riwayat · 5 baris · +1 rencana sisa tetap di Siklus" */
export function previewHeaderLine(itemCount: number, fee: number, remainderPlans: number): string {
  const rows = itemCount + (fee > 0 ? 1 : 0);
  const extra = remainderPlans > 0 ? ` · +${remainderPlans} rencana sisa tetap di Siklus` : '';
  return `1 aktivitas di Riwayat · ${rows} baris${extra}`;
}

// ---------------------------------------------------------------------------
// Notification (mirrors SQL)

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "18 Okt" from an ISO date, without timezone shifts. */
export function shortDateId(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS_ID[(m ?? 1) - 1]}`;
}

export interface BulkPayNoticeItem {
  title: string;
  amount: number;
  installmentCount: number | null;
  remainingAfter: number;
  requestedBy: string | null;
}

export interface BulkPayNoticeInput {
  payerName: string;
  accountName: string;
  paidAt: string;
  totalDebited: number;
  fee: number;
  note: string | null;
  items: BulkPayNoticeItem[];
  recipientId: string;
}

export function bulkPayNotification(input: BulkPayNoticeInput): { title: string; body: string } {
  const title = `${input.payerName} bayar ${input.items.length} tanggungan · ${formatRupiah(input.totalDebited)}`;
  const mine = input.items.filter((i) => i.requestedBy === input.recipientId).length;
  const lines: string[] = [
    mine > 0
      ? `${mine} pengajuanmu sudah dibayar dari ${input.accountName}.`
      : `Dari ${input.accountName}, ${shortDateId(input.paidAt)}.`,
  ];
  const note = input.note?.trim();
  if (note) lines.push(`“${note}”`);
  const ordered = [
    ...input.items.filter((i) => i.requestedBy === input.recipientId),
    ...input.items.filter((i) => i.requestedBy !== input.recipientId),
  ];
  const shown = ordered.slice(0, 5);
  for (const i of shown) {
    const tail =
      i.installmentCount != null
        ? `${i.installmentCount} cicilan`
        : i.remainingAfter <= 0
          ? 'lunas'
          : `sisa ${formatRupiah(i.remainingAfter)}`;
    lines.push(`• ${i.title} — ${formatRupiah(i.amount)} (${tail})`);
  }
  if (ordered.length > shown.length) lines.push(`dan ${ordered.length - shown.length} lainnya`);
  if (input.fee > 0) lines.push(`Biaya transfer ${formatRupiah(input.fee)}`);
  return { title, body: lines.join('\n') };
}

/**
 * Who gets the summary, as the server decides it: requesters of any item
 * (only when it is a summary batch: more than one item or a fee) plus the
 * chosen members, never the payer.
 */
export function bulkPayRecipients(args: {
  payerId: string;
  requesters: (string | null)[];
  chosen: string[];
  itemCount: number;
  fee: number;
}): string[] {
  const summary = args.itemCount > 1 || args.fee > 0;
  const out = new Set<string>();
  if (summary) for (const r of args.requesters) if (r && r !== args.payerId) out.add(r);
  for (const c of args.chosen) if (c !== args.payerId) out.add(c);
  return [...out];
}

// ---------------------------------------------------------------------------
// Batch snapshot (payment_batches.items) and Riwayat grouping

export interface BatchItemSnapshot {
  transaction_id: string;
  obligation_id: string;
  title: string;
  requested_by: string | null;
  amount: number;
  installment_count: number | null;
  installment_from: number | null;
  installment_to: number | null;
  remaining_after: number;
  remainder_planned: number;
}

/** "Cicilan ke-5", "Cicilan ke-5 & ke-6", "Cicilan ke-5 s.d. ke-8". */
export function installmentRangeLabel(from: number | null, to: number | null): string | null {
  if (from == null || to == null || to < from) return null;
  if (from === to) return `Cicilan ke-${from}`;
  if (to === from + 1) return `Cicilan ke-${from} & ke-${to}`;
  return `Cicilan ke-${from} s.d. ke-${to}`;
}

export function batchItemLabel(item: BatchItemSnapshot): string {
  const rest = item.remaining_after > 0 ? `sisa ${formatRupiah(item.remaining_after)}` : null;
  if (item.installment_count != null) {
    const range = installmentRangeLabel(item.installment_from, item.installment_to) ?? `${item.installment_count} cicilan`;
    return rest ? `${range} · ${rest}` : `${range} · lunas`;
  }
  return rest ? `Sebagian · ${rest}` : 'Lunas';
}

export function parseBatchItems(value: unknown): BatchItemSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (x): x is BatchItemSnapshot =>
      !!x && typeof x === 'object' && typeof (x as BatchItemSnapshot).transaction_id === 'string'
  );
}

export interface BatchableRow {
  id: string;
  payment_batch_id?: string | null;
  actual_amount: number;
}

export type LedgerEntry<T extends BatchableRow> =
  | { type: 'row'; row: T }
  | { type: 'batch'; batchId: string; rows: T[]; total: number };

/**
 * One bank debit is one activity: rows sharing a batch id collapse into one
 * entry, placed where the first of them appears. A batch with a single row
 * stays a plain row.
 */
export function groupLedgerByBatch<T extends BatchableRow>(rows: T[]): LedgerEntry<T>[] {
  const byBatch = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.payment_batch_id) continue;
    const list = byBatch.get(r.payment_batch_id) ?? [];
    list.push(r);
    byBatch.set(r.payment_batch_id, list);
  }
  const out: LedgerEntry<T>[] = [];
  const emitted = new Set<string>();
  for (const r of rows) {
    const batchRows = r.payment_batch_id ? byBatch.get(r.payment_batch_id) : undefined;
    if (!r.payment_batch_id || !batchRows || batchRows.length < 2) {
      out.push({ type: 'row', row: r });
      continue;
    }
    if (emitted.has(r.payment_batch_id)) continue;
    emitted.add(r.payment_batch_id);
    out.push({
      type: 'batch',
      batchId: r.payment_batch_id,
      rows: batchRows,
      total: batchRows.reduce((s, x) => s + x.actual_amount, 0),
    });
  }
  return out;
}

/** "3 aktivitas" when a group holds a batch, otherwise "3 transaksi". */
export function groupCountLabel<T extends BatchableRow>(entries: LedgerEntry<T>[]): string {
  const hasBatch = entries.some((e) => e.type === 'batch');
  return `${entries.length} ${hasBatch ? 'aktivitas' : 'transaksi'}`;
}
