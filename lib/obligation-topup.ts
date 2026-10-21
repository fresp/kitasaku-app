// Tambah pokok tanggungan (Phase 17) — pure rules behind the sheet on
// Detail Tanggungan. The server (topup_obligation, migration 036) is the
// authority; these mirror its checks so the sheet can explain them up front.
// Contract: docs/phase-17-tambah-pokok.md.

import { formatRupiah } from './format';

export interface TopupObligationRef {
  status: string | null;
  cancelled_at?: string | null;
  total_amount: number;
  remaining_amount: number;
}

export type TopupBlock = 'FINISHED' | 'SCHEDULED';

/** Why a top up is not offered, or null when it is. Same order as the RPC. */
export function topupBlockReason(
  ob: TopupObligationRef,
  openInstallmentCount: number,
): TopupBlock | null {
  if (ob.status === 'SETTLED' || ob.status === 'CANCELLED' || ob.cancelled_at) return 'FINISHED';
  if (openInstallmentCount > 0) return 'SCHEDULED';
  return null;
}

export function topupBlockMessage(block: TopupBlock, openInstallmentCount: number): string {
  if (block === 'FINISHED') return 'Tanggungan ini sudah selesai. Catat sebagai tanggungan baru.';
  return `Masih ada ${openInstallmentCount} cicilan terbuka. Supaya nominal per cicilan tetap benar, atur ulang tenor dan pokoknya dulu.`;
}

export interface TopupPreview {
  amount: number;
  totalBefore: number;
  totalAfter: number;
  remainingBefore: number;
  remainingAfter: number;
}

/** Figures the sheet shows; amount ≤ 0 keeps everything as it is. */
export function topupPreview(ob: TopupObligationRef, amount: number): TopupPreview {
  const add = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  return {
    amount: add,
    totalBefore: ob.total_amount,
    totalAfter: ob.total_amount + add,
    remainingBefore: ob.remaining_amount,
    remainingAfter: ob.remaining_amount + add,
  };
}

export function topupSubmitLabel(amount: number, pending: boolean): string {
  if (pending) return 'Menyimpan…';
  return amount > 0 ? `Tambah ${formatRupiah(amount)}` : 'Tambah pokok';
}

export function topupInflowHint(withInflow: boolean): string {
  return withInflow
    ? 'Tercatat sebagai pinjaman masuk di siklus ini, jadi menambah dana yang bisa dialokasikan.'
    : 'Saldo rekening tidak berubah. Hanya utang yang bertambah.';
}
