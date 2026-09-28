import { describe, expect, it } from 'vitest';
import { reconciliationPreview } from '../zero-based';
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
