import { describe, expect, it } from 'vitest';
import {
  batchItemLabel,
  bulkPayNotification,
  bulkPayRecipients,
  defaultDraftItem,
  deriveFee,
  draftItemAmount,
  draftItemProblem,
  groupCountLabel,
  groupLedgerByBatch,
  installmentRangeLabel,
  installmentsAmount,
  parseBatchItems,
  payBadge,
  previewHeaderLine,
  previewItemLabel,
  shortDateId,
  toRpcItems,
  type BulkPayPreviewItem,
} from '../bulk-pay';

const inst = (id: string, due: string | null, planned: number, paid = 0) => ({
  id, due_date: due, planned_amount: planned, paid_amount: paid, created_at: '2026-01-01T00:00:00Z',
});

describe('installments', () => {
  it('sums the next N in due order, nulls last, counting partial payments', () => {
    const rows = [inst('c', null, 100), inst('b', '2026-12-05', 750_000), inst('a', '2026-11-05', 750_000, 250_000)];
    expect(installmentsAmount(rows, 1)).toBe(500_000);
    expect(installmentsAmount(rows, 2)).toBe(1_250_000);
    expect(installmentsAmount(rows, 3)).toBe(1_250_100);
    expect(installmentsAmount(rows, 0)).toBe(0);
  });

  it('defaults to 1 cicilan for scheduled and to the full remainder otherwise', () => {
    expect(defaultDraftItem({ id: 'o', remaining_amount: 6_000_000 }, 8))
      .toEqual({ obligationId: 'o', kind: 'installments', installmentCount: 1 });
    expect(defaultDraftItem({ id: 'o', remaining_amount: 115_000 }, 0))
      .toEqual({ obligationId: 'o', kind: 'amount', amount: 115_000 });
  });

  it('reads the draft amount from the right input', () => {
    const rows = [inst('a', '2026-11-05', 750_000), inst('b', '2026-12-05', 750_000)];
    expect(draftItemAmount({ obligationId: 'o', kind: 'installments', installmentCount: 2 }, rows)).toBe(1_500_000);
    expect(draftItemAmount({ obligationId: 'o', kind: 'amount', amount: 9 }, rows)).toBe(9);
  });
});

describe('draftItemProblem', () => {
  const ob = { id: 'o', remaining_amount: 5_000_000 };
  it('accepts 1..remaining for unscheduled', () => {
    expect(draftItemProblem({ obligationId: 'o', kind: 'amount', amount: 1 }, ob, 0)).toBeNull();
    expect(draftItemProblem({ obligationId: 'o', kind: 'amount', amount: 5_000_000 }, ob, 0)).toBeNull();
    expect(draftItemProblem({ obligationId: 'o', kind: 'amount', amount: 0 }, ob, 0)).toMatch(/lebih dari Rp 0/);
    expect(draftItemProblem({ obligationId: 'o', kind: 'amount', amount: 5_000_001 }, ob, 0)).toMatch(/melebihi sisa/);
  });
  it('accepts 1..open installments for scheduled', () => {
    expect(draftItemProblem({ obligationId: 'o', kind: 'installments', installmentCount: 8 }, ob, 8)).toBeNull();
    expect(draftItemProblem({ obligationId: 'o', kind: 'installments', installmentCount: 9 }, ob, 8)).toMatch(/1 sampai 8/);
    expect(draftItemProblem({ obligationId: 'o', kind: 'installments', installmentCount: 1 }, ob, 0)).toMatch(/tidak punya cicilan/);
  });
});

describe('fee', () => {
  it('is the debit above the subtotal', () => {
    expect(deriveFee([115_000, 400_000, 1_000_000, 1_500_000], 3_021_500))
      .toEqual({ subtotal: 3_015_000, fee: 6_500, error: null });
    expect(deriveFee([100], 100)).toEqual({ subtotal: 100, fee: 0, error: null });
  });
  it('rejects a debit below the subtotal', () => {
    const r = deriveFee([1_000], 999);
    expect(r.fee).toBe(0);
    expect(r.error).toMatch(/tidak boleh lebih kecil/);
  });
  it('badges full and partial', () => {
    expect(payBadge(115_000, 115_000)).toBe('Lunas');
    expect(payBadge(1_000_000, 5_000_000)).toBe('Sebagian');
  });
  it('sends exactly one input per item', () => {
    expect(toRpcItems([
      { obligationId: 'a', kind: 'amount', amount: 5 },
      { obligationId: 'b', kind: 'installments', installmentCount: 2 },
    ])).toEqual([{ obligation_id: 'a', amount: 5 }, { obligation_id: 'b', installment_count: 2 }]);
  });
});

describe('preview labels', () => {
  const base: BulkPayPreviewItem = {
    obligation_id: 'o', title: 'X', ok: true, reason: null, mode: 'EXECUTE', amount: 1,
    installment_count: null, installment_from: null, installment_to: null,
    remaining_before: 1, remaining_after: 0, remainder: 0, extra_allocation: 0, requested_by: null,
  };
  it('names what happens to the plan', () => {
    expect(previewItemLabel(base)).toBe('Lunas · rencana siklus dieksekusi');
    expect(previewItemLabel({ ...base, mode: 'NEW_PAYMENT', remaining_after: 4_000_000 }))
      .toBe('Sebagian · alokasi baru · sisa Rp 4.000.000');
    expect(previewItemLabel({ ...base, mode: 'EXECUTE_SPLIT', installment_count: 2, remainder: 4_500_000, remaining_after: 4_500_000 }))
      .toBe('2 cicilan · sisa Rp 4.500.000 tetap direncanakan');
    expect(previewItemLabel({ ...base, ok: false, reason: 'Ada 2 rencana.' })).toBe('Ada 2 rencana.');
  });
  it('counts rows and remainder plans in the header', () => {
    expect(previewHeaderLine(4, 6_500, 1)).toBe('1 aktivitas di Riwayat · 5 baris · +1 rencana sisa tetap di Siklus');
    expect(previewHeaderLine(2, 0, 0)).toBe('1 aktivitas di Riwayat · 2 baris');
  });
});

describe('bulkPayNotification', () => {
  const NURI = 'u-nuri';
  const items = [
    { title: 'Nescafe Kopi + Milo', amount: 115_000, installmentCount: null, remainingAfter: 0, requestedBy: NURI },
    { title: 'Ekskul Basket', amount: 400_000, installmentCount: null, remainingAfter: 0, requestedBy: 'u-freza' },
    { title: 'Reimburse Tabungan', amount: 1_000_000, installmentCount: null, remainingAfter: 4_000_000, requestedBy: NURI },
    { title: 'Cicilan Laptop', amount: 1_500_000, installmentCount: 2, remainingAfter: 4_500_000, requestedBy: 'u-freza' },
  ];
  const input = {
    payerName: 'Freza', accountName: 'Mandiri', paidAt: '2026-10-18', totalDebited: 3_021_500, fee: 6_500,
    note: 'Sekalian transfer buat minggu ini ya', items, recipientId: NURI,
  };

  it('matches the SQL body for a requester (own items first)', () => {
    expect(bulkPayNotification(input)).toEqual({
      title: 'Freza bayar 4 tanggungan · Rp 3.021.500',
      body: [
        '2 pengajuanmu sudah dibayar dari Mandiri.',
        '“Sekalian transfer buat minggu ini ya”',
        '• Nescafe Kopi + Milo — Rp 115.000 (lunas)',
        '• Reimburse Tabungan — Rp 1.000.000 (sisa Rp 4.000.000)',
        '• Ekskul Basket — Rp 400.000 (lunas)',
        '• Cicilan Laptop — Rp 1.500.000 (2 cicilan)',
        'Biaya transfer Rp 6.500',
      ].join('\n'),
    });
  });

  it('opens with account and date for a non-requester and truncates after 5', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      title: `Item ${i + 1}`, amount: 10_000 * (i + 1), installmentCount: null, remainingAfter: 0, requestedBy: NURI,
    }));
    const { body } = bulkPayNotification({ ...input, note: null, fee: 0, items: many, recipientId: 'u-other' });
    expect(body.split('\n')).toEqual([
      'Dari Mandiri, 18 Okt.',
      '• Item 1 — Rp 10.000 (lunas)',
      '• Item 2 — Rp 20.000 (lunas)',
      '• Item 3 — Rp 30.000 (lunas)',
      '• Item 4 — Rp 40.000 (lunas)',
      '• Item 5 — Rp 50.000 (lunas)',
      'dan 2 lainnya',
    ]);
  });

  it('formats short Indonesian dates', () => {
    expect(shortDateId('2026-01-02')).toBe('2 Jan');
    expect(shortDateId('2026-05-31')).toBe('31 Mei');
    expect(shortDateId('2026-08-09T23:00:00Z')).toBe('9 Agu');
  });
});

describe('bulkPayRecipients', () => {
  it('adds requesters only for a summary batch, never the payer', () => {
    expect(bulkPayRecipients({ payerId: 'p', requesters: ['n', 'p', null, 'n'], chosen: [], itemCount: 2, fee: 0 }))
      .toEqual(['n']);
    expect(bulkPayRecipients({ payerId: 'p', requesters: ['n'], chosen: [], itemCount: 1, fee: 0 })).toEqual([]);
    expect(bulkPayRecipients({ payerId: 'p', requesters: ['n'], chosen: ['x', 'p'], itemCount: 1, fee: 500 }))
      .toEqual(['n', 'x']);
  });
});

describe('batch snapshot', () => {
  it('labels installment ranges', () => {
    expect(installmentRangeLabel(5, 5)).toBe('Cicilan ke-5');
    expect(installmentRangeLabel(5, 6)).toBe('Cicilan ke-5 & ke-6');
    expect(installmentRangeLabel(5, 8)).toBe('Cicilan ke-5 s.d. ke-8');
    expect(installmentRangeLabel(null, 3)).toBeNull();
  });
  it('labels items', () => {
    const snap = {
      transaction_id: 't', obligation_id: 'o', title: 'X', requested_by: null, amount: 1,
      installment_count: null, installment_from: null, installment_to: null, remaining_after: 0, remainder_planned: 0,
    };
    expect(batchItemLabel(snap)).toBe('Lunas');
    expect(batchItemLabel({ ...snap, remaining_after: 4_000_000 })).toBe('Sebagian · sisa Rp 4.000.000');
    expect(batchItemLabel({ ...snap, installment_count: 2, installment_from: 5, installment_to: 6, remaining_after: 4_500_000 }))
      .toBe('Cicilan ke-5 & ke-6 · sisa Rp 4.500.000');
  });
  it('parses defensively', () => {
    expect(parseBatchItems(null)).toEqual([]);
    expect(parseBatchItems([{ transaction_id: 't' }, 3, { x: 1 }])).toHaveLength(1);
  });
});

describe('groupLedgerByBatch', () => {
  const row = (id: string, batch: string | null, amt: number) => ({ id, payment_batch_id: batch, actual_amount: amt });
  it('collapses a batch where its first row appears', () => {
    const entries = groupLedgerByBatch([row('1', 'b', 100), row('2', null, 5), row('3', 'b', 6), row('4', 'c', 9)]);
    expect(entries.map((e) => (e.type === 'row' ? e.row.id : `batch:${e.batchId}:${e.total}`)))
      .toEqual(['batch:b:106', '2', '4']);
    expect(groupCountLabel(entries)).toBe('3 aktivitas');
    expect(groupCountLabel(groupLedgerByBatch([row('2', null, 5)]))).toBe('1 transaksi');
  });
});
