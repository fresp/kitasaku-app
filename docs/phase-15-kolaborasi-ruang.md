# Phase 15 — Kolaborasi Ruang (pengaju, jejak aktivitas, kabar transaksi)

Ruang keluarga tidak cuma tempat input bersama. Setiap tanggungan tercatat siapa yang mengajukan, setiap aksi atasnya punya jejak, pengaju dikabari saat tanggungannya diproses, dan siapa pun bisa mengabari anggota lain saat mencatat atau membayar transaksi. Mockup: canvas "Kitasaku — Reimburse Anggota" (baris 1–4). Implementasi (branch `feat/kolaborasi-ruang`): migration `033_household_collaboration.sql`, edge function `supabase/functions/send-push`, `lib/collaboration.ts` + `lib/notifications.ts` (pure, dengan tes), `lib/push.ts`, `components/collaboration/KabariCard.tsx`, layar `app/shared-transactions.tsx`, hook di `lib/queries.ts`. Belum diterapkan di Supabase remote; terapkan 033 **sebelum** merilis build yang membacanya.

## A. Pengaju tanggungan

1. `obligations.created_by` default `auth.uid()`, immutable (trigger). Semua jalur pembuatan mengisinya otomatis (insert `useCreateObligation`, RPC `create_financing_with_obligation`).
2. Data lama tanpa `created_by` tampil "Tidak tercatat". Tidak di-backfill, dan notifikasi ke pengaju dilewati untuk baris itu.
3. Reimburse bisa dibuat dari form tanggungan: toggle Jenis (Tagihan | Reimburse). Mode Reimburse menyembunyikan Frekuensi. Sebelum fase ini tidak ada jalur UI untuk membuat REIMBURSEMENT.

## B. Jejak aktivitas tanggungan

4. Tabel `obligation_events` bersifat append-only: tidak ada update/delete untuk siapa pun, RLS select untuk anggota. Baris ditulis oleh trigger SECURITY DEFINER, dengan `actor_user_id = auth.uid()`:
   - `CREATED`: insert obligation.
   - `PAYMENT`: transaksi dengan `obligation_id` menjadi PAID lewat **dua jalur**, yaitu INSERT oleh `allocate_debt_payment` dan UPDATE PENDING→PAID oleh `execute_planned_transaction`. Payload: amount, account_id, transaction_id, remaining_after, is_final. `remaining_after` harus dibaca **setelah** RPC mengurangi `remaining_amount`; verifikasi urutannya di 029/030.
   - `SCHEDULE_CHANGED`: perubahan jadwal/mode cicilan (`set_installment_cycle`, `schedule_obligation_installments`, `configure_obligation_installments`, `set_obligation_repayment_mode`).
   - `CANCELLED`: `cancelled_at` terisi lewat `cancel_obligation`, alasan ikut dicatat.
   - `STATUS_CHANGED`: status berubah **tanpa** turunnya `remaining_amount`. Ini jalur update langsung lewat policy `for all` dan dicatat sebagai anomali. Pelunasan tidak boleh tercatat dobel sebagai PAYMENT sekaligus STATUS_CHANGED.
5. Di Detail tanggungan, tab Riwayat menjadi Aktivitas (timeline dari `obligation_events`), ditambah baris "Diajukan oleh". Di daftar tanggungan, subjudul menjadi "<Jenis> · dari <nama>".

## C. Notifikasi tanggungan (otomatis)

6. `CREATED` dikirim ke semua anggota kecuali aktor. `PAYMENT`, `CANCELLED`, `SCHEDULE_CHANGED`, dan `STATUS_CHANGED` dikirim ke pengaju, kecuali aktor = pengaju atau `created_by` null.
   - **Revisi Phase 16 (034):** `PAYMENT` di dalam batch bayar tanggungan yang berisi >1 item atau punya biaya **tidak** dipush per tanggungan. Pengaju otomatis menerima satu ringkasan `OBLIGATIONS_BULK_PAID` per batch. `obligation_events` tetap ditulis seperti biasa. Lihat `docs/phase-16-bulk-bayar-tanggungan.md` bagian D.

## D. Kabar transaksi (opt-in per aksi)

7. Tidak ada push otomatis untuk transaksi biasa. Kartu "Kabari anggota ruang" ada di Quick Add, Konfirmasi Pembayaran, dan Eksekusi Bersama: switch (default **nyala**, semua anggota lain terpilih), pilihan penerima, catatan opsional. Bagikan lewat share sheet OS (WhatsApp) tetap ada sebagai jalur sekunder di Eksekusi Bersama.
8. Kabar hanya dikirim untuk transaksi yang **sudah tersimpan**. Untuk jalur tunggal (Quick Add, Konfirmasi Pembayaran), panggil RPC `share_transactions` setelah tulis berhasil. RPC itu memvalidasi bahwa transaksi milik household dan dicatat/dieksekusi oleh pemanggil; gagal share tidak memengaruhi uang. Untuk bulk, kabar ditulis di RPC eksekusinya (E).
9. Tanggungan yang dibayar sekaligus dikabari membuat pengaju menerima dua push (otomatis + kabar). Ini diterima.
   - Revisi Phase 16: untuk bayar tanggungan sekaligus, pengaju hanya menerima satu ringkasan per batch, bukan dua push.

## E. Eksekusi Bersama (bulk paid) dua langkah

10. **Verifikasi**: `preview_bulk_execute(household, transaction_ids)` mengembalikan status per baris (ok / alasan): masih PENDING, siklus tidak dibatalkan, akun aktif dan sesuai (akun kas untuk baris tanggungan), nominal > 0. UI menampilkan masalahnya; tombol eksekusi baru aktif bila semua baris ok (atau baris bermasalah dilepas).
11. **Commit**: `bulk_execute_transactions(household, transaction_ids, recipient_ids, note)` memvalidasi ulang, lalu all-or-nothing dalam satu transaksi SQL dengan logika per baris yang sama dengan `execute_planned_transaction` (nominal rencana, akun baris, tanggal hari ini, is_final false), lalu menulis kabar. Ini menggantikan loop `markPaid` di client.

## F. Notifikasi, push, setting

12. Tabel `notifications` (recipient, kind, payload jsonb, actor, read_at). Kind: `OBLIGATION_CREATED`, `OBLIGATION_PAYMENT`, `OBLIGATION_CANCELLED`, `OBLIGATION_SCHEDULE_CHANGED`, `OBLIGATION_STATUS_CHANGED`, `TRANSACTIONS_SHARED`. RLS: penerima select dan update `read_at` saja. Tabel ini masuk publication realtime + REPLICA IDENTITY FULL + `realtime_health()`.
13. Setting umum: kolom `notify_partner_expense` dipakai ulang, labelnya menjadi "Notifikasi Ruang Keluarga" (Profile dan Ruang Keluarga). Nilai false hanya melewati push; baris notifikasi tetap ditulis.
14. `push_tokens` lewat RPC `register_push_token` / `unregister_push_token`. Database Webhook INSERT `notifications` → `send-push` → Expo Push API; token `DeviceNotRegistered` dihapus.
15. Layar penerima "Kabar Pembayaran" (dari `TRANSACTIONS_SHARED`): siapa, kapan, catatan, item (dibaca live dari `transactions`), total, lalu "Lihat di Riwayat". Push tanggungan membuka Detail tanggungan.

## Di luar scope

- Inbox notifikasi di dalam app.
- Push otomatis untuk setiap pengeluaran.
- Push iOS.
- Nilai palsu yang ada sekarang: "Pengingat 2 hari sebelum", fallback akun "BCA" di Detail, switch "Ingatkan saya" yang tidak tersambung.
- Menutup policy `for all` di `obligations`; direkomendasikan untuk fase berikut.
- Quick Add yang masih insert transaksi lalu template sebagai dua round trip client (risiko non-atomik yang sudah ada).

## Catatan rilis

- `expo-notifications` butuh dev build / APK EAS; tidak bisa diuji di Expo Go.
- Kredensial FCM V1 diunggah ke EAS.
- Database Webhook dan secret edge function dikonfigurasi manual.
- Migration 033 di-apply di SQL Editor.

## Catatan implementasi

- **Nomor 033.** Nomor 032 dipakai `032_special_budgets` di `feat/special-budgets`, yang belum masuk `main`. 033 tidak bergantung pada 032.
- **Diuji di Postgres 16** dengan stub Supabase: 001–031 lalu 033, dan 033 diulang (idempoten). Yang diuji:
  - jejak untuk dua jalur bayar; pelunasan tercatat satu baris PAYMENT, tanpa STATUS_CHANGED;
  - pembatalan dan update status langsung;
  - fan-out ke pengaju/anggota;
  - bulk all-or-nothing, termasuk rollback saat ada baris bermasalah;
  - validasi `share_transactions`, RLS `notifications`, dan penolakan insert langsung ke `obligation_events`.
- **Temuan dari 029:** `execute_planned_transaction` menolak rencana DEBT_PAYMENT pada tanggungan **tanpa** jadwal cicilan ("tidak dapat dipetakan"). Perilaku ini sudah ada sebelumnya dan tidak diubah. Preview bulk menandai baris seperti itu lebih dulu.
  - Diperbaiki di 034: penolakan itu sekarang hanya berlaku untuk tanggungan yang punya jadwal.
- **Kabari di Quick Add** ikut default nyala, sama dengan layar bayar. Kalau terasa ramai, cukup ubah default di `useKabariState`.
- **Bagikan ke WhatsApp** di Eksekusi Bersama tetap memakai ringkasan rencana. Isinya sama dengan yang dieksekusi, karena bulk memakai nominal rencana.
- `expo-device` tidak dipakai. Registrasi push gagal dengan aman di emulator atau tanpa izin.
- `expo-notifications` dipasang dengan pin SDK 57 dari `bundledNativeModules.json` (~57.0.21), karena `npx expo install` diblokir proxy saat pengerjaan.
