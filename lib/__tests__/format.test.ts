import { describe, expect, it } from 'vitest';
import { unpaidPlansLabel } from '../format';

describe('unpaidPlansLabel', () => {
  it('states the count and the money in one sentence', () => {
    expect(unpaidPlansLabel(2, 800_000)).toBe('2 tagihan belum dibayar · Rp 800.000');
  });

  it('reads the same for one plan, since the screens must agree word for word', () => {
    expect(unpaidPlansLabel(1, 300_000)).toBe('1 tagihan belum dibayar · Rp 300.000');
  });
});
