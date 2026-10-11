export function formatRupiah(value: number, opts?: { withPrefix?: boolean }): string {
  const formatted = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
  return opts?.withPrefix === false ? formatted : `Rp ${formatted}`;
}

export function formatRupiahShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const jt = value / 1_000_000;
    const str = Number.isInteger(jt) ? jt.toString() : jt.toFixed(1).replace('.', ',');
    return `Rp ${str}jt`;
  }
  if (abs >= 1_000) {
    const rb = value / 1_000;
    const str = Number.isInteger(rb) ? rb.toString() : rb.toFixed(1).replace('.', ',');
    return `Rp ${str}rb`;
  }
  return formatRupiah(value);
}

export function formatDelta(current: number, previous: number): { text: string; kind: 'up' | 'down' | 'same' } {
  const diff = current - previous;
  if (diff === 0) return { text: 'Sama dg bln lalu', kind: 'same' };
  const sign = diff > 0 ? '+' : '−';
  return {
    text: `${sign}${formatRupiahShort(Math.abs(diff)).replace('Rp ', 'Rp ')} vs bln lalu`,
    kind: diff > 0 ? 'up' : 'down',
  };
}

/**
 * One fact, one sentence. Home's attention list and the ledger's banner both
 * report the plans this cycle has not executed yet; wording them separately
 * ("tagihan belum dibayar" / "transaksi belum dieksekusi") made the same two
 * numbers look like two different problems. Call this from both.
 */
export function unpaidPlansLabel(count: number, amount: number): string {
  return `${count} tagihan belum dibayar · ${formatRupiah(amount)}`;
}

/**
 * Digits of a typed money field, as an integer.
 *
 * Everything that is not a digit is dropped, so a value already carrying its
 * thousands separators ("1.817.548") round-trips, and so does a pasted string
 * with spaces or a stray "Rp".
 */
export function parseRupiahInput(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return 0;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : 0;
}

/**
 * What a money field should display while it is being typed: the digits with
 * id-ID thousands separators and no "Rp" prefix, because the prefix is
 * rendered beside the field rather than inside its value. Keeping it out of
 * the text is what makes it impossible for a backspace to eat it.
 *
 * An empty field stays empty rather than becoming "0", so the placeholder can
 * still show.
 */
export function formatRupiahInput(text: string): string {
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return '';
  return formatRupiah(parseRupiahInput(digits), { withPrefix: false });
}
