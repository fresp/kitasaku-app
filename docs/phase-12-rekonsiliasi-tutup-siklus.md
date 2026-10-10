# Phase 12 — Rekonsiliasi Tutup Siklus (akun primer, kategori Tidak Terlacak, push H-7/H-3)

Dokumen ini mencatat keputusan dan kontrak **rekonsiliasi tutup siklus**. Implementasi lokal kini memiliki akun primer BANK per siklus, snapshot rekonsiliasi, pratinjau selisih, penyesuaian atomik, dan opsi sweep saat penutupan (migration 012, 015, dan 016 serta `lib/queries.ts`). Ini adalah fakta bertanggal, bukan saldo turunan: Home hanya menyebut saldo absolut bila ada opening anchor yang sah; tanpa anchor, Home menampilkan pergerakan bersih siklus.

Status implementasi yang dapat diverifikasi dari repo: jalur rekonsiliasi dan sweep ada di kode/migrasi lokal. Status penerapan pada Supabase remote tidak dinyatakan di sini karena tidak diverifikasi dalam perubahan ini. Notifikasi push H-7/H-3 tetap rancangan tertunda.

Bagian di bawah mempertahankan alasan dan keputusan historis. Rekomendasi serta checklist yang sudah terlaksana dibaca sebagai catatan desain/histori, bukan todo aktif; perbedaan implementasi saat ini dicatat di bagian status aktual.

### Status aktual (2026-10-01)

- `cycles.primary_account_id` dibatasi ke rekening BANK aktif melalui picker dan validasi mutasi.
- Penutupan menyimpan snapshot, adjustment, dan sweep secara atomik melalui RPC. Delta negatif membuat transaksi penyesuaian dan alokasi `OTHER`; delta nullable tetap tidak diketahui bila opening anchor tidak tersedia.
- Opening akun primer menggunakan rekonsiliasi pada siklus terdahulu paling baru hanya untuk akun yang sama; tidak ada fallback ke siklus lebih lama atau akun lain.
- Pending, transaksi tanpa akun, dan transaksi primer non-siklus menjadi isu yang ditampilkan/diblokir dalam pratinjau. Push H-7/H-3 belum diimplementasikan.
- Migration 025 mengaktifkan snapshot saldo sekunder BANK/E_WALLET. Migration 026 tercatat di repo dan menambahkan guard bentuk cash-movement serta mengecualikan CASH dari sweep; penerapan pada Supabase remote belum diverifikasi.
- Status di atas merujuk pada kode dan migration lokal saja, bukan deployment remote.

---

## Sumber keputusan (brainstorm 2026-09-27/28)

Bagian ini mempertahankan keputusan dan konteks historis.

1. Trash = **parkiran**, bukan TPA. Ada profiling dulu ("saldo ATM-mu benar
   sisa X?"), lalu user memilih: ingat → kategori asli, tidak ingat → trash.
2. Trash **punya pagu bulanan** dan pagunya **tetap masuk Budget Health &
   Insight** sebagai indikator indisipliner.
3. Trash masuk sebagai `is_system` — bukan kategori user.
4. **1 siklus = 1 akun primer**, dan akun itu harus **rekening bank**
   (`type = 'BANK'`). Hanya akun itu yang jadi acuan rekonsiliasi.
5. **Transaksi non-siklus tetap dicatat sebagai bahan audit, tetapi tidak
   pernah membebani saldo siklus.** Belanja kartu kredit adalah contohnya:
   dicatat detail, tidak menyentuh saldo siklus; yang menjadi beban siklus
   adalah **tagihannya** di bulan berikutnya.
6. Notifikasi H-7 dan H-3, **push** (bukan hanya in-app).
7. **Transfer antar akun bukan income dan bukan expense** — ia relokasi, tidak
   masuk `sourceFunds` maupun `totalAllocation` (bagian 13). Sisa saldo akun
   penyimpan nilai disapu lewat transfer, sehingga siklus tetap murni akun
   primer dan neraca tidak pernah timpang.
8. **Investasi adalah posisi aset, bukan akun** (bagian 14). Akun adalah wadah
   kas yang disapu tiap siklus dan tidak menyimpan nilai; aset menumpuk dan
   tidak disapu. Nilai pasar aset dicatat sebagai **fakta bertanggal**, bukan
   kolom turunan.

---

## 1. Kenapa "1 akun primer" bukan sekadar penyederhanaan

Ini keputusan yang paling banyak mengubah segalanya, dan alasannya bukan
kenyamanan UI.

Migration 010 menolak `accounts.balance` sebagai saldo berjalan yang mudah basi.
Rekonsiliasi tidak menyimpan saldo berjalan semacam itu; ia menyimpan snapshot
fakta bertanggal sebagai anchor, lalu menghitung pergerakan dari transaksi.
Saldo absolut hanya dapat dihitung bila opening anchor yang sah tersedia.

**Mengikat satu akun primer per siklus membuat perbandingan punya dua ujung:**

```
O  = saldo awal yang dinyatakan / closing anchor siklus sebelumnya
C  = saldo akhir yang dinyatakan (saat siklus ditutup)
R  = pergerakan PAID akun primer menurut flow_type dan arah transfer
D  = (C − O) − R
```

Anchor `O` hanya diwariskan dari siklus terdahulu paling baru dan hanya jika
rekonsiliasi siklus itu untuk akun primer yang sama. Jika tidak ada anchor,
`O` dan `D` tidak dikarang sebagai nol; Home menampilkan pergerakan bersih,
bukan saldo absolut. Transaksi transfer masuk/keluar dihitung sesuai akun yang
menjadi tujuan/sumber dan bukan sebagai income atau expense.

Transaksi di luar siklus tidak dihitung dalam movement siklus. Preview penutupan
menampilkan transaksi tanpa siklus yang menyentuh akun primer sebagai isu
terpisah dan memblokir close sampai ditinjau. Aturan rinci historical di bawah
ini menjelaskan alasan model, tetapi jangan dibaca sebagai bukti bahwa jalur
transaksi non-siklus sudah tersedia di semua layar.

### Rekening kas dan arah pergerakan

E-wallet dan tunai tetap dapat menjadi akun, tetapi bukan akun primer untuk
rekonsiliasi. Zero-Based kas menghitung BANK dan E_WALLET; CASH, kartu kredit,
serta baris tanpa akun dikecualikan dari agregat kas. Dalam cashflow Home,
perpindahan ke/dari akun primer dihitung berdasarkan sisi transfer, sedangkan
transfer tetap netral terhadap income dan expense. Untuk saldo akun Zero-Based,
transfer masuk menjadi inflow akun penerima dan transfer keluar menjadi outflow
akun sumber.

Nilai `D` pada penutupan dipakai untuk menulis adjustment secara atomik oleh RPC.
Untuk delta negatif, RPC membuat transaksi penyesuaian serta alokasi `OTHER`;
untuk delta positif, ia membuat transaksi income. `D` tidak dihitung bila opening
anchor belum tersedia. Detail historis berikut tentang pilihan pencatatan tetap
dipertahankan sebagai keputusan desain, bukan pernyataan bahwa seluruh jalur
legacy sudah beroperasi demikian.

### Carry-over: saldo akhir jadi saldo awal berikutnya

```
O(siklus N+1) = C(siklus N)
```

Keluarga menyatakan saldo **sekali per siklus**, bukan dua kali. Yang mahal
hanya siklus pertama: ia tidak punya `O`, jadi `D` belum bisa dihitung. Layar
tutup siklus pertama hanya menyimpan jangkar (`C`), dan `D` baru bermakna sejak
siklus kedua. Jangan mengarang `O = 0` untuk siklus pertama — itu akan melaporkan
seluruh isi rekening sebagai "pemasukan tak tercatat".

### Kartu kredit: transaksi non-siklus yang tetap dicatat detail

**Belanja CC bukan transaksi siklus.** Ia dicatat detail sebagai bahan audit
keluarga — makan di McD, RAM laptop, belanja TV — dengan `account_id` = CC
Mandiri, tetapi ia **tidak di-bind ke siklus** dan karenanya tidak mengurangi
saldo siklus. CC juga **tidak bisa dipilih sebagai akun primer**: akun primer
hanya rekening bank (bagian 2.1).

```
Siklus N    belanja CC 500rb (McD, RAM, TV)
            → transaksi account_id = CC, cycle_id = NULL
            → audit keluarga. Mandiri tidak bergerak. Saldo siklus tidak tersentuh.
            → tidak masuk R.

Siklus N+1  tagihan CC (akumulasi belanja bulan N) dibayar dari Mandiri
            → transaksi account_id = Mandiri, flow_type = DEBT_PAYMENT
            → MASUK R, dan bank benar-benar turun.
```

Perhatikan asimetrinya, karena inilah inti modelnya: **belanja CC ada di bulan
belanja, tagihannya ada di bulan berikutnya.** Yang menjadi beban siklus adalah
**tagihannya**, bukan belanjanya — persis perilaku user di spreadsheet, di mana
sisa saldo bulan ini bebas dialokasikan ke hal lain, dan tagihan bulan depan
menjadi tanggung jawab saldo N+1.

Konsekuensi yang perlu disadari: belanja CC bulan N **tidak** muncul di Budget
Health siklus N sebagai beban saldo, tetapi ia tetap terlihat sebagai baris
Riwayat. Kalau keluarga ingin melihat "total pengeluaran keluarga bulan ini
termasuk CC", itu pertanyaan **audit** (jumlahkan semua baris bertanggal di
bulan itu), bukan pertanyaan **saldo siklus** (`R`). Dua angka ini memang
berbeda dan tidak boleh dipaksa sama.

Jadi ada dua peran yang berbeda dan keduanya sudah punya tempatnya:

| Peran | Diisi oleh |
| --- | --- |
| Jangkar rekonsiliasi (`O`, `C`, `R`) | akun primer (**bank saja**) |
| Belanja CC bulan N (audit, non-siklus) | `transactions` biasa, `account_id` = CC, `cycle_id` = NULL |
| Tagihan CC yang dibayar di N+1 | `obligations` + `DEBT_PAYMENT` (migration 004/005) |

Pembayaran tagihan CC adalah **carried-over obligation** — mekanisme yang sudah
ada dan sudah menangani `due_date`, cicilan, dan `remaining_amount`. Tidak ada
model baru yang dibutuhkan; yang perlu hanya memastikan tagihan CC masuk sebagai
obligasi, bukan sebagai `EXPENSE` biasa.

### Cakupan akun (migration 028 → 029)

Keputusan 2026-10-09, direvisi di hari yang sama. Versi 028 melarang akun selain
`BANK`/`E_WALLET` muncul di baris bersiklus dan memaksa pembayaran kartu
kredit/tunai lewat jalur terpisah (`settle_pending_outside_cycle`, dengan toggle
di layar konfirmasi). Itu dicabut oleh 029: journey-nya jadi dua jalur untuk satu
tindakan yang sama, padahal pemisahan yang sebenarnya dibutuhkan ada di sisi baca,
bukan sisi tulis.

Aturan yang berlaku sekarang:

- **Satu siklus menelusuri semua transaksi, dari akun apa pun.** Transaksi dengan
  kartu kredit atau tunai tetap memegang `cycle_id` dan muncul di ledger siklus
  seperti baris lain. Nggak ada toggle, nggak ada jalur kedua.
- **Acuan rekonsiliasi adalah akun UTAMA siklus** (`cycles.primary_account_id`,
  selalu `BANK`). `close_cycle_reconciliation` dan `reconciliationPreview`
  dievaluasi per akun, jadi baris kartu kredit nggak akan pernah menyentuh angka
  rekon — by construction, bukan karena difilter.
- **Zero-based dihitung per akun** dan hanya tersedia untuk `BANK`/`E_WALLET`
  (`useZeroBasedSummaryForAccount`). Agregat sumber dana dan alokasi se-siklus
  memfilter tipe akun di `lib/zero-based-accounting.ts`.
- **Insight tahunan memfilter tipe akun** lewat `countsTowardInsight`
  (`lib/insight.ts`). Tanpa ini belanja kartu kredit kehitung dua kali: sekali
  sebagai pengeluaran, sekali lagi waktu tagihan CC dibayar sebagai
  `DEBT_PAYMENT` dari rekening bank. Baris tanpa akun tergabung tetap dihitung,
  supaya aturan ini nggak diam-diam mengecilkan angka lama.
- Monitoring per akun untuk satu siklus tetap ada lewat snapshot akun dan ringkasan
  per akun.

Konsekuensinya: invariant ini **nggak dijaga DB**. Setiap agregasi baru yang
menjumlahkan uang se-siklus wajib ikut memfilter tipe akun, atau angkanya salah
tanpa ada yang menolak. Empat jalur yang ada sekarang sudah memfilter atau aman
karena per-akun; tambahkan test waktu menambah jalur kelima.

Yang tetap dipertahankan dari 028: `cycle_allocations.transaction_id` dan
`release_pending_transaction` (lihat `docs/phase-1-domain-contract.md` §8.1).
Itu bugfix terpisah — sebelumnya membatalkan rencana `EXPENSE` meninggalkan
alokasi aktif dan bikin `unallocated` tercatat terlalu kecil. Kolom
`transactions.replaces_transaction_id` juga tetap ada karena baris yang terlanjur
di-settle lewat jalur 028 masih menunjuk ke rencana aslinya.

### Pelunasan tanggungan menutup jadwalnya (migration 030)

`allocate_debt_payment` dulu memindahkan uang dan mengurangi `remaining_amount`
tanpa menyentuh `obligation_installments`, sehingga tanggungan bisa berstatus
SETTLED di atas sembilan cicilan yang masih terbuka. Sejak 030 pembayaran
dipetakan ke jadwal — cicilan terlama dulu, SETTLED kalau tertutup penuh,
PARTIAL kalau separuh — seperti yang sudah lama dilakukan
`execute_planned_transaction`, dan begitu sisa utang nol semua cicilan yang
tersisa ikut ditutup.

Dua perbedaan sengaja dari jalur rencana. RPC ini **tidak menolak** nominal yang
tidak bisa diserap habis oleh jadwal: di jalur rencana angkanya berasal dari
jadwal sehingga ketidakcocokan adalah bug, di sini angkanya pilihan pengguna dan
jadwal yang menutupi lebih kecil dari sisa utang (bunga di luar jadwal, jadwal
yang dikonfigurasi belakangan) adalah alasan mencatat, bukan menolak. Dan layar
hanya menawarkan "Lunasi sisa" ketika cicilan terbuka lebih dari satu.

### Saldo awal siklus dapat dinyatakan (migration 031)

Saldo awal sebuah siklus selama ini hanya diturunkan dari penutup siklus
sebelumnya (`useHomeCashBalance`), sehingga tidak ada untuk siklus pertama dan
baru tersedia sebulan setelah keluarga mulai memakai app. Selama belum ada, Home
jatuh ke "Pergerakan akun" — pergerakan bersih yang terbaca seperti saldo dan
sering negatif.

`cycles.opening_stated` menyimpan saldo akun primer di hari pertama siklus, diisi
saat siklus dibuka. **Angka turunan tetap menang** di mana keduanya ada: penutup
siklus sebelumnya hasil rekonsiliasi, yang ini diketik dari ingatan. Sebuah
trigger menolak perubahannya setelah siklus direkonsiliasi, karena itu berarti
menggeser delta yang sudah dihitung. Hanya berlaku untuk akun primer; akun lain
tetap menurunkan saldo awalnya dari siklus sebelumnya.

### Yang bisa mematahkan rumus ini

Transaksi ber-`account_id` NULL. Baris seperti itu adalah uang yang berpindah
tetapi tidak teratribusi ke rekening mana pun, jadi ia tidak masuk `R+`/`R−` dan
selisihnya muncul sebagai `D` palsu. Layar tutup siklus **wajib** mendaftar
baris tanpa akun sebagai penghalang, bukan diam-diam mengabaikannya.

Dengan akun primer yang dikunci ke rekening bank, baris yang berpotensi merusak
`R` menyusut jadi satu rekening saja — keluarga tinggal mencocokkan satu akun,
bukan enam. `account_id` NULL di baris yang menyentuh rekening itu berarti
keluarga memang melewatkannya, bukan karena bingung memilih.

---

## 2. Model data (migration 012)

Implementasi lokal tersedia di `supabase/migrations/012_phase12_reconciliation.sql`.
Catatan dan SQL contoh berikut menjelaskan bentuk desain awal; migration aktual
adalah sumber kebenaran untuk kolom, constraint, dan trigger.

### 2.1 `cycles.primary_account_id`

```sql
alter table public.cycles
  add column if not exists primary_account_id uuid
    references public.accounts(id) on delete set null;
```

Satu siklus, satu akun. `on delete set null` mengikuti pola
`cycle_allocations.account_id` (004) — akun yang dihapus tidak boleh menghapus
riwayat siklus, cukup membuatnya tak lagi punya acuan. Kolom ini **nullable**:
siklus yang sudah ada sebelum migrasi ini tidak punya akun primer, dan app harus
tetap berjalan (bagian 6).

Invariant "satu akun primer per siklus" tidak butuh index unik — kolomnya ada di
baris siklus itu sendiri, jadi ia tunggal menurut definisi. Yang perlu dijaga ada
**dua hal**, dan keduanya masuk ke satu trigger yang sama:

1. **Akunnya milik household yang sama.** Pola yang sudah ada:
   `validate_cycle_allocation_household()` di 004. Tambahkan saudaranya,
   `validate_cycle_primary_account_household()`.
2. **Akunnya bertipe `BANK`.** Keputusan user: *"1 siklus cuma bisa pilih pakai
   bank rekening aja."* Ini bukan preferensi UI — ia yang membuat `C` bisa
   dinyatakan. Yang bisa dibaca saldonya dari ATM/aplikasi bank adalah rekening
   bank; CC punya saldo terutang (bukan saldo kas), dan e-wallet/tunai adalah
   sink yang justru sengaja tidak dilacak. Menegakkannya di trigger, bukan hanya
   di picker, karena picker bisa dilewati lewat insert langsung.

```sql
-- di dalam validate_cycle_primary_account_household()
if NEW.primary_account_id is not null then
  select household_id, type into v_ref_household, v_type
    from public.accounts where id = NEW.primary_account_id;
  if v_ref_household is null or v_ref_household <> NEW.household_id then
    raise exception 'cycles: primary account % does not belong to household %',
      NEW.primary_account_id, NEW.household_id;
  end if;
  if v_type <> 'BANK' then
    raise exception 'cycles: primary account must be a BANK account, got %', v_type;
  end if;
end if;
```

Catatan: `accounts.type` sudah punya CHECK `in ('BANK', 'CREDIT_CARD',
'E_WALLET', 'CASH')` (`001_initial_schema.sql:34`), jadi tidak perlu vocab baru —
cukup menyaring `= 'BANK'`. Konsekuensinya keluarga yang tidak punya akun `BANK`
harus membuatnya dulu; itu masuk sebagai langkah onboarding (bagian 9).

### 2.2 `cycle_reconciliations` — fakta, bukan kolom turunan

```sql
create table if not exists public.cycle_reconciliations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  opening_stated bigint,          -- null untuk siklus pertama
  closing_stated bigint not null,
  recorded_net bigint not null,   -- Δ_catat yang dibekukan saat snapshot
  delta bigint not null,          -- D yang dibekukan; 0 = cocok
  adjustment_txn_id uuid references public.transactions(id) on delete set null,
  noted_at timestamptz not null default now(),
  noted_by uuid references auth.users(id),
  unique (cycle_id)               -- satu rekonsiliasi per siklus
);
```

**Kenapa tabel ini tidak melanggar keputusan migration 010.** Yang ditolak 010
adalah kolom saldo yang menjadi *source of truth kedua* dan basi begitu sebuah
transaksi diedit — "wrong until something remembers to rewrite it". Baris di
sini bukan itu: ia **kejadian** ("pada 24 Okt keluarga menyatakan Mandiri berisi
X"), bertanggal, tidak pernah ditulis ulang, dan tidak ada satu pun perhitungan
yang membacanya sebagai saldo berjalan. Untuk membaca saldo hari ini, app tetap
menjumlahkan pergerakan — snapshot hanya memberi **titik jangkar** yang selama
ini hilang.

`recorded_net` dan `delta` **dibekukan** saat snapshot, bukan dihitung ulang saat
render. Alasannya sama dengan `actual_amount` pada baris PAID: begitu keluarga
menyatakan sesuatu, angka itu menjadi fakta yang tidak boleh berubah diam-diam
ketika sebuah transaksi lama diedit. `unique (cycle_id)` menjamin satu
rekonsiliasi per siklus — inilah yang membuat penulisan adjustment
**exactly-once** (bagian 5).

RLS: `household_scoped_select/write_cycle_reconciliations`, pasangan yang sama
dengan `cycle_allocations` di 004. Realtime: `ADD TABLE` satu statement
(mengikuti pola 003) + `REPLICA IDENTITY FULL`.

### 2.3 Idempotensi migrasi

Mengikuti konvensi repo: `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT
EXISTS`, dan widening `CHECK` dengan drop-by-name-lookup lalu re-add (pola 004),
karena nama constraint bisa auto-generated di sebagian environment.

---

## 3. Kategori sistem `UNTRACKED`

Sesuai keputusan: masuk sebagai `is_system`, bukan kategori user.

```sql
-- 1. perluas vocab role
alter table public.categories
  drop constraint if exists categories_system_role_check;   -- via lookup pg_constraint
alter table public.categories
  add constraint categories_system_role_check
  check (system_role is null or system_role in
    ('DEBT_PAYMENT', 'FINANCING_INFLOW', 'UNTRACKED'));

-- 2. backfill per household (pola loop di 006)
--    name: 'Tidak Terlacak', type: 'EXPENSE', is_system: true,
--    monthly_budget: 0  ← pagu DISET user, bukan ditebak app
```

`monthly_budget` **tidak diisi default**. Mengisinya dengan angka karangan akan
langsung memunculkan temuan "indisipliner" pada keluarga yang belum pernah
menyentuh fitur ini. `0` berarti "tanpa pagu", dan `budgetHealthStatus()` sudah
menangani kasus itu dengan benar (`NO_BUDGET`, `zero-based.ts:441`).

Yang perlu diubah di klien:

| Lokasi | Perubahan |
| --- | --- |
| `lib/queries.ts:43` | `CategorySystemRole` += `'UNTRACKED'` |
| `app/manage-categories.tsx:35` | `SYSTEM_ROLE_HINT` += `UNTRACKED: 'Rekonsiliasi · Tidak dapat dihapus'` |
| `lib/category-icon.ts` | ikon untuk role ini (mis. `category-tidak-terlacak`), fallback nama |

### 3.1 Lubang yang harus ditutup: `is_system` menjawab dua pertanyaan sekaligus

Ini temuan yang paling mudah terlewat. `app/budget-health.tsx:58` memetakan
**setiap** kategori:

```js
const spent  = byCat.get(c.id) ?? 0;
const budget = c.monthly_budget ?? 0;
const health = budgetHealthStatus(spent, budget);
```

Cara tergampang menyembunyikan trash dari Quick Add adalah
`filter(c => !c.is_system)`. Kalau itu yang dilakukan, **pagu trash beserta
insight-nya ikut lenyap dari satu-satunya layar tempat insight itu hidup** —
pagu yang di-set tetapi tidak pernah ditagih. Requirement #2 ("value ini tetap
masuk ke budget health dan insight") gagal tanpa error apa pun.

Akar masalahnya: satu flag `is_system` dipakai untuk menjawab dua pertanyaan
berbeda. Pisahkan:

```ts
// Boleh dipilih manual di Quick Add?
isEligibleForPicker(cat, kind)

// Ikut dinilai pagunya di Budget Health?
isBudgeted(cat)
```

| Role | Di picker | Di Budget Health |
| --- | --- | --- |
| `DEBT_PAYMENT` | tidak | tidak |
| `FINANCING_INFLOW` | tidak | tidak |
| `UNTRACKED` | **tidak** | **ya** |
| kategori user | ya | ya |

Perlu ditegaskan: trash tidak boleh muncul di picker Quick Add. Ia bukan pilihan
yang diambil orang saat mencatat pengeluaran **nyata**; ia hanya boleh ditulis
oleh alur rekonsiliasi. Kalau ia muncul di picker, ia berhenti jadi jangkar
disiplin dan menjadi kategori "malas" yang bisa dipilih siapa saja kapan saja.

---

## 4. Alur

```
H-7  →  banner + push: "Siklus tutup 7 hari lagi. Cek saldo <Akun Primer>."
H-3  →  banner + push: sama, + angka bila sudah ada draf

Home (kapan saja)  →  Kartu "Cek Saldo Akun"
  └─ Tampilkan: catatan app (Δ_catat) & minta satu angka: saldo sekarang
       └─ D = (saldo dinyatakan − O) − Δ_catat
            ├─ D = 0  →  "Cocok" · tidak menulis apa pun
            └─ D ≠ 0  →  "Ada Rp X yang belum tercatat"
                          ├─ "Saya ingat"     → Quick Add biasa (kategori asli)
                          └─ "Tidak ingat"    → tulis adjustment (bagian 5)
```

**Profiling dulu, tulis belakangan.** App tidak pernah menebak saldo. Ia
menanyakan satu angka, lalu membandingkan dengan catatannya sendiri. Selama
keluarga belum menyatakan saldo, **tidak ada baris apa pun yang ditulis** — ini
yang membedakan parkiran dari timbunan tebakan.

**Yang disaring lebih dulu, sebelum `D` dihitung:** baris PENDING, kategori yang
lewat pagu, dan baris ber-`account_id` NULL. Ketiganya adalah kesalahan catat
yang **bisa diperbaiki**, dan memperbaikinya lebih baik daripada menutupinya
dengan adjustment. `D` baru ditawarkan setelah daftar itu kosong.

### 4.1 Kapan snapshot diambil — satu keputusan yang masih terbuka

Ada tegangan nyata antara permintaan H-7/H-3 dan definisi "saldo akhir":

- Notifikasi minta balancing **sebelum** siklus berakhir.
- Tetapi saldo yang dinyatakan di H-3 bukan saldo akhir siklus — masih ada 3 hari
  pengeluaran sesudahnya.
- Sementara carry-over butuh saldo **pada saat siklus tutup**, karena itulah
  saldo awal siklus berikutnya.

**Rekomendasi (A): snapshot tunggal di tutup siklus.** H-7/H-3 adalah pemicu
untuk **meninjau dan merapikan** (baris PENDING, kategori lewat pagu, baris tanpa
akun, pratinjau `D` dengan saldo hari itu), bukan untuk mengambil snapshot.
Snapshot diambil sekali, saat siklus ditutup — dan di situlah `O(N+1) = C(N)`
lahir. Satu angka per siklus, carry-over bersih, tidak ada aturan "snapshot mana
yang mengikat".

Nilai H-7 tetap besar: justru karena masih ada 7 hari, keluarga **bisa
memperbaiki** temuan di siklus yang sedang berjalan. Ditemukan di H-3 saat tutup
siklus, pengeluaran yang terlupa sudah tidak punya siklus untuk ditempati.

**Alternatif (B): checkpoint H-7 dan H-3 yang tersimpan.** Memungkinkan insight
"keluarga ini selalu melenceng di minggu terakhir", tetapi menambah entri data
3× dan memaksa aturan eksplisit tentang checkpoint mana yang di-carry. Tunda
sampai ritualnya terbukti dipakai.

---

## 5. Aturan tulis: dua jalur, exactly-once

### 5.1 Dua lapisan, dan mengapa keduanya harus ditulis

Ini inti dari keputusan "adjustment menulis apa". Ada dua angka di app yang
**memang berbeda** dan tidak boleh dipaksa sama:

| Lapisan | Isi | Dipakai untuk |
| --- | --- | --- |
| **Kas** | `O + R+ − R−` (hanya transaksi `account_id` = akun primer) | dicocokkan ke ATM |
| **Rencana** | `sourceFunds − totalAllocation` | zero-based; setiap rupiah punya tujuan |

Rekonsiliasi **tidak mengubah** lapisan kas — kas adalah hasil aritmetika murni
dari transaksi, dan ia menjadi benar begitu transaksi yang kelupaan dicatat.
Yang adjustment perbaiki adalah **lapisan rencana**, yang kalau dibiarkan akan
terus mengklaim uang yang sudah tidak ada:

```
Kas Mandiri     10jt → 9jt   ✅ cocok dengan bank
Rencana         10jt teralokasi, padahal 1jt keluar tanpa tujuan
```

Itu sebabnya adjustment menulis **dua baris** — satu untuk tiap lapisan. Bukan
karena rumusnya butuh, tapi karena keduanya menjawab pertanyaan berbeda:

### 5.1.1 `D < 0` — pengeluaran tak tercatat

Menulis **dua baris**, karena keduanya menjawab pertanyaan berbeda:

```ts
// 1. Kebenaran kas — Riwayat & Budget Health membacanya
transactions.insert({
  household_id, cycle_id, account_id: primaryAccountId,
  name: 'Penyesuaian Saldo', direction: 'EXPENSE', flow_type: 'EXPENSE',
  category_id: untrackedCategoryId,
  planned_amount: |D|, actual_amount: |D|,
  status: 'PAID', release_date: <tanggal rekonsiliasi>,
});

// 2. Kebenaran rencana — hanya ini yang dijumlahkan ke Total Alokasi
cycle_allocations.insert({
  household_id, cycle_id, allocation_type: 'OTHER',
  category_id: untrackedCategoryId, account_id: primaryAccountId,
  amount: |D|, note: 'Rekonsiliasi <tanggal>',
});
```

Tanpa baris 2, `unallocatedFunds` tetap 3jt dan app **kelihatan** balance padahal
tidak — persis "silent landfill" yang harus dihindari. Tanpa baris 1, kas tidak
akan pernah cocok dengan bank dan rekonsiliasi berikutnya mewarisi selisih yang
sama. Ini penerapan langsung aturan anti-double-count Phase 1: total alokasi
**hanya** dari `cycle_allocations`, transaksi tidak pernah dijumlahkan ke sana.

Efeknya ke angka, dalam satu tabel:

| | Kas | Rencana |
| --- | --- | --- |
| Sebelum | 3jt (salah, bank bilang 2jt) | 3jt teralokasi |
| Baris 1 (transaksi) | **2jt** ✅ | 3jt teralokasi |
| Baris 2 (alokasi) | 2jt ✅ | **2jt + 1jt Tidak Terlacak** ✅ |

Perhatikan baris kedua: alokasi `OTHER` menaikkan `totalAllocation` menjadi
setara `sourceFunds`, sehingga `unallocatedFunds` kembali 0 — bukan karena
uangnya ditemukan, tapi karena 1jt itu sekarang **punya tujuan bernama**: jujur
mengakui bahwa ia tidak diketahui. Itu lebih benar daripada mengklaimnya
teralokasi ke sesuatu yang tidak pernah dipilih.

### 5.2 `D > 0` — pemasukan tak tercatat

Satu baris saja, `direction: 'INCOME'`, `flow_type: 'OPERATING_INCOME'`.
Income adalah *source*, bukan alokasi, jadi ia menaikkan `unallocatedFunds`
dengan sendirinya — dan itu memicu bagian 7.

### 5.3 Exactly-once

Tiga pagar, semuanya sudah punya preseden di repo ini:

1. `unique (cycle_id)` pada `cycle_reconciliations` — rekonsiliasi kedua untuk
   siklus yang sama ditolak database, bukan hanya UI.
2. `adjustment_txn_id` disimpan, sehingga layar bisa **memutar ulang** hasilnya
   ("penyesuaian Rp 1.000.000 sudah dicatat pada 24 Okt") alih-alih menghitung
   `D` lagi dari snapshot lama.
3. Sebuah fungsi `canReconcile(cycle, reconciliation)` — cerminan
   `canMarkAsPaid()` (`zero-based.ts:319`) yang sudah menjadi satu-satunya gerbang
   PENDING→PAID. Pola yang sama: satu tempat yang memutuskan, setiap pemanggil
   bertanya ke situ, bukan memeriksa status sendiri-sendiri.

Sama seperti `allocate_debt_payment` yang menulis barisnya langsung PAID dan
tidak boleh dikonfirmasi dua kali, adjustment tidak boleh ditulis ulang ketika
keluarga membuka layar yang sama besoknya.

### 5.4 Yang boleh ditinjau ulang — inti "parkiran, bukan TPA"

Baris adjustment **bisa direklasifikasi**. Ketika keluarga ingat bahwa
Rp 300.000 itu ternyata dokter gigi:

- `transactions.category_id` → kategori asli
- `cycle_allocations.category_id` → kategori asli (tetap `allocation_type = OTHER`)

Efeknya pagu trash **turun** dan pagu kategori asli **naik** — dan itu benar.
Konsekuensi yang perlu disadari: memindahkan pengeluaran **ke** trash juga
menaikkan pagu trash. Itu bukan celah; memang begitulah harga sebuah parkiran.

Yang **tidak** boleh: menghapus baris adjustment untuk menghilangkan jejak
indisipliner. Hapus = membatalkan rekonsiliasi, dan itu harus memunculkan
peringatan eksplisit bahwa `D` siklus itu kembali terbuka.

---

## 6. Perilaku saat tidak ada akun primer

Kolomnya nullable dan semua siklus yang ada sekarang NULL, jadi jalur ini adalah
**mayoritas kasus untuk sementara waktu**, bukan kasus tepi.

- Kartu "Cek Saldo Akun" **tidak muncul** kalau `primary_account_id` NULL. Ia
  tidak boleh menampilkan layar rekonsiliasi tanpa jangkar — itu akan menghasilkan
  `D` palsu.
- Sebagai gantinya, tawarkan **sekali**: "Pilih akun acuan untuk siklus ini?"
  di layar tutup siklus, dengan daftar **hanya akun bertipe `BANK`** (bagian 2.1).
  Kalau keluarga belum punya satu pun akun `BANK`, tawarkan membuatnya lebih
  dulu — bukan diam-diam membiarkan CC/e-wallet dipilih.
- Home tetap menampilkan siklus seperti sekarang. Absennya jangkar harus terbaca
  sebagai "belum diatur", bukan sebagai "cocok" — pelajaran yang sama dengan
  `hasCycle: false` di `lib/insight.ts`: nol berarti "tidak ada", absen berarti
  "tidak tahu". Dua hal itu tidak boleh digambar sama.

---

## 7. Insight & Budget Health

### 7.1 Indisipliner itu dua dimensi, bukan satu

Kalau pagu trash adalah satu-satunya metrik, muncul insentif terbalik: **keluarga
yang tidak pernah merekonsiliasi sama sekali akan terlihat paling disiplin**,
karena trash-nya nol. Trash kecil bisa berarti "tertib" atau "menyerah mencatat",
dan satu angka tidak bisa membedakan keduanya.

Jadi insight butuh pasangan:

| Metrik | Rumus | Sumber |
| --- | --- | --- |
| **Rasio trash** | trash ÷ total pengeluaran siklus | `cycle_allocations` `OTHER` ber-`category_id` UNTRACKED |
| **Cakupan rekonsiliasi** | siklus yang punya snapshot ÷ 12 siklus terakhir | `cycle_reconciliations` |

"Trash 2% tapi 0 dari 6 siklus pernah dicocokkan" **lebih buruk** daripada
"trash 8% tapi tiap siklus dicocokkan". Yang kedua adalah keluarga teladan, dan
app harus mengatakannya demikian. Pisahkan dua pesannya.

Catatan teknis: rasio trash bisa dibaca dari `category_id` kategori sistem tanpa
kolom baru — `cycle_allocations` sudah punya `category_id`. Yang belum ada adalah
tempat menghitungnya; `lib/insight.ts` sudah membangun `allocationByType` per
`YearBucket` (`insight.ts:293`), jadi agregasi per-kategori adalah penambahan
satu map, bukan mesin baru.

### 7.2 Insight investasi disempurnakan oleh jangkar

Insight "sisa dana sudah lengkap, alokasikan ke investasi" **sudah** setengah ada:
status `UNALLOCATED` dan banner "Alokasi lengkap · Rp X belum punya tujuan"
(`components/ui/ZeroBasedProjection.tsx:116`).

Bedanya halus tetapi menentukan:

- `unallocated` di **awal** siklus = "belum kamu rencanakan".
- `unallocated` di **akhir** siklus = "sudah direncanakan semua, masih ada sisa"
  → **baru inilah** yang benar-benar bisa diinvestasikan.

Sebelum Phase 12, app tidak bisa membedakan keduanya. Setelah ada snapshot, ia
bisa: sisa yang belum dialokasikan **pada saat tutup siklus**, setelah `D`
diselesaikan, adalah angka yang benar-benar bebas — bukan sekadar angka yang
belum sempat diberi tujuan.

---

## 8. Push notification H-7 / H-3

Sesuai permintaan: **push**, bukan hanya in-app.

### 8.1 Yang sudah ada vs yang belum

Logika tanggalnya murah — `end_date − 7`, dan `cycleDayIndex()`
(`lib/profile.ts:208`) sudah menangani aritmetika hari siklus. **Pengirimannya
yang panjang**, dan ada empat hal yang belum ada di repo:

1. **Identitas aplikasi.** `app.json` tidak punya `ios.bundleIdentifier`,
   `android.package`, maupun `extra.eas.projectId`; `eas.json` **tidak ada**.
   `getExpoPushTokenAsync({ projectId })` **akan gagal hari ini** karena
   `projectId` tidak ada. Ini temuan #3 di
   [`repair-options-impact-effort.md`](./repair-options-impact-effort.md) yang
   naik status dari "hygiene rilis" menjadi **prasyarat keras**.
2. **`expo-notifications` belum terpasang** dan belum ada di `plugins`.
3. **Development build wajib.** Sejak SDK 53, remote push **tidak jalan di Expo
   Go di Android**.
4. **Pengirimnya belum ada.** `supabase/` hanya punya `migrations/` — belum ada
   `functions/`. Butuh Edge Function + cron harian + tabel `push_tokens`.

### 8.2 Fakta API SDK 57 (dari docs resmi, bukan ingatan)

Karena SDK 57 mengubah beberapa API, ini yang berlaku — sesuai instruksi
`AGENTS.md` untuk selalu membaca docs versi:

```ts
// Trigger tanggal: `repeats` DIABAIKAN untuk tipe ini
trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date }

// setNotificationHandler: shouldShowAlert DEPRECATED
// → shouldShowBanner + shouldShowList
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true,
    shouldPlaySound: false, shouldSetBadge: false,
  }),
});

// Android: channel HARUS dibuat sebelum meminta token
await Notifications.setNotificationChannelAsync('cycle', {...});
const token = await Notifications.getExpoPushTokenAsync({ projectId });

// Token bisa rotasi → simpan lewat listener, jangan sekali saja
Notifications.addPushTokenListener(...);
```

- `handleNotification` harus menjawab **dalam 3 detik**, atau notifikasi dibuang.
- Android 12+ butuh `SCHEDULE_EXACT_ALARM` untuk alarm tepat waktu.
- `getExpoPushTokenAsync` memanggil server Expo dan bisa ditolak (offline,
  timeout) → wajib `try/catch` dengan retry.

### 8.3 Tabel yang dibutuhkan

```sql
push_tokens      -- (household_id, user_id, token, platform, updated_at)
cycle_notification_log (
  cycle_id, kind, sent_at,    -- kind in ('H7','H3')
  unique (cycle_id, kind)
);
```

`cycle_notification_log` **bukan opsional**. Cron harian yang berjalan ulang akan
mengirim H-7 berkali-kali tanpa catatan ini — satu siklus bisa memicu belasan
notifikasi beruntun. Pola `unique (cycle_id, kind)` sama dengan yang menjaga
rekonsiliasi tetap exactly-once.

RLS keduanya mengikuti `household_scoped_*` seperti tabel lain.

### 8.4 Isi pesan harus spesifik berangka

Reminder generik diabaikan. Yang ditagih adalah **angka dan nama akun**:

```
H-7  "Siklus tutup 7 hari lagi · Cek saldo Mandiri dan cocokkan dengan app."
H-3  "3 hari lagi · Rp 1.240.000 belum punya tujuan."
```

Nama akun diambil dari `cycles.primary_account_id`; kalau NULL, pakai varian
tanpa nama akun (bagian 6).

### 8.5 Urutan: banner dulu, push belakangan

Ini bukan langkah yang bisa dibalik. Push adalah **pengiriman** dari keputusan
yang sudah harus benar di banner. Membangun push lebih dulu berarti men-debug
logika tanggal dan copy lewat kanal yang paling mahal di-iterasi (perlu build,
perlu device, perlu kredensial). Banner in-app menguji hal yang sama dengan nol
infra.

---

## 9. Onboarding

Sampai sekarang: `welcome` (3 slide) → `sign-in` → `setup-choice` (Buat/Gabung)
→ `invite` → tab. Yang hilang justru tiga hal yang membuat siklus bisa
direkonsiliasi sejak hari pertama.

```
1. Buat/Gabung  →  2. Akun        →  3. Akun primer  →  4. Kategori  →  5. Undang
   (ada)             (seeded, tapi     (belum ada)       (seeded,        (ada)
                      belum dikon-                        pagu masih
                      firmasi)                            karangan)
```

Langkah 3 hanya menawarkan akun bertipe **`BANK`**. `seedHouseholdDefaults`
sudah membuat satu (`seed.ts:37`, `{ name: 'Mandiri', type: 'BANK' }`), jadi
kasus normalnya keluarga tinggal memilih — tetapi kalau daftar akun `BANK`
kosong (mis. keluarga menghapusnya), langkah ini harus bisa **membuat** akun,
bukan menampilkan picker kosong. Tanpa akun bank, tidak ada akun primer, dan
tanpa akun primer tidak ada rekonsiliasi sama sekali (bagian 6).

**Kenapa akun sebelum kategori.** Kategori butuh pagu, dan pagu tanpa tahu
berapa uang yang masuk adalah angka karangan. `DEFAULT_CATEGORIES` sekarang
menulis `Primary: 6jt`, `Rumah Tangga: 5jt` untuk keluarga mana pun — sisa
terakhir dari masalah yang sudah diperbaiki di Tier 1 (#2 "bersihkan default
personal").

**Kenapa akun primer jadi langkah tersendiri.** Ia satu-satunya pilihan yang
**mengikat seluruh siklus** dan mengubah arti setiap angka di app. Diselipkan
sebagai field di langkah akun, ia akan terbaca sebagai detail, bukan keputusan.

**Kenapa di sini, bukan setelah tab.** Tanpa akun primer, kartu rekonsiliasi
tidak pernah muncul (bagian 6), jadi fitur ini tidak akan pernah hidup untuk
keluarga yang tidak pernah membukanya di Ruang Keluarga.

**"Nanti Saja" harus tetap ada di tiap langkah.** Gate di `app/_layout.tsx:60`
sudah punya jalur `!membership`, dan onboarding yang tidak bisa dilewati akan
memblokir keluarga yang ingin melihat-lihat dulu. Jalur lewati harus eksplisit,
bukan tersembunyi.

Satu konsekuensi teknis: memilih akun primer saat onboarding berarti `cycles`
harus sudah ada — jadi urutannya **siklus dulu, baru akun primer**, meski
siklusnya sendiri dibuat otomatis oleh `seedHouseholdDefaults`.

---

## 10. Keputusan yang masih terbuka

| # | Pertanyaan | Rekomendasi |
| --- | --- | --- |
| 1 | Snapshot di H-7/H-3 atau di tutup siklus? | **Tutup siklus** (bagian 4.1, opsi A). H-7/H-3 = peninjauan. |
| 2 | Apakah siklus tanpa akun primer boleh ditutup? | **Ya**, dengan tawaran memilih akun. Jangan blokir ritual tutup siklus hanya karena jangkar belum diatur. |
| 3 | Default pagu trash | **0 / tanpa pagu.** Insight tetap bekerja lewat rasio + tren; pagu hanya menajamkan. |
| 4 | Nasib `ShopeePay`/`Tunai` sebagai akun | **Tetap ada sebagai akun, tapi tidak bisa jadi akun primer** — user boleh mencatat transaksi dari sana sebagai bahan audit, dan transaksi itu tidak membebani saldo siklus (bagian 1). Picker akun primer disaring ke `type = 'BANK'`; picker transaksi biasa tidak disaring. |
| 5 | Kapan `account_id` diwajibkan? | **Segera untuk expense**, karena ia menentukan `R`. Tanpa ini, tiap baris NULL adalah `D` palsu. |
| 6 | Baris ber-`account_id` = akun primer tetapi `cycle_id` NULL — masuk `R` atau tidak? | **Belum diputuskan.** Secara kas ia menggerakkan rekening, tapi ia tidak bisa diatribusikan ke siklus mana pun. Pilihan: (a) abaikan dari `R` dan tampilkan sebagai "transaksi di luar siklus" di layar tutup, atau (b) wajibkan `cycle_id` untuk setiap baris yang menyentuh akun primer. Rekomendasi sementara: **(a)** — lebih jujur, karena (b) memaksa keluarga memilih siklus untuk transaksi yang memang di luar ritual. |

---

## 11. Urutan pengerjaan

| # | Langkah | Kenapa di sini |
| --- | --- | --- |
| 1 | **Banner in-app H-7/H-3** + `daysUntilCycleEnd()` murni + tes | nol infra; menguji logika tanggal & copy sebelum ada notif |
| 2 | **Kategori sistem `UNTRACKED`** + pemisahan `isEligibleForPicker`/`isBudgeted` | kecil; membuka jalur tulis trash dan menutup lubang 3.1 |
| 3 | **Picker akun primer disaring ke `type = 'BANK'`** + penegakan di trigger | menentukan `R`; tanpa ini rekonsiliasi tidak bisa benar |
| 4 | **Migration 012** (`primary_account_id`, `cycle_reconciliations`) | landasan data |
| 5 | **Onboarding: pilih akun primer** (bagian 9) | membuat #6 hidup sejak hari pertama |
| 6 | **Layar "Cek Saldo" + tutup siklus** (profiling, gated) | inti fiturnya; banner #1 jadi pintu masuknya |
| 7 | **Insight 2-dimensi** (rasio trash + cakupan) | butuh 3–6 siklus data sebelum bermakna |
| 8 | **Push notif** — ditunda sampai persiapan deploy (bagian 8) | butuh identitas paket + `eas.json` + dev build + Edge Function |

#1–#7 bisa dikerjakan tanpa menyentuh notifikasi sama sekali, dan #1 sudah
memberi nilai utuh sendirian.

**Langkah 8 ditunda dengan sadar.** Selama pengembangan masih di Expo, push
tidak bisa diuji dengan benar (remote push tidak jalan di Expo Go Android sejak
SDK 53) dan ia memblokir pada identitas paket — keputusan yang hanya boleh
diambil sekali oleh pemilik produk. Yang perlu disiapkan sementara: catat
`daysUntilCycleEnd()` + copy H-7/H-3 di banner, karena itulah yang nanti
**dikirim** push. Push tidak boleh merancang ulang isi pesannya; ia hanya
mengirim apa yang banner sudah buktikan berguna.

Checklist persiapan rilis (dari bagian 8.1), dikerjakan sekaligus saat deploy:
`ios.bundleIdentifier` · `android.package` · `extra.eas.projectId` · `eas.json` ·
`expo-notifications` + plugin · `push_tokens` + RLS · `cycle_notification_log`
(`unique (cycle_id, kind)`) · Edge Function + cron · kredensial FCM/APNs.

---

## 12. Di luar scope (task terpisah)

### 12.1 App belum bisa mencatat transaksi non-siklus sama sekali

Aturan "transaksi non-siklus tetap tercatat tetapi tidak membebani saldo siklus"
(keputusan #5) **belum bisa dijalankan hari ini** — bukan karena rumusnya salah,
tapi karena tidak ada jalur yang bisa menulis baris seperti itu:

| Lokasi | Apa yang terjadi |
| --- | --- |
| `app/quick-add.tsx:151` | `if (!householdId \|\| !cycleQ.data?.id)` → **memblokir** pencatatan tanpa siklus aktif |
| `lib/queries.ts:150-164` | `useTransactions` memakai `.eq('cycle_id', cycleId!)` → baris ber-`cycle_id` NULL **tidak terlihat di mana pun** |

Kolomnya sendiri sudah siap: `transactions.cycle_id` **nullable sejak migration
001**. Jadi yang hilang murni jalur + query, bukan skema.

**Kenapa ini bukan detail kecil.** Ini yang membuat model "audit vs saldo
siklus" bisa hidup: tanpa kemampuan mencatat di luar siklus, keluarga yang mau
mencatat jajan ShopeePay-nya terpaksa **memasukkan baris itu ke siklus** — dan
persis di situlah saldo siklus jadi tercemar. Jadi ketiadaan fitur ini bukan
sekadar "belum ada", ia **mendorong** perilaku yang justru ingin dicegah.

Dua perubahan minimum: (a) `quick-add.tsx` mengizinkan simpan tanpa siklus aktif
(bila `account_id` ≠ akun primer, atau atas pilihan eksplisit user), dan (b)
sebuah query Riwayat "di luar siklus" yang tidak memfilter `cycle_id`. Kaitan ke
Phase 12: keputusan terbuka #6 di bagian 10 bergantung pada (b).

### 12.2 Kategori sistem tidak dibuat untuk household baru

**Kategori sistem tidak dibuat untuk household baru.** `create_household`
(migration 007) hanya menulis `households` + `household_members`; backfill 006
adalah `for hh in select id from public.households loop` — snapshot sekali jalan,
tanpa trigger. Akibatnya household yang dibuat setelah 006 berjalan tidak punya
`Pinjaman` / `Pemasukan Pendanaan`, dan `new-cycle.tsx:103` menulis baris
kewajiban dengan `category_id = null` — persis yang diperingatkan komentar di
`new-cycle.tsx:99-102`.

Ini **bug yang sudah ada sekarang**, tidak disebabkan Phase 12 dan tidak
menghalanginya. Satu-satunya kaitan: `UNTRACKED` juga butuh mekanisme yang sama
untuk ada di setiap household. Fix yang benar adalah trigger
`after insert on households` yang menyisipkan ketiga kategori sistem — dijaga di
database, sama seperti `prevent_system_category_delete` di 006. Dicatat di sini
supaya tidak terlupa, dikerjakan sebagai perubahan tersendiri.

---

## 13. Transfer antar akun & sapu sisa saldo (keputusan 2026-09-28)

Bagian ini menjawab pertanyaan yang muncul setelah §1–§12 selesai: **apakah
siklus sebaiknya mencakup semua akun, bukan hanya akun primer?**

### 13.1 Blocker yang sudah dialami user di sheets

User pernah mencoba memodelkan top-up e-wallet secara detail di spreadsheet dan
berhenti karena satu masalah: **income-nya naik palsu.**

```
Top-up GoPay 500rb dari Mandiri
  baris 1:  Mandiri keluar 500rb
  baris 2:  GoPay masuk 500rb      ← ini terbaca sebagai PEMASUKAN
  → total pemasukan naik 500rb, padahal tidak ada uang baru dari luar
```

**Bug yang sama akan terjadi di app ini, dan lokasinya sudah ditemukan:**

```
lib/queries.ts:641-654  aggregateSourceFunds()
  .eq('household_id', ...).eq('cycle_id', ...)     ← tidak ada filter akun
  if (flow === 'OPERATING_INCOME') operatingIncome += amount
```

`aggregateSourceFunds` menyaring **hanya per siklus**, tidak per akun. Jadi baris
"GoPay masuk" yang ditulis dengan `flow_type = OPERATING_INCOME` akan menaikkan
`sourceFunds`. Penyebabnya bukan akunnya — penyebabnya **label flow-nya**.

### 13.2 Akar masalah: transfer bukan income, bukan expense

Ada tiga jenis pergerakan uang, dan `FlowType` (`lib/zero-based.ts:13-20`) baru
punya kosakata untuk dua:

| Jenis | Arti | Masuk hitungan |
| --- | --- | --- |
| **Sumber** | uang masuk dari luar keluarga | `sourceFunds` |
| **Alokasi** | uang diberi pekerjaan (belanja, utang, investasi) | `totalAllocation` |
| **Relokasi** | uang pindah kantong antar akun sendiri | **tidak keduanya** |

Enam nilai `FlowType` yang ada (`OPERATING_INCOME`, `FINANCING_INFLOW`,
`ASSET_RELEASE`, `EXPENSE`, `DEBT_PAYMENT`, `ASSET_ALLOCATION`) semuanya milik
jenis 1 atau 2. **Tidak ada satu pun yang berarti "pindah kantong".** Karena itu
top-up GoPay terpaksa dilabeli income (menggelembungkan sumber) atau expense
(menggelembungkan belanja) — tidak ada pilihan yang benar.

`ASSET_ALLOCATION` juga tidak bisa dipakai meski namanya mirip:
`lib/insight.ts:282-284` menambahkannya ke `actualAssetAllocation` **tanpa
memeriksa arah**, jadi top-up GoPay akan muncul sebagai "dana yang diinvestasikan".

**Yang dibutuhkan: satu `FlowType` untuk transfer** yang tidak masuk
`sourceFunds` maupun `totalAllocation`.

### 13.3 Keputusan user

| Pertanyaan | Jawaban |
| --- | --- |
| Sisa saldo di akun non-primer | **Relokasi** — bukan sumber, bukan alokasi |
| Akun yang ikut disapu | **Hanya akun penyimpan nilai** (bank + aset); e-wallet & tunai diperlakukan *spent* |

Konsekuensi yang harus disadari: **`sourceFunds` tetap murni akun primer** —
"pemasukan 20jt di primary, ya siklusnya 20jt itu aja". Sapuan sisa GoPay
**tidak** menambah `totalAllocation` dan **tidak** mengubah `sourceFunds`, jadi
`unallocatedFunds` tetap 0. Neraca tidak pernah timpang.

**Kalau sapuan itu dicatat sebagai alokasi, angkanya rusak:**

```
sourceFunds     20jt   (hanya primary)
totalAllocation 21jt   (20jt + 1jt sapuan GoPay yang "dialokasikan")
unallocated     −1jt   → app melaporkan funding gap yang tidak ada
```

Itulah alasan sapuan bukan alokasi baru. Tapi **sapuan juga bukan transfer
antar-akun** — lihat bagian 14, karena jawaban pertama saya di sini salah.

### 13.4 Yang perlu ditambahkan

**1. `FlowType` baru.** Nama yang diusulkan: `TRANSFER`. Tidak masuk
`aggregateSourceFunds` maupun `aggregateAllocations` — hanya menggerakkan kas.

**2. Kolom akun lawan — hanya untuk transfer antar-akun.** Transfer antar dua
akun butuh dua akun, sedangkan `transactions` hanya punya satu `account_id`.
Untuk itu: `counter_account_id uuid`. **Tapi sapuan ke investasi bukan transfer
antar-akun** — tujuannya bukan akun, melainkan *posisi aset* (bagian 14).
Jangan pakai kolom ini untuk sapuan investasi.

**3. Aturan sapu.** Menyapu **semua** akun penyimpan nilai tiap tutup siklus
membuat setiap akun mulai dari nol, sehingga **masalah saldo awal yang migration
010 tolak hilang dengan sendirinya** — setiap siklus punya `O = 0`. Ini
keuntungan nyata, tetapi harganya: sapuan harus tahu saldo **tiap** akun
penyimpan nilai, bukan hanya akun primer.

### 13.5 Hubungan dengan §1: dua mode, bukan saling menggantikan

Penting untuk tidak membaca §13 sebagai pengganti §1. Keduanya menjawab
pertanyaan berbeda:

| | §1 — rekonsiliasi | §13 — sapu siklus |
| --- | --- | --- |
| Pertanyaan | "catatan app cocok dengan bank?" | "ke mana sisa saldo pergi?" |
| Cakupan | akun primer saja | akun penyimpan nilai |
| Butuh | `O`, `C` (dua angka) | saldo tiap akun |
| Kapan | tutup siklus | tutup siklus |

**Urutan yang benar:** rekonsiliasi dulu (§1), sapu belakangan (§13). Tidak masuk
akal menyapu sisa sebelum tahu catatannya cocok — sapuan di atas angka yang salah
hanya memindahkan kesalahan ke akun lain.

### 13.6 Yang belum diputuskan

| # | Pertanyaan | Catatan |
| --- | --- | --- |
| 1 | Nama `FlowType`: `TRANSFER` atau lain? | Perlu dicek terhadap konvensi enum repo |
| 2 | Akun tujuan sapuan: dipilih user atau akun `INVESTMENT` khusus? | Belum dibahas |
| 3 | Apakah sapuan wajib atau opsional tiap siklus? | Kalau wajib, keluarga tanpa posisi aset terpaksa membuatnya |
| 4 | Bagaimana sapuan berinteraksi dengan `cycle_allocations` akun `ASSET`? | Alokasi aset sudah ada; sapuan harus tidak dobel hitung dengannya |

**Catatan cakupan.** §13 lebih besar dari §1–§12: ia menambah `FlowType`,
kolom, aturan sapu, dan menyentuh `lib/insight.ts` serta
`aggregateSourceFunds`. Disarankan **dikerjakan setelah §11 #1–#7 selesai**,
bukan diselipkan — kecuali #12.1 (mencatat transaksi non-siklus) yang justru
jadi prasyaratnya.

---

## 14. Investasi itu *posisi aset*, bukan akun (koreksi §13)

User menangkap kesalahan konseptual di §13: *"ini kalo nggak salah tangkep malah
di transfer ke akun investment. **Emang ada akun investment?**"*

**Jawabannya: tidak ada, dan saya yang mengarangnya.** `accounts.type` dibatasi
CHECK `in ('BANK', 'CREDIT_CARD', 'E_WALLET', 'CASH')`
(`001_initial_schema.sql:34`) — **tidak ada `INVESTMENT`**. Yang lebih penting,
menambahkannya akan melanggar paradigma user sendiri: akun adalah wadah
zero-based yang **disapu tiap bulan, tidak boleh menyimpan nilai, tidak boleh
menumpuk**. Akun investasi yang menyimpan dana bertahun-tahun adalah kebalikan
dari itu.

### 14.1 Pemisahan yang benar

| Konsep | Apa | Disapu? | Punya saldo? |
| --- | --- | --- | --- |
| **Akun** | wadah kas: Mandiri, GoPay, Tunai | **ya, tiap siklus** | ya, tapi dikosongkan |
| **Aset** | posisi: investasi, dana darurat | **tidak** | ya, dan memang menumpuk |

Investasi **bukan akun** — ia **posisi aset** yang nilainya menumpuk dari waktu
ke waktu. Ia tidak punya `accounts` row, tidak muncul di picker akun, dan tidak
disapu.

### 14.2 App sudah punya konsep ini — dan sudah benar

Ini bukan fitur baru. `lib/insight.ts` sudah memisahkannya, dan komentarnya
menyatakan batasnya secara eksplisit:

```
//   * Asset movement is *allocations*, because the ledger has no assets table.
//     `assetAdditions` is what the family set aside, not a market value, and it
//     is labelled that way on screen.
```

Jadi yang sudah ada:

- `cycle_allocations` ber-`allocation_type` `INVESTMENT` / `SAVINGS` / `ASSET` /
  `EMERGENCY_FUND` — inilah "menyisihkan ke investasi". **Sudah jalan.**
- `ASSET_BANDS` (`insight.ts:476-481`) sudah mengelompokkannya: `Dana darurat`,
  `Dana anak`, `Investasi`, `Likuiditas`.
- `accumulateAssets()` (`insight.ts:411-417`) sudah menjumlahkannya
  bulan-ke-bulan — persis "Juli–September 1jt jadi 3jt" yang kamu sebutkan.
- `app/asset-insight.tsx` sudah menampilkannya ("Akumulasi" vs "bulanan").

**Jadi pertanyaanmu "apakah bisa memantau investasi dari transaksi perbulannya"
jawabannya: sudah bisa.** Yang belum ada adalah bagian berikutnya.

### 14.3 Yang belum ada: nilai pasar (fluktuasi)

Inilah kebutuhan nyata yang kamu sebutkan, dan ia **tidak** terjawab oleh
mekanisme yang ada:

```
Disisihkan (ledger)   Jul 1jt + Agu 1jt + Sep 1jt  =  3jt   ← akurat, sudah ada
Nilai pasar (nyata)                                 =  3,5jt ← TIDAK ada di app
```

`assetAdditions` adalah **"yang disisihkan"**, bukan **"nilai sekarang"**. App
tidak pernah tahu nilainya naik jadi 3,5jt, karena tidak ada tabel aset dan
tidak ada tempat menyimpan valuasi. Komentar `insight.ts:18` sudah
memperingatkan ini — dan layar pun melabelinya "disisihkan", bukan "nilai".

**Yang dibutuhkan: tabel `asset_valuations`** — per posisi aset, per tanggal,
satu angka yang dinyatakan keluarga. Persis pola `cycle_reconciliations` (§2.2):
**fakta bertanggal, bukan kolom turunan yang basi.** Untuk investasi yang
nilainya fluktuatif, ini satu-satunya cara yang benar — valuasi adalah
**kejadian** ("pada 30 Sep nilainya 3,5jt"), bukan hasil hitungan.

Penyesuaiannya tidak menyentuh siklus sama sekali: itu **unrealized gain**,
bukan uang masuk. Ia tidak boleh masuk `sourceFunds` maupun `totalAllocation`.

### 14.4 Kenapa ini menyelesaikan masalah §13 dengan lebih baik

Awalnya saya menulis "sapu sisa GoPay ke akun investasi". Itu salah karena
menciptakan akun yang tidak boleh ada. Yang benar, **dua langkah terpisah**:

```
1. Sisa GoPay 1jt  →  MASUK ke akun primer (transfer antar-akun)
                      → FlowType TRANSFER, counter_account_id = GoPay
                      → akun mulai dari nol, siklus tetap murni primer

2. 1jt itu         →  DISISIHKAN ke INVESTMENT (cycle_allocations)
                      → totalAllocation naik, tapi sourceFunds juga naik 1jt
                      → unallocated tetap 0 ✅
```

Bandingkan dengan §13 yang salah, di mana sapuan langsung "dialokasikan" tanpa
pernah masuk sumber — di situ `unallocated` jadi −1jt. **Dua langkah di atas
tidak punya masalah itu**, karena uangnya benar-benar berpindah ke akun primer
lebih dulu (langkah 1), lalu dialokasikan (langkah 2). Neraca tetap balance.

### 14.5 Yang perlu diputuskan

| # | Pertanyaan | Catatan |
| --- | --- | --- |
| 1 | Sapuan sisa wajib masuk akun primer, atau boleh langsung jadi alokasi aset? | Langsung = hemat satu langkah, tapi uangnya tidak pernah terlihat di rekening |
| 2 | `asset_valuations`: per posisi aset atau per `allocation_type`? | Per posisi lebih fleksibel (dua reksadana berbeda), per type lebih sederhana |
| 3 | Unrealized gain ditampilkan di mana? | Layar `asset-insight.tsx` sudah punya tempat |
| 4 | Apakah valuasi perlu riwayat, atau hanya nilai terakhir? | Riwayat = bisa lihat tren; terakhir = lebih sederhana |

**Catatan penting:** §14 menambah tabel baru dan menyentuh `insight.ts`, jadi
ukurannya sebanding dengan §13. Keduanya **bukan** bagian dari §1–§12, dan
sebaiknya dikerjakan sebagai fase terpisah setelah ritual tutup siklus (§11
#1–#7) terbukti dipakai.
