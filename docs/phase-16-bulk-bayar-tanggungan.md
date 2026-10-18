# Phase 16 — Bayar tanggungan sekaligus (bulk pay)

Satu transfer bank bisa melunasi beberapa tanggungan aktif: satu akun, satu tanggal, catatan opsional, dan satu ringkasan notifikasi. Debit bank boleh lebih besar dari subtotal karena ada biaya transfer. Mockup: `docs/mockups/bulk-pay-obligations-mockups.html` (lokal, folder ini di-gitignore). Implementasi: migration `034_bulk_pay_obligations.sql`, `lib/bulk-pay.ts` (pure, dengan tes), `components/bulk-pay/*`, layar `app/bulk-pay-review.tsx` dan `app/payment-batch.tsx`, hook di `lib/queries.ts`. Terapkan 034 di SQL Editor **sebelum** merilis build yang memanggilnya.

## A. Entry dan form

1. Quick Add > Pengeluaran punya pilihan "Biasa / Bayar tanggungan" (bukan tab ke-4). Dalam mode ini kategori diganti daftar tanggungan terpilih, dan toggle audit serta "Belum dibayar" disembunyikan. Picker "Masuk ke" (Anggaran Khusus, Phase 14) belum ada di `main`, jadi tidak ada yang perlu dikunci; 034 tidak menyebut `special_budget_id`.
2. **Tanggungan tanpa jadwal cicilan:** input nominal, default `remaining_amount`, boleh 1..sisa. Badge Lunas/Sebagian, ada "Bayar penuh" dan sisa setelah bayar.
3. **Tanggungan dengan cicilan terbuka:** stepper "N cicilan" (1..jumlah cicilan terbuka). Nominal dihitung server dari N cicilan terbuka pertama: `planned − paid`, urut jatuh tempo, sama dengan urutan pemetaan di 029. Tidak ada cicilan sebagian.
4. **Total keluar dari rekening:** default = subtotal. Total < subtotal ditolak. Total > subtotal membuat **satu** baris EXPENSE terpisah untuk selisihnya. Kategori default "Biaya Transfer"; kalau belum ada, RPC membuatnya sebagai kategori biasa. Biaya tidak pernah dibagi ke tanggungan dan tidak menulis allocation, sama seperti Quick Add biasa.
5. Akun: hanya BANK/E_WALLET aktif. Tanggal ≤ hari ini, satu tanggal untuk semua baris.

## B. Semantik per item (divalidasi terhadap kode, lihat temuan)

Siklus aktif ditentukan server. PENDING yang dicari hanya PENDING DEBT_PAYMENT tanggungan itu di siklus aktif.

| Kasus | Yang terjadi |
|---|---|
| Ada 1 PENDING, bayar = rencana | PENDING dieksekusi lewat `execute_planned_transaction`; allocation tetap |
| Ada 1 PENDING, bayar < rencana | PENDING dieksekusi dengan nominal bayar; allocation lama diubah jadi = bayar; PENDING sisa baru = `min(rencana − bayar, sisa tanggungan setelah bayar)` dengan allocation sendiri (akun disalin dari allocation lama). Total allocation tetap, relasi 1 baris = 1 allocation terjaga |
| Ada 1 PENDING, bayar > rencana | PENDING dieksekusi dengan nominal bayar; allocation dinaikkan = bayar |
| Tidak ada PENDING | Baris PAID baru + allocation = bayar (akun = akun bayar), kategori sistem Pinjaman |
| Lebih dari 1 PENDING | Ditolak di preview: "Ada N rencana… Bayar dari Detail Tanggungan." |
| N cicilan | Sama dengan kasus di atas, nominal = N cicilan. Satu baris, `remaining_amount` turun sekali, jadwal maju N |

Satu tanggungan = tepat satu baris DEBT_PAYMENT di batch. Semua baris batch (utang + biaya) membawa `payment_batch_id`. PENDING sisa **tidak** masuk batch karena bukan bagian dari debit bank.

**Membuka siklus berikutnya:** cicilan tidak pernah di-generate per siklus. `new-cycle.tsx` membawa setiap tanggungan sebesar `remaining_amount` yang sudah turun, jadi cicilan yang dibayar di muka tidak muncul lagi. Copy "siklus berikutnya tidak membuat rencana" sengaja tidak dipakai.

## C. Kontrak RPC

- `payment_batches` (baru): akun, tanggal, subtotal, total, biaya, jumlah item, catatan, penerima, pembuat. Read-only lewat RLS anggota; ditulis hanya oleh RPC. Masuk publication realtime + REPLICA IDENTITY FULL. Kolom `transactions.payment_batch_id` merujuk tabel ini. Tabel ini ditambahkan karena catatan dan penerima butuh tempat; tidak ada kolom catatan di `transactions`.
- `preview_pay_obligations_bulk(household, account, paid_at, items, total_debited, fee_category_id)` → jsonb: `error` (masalah global), `items[]` (ok, reason, mode, amount, installment range, sisa sebelum/sesudah, sisa rencana), `subtotal`, `fee_amount`, kategori biaya (+ `fee_category_new`), `plans_executed`, `remainder_plans`, `extra_allocation`, `all_ok`. Read-only.
- `pay_obligations_bulk(...sama, note, notify_member_ids)` → `payment_batch_id`. SECURITY DEFINER + cek anggota. Mengunci tanggungan (urut id) dan PENDING terkait, menghitung ulang semua nominal di server, lalu all-or-nothing.
- `items`: `[{ obligation_id, amount? , installment_count? }]`. Tepat satu dari dua field, sesuai jenis tanggungan; maksimal 50 item.
- **Belum dialokasikan setelahnya** dihitung client: ringkasan zero-based siklus saat ini dikurangi `extra_allocation`. Yang mengubah unallocated hanya allocation; eksekusi rencana dan biaya tidak.

## D. Notifikasi

6. Satu push per penerima per batch, dibangun di DB saat commit dan disimpan di `notifications` (kind `OBLIGATIONS_BULK_PAID`). `send-push` tidak berubah; client membaca `payment_batch_id` dari payload notifikasi.
7. Penerima = pengaju dari item mana pun (otomatis, selain pembayar) + anggota yang dipilih lewat "Kabari anggota lain".
8. Format:
   - Judul: `<pembayar> bayar <n> tanggungan · Rp <total>`
   - Baris 1: `<k> pengajuanmu sudah dibayar dari <akun>.` bila penerima mengajukan item, selain itu `Dari <akun>, <tgl>.`
   - Catatan dalam kutip (opsional), lalu maksimal 5 baris `• <nama> — Rp <nominal> (lunas | sisa Rp X | N cicilan)`. Item milik penerima didahulukan, lalu `dan <m> lainnya` bila terpotong, terakhir `Biaya transfer Rp <biaya>` bila ada.
   - Teks di layar review dibangun oleh `lib/bulk-pay.ts` dengan aturan yang sama.
9. Push otomatis per tanggungan (Phase 15) **tidak dikirim** untuk pembayaran di dalam batch yang punya >1 item atau biaya; `obligation_events` tetap tertulis utuh. Batch 1 item tanpa biaya tetap memakai push per tanggungan biasa, dan pengaju tidak ditambahkan ke penerima ringkasan.
10. Tap notifikasi membuka Detail Pembayaran (`/payment-batch`).

## E. Riwayat

11. Baris dengan `payment_batch_id` yang sama ditampilkan sebagai satu aktivitas di grup tanggalnya ("Bayar n tanggungan · <akun>", total debit). Tap membuka Detail Pembayaran, yang mendaftar baris-barisnya; tiap baris membuka edit transaksi biasa. Tidak ada pembatalan batch.

## F. Perbaikan yang ikut 034

12. `execute_planned_transaction`: penolakan "tidak dapat dipetakan ke jadwal cicilan" hanya berlaku kalau tanggungan punya jadwal. Ini memperbaiki Konfirmasi Pembayaran untuk Reimburse/Tagihan yang sebelumnya selalu gagal. `bulk_execute_row_problem` ikut disesuaikan.

## Temuan dan open questions

- **Double count di Detail Tanggungan (sudah ada sebelumnya):** `loan-detail.tsx` dan `ObligationRow.tsx` memanggil `allocate_debt_payment` walau di siklus aktif sudah ada PENDING. Akibatnya allocation dobel dan PENDING lama jadi stale. Follow-up: arahkan keduanya ke `pay_obligations_bulk` satu item, dan cabut grant `allocate_debt_payment` setelah semua device update. Query deteksi ada di blok verifikasi 034.
- **Allocation tanggungan bawaan siklus tidak terhitung di zero-based:** dibuat dengan `account_id` null (`new-cycle.tsx:227`), dan hanya allocation BANK/E_WALLET yang dihitung. Tidak diubah di fase ini.
- **Tanggal pakai UTC:** `todayISO()` dan `current_date` di DB sama-sama UTC, jadi pagi WIB sebelum 07.00 masih dihitung tanggal kemarin. Perilaku ini sudah ada sebelumnya.
- **Tanggungan bercicilan yang sisa tanggungannya > total cicilan terbuka** (bunga di luar jadwal): masih ditolak oleh `execute_planned_transaction`, dan stepper hanya menawarkan cicilan terbuka.
