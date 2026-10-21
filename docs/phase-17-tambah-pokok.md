# Phase 17 — Tambah pokok tanggungan

Utang yang bertambah pada tanggungan yang sudah ada dicatat sebagai kejadian, bukan dengan mengubah pokok lewat "Atur Tenor & Cicilan". Implementasi: migration `036_obligation_topup.sql`, `lib/obligation-topup.ts` (pure, dengan tes), hook `useTopupObligation` di `lib/queries.ts`, sheet "Tambah pokok" di `app/loan-detail.tsx`. Terapkan 036 di SQL Editor **sebelum** merilis build yang memanggilnya.

## Keputusan

1. Entry: tombol "Tambah pokok" di Detail Tanggungan, di samping "Tandai sudah dibayar". Hanya untuk tanggungan yang belum selesai.
2. Form: nominal (> 0), tanggal (≤ hari ini), catatan opsional (≤ 280), toggle "Uang masuk ke rekening" (default nyala) dengan pilihan rekening BANK/E_WALLET aktif.
3. RPC `topup_obligation(household, obligation, amount, occurred_on, account?, note?)`, SECURITY DEFINER dengan cek anggota, mengunci baris tanggungan:
   - `total_amount` dan `remaining_amount` naik sebesar nominal, `principal_amount` ikut bila terisi. Status tidak berubah.
   - Menulis satu event `TOPUP` (amount, remaining_after, account, transaction, payload: occurred_on, note, total_before/after).
   - Dengan rekening: satu transaksi PAID `FINANCING_INFLOW` di siklus aktif, kategori sistem Pemasukan Pendanaan, nama "Tambah pokok · <judul>". **Tanpa `obligation_id`** (baris dengan `obligation_id` selalu DEBT_PAYMENT); tautannya di `obligation_events.transaction_id`. Tidak menulis `cycle_allocations`: pemasukan adalah sumber, bukan alokasi, jadi "belum dialokasikan" bertambah.
   - Tanpa rekening: hanya utang yang bertambah, tidak butuh siklus aktif.
4. Tanggungan dengan cicilan terbuka ditolak; sheet menawarkan "Atur cicilan". Membagi tambahan ke cicilan terbuka akan mengubah pemetaan 029 dan bentrok dengan kasus sisa > total cicilan terbuka (Phase 16).
5. `log_obligation_updated` melewati update yang ditulis bersama event TOPUP pada transaksi DB yang sama, jadi tidak ada SCHEDULE_CHANGED palsu.
6. Notifikasi `OBLIGATION_TOPUP` ke pengaju lewat fan-out biasa, kecuali pengaju sendiri yang menambah atau tanggungan tanpa pengaju (sebelum 033). Tap membuka Detail Tanggungan.
7. Aktivitas: "Pokok ditambah oleh <nama>", "+Rp X · masuk ke <akun> · sisa Rp Y — <catatan>".
8. Hero Detail menampilkan "Sisa dari total Rp X" saat sisa berbeda dari total.

## Dampak

- Tidak ada tabel baru; `transactions`, `obligations`, `obligation_events`, `notifications` sudah di publication realtime.
- Mutasi memanggil `invalidateMoneyKeys` (sudah mencakup `oblig`, `obl-events`, `txns`, `source-funds`, `zero-summary`).
- Siklus berikutnya membawa `remaining_amount` yang sudah naik.
- SQL diuji di Postgres 16 + stub Supabase: jalur sukses (dengan/tanpa rekening), idempotensi, semua penolakan (bercicilan, selesai, tanggal depan, nominal 0, akun tunai, bukan anggota, tanpa siklus aktif), top up oleh pengaju sendiri tanpa push, edit jadwal setelahnya tetap tercatat.

## Ditunda

- Top up untuk tanggungan bercicilan (regenerasi jadwal otomatis).
- Kartu "Kabari anggota ruang" di sheet ini.
- Date picker; tanggal masih input teks seperti sheet cicilan, dan `todayISO` masih UTC.
