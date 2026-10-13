import { describe, expect, it } from 'vitest';
import {
  activityTimeline,
  buildTimeline,
  cancellationReasonLabel,
  defaultShareRecipients,
  memberName,
  normalizeShareNote,
  obligationListSubtitle,
  recipientsSentence,
  requesterLabel,
  shareSummary,
  summarizeBulkPreview,
  timelineItem,
  type MemberRef,
  type ObligationEvent,
} from '../collaboration';

const F = 'user-f';
const R = 'user-r';
const members: MemberRef[] = [
  { user_id: F, display_name: 'Freza', email: 'freza@x.id', is_me: true },
  { user_id: R, display_name: null, email: 'rani@x.id', is_me: false },
];

function ev(partial: Partial<ObligationEvent>): ObligationEvent {
  return {
    id: 'e1',
    obligation_id: 'o1',
    kind: 'CREATED',
    actor_user_id: R,
    transaction_id: null,
    account_id: null,
    amount: null,
    remaining_after: null,
    is_final: null,
    reason: null,
    payload: {},
    created_at: '2026-10-12T01:10:00Z',
    ...partial,
  };
}

describe('member names', () => {
  it('prefers display name, then the email local part', () => {
    expect(memberName(members, F)).toBe('Freza');
    expect(memberName(members, R)).toBe('rani');
  });
  it('returns null for unknown or missing users', () => {
    expect(memberName(members, 'nobody')).toBeNull();
    expect(memberName(members, null)).toBeNull();
  });
  it('says "Tidak tercatat" for rows from before migration 033', () => {
    expect(requesterLabel(members, null)).toBe('Tidak tercatat');
    expect(requesterLabel(members, R)).toBe('rani');
  });
  it('builds the list subtitle with or without a requester', () => {
    expect(obligationListSubtitle('REIMBURSE', members, R)).toBe('Reimburse · dari rani');
    expect(obligationListSubtitle('BILL', members, null)).toBe('Tagihan');
  });
});

describe('timeline', () => {
  it('describes a submission with type and amount', () => {
    const item = timelineItem(ev({ amount: 385000, payload: { type: 'REIMBURSEMENT' } }), members);
    expect(item.title).toBe('Diajukan oleh rani');
    expect(item.subtitle).toBe('Reimburse Rp 385.000');
    expect(item.tone).toBe('info');
  });
  it('distinguishes partial payment from settlement', () => {
    const partial = timelineItem(
      ev({ kind: 'PAYMENT', actor_user_id: F, amount: 200000, remaining_after: 185000, is_final: false,
           payload: { account_name: 'BCA Keluarga' } }),
      members,
    );
    expect(partial.title).toBe('Dibayar sebagian oleh Freza');
    expect(partial.subtitle).toBe('Rp 200.000 dari BCA Keluarga · sisa Rp 185.000');
    const final = timelineItem(
      ev({ kind: 'PAYMENT', actor_user_id: F, amount: 85000, remaining_after: 0, is_final: true, payload: {} }),
      members,
    );
    expect(final.title).toBe('Dilunasi oleh Freza');
    expect(final.subtitle).toBe('Rp 85.000');
  });
  it('labels cancellation reasons and keeps the note', () => {
    const item = timelineItem(
      ev({ kind: 'CANCELLED', reason: 'WRONG_INPUT', payload: { note: 'nominal keliru' } }),
      members,
    );
    expect(item.subtitle).toBe('Alasan: salah input — nominal keliru');
    expect(item.tone).toBe('cancelled');
    expect(cancellationReasonLabel('SOMETHING')).toBe('SOMETHING');
    expect(cancellationReasonLabel('')).toBeNull();
  });
  it('shows a direct status change with readable states and an unknown actor', () => {
    const item = timelineItem(
      ev({ kind: 'STATUS_CHANGED', actor_user_id: null, payload: { from: 'OPEN', to: 'SETTLED' } }),
      members,
    );
    expect(item.title).toBe('Status diubah oleh Seseorang');
    expect(item.subtitle).toBe('Belum dibayar → Lunas');
  });
  it('orders events oldest first', () => {
    const items = buildTimeline(
      [
        ev({ id: 'b', kind: 'SCHEDULE_CHANGED', created_at: '2026-10-13T00:00:00Z' }),
        ev({ id: 'a', created_at: '2026-10-12T00:00:00Z' }),
      ],
      members,
    );
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('kabar transaksi', () => {
  it('defaults to every other member', () => {
    expect(defaultShareRecipients(members, F)).toEqual([R]);
    expect(defaultShareRecipients([members[0]], F)).toEqual([]);
  });
  it('names who will be told', () => {
    expect(recipientsSentence(members, [R])).toBe('rani akan diberi tahu');
    const three: MemberRef[] = [...members, { user_id: 'u3', display_name: 'Dimas' }];
    expect(recipientsSentence(three, [R, 'u3'])).toBe('rani dan Dimas akan diberi tahu');
    expect(recipientsSentence(members, [])).toBeNull();
  });
  it('summarizes amounts the way the SQL kabar does', () => {
    const s = shareSummary([
      { direction: 'EXPENSE', amount: 412500 },
      { direction: 'EXPENSE', amount: 385000 },
      { direction: 'EXPENSE', amount: 750000 },
    ]);
    expect(s.text).toBe('3 transaksi · keluar Rp 1.547.500');
    expect(shareSummary([{ direction: 'INCOME', amount: 5000000 }]).text).toBe('1 transaksi · masuk Rp 5.000.000');
  });
  it('trims and caps the note', () => {
    expect(normalizeShareNote('   ')).toBeNull();
    expect(normalizeShareNote(' ok ')).toBe('ok');
    expect(normalizeShareNote('x'.repeat(400))?.length).toBe(280);
  });
});

describe('bulk preview', () => {
  it('enables only when every selected row passed', () => {
    const ok = summarizeBulkPreview(['a', 'b'], [
      { transaction_id: 'a', ok: true, reason: null },
      { transaction_id: 'b', ok: true, reason: null },
    ]);
    expect(ok).toEqual({ allOk: true, problems: {} });
    const bad = summarizeBulkPreview(['a', 'b'], [
      { transaction_id: 'a', ok: true, reason: null },
      { transaction_id: 'b', ok: false, reason: 'Akunnya tidak aktif.' },
    ]);
    expect(bad.allOk).toBe(false);
    expect(bad.problems).toEqual({ b: 'Akunnya tidak aktif.' });
  });
  it('treats an unreported or empty selection as not ready', () => {
    expect(summarizeBulkPreview(['a'], []).allOk).toBe(false);
    expect(summarizeBulkPreview([], []).allOk).toBe(false);
  });
});

describe('activityTimeline', () => {
  it('folds in payments that predate the trail, without duplicating covered ones', () => {
    const events: ObligationEvent[] = [
      ev({ id: 'e-created', created_at: '2026-10-01T00:00:00Z', amount: 300000, payload: { type: 'BILL' } }),
      ev({ id: 'e-pay', kind: 'PAYMENT', actor_user_id: F, transaction_id: 't2', amount: 100000,
           remaining_after: 100000, is_final: false, created_at: '2026-10-05T00:00:00Z', payload: {} }),
    ];
    const items = activityTimeline(
      events,
      [
        { id: 't1', actual_amount: 100000, executed_by: R, created_at: '2026-09-20T00:00:00Z', accounts: { name: 'BCA' } },
        { id: 't2', actual_amount: 100000, executed_by: F, created_at: '2026-10-05T00:00:00Z' },
      ],
      members,
    );
    expect(items.map((i) => i.id)).toEqual(['payment-t1', 'e-created', 'e-pay']);
    expect(items[0].title).toBe('Dibayar oleh rani');
    expect(items[0].subtitle).toBe('Rp 100.000 dari BCA');
  });
});
