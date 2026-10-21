import { describe, expect, it } from 'vitest';
import {
  topupBlockMessage,
  topupBlockReason,
  topupInflowHint,
  topupPreview,
  topupSubmitLabel,
  type TopupObligationRef,
} from '../obligation-topup';
import { timelineItem, type ObligationEvent } from '../collaboration';
import { routeForNotification } from '../notifications';

const open: TopupObligationRef = { status: 'OPEN', cancelled_at: null, total_amount: 5000000, remaining_amount: 5000000 };

describe('topupBlockReason', () => {
  it('allows an open obligation without a schedule', () => {
    expect(topupBlockReason(open, 0)).toBeNull();
    expect(topupBlockReason({ ...open, status: 'PARTIAL', remaining_amount: 2000000 }, 0)).toBeNull();
  });

  it('blocks finished obligations before looking at the schedule', () => {
    expect(topupBlockReason({ ...open, status: 'SETTLED' }, 3)).toBe('FINISHED');
    expect(topupBlockReason({ ...open, status: 'CANCELLED' }, 0)).toBe('FINISHED');
    expect(topupBlockReason({ ...open, cancelled_at: '2026-10-01T00:00:00Z' }, 0)).toBe('FINISHED');
  });

  it('blocks obligations with open installments', () => {
    expect(topupBlockReason(open, 6)).toBe('SCHEDULED');
    expect(topupBlockMessage('SCHEDULED', 6)).toContain('6 cicilan terbuka');
  });
});

describe('topupPreview', () => {
  it('adds the amount to both total and remaining', () => {
    expect(topupPreview({ ...open, remaining_amount: 3000000 }, 1500000)).toEqual({
      amount: 1500000,
      totalBefore: 5000000,
      totalAfter: 6500000,
      remainingBefore: 3000000,
      remainingAfter: 4500000,
    });
  });

  it('ignores non-positive or invalid amounts', () => {
    expect(topupPreview(open, 0).remainingAfter).toBe(5000000);
    expect(topupPreview(open, -10).totalAfter).toBe(5000000);
    expect(topupPreview(open, Number.NaN).amount).toBe(0);
  });
});

describe('labels', () => {
  it('names the amount on the submit button', () => {
    expect(topupSubmitLabel(1500000, false)).toBe('Tambah Rp 1.500.000');
    expect(topupSubmitLabel(0, false)).toBe('Tambah pokok');
    expect(topupSubmitLabel(1500000, true)).toBe('Menyimpan…');
  });

  it('explains both inflow choices', () => {
    expect(topupInflowHint(true)).toContain('pinjaman masuk');
    expect(topupInflowHint(false)).toContain('Saldo rekening tidak berubah');
  });
});

describe('TOPUP in Aktivitas and notifications', () => {
  const base: ObligationEvent = {
    id: 'e1', obligation_id: 'o1', kind: 'TOPUP', actor_user_id: 'u1', transaction_id: 't1',
    account_id: 'a1', amount: 1500000, remaining_after: 6500000, is_final: false, reason: null,
    payload: { account_name: 'BCA', note: 'pinjam lagi' }, created_at: '2026-10-21T14:05:00Z',
  };
  const members = [{ user_id: 'u1', display_name: 'Freza' }];

  it('describes a top up with money in', () => {
    expect(timelineItem(base, members)).toMatchObject({
      title: 'Pokok ditambah oleh Freza',
      subtitle: '+Rp 1.500.000 · masuk ke BCA · sisa Rp 6.500.000 — pinjam lagi',
      tone: 'info',
    });
  });

  it('describes a top up without money in', () => {
    const item = timelineItem({ ...base, account_id: null, transaction_id: null, payload: {} }, members);
    expect(item.subtitle).toBe('+Rp 1.500.000 · sisa Rp 6.500.000');
  });

  it('opens the tanggungan from an OBLIGATION_TOPUP push', () => {
    expect(routeForNotification({ kind: 'OBLIGATION_TOPUP', obligation_id: 'o1' }))
      .toEqual({ pathname: '/loan-detail', params: { id: 'o1' } });
  });
});
