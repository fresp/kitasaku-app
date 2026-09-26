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
