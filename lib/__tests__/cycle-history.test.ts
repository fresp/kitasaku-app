import { describe, expect, it } from 'vitest';
import { selectHistoryCycle } from '../cycle-history';
import type { Cycle } from '../queries';

const cycle = (id: string, active = false, cancelled = false): Cycle => ({
  id, household_id: 'household', name: id, start_date: '2026-09-01',
  end_date: '2026-09-30', is_active: active, primary_account_id: null,
  cancelled_at: cancelled ? '2026-10-04T00:00:00Z' : null,
});

describe('history cycle selection', () => {
  it('defaults to the active live cycle', () => {
    expect(selectHistoryCycle(undefined, [cycle('old'), cycle('current', true)], [], cycle('current', true))?.id).toBe('current');
  });
  it('uses the newest live cycle when none is active (closed, or just cancelled)', () => {
    expect(selectHistoryCycle(undefined, [cycle('latest'), cycle('old')], [cycle('wrong', false, true)], null)?.id).toBe('latest');
  });
  it('allows explicit read-only access to any of multiple cancelled cycles', () => {
    const cancelled = [cycle('bad-2', false, true), cycle('bad-1', false, true)];
    expect(selectHistoryCycle('bad-1', [cycle('real')], cancelled, cycle('real'))?.id).toBe('bad-1');
    expect(selectHistoryCycle('bad-2', [cycle('real')], cancelled, cycle('real'))?.id).toBe('bad-2');
  });
  it('falls back safely when a stale cycle id was removed', () => {
    expect(selectHistoryCycle('missing', [cycle('real')], [], null)?.id).toBe('real');
    expect(selectHistoryCycle('missing', [], [cycle('bad', false, true)], null)).toBeNull();
  });
});
