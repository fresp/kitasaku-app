import { describe, expect, it } from 'vitest';
import { formatRupiahInput, parseRupiahInput, unpaidPlansLabel } from '../format';

describe('unpaidPlansLabel', () => {
  it('states the count and the money in one sentence', () => {
    expect(unpaidPlansLabel(2, 800_000)).toBe('2 tagihan belum dibayar · Rp 800.000');
  });

  it('reads the same for one plan, since the screens must agree word for word', () => {
    expect(unpaidPlansLabel(1, 300_000)).toBe('1 tagihan belum dibayar · Rp 300.000');
  });
});

describe('money input formatting', () => {
  it('formats digits as they are typed, without a prefix', () => {
    expect(formatRupiahInput('160000')).toBe('160.000');
    expect(formatRupiahInput('1817548')).toBe('1.817.548');
    expect(formatRupiahInput('5')).toBe('5');
  });

  it('round-trips a value that already carries its separators', () => {
    // The screen stores whatever the field last rendered, so the formatter is
    // fed its own output on the next keystroke.
    expect(formatRupiahInput('1.817.548')).toBe('1.817.548');
    expect(parseRupiahInput('1.817.548')).toBe(1_817_548);
  });

  it('leaves an empty field empty so the placeholder still shows', () => {
    expect(formatRupiahInput('')).toBe('');
    expect(formatRupiahInput('Rp ')).toBe('');
    expect(parseRupiahInput('')).toBe(0);
  });

  it('drops anything that is not a digit, including a pasted prefix', () => {
    expect(formatRupiahInput('Rp 160.000')).toBe('160.000');
    expect(parseRupiahInput('Rp 160.000')).toBe(160_000);
    expect(parseRupiahInput('-250')).toBe(250);
  });

  it('refuses a figure past the safe integer range rather than returning NaN', () => {
    expect(parseRupiahInput('9'.repeat(25))).toBe(0);
  });
});
