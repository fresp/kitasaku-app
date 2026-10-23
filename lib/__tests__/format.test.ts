import { describe, expect, it } from 'vitest';
import { formatRupiahInput, parseRupiahInput, pendingIncomeLabel, unpaidPlansLabel } from '../format';

describe('unpaidPlansLabel', () => {
  it('states the count and the money in one sentence', () => {
    expect(unpaidPlansLabel(2, 800_000)).toBe('2 tagihan belum dibayar · Rp 800.000');
  });

  it('reads the same for one plan, since the screens must agree word for word', () => {
    expect(unpaidPlansLabel(1, 300_000)).toBe('1 tagihan belum dibayar · Rp 300.000');
  });
});

describe('pendingIncomeLabel', () => {
  it('reports pending income apart from the bills', () => {
    expect(pendingIncomeLabel(2, 20_881_995)).toBe('2 pemasukan belum diterima · Rp 20.881.995');
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

  it('drops pasted sen instead of folding them into the rupiah', () => {
    // Stripping every non-digit would read "600.000,00" as Rp 60.000.000.
    expect(parseRupiahInput('600.000,00')).toBe(600_000);
    expect(parseRupiahInput('Rp 1.250.000,50')).toBe(1_250_000);
    expect(parseRupiahInput('75.000,5')).toBe(75_000);
    expect(formatRupiahInput('600.000,00')).toBe('600.000');
  });

  it('keeps digits after a comma that cannot be sen', () => {
    expect(parseRupiahInput('1,000,000')).toBe(1_000_000);
    expect(formatRupiahInput('600000,')).toBe('600.000');
  });

  it('survives a backspace across a separator', () => {
    // The field shows "1.000"; deleting the last char hands back "1.00".
    expect(formatRupiahInput('1.00')).toBe('100');
  });
});
