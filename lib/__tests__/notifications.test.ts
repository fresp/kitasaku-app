import { describe, expect, it } from 'vitest';
import { routeForNotification, sharedNote, sharedTransactionIds } from '../notifications';

describe('routeForNotification', () => {
  it('opens the tanggungan for obligation kinds', () => {
    expect(routeForNotification({ kind: 'OBLIGATION_PAYMENT', obligation_id: 'o1', id: 'n1' }))
      .toEqual({ pathname: '/loan-detail', params: { id: 'o1' } });
  });
  it('opens Kabar Pembayaran for shared transactions, from a row or a push', () => {
    expect(routeForNotification({ kind: 'TRANSACTIONS_SHARED', id: 'n1' }))
      .toEqual({ pathname: '/shared-transactions', params: { id: 'n1' } });
    expect(routeForNotification({ kind: 'TRANSACTIONS_SHARED', notification_id: 'n2', obligation_id: null }))
      .toEqual({ pathname: '/shared-transactions', params: { id: 'n2' } });
  });
  it('returns null when it cannot route', () => {
    expect(routeForNotification({ kind: 'OBLIGATION_CREATED', obligation_id: null })).toBeNull();
    expect(routeForNotification({ kind: 'SOMETHING' })).toBeNull();
    expect(routeForNotification({})).toBeNull();
  });
});

describe('shared payload', () => {
  it('reads transaction ids and note defensively', () => {
    expect(sharedTransactionIds({ transaction_ids: ['a', 3, '', 'b'] })).toEqual(['a', 'b']);
    expect(sharedTransactionIds(null)).toEqual([]);
    expect(sharedNote({ note: '  aman ' })).toBe('aman');
    expect(sharedNote({ note: 4 })).toBeNull();
  });
});
