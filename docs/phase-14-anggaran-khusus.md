# Phase 14 — Anggaran Khusus (special budgets)

Kontrak domain untuk belanja di luar rutin yang punya tanggal: Lebaran, liburan, renovasi, biaya sekolah, hajatan. Implementasi: migration `032_special_budgets.sql`, `lib/special-budget.ts`, hook di `lib/queries.ts`, layar `app/special-budget*.tsx`. Status penerapan di Supabase remote tidak dinyatakan di sini; terapkan 032 **sebelum** merilis build yang membaca `special_budget_id`.

## Model tiga tempat

- **Siklus** — kebutuhan rutin bulan ini (zero-based per siklus, tidak berubah).
- **Anggaran khusus** — belanja di luar rutin yang ada tanggalnya. Uangnya tetap di rekening asal.
- **Simpanan** — disimpan, tanpa tanggal (tabel `assets`).

## Kontrak

1. Anggaran khusus adalah **lensa** di atas transaksi biasa, bukan tempat uang. Saldo akun, rekonsiliasi, dan snapshot tetap menghitung semua baris, berlabel atau tidak.
2. Transaksi dengan `special_budget_id` dikeluarkan dari zero-based siklus (`aggregateCashSourceFunds`), Insight, Riwayat Siklus, Budget Health, dan Detail Kategori. Riwayat transaksi dan saldo tetap menampilkannya.
3. Angka anggaran (SQL `special_budget_remaining()` = `specialBudgetFigures()`):
   - dana masuk = OPERATING_INCOME + FINANCING_INFLOW + ASSET_RELEASE berlabel (PAID, tidak batal) + `cycle_allocations` hidup yang menunjuk anggaran;
   - terpakai = EXPENSE berlabel; ke simpanan = ASSET_ALLOCATION berlabel;
   - sisa = dana masuk − terpakai − ke simpanan (boleh minus).
4. **Sisihkan dari siklus** = satu baris `cycle_allocations` bertipe `OTHER` dengan `special_budget_id` (RPC `fund_special_budget_from_cycle`). Tidak ada uang berpindah rekening.
5. Yang boleh diberi label (trigger `guard_transaction_special_budget`): transaksi PAID dari rekening BANK/E_WALLET; bukan DEBT_PAYMENT, TRANSFER, transaksi rutin, atau baris tanggungan. **Kartu kredit dan tunai tidak bisa diberi label di V1**: belanja CC mengurangi sisa anggaran padahal tagihannya dibayar siklus.
6. `end_date` hanya penanda. Status dihitung, tidak disimpan: Akan datang / Berjalan / Selesai · belum ditutup / Ditutup. Satu-satunya kunci adalah `closed_at`, diisi hanya oleh RPC `close_special_budget`.
7. Tutup bersifat final dan atomik, dengan `p_expected_remaining` sebagai penjaga angka:
   - sisa > 0 → Siklus: tidak menulis baris apa pun (uang tetap di rekening dan tidak lagi diklaim) · Simpanan: ASSET_ALLOCATION berlabel;
   - sisa < 0 → Siklus: alokasi `OTHER` di siklus berjalan · Simpanan: ASSET_RELEASE berlabel;
   - sisa = 0 → `NONE`, hanya mengunci.
   Setelah ditutup, nominal/status/akun/label transaksinya dibekukan; rename tetap boleh. Transaksi susulan dicatat ke siklus.
8. Home: porsi siklus pada saldo akun primer = saldo − Σ sisa **positif** anggaran yang belum ditutup. Sisa minus tidak dijumlahkan balik (uangnya sudah keluar). Anggaran minus atau yang lewat tanggal tetap tampil di "Perlu perhatian" sampai ditutup.
9. Quick Add selalu default ke Siklus; anggaran yang sedang berjalan di tanggal transaksi muncul sebagai pilihan "Masuk ke". Dibuka dari detail anggaran ("Catat"), anggaran itu terpilih.

## Belum dikerjakan

- Rencana per item dan "Buka lagi yang lalu".
- Segmen anggaran khusus di Insight (saat ini dikeluarkan sepenuhnya).
- Pembebanan tagihan kartu kredit ke anggaran khusus.
- Sumber dana pinjaman langsung dari Quick Add (alur pinjaman tidak menampilkan pilihan "Masuk ke").
- Toast konfirmasi setelah simpan; saat ini label anggaran tampil di tombol simpan dan di Aktivitas Home.
- Porsi siklus di Home mengasumsikan uang anggaran ada di akun primer.
