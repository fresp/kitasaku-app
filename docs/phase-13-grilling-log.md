# Log Grilling Otonom — Phase 13 (zero-based per akun)

Log ini ditulis oleh scheduled task `grill-phase-13-overnight` (02:30, 04:30,
06:30 WIB). Setiap pass memverifikasi satu area terhadap kode nyata.

**Aturan log ini:** hanya temuan yang **terverifikasi langsung ke kode** yang
dicatat. Kalau sebuah pass tidak menemukan apa-apa, ia menulis itu apa adanya —
log kosong lebih baik daripada temuan karangan.

Temuan yang sudah ada di `docs/phase-13-zero-based-per-akun.md` §6 **tidak
diulang** di sini; log ini hanya memuat temuan **baru** dan **koreksi** atas
temuan lama.

Ringkasan temuan yang sudah diketahui (dari §6, sebagai rujukan):

| # | Temuan | Kelas |
| --- | --- | --- |
| 1 | Transfer masuk dihitung sumber di dua tingkat | Fraud |
| 2 | `allocation.tsx` tidak mengirim `accountId` | Bug (ada sekarang) |
| 3 | Default akun = CC Mandiri, bukan bank | Bug (ada sekarang) |
| 4 | `assets` vs `cycle_allocations` = dua sumber nilai | Fraud |
| 5 | "Semua akun harus nol" bisa jadi beban ritual | Grey area |
| 6 | `ASSET_ALLOCATION`/`ASSET_RELEASE` tanpa jalur tulis | Bug (ada sekarang) |
| 7 | `useZeroBasedSummary` tidak filter akun | Kurang fitur |
| 8 | `insight.ts:283` tanpa cek arah | Risiko |

---

<!-- Pass baru ditambahkan di bawah ini -->

## Pass 1 — area: jalur tulis & data (`transactions`, `cycle_allocations`, `accounts`, `obligations`)

Diperiksa langsung: `lib/queries.ts` (seluruh mutation), `lib/seed.ts`, `lib/realtime.ts`,
`lib/obligation.ts`, `supabase/migrations/001`–`011`, dan semua pemanggil mutasi di
`app/*.tsx` + `components/**`. Tidak ada temuan §6 yang dikoreksi (semuanya masih benar
saat diperiksa ulang). Berikut temuan **baru** yang terverifikasi.

### [jalur-tulis] `obligation_installments.status` tidak pernah berubah dari `'OPEN'` setelah baris dibuat

- **Kelas**: Bug (ada sekarang)
- **Bukti**: Satu-satunya INSERT — `supabase/migrations/005_loan_lifecycle_installments.sql:218`:
  ```
  insert into public.obligation_installments (
    household_id, obligation_id, cycle_id, planned_amount, due_date, status
  ) values (
    p_household_id, p_obligation_id, v_cycle, v_amount, v_due, 'OPEN'
  ) returning id into v_id;
  ```
  Satu-satunya UPDATE pada tabel ini — `supabase/migrations/005_loan_lifecycle_installments.sql:267`:
  ```
  update public.obligation_installments
    set cycle_id = p_cycle_id
    where id = p_installment_id;
  ```
  Tidak ada trigger pada `obligation_installments` (hanya 2 trigger di seluruh migrasi:
  `trg_validate_cycle_allocation_household` di 004 dan `trg_prevent_system_category_delete` di 006).
  Kolom `paid_amount`/`paid_transaction_id` (004:227–228) juga tidak pernah ditulis.
  Pembacanya justru bergantung pada `status`:
  `lib/obligation.ts:388` — `const done = installments.filter((i) => i.status === 'SETTLED' || i.status === 'CANCELLED').length;`
  dan `lib/obligation.ts:409` — `const open = installments.filter((i) => !isSettled(i.status));`
  Dirender di `app/loan-detail.tsx:266-267` (`Progres cicilan`) dan `components/ui/ObligationCard.tsx:101`.
- **Dampak**: Karena `status` selamanya `'OPEN'`, `installmentProgressLabel` selalu mengembalikan
  `"0 dari N cicilan"` walau keluarga sudah membayar beberapa cicilan, dan `nextOpenInstallment`
  selalu mengembalikan cicilan **pertama** — bukan cicilan berikutnya yang benar-benar belum dibayar.
  Jadi kartu "Bayar Sekarang" pada `ObligationCard` (baris 128) dan baris "Progres cicilan"
  di layar detail pinjaman menampilkan angka yang salah secara sistematis (bukan sekadar kosong).
- **Usul perbaikan**: Jadikan status cicilan turunan dari pembayaran, bukan kolom yang harus
  dipelihara manual. Saat `useMarkAsPaid` / `allocate_debt_payment` melunasi sebuah transaksi yang
  tertaut ke cicilan (mis. lewat `cycle_id` + `obligation_id`, atau tambahkan `installment_id` di
  transaksi), tandai baris cicilan terkait `SETTLED` dan isi `paid_amount`/`paid_transaction_id`
  dalam transaksi DB yang sama. Alternatif yang lebih murah: hitung progres di klien dari
  `planned_amount` vs pembayaran yang tercatat, sehingga kolom `status` tidak lagi diandalkan.
- **Status verifikasi**: TERVERIFIKASI

### [jalur-tulis] `obligations.current_installment` ditulis sekali sebagai `1` dan tidak pernah bertambah

- **Kelas**: Bug (ada sekarang)
- **Bukti**: Ditulis hanya di `supabase/migrations/005_loan_lifecycle_installments.sql:116`:
  ```
  case when p_installment_count is null then null else 1 end,
  ```
  (kolom didaftarkan di baris 109). `grep -rn "current_installment"` di seluruh `lib/`, `app/`,
  `components/`, dan `supabase/` hanya menemukan 4 kemunculan: definisi kolom (004:204), kolom
  insert (005:109), tipe TS (`lib/queries.ts:83`), dan pembacanya (`app/funding-gap.tsx:285`).
  Tidak ada UPDATE sama sekali.
- **Dampak**: `app/funding-gap.tsx:285` membaca `const current = o.current_installment ?? 0;` lalu
  di baris 296 merender `Cicilan ke-${current} dari ${total}`. Untuk setiap pinjaman berjadwal,
  `current` selalu `1`, sehingga keluarga selalu melihat **"Cicilan ke-1 dari N"** meski sudah
  masuk cicilan ke-5. Ini menyesatkan tepat pada layar yang dipakai untuk memutuskan alokasi siklus.
- **Usul perbaikan**: Hitung nomor cicilan berjalan dari jumlah baris cicilan yang sudah
  `SETTLED` (atau dari tanggal, `current = index dari cicilan OPEN pertama`), dan hapus ketergantungan
  pada kolom `current_installment`. Kalau kolom tetap dipakai, naikkan di jalur pembayaran yang sama
  dengan yang memperbarui `remaining_amount`.
- **Status verifikasi**: TERVERIFIKASI

### [jalur-tulis] Form tanggungan mengumpulkan `categoryId`, tetapi tabel `obligations` tidak punya kolomnya — pilihan kategori hilang diam-diam

- **Kelas**: Bug (ada sekarang)
- **Bukti**: Form menyimpan state dan mengirimkannya —
  `components/obligations/ObligationFormSheet.tsx:75`:
  ```
  const [categoryId, setCategoryId] = useState<string | null>(null);
  ```
  `components/obligations/ObligationFormSheet.tsx:127`:
  ```
  categoryId: categoryId || null,
  ```
  Argumennya dideklarasikan di `lib/queries.ts:501` (`categoryId?: string | null;`) tetapi INSERT
  di `lib/queries.ts:543` sama sekali tidak memakainya:
  ```
  const { error } = await sb.from('obligations').insert({
    household_id: args.householdId,
    title: args.title,
    type: args.type,
    total_amount: args.total,
    remaining_amount: args.total,
    status: 'OPEN',
    recipient,
    due_date: args.dueDate ?? null,
    beneficiary_id: beneficiaryId,
  });
  ```
  Tabel `obligations` (001:60–71) tidak punya `category_id`, dan tidak ada migrasi yang
  menambahkannya — `alter table public.obligations` hanya muncul di 004 (kolom loan/repayment),
  008 (`repayment_mode`), dan 011 (`beneficiary_id`).
- **Dampak**: Setiap kali keluarga memilih kategori pada form "Tambah Tanggungan", pilihannya
  dibuang tanpa peringatan; `categoryId` selalu `null` di DB. Data hilang diam-diam (silent data
  loss), bukan error. Tidak ada pembacaan yang menampilkan kategori tanggungan karena kolomnya
  memang tidak ada, jadi kerusakannya tersembunyi.
- **Usul perbaikan**: Putuskan arah desain: kalau kategori memang relevan untuk tanggungan,
  tambahkan `category_id uuid references public.categories(id)` via migrasi baru dan sertakan di
  INSERT `useCreateObligation`; kalau tidak, hapus pemilih kategori dari `ObligationFormSheet` dan
  buang `categoryId` dari `CreateObligationArgs` agar UI tidak menjanjikan sesuatu yang tidak disimpan.
- **Status verifikasi**: TERVERIFIKASI

### [jalur-tulis] `['year-insight']` tidak pernah di-invalidate oleh mutation mana pun maupun oleh realtime

- **Kelas**: Risiko
- **Bukti**: Kunci query didefinisikan di `lib/queries.ts:776`:
  ```
  queryKey: ['year-insight', householdId, year],
  ```
  Daftar invalidation terpusat di `lib/queries.ts:126-133` tidak memuatnya:
  ```
  function invalidateMoneyKeys(qc: QueryClient): void {
    qc.invalidateQueries({ queryKey: ['txns'] });
    qc.invalidateQueries({ queryKey: ['oblig'] });
    qc.invalidateQueries({ queryKey: ['obl-payments'] });
    qc.invalidateQueries({ queryKey: ['alloc'] });
    qc.invalidateQueries({ queryKey: ['source-funds'] });
    qc.invalidateQueries({ queryKey: ['zero-summary'] });
  }
  ```
  `lib/realtime.ts` juga tidak punya handler yang meng-invalidate `year-insight` (hanya
  `txns`/`oblig`/`tmpl`/`cycle`/`cats`/`accs`/`alloc`/`zero-summary`/`installments`).
  Layar pemakainya, `app/asset-insight.tsx`, tidak punya mutation; ia hanya menyediakan
  `refetch` manual di baris 429–431.
- **Dampak**: Berbeda dari semua key uang lain, layar "Insight & Aset" tidak ikut ter-refresh
  saat data berubah dari perangkat pasangan (realtime). Selama layar itu terbuka, angka
  `useYearInsight` bisa menampilkan posisi aset yang basi. Dampak dibatasi: `QueryClient`
  default (`staleTime: 0`, `refetchOnMount`/`refetchOnWindowFocus` aktif) membuat layar
  mengambil data segar saat pertama dibuka/di-mount ulang, jadi basi hanya terjadi pada jendela
  ketika layar sudah terbuka dan data berubah di tempat lain.
- **Usul perbaikan**: Tambahkan `qc.invalidateQueries({ queryKey: ['year-insight'] })` ke
  `invalidateMoneyKeys` (agar setiap mutation uang menyegarkan insight), dan tambahkan handler
  `year-insight` di `lib/realtime.ts` untuk `transactions`/`cycle_allocations` agar sinkronisasi
  pasangan konsisten dengan layar lain.
- **Status verifikasi**: TERVERIFIKASI

### [jalur-tulis] Kode mati pada jalur tulis: `useUpdateAllocation`, `useSetInstallmentCycle`, `useReorderAccounts`, `useScheduleInstallments` tidak punya pemanggil

- **Kelas**: Grey area
- **Bukti**: `grep -rn` nama-nama ini di `app/` dan `components/` (di luar definisinya di
  `lib/queries.ts`) tidak menemukan satu pun pemanggil: `useUpdateAllocation` (def `lib/queries.ts:918`),
  `useSetInstallmentCycle` (def `lib/queries.ts:1133`), `useReorderAccounts` (def `lib/queries.ts:1624`),
  `useScheduleInstallments` (def `lib/queries.ts:1153`). Bandingkan dengan hook yang memang dipakai:
  `useUpdateAccount` dipanggil di `app/manage-accounts.tsx:122`, `useObligationInstallments` di
  `app/loan-detail.tsx:73` + `components/ui/ObligationRow.tsx:71`, `useCycleInstallments` di
  `app/funding-gap.tsx:62`.
- **Dampak**: Bukan bug uang hari ini, tetapi RPC `set_installment_cycle` (satu-satunya jalur
  "menarik cicilan backlog ke siklus ini", 005:235–271) **tidak dapat dijangkau dari UI sama sekali** —
  sehingga invariant "cicilan backlog bisa ditempelkan ke siklus berjalan" tidak pernah bisa
  dijalankan pengguna. `useReorderAccounts` juga menelan error (`Promise.all` tanpa memeriksa
  `error` tiap update, `lib/queries.ts:1629-1633`) — berbahaya hanya bila kelak dipakai.
- **Usul perbaikan**: Untuk `useSetInstallmentCycle`, hubungkan ke aksi UI (mis. tombol pada kartu
  backlog di `funding-gap`/`loan-detail`) atau hapus RPC + hook bila fitur backlog ditinggalkan.
  Untuk `useReorderAccounts`, periksa `error` per baris sebelum dianggap sukses. Untuk dua hook
  sisanya, hapus agar tidak menyesatkan pembaca berikutnya.
- **Status verifikasi**: TERVERIFIKASI

### Diperiksa, ternyata bukan masalah (tidak ditulis sebagai temuan)

- `transactions.recipient` (001:90) tidak pernah ditulis **dan** tidak pernah dibaca — kolom sisa,
  tanpa dampak. (`recipient` yang dibaca UI adalah milik `obligations.recipient`.)
- `obligations.notes` (001:71) dan `obligations.repayment_method` tidak diisi oleh jalur form
  tanggungan umum, tetapi keduanya nullable dan tidak diandalkan perhitungan uang.
- Anti-double-count: alokasi hanya dari `cycle_allocations`; `useQuickAdd` hanya menulis
  `OPERATING_INCOME`/`EXPENSE` (`lib/queries.ts:285`) dan tidak pernah menjumlahkan `flow_type`
  ke total alokasi — invariant Phase 1 masih terjaga.
- `useCreateAccount` (`lib/queries.ts:1484`) memakai `sort_order: args.sortOrder ?? 0` — konsisten
  dengan temuan §6 #3, tidak diulang di sini.
