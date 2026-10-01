import { describe, expect, it } from 'vitest';
import {
  accountOpeningBalanceFromPriorClosing,
  accountZeroBased,
  openingBalanceFromPriorReconciliation,
  reconciliationPreview,
} from '../zero-based';
import type { ReconciliationTransaction } from '../zero-based';

const txn = (overrides: Partial<ReconciliationTransaction>): ReconciliationTransaction => ({
  account_id: 'bank',
  direction: 'EXPENSE',
  planned_amount: 0,
  actual_amount: 0,
  status: 'PAID',
  ...overrides,
});

describe('cycle reconciliation preview', () => {
  it('prefers the latest prior reconciliation and falls back only to that cycle snapshot', () => {
    const reconciliations = [
      { cycleId: 'older', endDate: '2026-07-31', accountId: 'wallet', closingStated: 700 },
      { cycleId: 'latest', endDate: '2026-08-31', accountId: 'bank', closingStated: 900 },
    ];
    const snapshots = [
      { cycleId: 'latest', endDate: '2026-08-31', accountId: 'wallet', closingStated: 800 },
      { cycleId: 'latest', endDate: '2026-08-31', accountId: 'bank', closingStated: 850 },
    ];

    expect(accountOpeningBalanceFromPriorClosing('bank', '2026-09-01', reconciliations, snapshots)).toBe(900);
    expect(accountOpeningBalanceFromPriorClosing('wallet', '2026-09-01', reconciliations, snapshots)).toBe(800);
  });

  it('does not skip the latest prior cycle when that cycle has no same-account closing fact', () => {
    const reconciliations = [
      { cycleId: 'older', endDate: '2026-07-31', accountId: 'bank', closingStated: 700 },
      { cycleId: 'latest', endDate: '2026-08-31', accountId: 'other-bank', closingStated: 900 },
    ];
    const snapshots = [
      { cycleId: 'older', endDate: '2026-07-31', accountId: 'wallet', closingStated: 600 },
    ];

    expect(accountOpeningBalanceFromPriorClosing('bank', '2026-09-01', reconciliations, snapshots)).toBeNull();
  });

  it('uses the previous closing anchor only for the same account', () => {
    const anchors = [
      { cycleId: 'old', endDate: '2026-08-31', accountId: 'bank-a', closingStated: 12_000 },
    ];
    expect(openingBalanceFromPriorReconciliation('bank-a', '2026-09-01', anchors)).toBe(12_000);
    expect(openingBalanceFromPriorReconciliation('bank-b', '2026-09-01', anchors)).toBeNull();
  });

  it('uses the latest earlier cycle anchor and does not skip an unreconciled latest cycle', () => {
    const anchors = [
      { cycleId: 'older', endDate: '2026-07-31', accountId: 'bank-a', closingStated: 10_000 },
      { cycleId: 'latest', endDate: '2026-08-31', accountId: 'bank-b', closingStated: 20_000 },
    ];
    expect(openingBalanceFromPriorReconciliation('bank-a', '2026-09-01', anchors)).toBeNull();
    expect(openingBalanceFromPriorReconciliation('bank-a', '2026-08-01', anchors)).toBe(10_000);
  });

  it('uses the newest same-account anchor when multiple earlier anchors exist', () => {
    const anchors = [
      { cycleId: 'old', endDate: '2026-07-31', accountId: 'bank-a', closingStated: 10_000 },
      { cycleId: 'new', endDate: '2026-08-31', accountId: 'bank-a', closingStated: 12_000 },
    ];
    expect(openingBalanceFromPriorReconciliation('bank-a', '2026-09-01', anchors)).toBe(12_000);
  });

  it('does not use an anchor dated on or after the current cycle start', () => {
    expect(openingBalanceFromPriorReconciliation('bank-a', '2026-08-01', [
      { cycleId: 'future', endDate: '2026-08-31', accountId: 'bank-a', closingStated: 10_000 },
    ])).toBeNull();
  });


  it('counts transfers out and in directionally in each account summary', () => {
    const transactions = [
      { account_id: 'bank-a', counter_account_id: 'bank-b', flow_type: 'TRANSFER' as const, planned_amount: 500, actual_amount: 500, status: 'PAID' as const },
    ];
    const source = accountZeroBased({ accountId: 'bank-a', transactions });
    const target = accountZeroBased({ accountId: 'bank-b', transactions });

    expect(source.outgoing.transferOut).toBe(500);
    expect(source.incoming.transferIn).toBe(0);
    expect(source.netCashflow).toBe(-500);
    expect(target.incoming.transferIn).toBe(500);
    expect(target.outgoing.transferOut).toBe(0);
    expect(target.netCashflow).toBe(500);
  });

  it('computes recorded movement and delta from paid primary-account rows', () => {
    const result = reconciliationPreview({
      accountId: 'bank',
      openingStated: 10_000_000,
      closingStated: 12_000_000,
      transactions: [
        txn({ flow_type: 'OPERATING_INCOME', actual_amount: 5_000_000 }),
        txn({ flow_type: 'EXPENSE', actual_amount: 3_000_000 }),
        txn({ account_id: 'card', flow_type: 'EXPENSE', actual_amount: 9_000_000 }),
      ],
    });
    expect(result.recordedNet).toBe(2_000_000);
    expect(result.delta).toBe(0);
    expect(result.canRecord).toBe(true);
  });

  it('keeps the first cycle as an anchor without inventing opening zero', () => {
    const result = reconciliationPreview({
      accountId: 'bank',
      openingStated: null,
      closingStated: 25_000_000,
      transactions: [],
    });
    expect(result.openingStated).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.canRecord).toBe(true);
  });

  it('blocks pending and unassigned rows instead of hiding them in adjustment', () => {
    const result = reconciliationPreview({
      accountId: 'bank',
      openingStated: 1_000_000,
      closingStated: 900_000,
      transactions: [
        txn({ status: 'PENDING', planned_amount: 100_000 }),
        txn({ account_id: null, actual_amount: 200_000 }),
      ],
    });
    expect(result.pendingCount).toBe(1);
    expect(result.nullAccountCount).toBe(1);
    expect(result.canRecord).toBe(false);
  });

  it('classifies asset allocation by flow type, not legacy direction', () => {
    const result = reconciliationPreview({
      accountId: 'bank',
      openingStated: 10_000,
      closingStated: 8_000,
      transactions: [
        txn({ direction: 'INCOME', flow_type: 'ASSET_ALLOCATION', actual_amount: 2_000 }),
      ],
    });
    expect(result.recordedNet).toBe(-2_000);
    expect(result.delta).toBe(0);
  });

  it('reports primary-account transactions outside the cycle separately', () => {
    const result = reconciliationPreview({
      accountId: 'bank',
      openingStated: 0,
      closingStated: 0,
      transactions: [],
      outsideCyclePrimaryCount: 2,
    });
    expect(result.outsideCyclePrimaryCount).toBe(2);
    expect(result.canRecord).toBe(true);
  });
});
