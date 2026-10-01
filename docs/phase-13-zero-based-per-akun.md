# Phase 13 — Zero-Based per Akun, Transfer, dan Aset Investasi

Dokumen ini menjawab satu pertanyaan yang muncul di akhir Phase 12: **apakah
siklus sebaiknya zero-based per akun, bukan hanya per rumah tangga?** Dokumen ini
juga memuat **grilling** — pencarian bug/grey area — atas model tersebut.

Status aktual (2026-10-01): fondasi Phase 13 sudah tersedia pada kode dan migration lokal: `TRANSFER`/`counter_account_id`, tabel aset/valuasi, jalur tulis asset allocation/release, kebijakan sweep, agregasi Zero-Based kas, dan ringkasan per akun beserta snapshot saldo yang dinyatakan. Tes unit mencakup sejumlah kontrak domain, tetapi belum memverifikasi seluruh behavior lewat Supabase lokal/remote. Migration 026 tercatat di repo untuk guard bentuk cash movement dan pengecualian CASH pada sweep; penerapan pada Supabase remote tidak diverifikasi.

Bagian berikut mempertahankan keputusan dan temuan historis. Checklist yang ditandai selesai adalah catatan pada tanggalnya; klaim di bagian grilling bahwa fitur tertentu belum ada adalah keadaan saat dokumen ditulis, bukan daftar status terkini.

---

## 1. Keputusan user (pivot dari Phase 12)

Koreksi user atas usulan §13–§14 Phase 12:

> "secara flow terlalu panjang. saya tetep mau dari ewalet ini bisa langsung
> topup investment"
>
> "seharusnya unallocated ini udah ke define dari masing2 account, nanti di
> hitung setiap account dari income/outcomenya apa masih ada unallocated? jika
> iya baru di instruksikan untuk penyesuaian atau di arahkan untuk
> diinvestasikan direct dari account tersebut ke assets investasi"
>
> "saya setuju ada table assets untuk store semua transaksi2 investasi ke assets
> tersebut. jadi ketika kita input kategori investasi kita ngebuatin 1 assets itu"

Tiga perubahan dari usulan saya:

| Usulan saya (§13–14 Phase 12) | Keputusan user |
| --- | --- |
| Sisa e-wallet → **masuk primer** → baru disisihkan | **Langsung** dari e-wallet ke investasi |
| Zero-based dihitung **per rumah tangga** | Zero-based dihitung **per akun** |
| Investasi = `cycle_allocations` tipe `INVESTMENT` | Investasi = **tabel `assets`** (posisi yang bisa divaluasi) |

Usulan saya menciptakan langkah yang tidak perlu. Model user lebih pendek **dan
lebih benar**, karena ia menghapus kebutuhan "akun investasi" sepenuhnya.

---

## 2. Model yang benar: setiap akun harus habis (zero)

### 2.1 Prinsip

**Setiap akun adalah wadah zero-based: ia mulai dari nol, dan harus kembali ke
nol di akhir siklus.** Apa pun yang tersisa harus punya tujuan — atau menjadi
posisi aset.

Ini bukan sekadar kerapian. Ia **menghapus masalah saldo awal** yang menjadi
alasan utama migration 010 menolak `accounts.balance`:

```
Kalau tiap akun disapu ke nol tiap siklus, maka O = 0 untuk setiap akun,
setiap siklus. Tidak ada saldo awal yang perlu disimpan.
```

Perhatikan: yang "disapu" bukan uangnya, melainkan **ketidakjelasan**-nya. Uang
yang tersisa diarahkan ke aset, dan aset memang **boleh** menumpuk — itu memang
sifatnya.

### 2.2 Pemisahan akun vs aset

| Konsep | Apa | Menumpuk? | Punya saldo? |
| --- | --- | --- | --- |
| **Akun** | wadah kas: Mandiri, GoPay, Tunai | **tidak** — disapu ke nol | ya, sementara |
| **Aset** | posisi: reksadana, dana darurat, emas | **ya** | ya, dan divaluasi |

Ini **dikuatkan oleh skema yang sudah ada**, bukan sekadar pendapat:

```
001_initial_schema.sql:27   categories.type  check (type in ('EXPENSE','INCOME','INVESTMENT'))
001_initial_schema.sql:34   accounts.type    check (type in ('BANK','CREDIT_CARD','E_WALLET','CASH'))
```

`INVESTMENT` **ada** sebagai jenis kategori, dan **tidak ada** sebagai jenis
akun. Skema sudah menyatakan hal yang sama dengan insting user: investasi
bukan akun.

---

## 3. Tiga jenis pergerakan uang

Ini kosakata yang hilang dan menyebabkan blocker di spreadsheet user. Catatan
serta tabel temuan di bawah merekam kondisi saat dokumen dirancang; fondasi
`TRANSFER`/`counter_account_id` kini tersedia di migration 014, tetapi detail
implementasi lokal menjadi acuan status saat ini.

| Jenis | Arti | `sourceFunds` | `totalAllocation` |
| --- | --- | --- | --- |
| **Sumber** | uang masuk dari luar keluarga | + | — |
| **Alokasi** | uang diberi pekerjaan | — | + |
| **Relokasi** | pindah kantong antar akun sendiri | 0 | 0 |

`FlowType` yang ada (`lib/zero-based.ts:13-20`):

| FlowType | Jenis | Sudah ditulis oleh |
| --- | --- | --- |
| `OPERATING_INCOME` | Sumber | `quick-add.tsx` (`queries.ts:285`) |
| `FINANCING_INFLOW` | Sumber | `useCreateCycle` (`queries.ts:440`) |
| `ASSET_RELEASE` | Sumber | **tidak ada** ⚠️ |
| `EXPENSE` | Alokasi | `quick-add.tsx` (`queries.ts:285`) |
| `DEBT_PAYMENT` | Alokasi | `useAllocateObligation`, `useCreateCycle` |
| `ASSET_ALLOCATION` | **Relokasi ke aset** | **tidak ada** ⚠️ |

### 3.1 Temuan penting: `ASSET_ALLOCATION` sudah benar untuk top-up investasi

Saya sebelumnya mengira perlu `FlowType` baru untuk "topup investasi langsung
dari e-wallet". **Tidak perlu.** `ASSET_ALLOCATION` sudah persis berarti itu:
kas keluar dari akun, berubah menjadi posisi aset. Ia bukan income (uang tidak
bertambah) dan bukan expense (uang tidak habis).

**Yang benar-benar hilang hanya satu: `TRANSFER`** — perpindahan antar **dua
akun**, di mana tidak ada aset yang lahir. Mandiri → GoPay adalah transfer;
GoPay → reksadana adalah `ASSET_ALLOCATION`.

> **Catatan status kini (2026-09-30):** `TRANSFER` dan `counter_account_id` sudah
> ditambahkan pada migration 014 dan kosakata klien. Paragraf serta temuan di
> bawah yang menyatakan jalur tersebut belum ada adalah kondisi historis saat
> dokumen ditulis, bukan status kode saat ini.

```
Mandiri → GoPay       TRANSFER          (akun → akun, dua sisi kas)
GoPay   → reksadana   ASSET_ALLOCATION  (akun → aset, satu sisi kas)
reksadana → Mandiri   ASSET_RELEASE     (aset → akun, satu sisi kas)
```

⚠️ **Kedua flow yang dibutuhkan (`ASSET_ALLOCATION`, `ASSET_RELEASE`) belum
punya jalur tulis sama sekali.** Ini terverifikasi: grep di seluruh `lib/`,
`app/`, `components/` hanya menemukan **pembacaan**, tidak ada `insert` yang
menulisnya. Akibatnya `actualAssetAllocation` (`insight.ts:283`) **selalu 0**
pada data nyata.

---

## 4. Perhitungan: rumah tangga vs akun

Ini bagian paling rawan, dan di sinilah fraud bisa muncul.

### 4.1 Dua tingkat, dua rumus

```
Tingkat RUMAH TANGGA (yang sudah ada, tidak berubah):
  sourceFunds   = income dari LUAR saja
  totalAllocation = Σ cycle_allocations
  unallocated   = sourceFunds − totalAllocation

Tingkat AKUN (yang baru):
  masuk_akun  = income ke akun itu + transfer masuk ke akun itu
  keluar_akun = expense + debt payment + transfer keluar + asset allocation
  sisa_akun   = masuk_akun − keluar_akun        ← ini yang harus 0
```

### 4.2 ⚠️ FRAUD #1 — transfer masuk harus jadi sumber di tingkat akun, tapi TIDAK di tingkat rumah tangga

Ini konsekuensi yang tidak boleh dilewatkan:

```
Mandiri → GoPay 3jt (TRANSFER)

Tingkat AKUN:
  GoPay.masuk += 3jt     ✅ benar — GoPay memang menerima 3jt

Tingkat RUMAH TANGGA:
  sourceFunds += 3jt     ❌ SALAH — tidak ada uang baru dari luar
```

Kalau transfer masuk dihitung sebagai sumber **di kedua tingkat**, pemasukan
rumah tangga menggelembung sebesar total transfer internal. Persis **bug yang
membuat user berhenti di spreadsheet**, hanya berpindah tempat.

**Aturan:** transfer adalah **sumber di tingkat akun**, dan **netral di tingkat
rumah tangga**. Kalau ini tidak ditegakkan di satu tempat, ia akan bocor.

### 4.3 ⚠️ FRAUD #2 — alokasi hari ini tidak punya `account_id`

Ini **bug yang sudah ada sekarang**, dan ia mematikan zero-based per akun:

```
app/allocation.tsx:98-105   payload createAlloc:
  { householdId, cycleId, allocationType, amount, categoryId, obligationId }
  ← accountId TIDAK DIKIRIM, padahal useCreateAllocation menerimanya

app/allocation.tsx:290      tampilan:
  {r.accounts?.name ?? 'Tanpa akun'}
  ← layar MENAMPILKAN akun yang formulirnya sendiri tidak pernah mengisi
```

Jadi **setiap alokasi yang dibuat dari layar Alokasi punya `account_id = NULL`.**

Akibatnya untuk zero-based per akun: `sisa_akun = masuk_akun − 0 = masuk_akun`.
**Setiap akun akan terlihat 100% belum teralokasi, selamanya.** Fitur ini tidak
bisa jalan tanpa memperbaiki ini lebih dulu.

Kabar baiknya: kolomnya **sudah ada dan nullable** — `cycle_allocations.account_id`
(`004_zero_based_financing_allocations.sql:79`, `on delete set null`). Yang
hilang hanya pengiriman nilainya dari layar.

### 4.4 🔴 BUG #3 — default akun `quick-add` adalah KARTU KREDIT, bukan bank

Ini **bug yang sudah ada sekarang**, dan dampaknya lebih besar dari perkiraan
awal saya. Verifikasi lengkap:

```
lib/seed.ts:36-41   DEFAULT_ACCOUNTS = [{name:'Mandiri',type:'BANK'},
                                        {name:'CC Mandiri',type:'CREDIT_CARD'},
                                        {name:'ShopeePay',...},{name:'Tunai',...}]
                    ← TIDAK ada field sort_order
lib/seed.ts:65      .map((a) => ({ ...a, household_id: householdId }))
                    ← tetap tidak menambahkan sort_order
migrations/010:154  sort_order int not null default 0
migrations/010:188  backfill Mandiri=1, CC=2, ShopeePay=3, Tunai=4
                    ← TAPI hanya untuk household yang sudah ada saat 010 berjalan
lib/account.ts:107  sort_order sama → fallback a.name.localeCompare(b.name, 'id')
```

Jadi untuk **setiap household yang dibuat setelah migration 010 berjalan**
(yakni setiap pendaftaran baru sejak 010 dirilis), keempat akun punya
`sort_order = 0`. `sortAccounts` lalu jatuh ke urutan alfabet:

```
['Mandiri','CC Mandiri','ShopeePay','Tunai'].sort(localeCompare) 
  → ['CC Mandiri', 'Mandiri', 'ShopeePay', 'Tunai']
        ↑ 'C' < 'M', jadi kartu kredit menang
```

**Akibatnya `accounts[0]` = `CC Mandiri` — sebuah kartu kredit, bukan bank.**

```
app/quick-add.tsx:111   const selectedAccountId = accountId ?? accounts[0]?.id ?? null;
lib/queries.ts:285      flow_type: 'OPERATING_INCOME' untuk income
```

Sehingga keluarga baru yang mencatat pemasukan **tanpa memilih akun** akan
menulis `account_id = CC Mandiri`. Untuk Phase 12 ini berarti `R+` menghitung
transaksi kartu kredit sebagai pemasukan akun primer, dan rekonsiliasi
melaporkan `D` palsu yang besar.

**Ini juga salah hari ini, tanpa Phase 12/13 sama sekali** — pemasukan keluarga
tercatat berasal dari kartu kredit.

Catatan tambahan: user sudah menyatakan income **tidak perlu** memilih akun
karena terkunci ke akun siklus, tetapi kode **tetap menampilkan picker akun**
untuk income (`quick-add.tsx:66,111`) dan tetap memakai `accounts[0]`. Jadi niat
user dan perilaku kode belum bertemu — dan sekarang kita tahu default-nya pun
salah.

### 4.5 ⚠️ FRAUD #4 — dua sumber kebenaran untuk "berapa yang diinvestasikan"

Ini yang paling berbahaya jangka panjang.

```
Jalur A (sudah ada):  cycle_allocations tipe INVESTMENT
                      → insight.ts:295  b.assetAdditions += amount
                      → insight.ts:411  accumulateAssets() menjumlahkannya

Jalur B (baru):       tabel `assets` + transaksi investasi
                      → nilai posisi aset
```

Kalau keduanya hidup berdampingan **tanpa aturan**, "total investasi" punya dua
angka yang berbeda dan layar akan saling bertentangan. Ini kelas bug yang sama
dengan yang sudah dijaga ketat oleh aturan anti-double-count Phase 1
(`lib/zero-based.ts:10-12`), dan harus dijaga dengan disiplin yang sama.

**Aturan yang diusulkan:** `assets` adalah **satu-satunya** sumber untuk *nilai
posisi*. `cycle_allocations` tetap sumber untuk *rencana alokasi*. `assetAdditions`
tidak boleh lagi dijumlahkan menjadi "nilai aset" begitu tabel `assets` ada —
ia hanya boleh berarti "yang **direncanakan** disisihkan".

### 4.6 ⚠️ GREY AREA #5 — apakah "disapu ke nol" itu realistis?

Kalau setiap akun harus nol, maka rekening yang menyimpan tabungan harus
**seluruhnya** dipindahkan menjadi posisi aset tiap siklus. Untuk keluarga yang
menyimpan dana darurat di rekening, ini berarti tiap bulan membuat
`ASSET_ALLOCATION` besar-besaran.

Ini bisa jadi **beban ritual yang berat**, dan berisiko membuat keluarga berhenti
memakai fitur. Perlu diputuskan: apakah "harus nol" itu **wajib** atau
**penawaran** (app menawarkan sapu, keluarga boleh menolak). Bagian 7.

---

## 5. Tabel `assets` (keputusan user)

User setuju ada tabel aset: *"ketika kita input kategori investasi kita ngebuatin
1 assets itu"*. Jadi membuat transaksi investasi **membuat** posisi aset.

### 5.1 Bentuk yang diusulkan

```sql
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,                  -- 'Reksadana Pasar Uang'
  band text not null,                  -- sejalan dengan ASSET_BANDS
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.asset_valuations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  stated_value bigint not null,        -- FAKTA yang dinyatakan keluarga
  valued_at date not null,
  noted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
```

`band` sengaja sejalan dengan `ASSET_BANDS` (`insight.ts:476-481`: `Dana
darurat`, `Dana anak`, `Investasi`, `Likuiditas`) supaya tidak lahir kosakata
ketiga.

### 5.2 Kenapa `asset_valuations` harus tabel, bukan kolom

Sama persis dengan alasan `cycle_reconciliations` di Phase 12 §2.2: valuasi
adalah **kejadian bertanggal** ("pada 30 Sep nilainya 3,5jt"), bukan kolom
turunan yang basi begitu ada transaksi baru. Untuk instrumen fluktuatif, kolom
`assets.current_value` akan salah setiap hari dan tidak ada yang menulis ulang.

### 5.3 Hubungan ke transaksi investasi

Transaksi investasi perlu menunjuk aset mana:

```sql
alter table public.transactions
  add column if not exists asset_id uuid references public.assets(id) on delete set null;
```

Sehingga alur "input kategori investasi → buat aset" menjadi:
`transactions.asset_id` → baris di `assets`. Satu transaksi investasi = satu
penambahan posisi; `asset_valuations` yang menyatakan nilainya sekarang.

---

## 6. Ringkasan temuan grilling (snapshot historis saat dokumen ditulis; bukan status aktual)

Temuan #1–#9 di bawah merekam kondisi dan risiko yang ditemukan pada saat grilling. Beberapa sudah ditangani oleh implementasi yang tercatat di status aktual §0; jangan menafsirkan label “bug (ada sekarang)” atau saran tindakan di tabel ini sebagai hasil audit kode terkini.

| # | Temuan | Kelas | Dampak |
| --- | --- | --- | --- |
| 1 | Transfer masuk dihitung sumber di dua tingkat → income menggelembung | **Fraud** | Blocker yang sama dengan spreadsheet user |
| 2 | `allocation.tsx` tidak mengirim `accountId` → alokasi selalu NULL | **Bug (ada sekarang)** | Zero-based per akun mustahil |
| 3 | Default akun = **CC Mandiri** (bukan bank) untuk household pasca-010 | **Bug (ada sekarang)** | Income tercatat dari kartu kredit; `D` palsu |
| 4 | `assets` vs `cycle_allocations` = dua sumber "nilai investasi" | **Fraud** | Layar saling bertentangan |
| 5 | "Semua akun harus nol" bisa jadi beban ritual | **Grey area** | Fitur ditinggalkan |
| 6 | `ASSET_ALLOCATION` & `ASSET_RELEASE` tidak punya jalur tulis | **Bug (ada sekarang)** | `actualAssetAllocation` selalu 0 |
| 7 | `useZeroBasedSummary`/`useSourceFunds` tidak filter akun | **Kurang fitur** | Belum ada perhitungan per akun |
| 8 | `insight.ts:283` menjumlahkan `ASSET_ALLOCATION` tanpa cek arah | **Risiko** | Salah hitung kalau arah dipakai |
| 9 | `ASSET_ALLOCATION` ditulis ber-`direction: 'INCOME'` di test | **Bug (ada sekarang)** | Kas keluar terbaca masuk; saldo akun tak pernah turun (§7.4) |

Temuan tambahan dari **Pass 1 grilling** (area jalur tulis & data; detail di
`phase-13-grilling-log.md`). Semuanya **terverifikasi ulang** langsung ke kode:

| # | Temuan | Kelas | Kaitan Phase 13 |
| --- | --- | --- | --- |
| 10 | `obligation_installments.status` selamanya `'OPEN'` — hanya INSERT (`005:218`) + UPDATE `cycle_id` (`005:267`), tak ada trigger | **Bug (ada sekarang)** | tidak langsung |
| 11 | `obligations.current_installment` ditulis sekali = `1`, tak pernah naik (`005:116`) | **Bug (ada sekarang)** | **ya** — `funding-gap.tsx:285` selalu "Cicilan ke-1 dari N" |
| 12 | Form tanggungan mengumpulkan `categoryId` tapi `obligations` tak punya kolomnya → **hilang diam-diam** | **Bug (ada sekarang)** | tidak langsung |
| 13 | `['year-insight']` tak pernah di-invalidate (`queries.ts:776`; `invalidateMoneyKeys` 126-133; `realtime.ts`) | **Risiko** | **ya** — C5/C7 menyentuh layar ini |
| 14 | Hook tulis tanpa pemanggil; RPC `set_installment_cycle` **tak terjangkau UI**; `useReorderAccounts` menelan error | **Grey area** | tidak langsung |

**#11 dan #13 paling relevan** untuk Phase 13: #11 muncul di `funding-gap` (layar
uang yang Phase 12/13 sentuh), dan #13 ada di layar aset yang justru akan dibangun
ulang oleh C5/C7 — memperbaikinya sebelum C7 menghindari membangun di atas
invalidation yang bocor.

**Tiga dari sembilan temuan (#2, #3, #6) adalah bug yang sudah ada sekarang**,
tidak disebabkan oleh Phase 12 maupun Phase 13. Dua di antaranya (#2, #3)
merusak **data yang ditulis hari ini**, bukan hanya fitur yang belum jadi.
Dua temuan (#6, #9) naik jadi **jalur kritis** setelah keputusan "harus pindah
fisik" di §7.

---

## 7. Keputusan (dijawab user 2026-09-28 pagi)

| # | Pertanyaan | **Jawaban user** |
| --- | --- | --- |
| 1 | Alokasi ke investasi: uang harus **pindah fisik** atau cukup **ditandai**? | **Harus pindah fisik** |
| 2 | Sapu akun di tutup siklus: wajib atau penawaran? | **Penawaran** — dan dijadikan **setting**, bukan dipaku di kode (lihat §7.0) |
| 3 | `assetAdditions` dihentikan setelah `assets` ada? | **Ya, hentikan** — `assets` satu-satunya sumber nilai |
| 4 | Sapu = seluruh saldo atau selisih siklus? | **Hanya selisih siklus** (lihat tegangan di §7.1.1) |
| 5 | Mulai dari mana? | **Perbaiki bug dulu** (§8 #1–#3) |

Keputusan teknis yang saya ambil sendiri (koreksi kalau keberatan):
`counter_account_id` sebagai kolom lawan transfer; `assets.band` mengikuti
`ASSET_BANDS`; `asset_valuations` per **posisi** (bukan per tipe); hanya akun
bersaldo yang ditanya saat sapu.

### 7.0 Sapu = **setting**, bukan perilaku yang dipaku

Koreksi user: *"ini dibuat setting/rules aja disetting, klo sapu akun sifatnya
required berarti treatment required, tapi klo penawaran berarti di tawarkan"*.

Jadi **jangan** menulis `if (SAPU_WAJIB)` di kode. Jadikan satu kolom setting
yang membedakan **perilaku**, dan app menyesuaikan treatment-nya:

| Nilai setting | Perilaku app |
| --- | --- |
| `REQUIRED` | Tutup siklus **diblokir** sampai semua akun disapu; sapu jadi gate |
| `OFFERED` | Sapu **ditawarkan** di tutup siklus; keluarga boleh menolak |

**Ini bukan detail kosmetik** — ia menentukan di mana sapu diletakkan di alur:

```
REQUIRED  → sapu jadi bagian dari gate tutup siklus (seperti cycleReadiness)
OFFERED   → sapu jadi kartu penawaran, terpisah dari gate
```

Kalau dipaku di kode, keluarga yang butuh mode lain harus menunggu rilis
berikutnya. Sebagai setting, keduanya hidup berdampingan.

**Infrastruktur setting sudah ada** — tidak perlu pola baru. `households`
(migration 007) sudah punya `payday_day int`, dan `household_members` punya
`notify_partner_expense boolean not null default true` (`007:61`) dengan
komentar yang persis menyatakan perannya:

> `'Per-member, device-independent preference. Purely a notification gate: it
> never affects an amount, an allocation, or a status.'`

Pola `notify_partner_expense` bisa disalin hampir persis:

```sql
-- di households (setting tingkat keluarga, bukan per-anggota)
alter table public.households
  add column if not exists sweep_policy varchar not null default 'OFFERED';

alter table public.households
  drop constraint if exists households_sweep_policy_check;
alter table public.households
  add constraint households_sweep_policy_check
  check (sweep_policy in ('REQUIRED', 'OFFERED'));
```

Default `'OFFERED'` mengikuti jawaban user dan aman: keluarga yang tidak pernah
menyentuh setting ini tidak akan tiba-tiba diblokir dari menutup siklus.

⚠️ **Yang harus dijaga:** setting ini **boleh** mengubah alur, tetapi **tidak
boleh** mengubah angka. Sapu `OFFERED` yang ditolak dan sapu `REQUIRED` yang
dijalankan harus menghasilkan perhitungan yang **identik** kalau keduanya
dijalankan — kalau tidak, laporan keluarga bergantung pada setting, dan itu
kelas bug yang sama dengan dua sumber kebenaran (temuan #4). Persis peringatan
`notify_partner_expense` di atas.

### 7.1 Keputusan sapu: **hanya selisih siklus** (dijawab user)

User memilih **hanya selisih siklus** yang disapu, bukan seluruh saldo:

```
Mandiri awal siklus  50jt   (tabungan lama — TETAP di akun)
income               +20jt
expense              −18jt
                     ─────
saldo akhir          52jt   → yang disapu hanya 2jt (selisih siklus)
```

### 7.1.1 ⚠️ Tegangan yang harus disadari (jangan diabaikan)

Pilihan ini **tidak sepenuhnya konsisten** dengan pernyataan user sebelumnya:

> "account2 yg di thread sebagai zero allocation. **gaboleh ada nilainya atau
> snowball setiap bulan**"

Dengan "hanya selisih siklus", saldo akun **memang menumpuk**: 50jt → 52jt →
54jt. Itu **snowball**, persis yang dilarang. Jadi ada dua pernyataan yang
saling tarik-menarik, dan §7.1 memilih yang lebih ringan ritualnya.

**Ada satu cara membaca yang membuat keduanya benar sekaligus**, dan inilah
yang perlu diputuskan:

```
Saldo lama 50jt itu SUDAH DITANDAI sebagai posisi aset
  → secara NOMINAL akun berisi 52jt
  → secara RENCANA akun berisi 0 (50jt sudah punya tujuan, 2jt disapu)
  → "nol" berlaku di lapisan RENCANA, bukan lapisan FISIK
```

Kalau pembacaan ini yang dipakai, konsistensinya kembali: **akun nol secara
rencana**, dan tabungan lama tetap aman di rekening tanpa harus dipindah
fisik. Yang wajib dilakukan app: **saldo lama harus ditandai**, bukan
diabaikan.

### 7.1.2 🔴 Konsekuensi ke Phase 12: masalah saldo awal KEMBALI

Ini yang harus disadari sebelum implementasi. Kalau saldo lama dibiarkan di akun:

```
O (saldo awal siklus) ≠ 0     ← masalah yang Phase 12 §1 sibuk selesaikan
```

Phase 12 mengatasi ini dengan **menyatakan saldo sekali per siklus** dan
membandingkan **selisih** (`C − O`), bukan saldo absolut. Mekanisme itu **tetap
berlaku** dan jadi wajib — ia bukan lagi "jaring pengaman", melainkan **satu-
satunya cara** rekonsiliasi bekerja.

Konsekuensinya: `cycle_reconciliations` (Phase 12 §2.2) **naik status dari
pelengkap menjadi prasyarat**. Tanpa `O` yang dinyatakan, app tidak bisa
menghitung `D`, dan zero-based per akun tidak punya jangkar.

**Dua pembacaan §7.1.1 menentukan mana yang benar:**

| Pembacaan | Saldo lama | `O` | Phase 12 |
| --- | --- | --- | --- |
| **Ditandai** (disarankan) | ditandai posisi aset | masih perlu dinyatakan | prasyarat, tapi `D` sederhana |
| **Diabaikan** | tidak dilacak | wajib dinyatakan | prasyarat keras |

Rekomendasi: **ditandai**. Kalau saldo lama ditandai, ia tidak lagi "uang tak
jelas asal-usulnya" — ia posisi aset yang kebetulan duduk di rekening, dan
`D` hanya perlu menjelaskan pergerakan siklus ini.

### 7.2 🔴 Akibatnya, temuan #6 naik jadi jalur kritis

Kalau seluruh saldo disapu keluar tiap siklus, maka **uang harus bisa kembali**.
Itulah `ASSET_RELEASE` — dan temuan #6 menyatakan flow itu **tidak punya jalur
tulis sama sekali** (terverifikasi: grep hanya menemukan pembacaan).

Tanpa `ASSET_RELEASE`:

```
Siklus N    semua saldo disapu ke aset → Mandiri 0
Siklus N+1  tagihan datang sebelum income berikutnya
            → tidak ada cara menarik dana dari aset
            → keluarga terpaksa tidak menyapu, atau menyapu sebagian
```

Jadi urutan pengerjaan §8 harus berubah: **#5 (jalur tulis `ASSET_RELEASE`)
naik sebelum #7 (layar sapu)**. Menyapu tanpa cara menarik kembali adalah
perangkap.

### 7.3 Konflik yang harus disadari: "pindah fisik" vs "penawaran"

Dua jawaban ini **saling tarik-menarik**, dan tidak ada yang salah — tapi
konsekuensinya perlu diputuskan sadar:

- "Harus pindah fisik" berarti akun **tidak akan** nol kalau keluarga menolak.
- "Penawaran" berarti keluarga **boleh** menolak.

Kalau keluarga menolak menyapu, akunnya menumpuk. Itu **bukan bug** — app cukup
melaporkannya sebagai sisa yang belum punya tujuan (dan Phase 12 tetap berguna
sebagai jaring pengaman untuk kasus ini). Yang penting: app **tidak boleh**
mengklaim "neraca balance" ketika keluarga menolak sapu.

### 7.4 🔴 Temuan #9 — `ASSET_ALLOCATION` ditulis dengan `direction: 'INCOME'`

Ditemukan saat memverifikasi §7.2. Test yang mengunci perilaku ini menulis baris
aset sebagai **INCOME**:

```ts
// lib/__tests__/insight.test.ts:100
txn({ cycle_id: 'c-jan', direction: 'INCOME', flow_type: 'ASSET_ALLOCATION',
      actual_amount: 4_000_000, status: 'PAID' }),
```

Dan `insight.ts:282-284` hanya memakai `actual` tanpa memeriksa `direction`,
sehingga test itu lolos. **Untuk perhitungan per akun ini berbahaya:**
`ASSET_ALLOCATION` adalah **kas keluar** (uang meninggalkan akun), tetapi
`direction = 'INCOME'` membuatnya terbaca sebagai **kas masuk**.

Rumus akun di §4.1 (`keluar_akun = ... + asset allocation`) mengasumsikan arah
keluar. Kalau ada baris lama ber-`direction = 'INCOME'`, saldo akun akan
**bertambah** alih-alih berkurang — dan keluarga melihat akunnya tidak pernah
turun.

Perlu diputuskan: apakah `direction` untuk `ASSET_ALLOCATION` **dipaksa
`'EXPENSE'`** (dan test lama diperbaiki), atau perhitungan per akun mengabaikan
`direction` sepenuhnya dan membaca `flow_type` saja. Rekomendasi: **baca
`flow_type` saja** — konsisten dengan aturan anti-double-count Phase 1 bahwa
`flow_type` yang mengklasifikasi, bukan `direction`.

---

## 8. Urutan pengerjaan (diperbarui setelah §7)

| # | Langkah | Kenapa di sini |
| --- | --- | --- |
| 1 | **Perbaiki #2** — `allocation.tsx` kirim `accountId` | Bug yang sudah ada; tanpa ini tidak ada yang bisa dikerjakan |
| 2 | **Perbaiki #3** — default akun = akun primer, bukan `accounts[0]` | Murah; mencegah `D` palsu di Phase 12 |
| 3 | **Fungsi murni** `accountZeroBased()` + tes | Menegakkan temuan #1 di satu tempat |
| 4 | **`FlowType` `TRANSFER`** + `counter_account_id` + jalur tulis | Membuka relokasi antar akun |
| 5 | **Jalur tulis `ASSET_RELEASE`** ← **naik** (temuan #6) | Tanpa ini, sapuan jadi perangkap (§7.2) |
| 6 | **Jalur tulis `ASSET_ALLOCATION`** + putuskan arahnya (temuan #9) | Membuka topup investasi langsung |
| 7 | **Tabel `assets` + `asset_valuations`** + `transactions.asset_id` | Posisi aset yang bisa divaluasi |
| 8 | **Layar sapu siklus** + setting `sweep_policy` (`REQUIRED`/`OFFERED`) | Ritualnya; setting menentukan gate vs penawaran (§7.0) |
| 9 | **Hentikan `assetAdditions` sebagai "nilai"** | Menutup temuan #4 |

Langkah #1–#3 **bisa dikerjakan sekarang** dan sudah bernilai tanpa menunggu
keputusan lain — keduanya memperbaiki bug yang sudah ada.

### 8.1 Todolist lengkap (Phase 12 + Phase 13 + rilis)

**Tahap 0 — bisa jalan sekarang, tidak butuh keputusan apa pun** ✅ **SELESAI 2026-09-28**

| # | Aksi | Ukuran | Bukti | Hasil |
| --- | --- | --- | --- | --- |
| A1 | `allocation.tsx` kirim `accountId` ke `useCreateAllocation` | S | `allocation.tsx:98-105` vs `queries.ts:895` | ✅ picker akun + `accountId: selectedAccountId` |
| A2 | Default akun = akun primer, bukan `accounts[0]` | S | `seed.ts:36-41,65` + `010:154,188` | ✅ `sort_order` eksplisit + `defaultAccountId()` + migrasi 013 |
| A3 | Arah `ASSET_ALLOCATION`: baca `flow_type`, bukan `direction` | S | `insight.test.ts:100`, `insight.ts:283` | ✅ komentar aturan + tes 90b yang mengunci kedua arah |
| A4 | `['year-insight']` masuk `invalidateMoneyKeys` + handler realtime (temuan #13) | S | `queries.ts:776`, `126-133`, `realtime.ts` | ✅ + `['cycle-years']` (temuan baru, lihat §8.2) |
| A5 | `funding-gap.tsx:285` jangan pakai `current_installment` yang tak pernah naik (temuan #11) | S | `005:116`, `funding-gap.tsx:285` | ✅ `currentInstallmentNumber()` dari `remaining_amount` |

**Verifikasi Tahap 0:** `npm test` 226 lolos (dari 221 — 5 tes baru), `npx tsc
--noEmit` bersih, `npx eslint` bersih di semua file yang diubah. Sisa 9 masalah
lint proyek semuanya **pre-existing** di `app/(auth)/setup-choice.tsx` dan
`app/manage-accounts.tsx` (tidak disentuh).

### 8.2 Temuan sampingan saat mengerjakan Tahap 0

| # | Temuan | Kelas |
| --- | --- | --- |
| 15 | `useCycleYears` (`['cycle-years']`) juga tak pernah di-invalidate — pemilih tahun di `asset-insight.tsx:122` bisa tidak memuat tahun yang baru dipakai pasangan | Risiko |
| 16 | A5 hanya memperbaiki `funding-gap.tsx`; `loan-detail.tsx:266-267` dan `ObligationCard.tsx:101` masih menampilkan "0 dari N cicilan" dari `status` yang tak pernah `SETTLED` | Bug (ada sekarang) |

**#16 adalah ekor dari #10/#11** dan lebih besar dari A5: `installmentProgressLabel`
(`lib/obligation.ts:385`) dan `nextOpenInstallment` (`:408`) membaca
`obligation_installments.status`, yang **tidak pernah** berubah dari `'OPEN'`.
Perbaikan yang benar adalah jadikan status cicilan turunan dari pembayaran
(helper `currentInstallmentNumber` yang ditulis untuk A5 adalah pola yang sama).
Belum dikerjakan — di luar lingkup Tahap 0.

**Tahap 0.5 — parity skema lokal** ✅ **SELESAI 2026-09-28**

| # | Aksi | Bukti | Hasil |
| --- | --- | --- | --- |
| P0 | Pulihkan migration 012 Phase 12 di repo lokal | `supabase/migrations/012_phase12_reconciliation.sql` | ✅ akun primer BANK, snapshot rekonsiliasi, `UNTRACKED`, seed kategori household baru |
| P1 | Tambahkan migration 014 Phase 13 di repo lokal | `supabase/migrations/014_phase13_assets_transfers.sql` | ✅ `TRANSFER`, akun lawan, aset/valuasi, `sweep_policy` |
| P2 | Samakan kosakata klien dengan skema baru | `lib/zero-based.ts`, `lib/queries.ts`, `app/quick-add.tsx`, `app/manage-categories.tsx` | ✅ tipe `TRANSFER`, role `UNTRACKED`, picker trash disembunyikan |
| P3 | Samakan invalidasi Realtime untuk aset dan valuasi | `lib/realtime.ts`, `lib/queries.ts` | ✅ cache terkait aset/insight di-invalidasi |

**Catatan batas parity:** migration telah direview dan divalidasi secara tekstual, typecheck,
test, dan `git diff --check`. Supabase CLI tidak tersedia di environment ini, remote schema
tidak diintrospeksi, dan migration **tidak dijalankan ulang ke Supabase** karena user telah
menyatakan migration remote sudah dijalankan. Verifikasi SQL Editor tetap diperlukan sebelum
mengubah migration remote yang sudah ada.

**Tahap 1 — Phase 12 (rekonsiliasi tutup siklus)**

| # | Aksi | Tergantung |
| --- | --- | --- |
| B1 | Banner in-app H-7/H-3 + `daysUntilCycleEnd()` murni + tes | — |
| B2 | Kategori sistem `UNTRACKED` + pisahkan `isEligibleForPicker`/`isBudgeted` | — |
| B2b | Trigger `create_household` untuk kategori sistem (Phase 12 §12.2) | menyatu dengan B2 |
| B3 | Picker akun primer disaring `type='BANK'` + penegakan trigger | — |
| B4 | Migration 012: `primary_account_id`, `cycle_reconciliations` | B3 |
| B5 | Onboarding: pilih akun primer | B4 |
| B6 | Layar "Cek Saldo" + tutup siklus | B4 |
| B7 | Insight 2-dimensi (rasio trash + cakupan) | butuh 3–6 siklus data |
| B8 | Izinkan catat transaksi non-siklus (Phase 12 §12.1) | — |

**Tahap 2 — Phase 13 (zero-based per akun; status historis 2026-09-28, bukan todo aktif)**

| # | Aksi | Tergantung |
| --- | --- | --- |
| C1 | Fungsi murni `accountZeroBased()` + tes | A1, A2 |
| C2 | `FlowType TRANSFER` + `counter_account_id` + jalur tulis | — |
| C3 | **Jalur tulis `ASSET_RELEASE`** (jalur kritis, §7.2) | — |
| C4 | Jalur tulis `ASSET_ALLOCATION` | A3 |
| C5 | Tabel `assets` + `asset_valuations` + `transactions.asset_id` | — |
| C6 | Setting `sweep_policy` + layar sapu siklus | C2, C3, C5 |
| C7 | Hentikan `assetAdditions` sebagai "nilai" | C5 |

**Tahap 3 — ditunda sampai persiapan deploy**

| # | Aksi | Kenapa ditunda |
| --- | --- | --- |
| D1 | Push notif H-7/H-3 | butuh identitas paket + `eas.json` + dev build + Edge Function |
| D2 | Release hygiene: `bundleIdentifier`, `android.package`, `eas.json` | prasyarat keras D1; nama paket hanya boleh diputuskan sekali |

**De-duplikasi:** C3 = `repair-options-impact-effort.md` #1 ("Jalur tangkap Asset
Release"); D2 = #3. Jangan dikerjakan dua kali.

**Satu keputusan masih memblokir Tahap 2:** apakah saldo lama **ditandai**
sebagai posisi aset, atau **diabaikan** (§7.1.1). Kalau diabaikan, B4
(`cycle_reconciliations`) jadi prasyarat keras Tahap 2.

---

## 9. Hubungan dengan Phase 12

Phase 12 (`phase-12-rekonsiliasi-tutup-siklus.md`) tetap berlaku dan **tidak
digantikan**. Keduanya menjawab pertanyaan berbeda:

| | Phase 12 | Phase 13 |
| --- | --- | --- |
| Pertanyaan | "catatan cocok dengan bank?" | "ke mana sisa saldo pergi?" |
| Tingkat | akun primer | semua akun |
| Butuh | `O`, `C` | saldo tiap akun |

**Urutan yang benar: rekonsiliasi dulu, sapu belakangan.** Menyapu di atas angka
yang belum dicocokkan hanya memindahkan kesalahan ke akun lain.

Satu efek samping yang menyenangkan: kalau Phase 13 benar-benar membuat tiap
akun nol, maka `O = 0` untuk semua akun, dan masalah saldo awal yang Phase 12
§1 sibuk selesaikan **hilang dengan sendirinya**. Phase 12 tetap berguna sebagai
*jaring pengaman* ketika sapuan tidak dijalankan.

---

## 10. Kebutuhan perubahan design (pen.dev) — hasil audit 2026-09-28

Diperiksa langsung terhadap `../design/design.pen` (JSON schema v2.19, **15
top-level frame**, 966 string unik). Yang menjawab pertanyaan "apakah pen.dev
perlu menyesuaikan design?" adalah **apa yang sudah ada di design**, bukan apa
yang kita rencanakan.

### 10.1 Yang sudah benar di design — app yang ketinggalan, bukan design

| Konsep | Design sudah punya | App |
| --- | --- | --- |
| **Akun sumber alokasi** | Flow D: blok `AKUN SUMBER` · `Mandiri •• 8821` | ❌ A1 baru menambahkan (sekarang ✅) |
| **Tipe akun** | Flow J: `Rekening bank` / `Kartu kredit` / `E-wallet` | ✅ cocok `accounts.type` |
| **Strategi tutup gap** | Screen 7B: `Tambah Pendapatan` · `Pencairan Aset (Asset Release)` · `Pinjaman Baru` | ❌ kartu Asset Release masih `disabled` (= C3) |
| **Aset = kategori, bukan akun** | Flow J tak punya tipe "investasi"; kategori `Investasi` ada di Kelola Kategori | ✅ cocok `categories.type` |

**Kesimpulan penting:** untuk A1 dan C3, **design tidak perlu diubah** — app
yang harus menyusul. A1 sudah menyusul hari ini.

### 10.2 Yang belum ada di design sama sekali — butuh frame baru

Diverifikasi dengan pencarian string di seluruh 966 string: **nol kemunculan**
untuk `sapu`, `relokasi`, `topup`/`top-up`, `nilai pasar`, `valuasi`,
`fluktuat`.

| # | Yang hilang | Bukti di design | Frame yang dibutuhkan |
| --- | --- | --- | --- |
| **P1** | **Relokasi antar akun** (transfer) | `transfer` hanya muncul 4×, semuanya **Rekening Penerima** milik Flow K (bayar ke pihak luar), bukan pindah kantong sendiri | Layar "Pindah Dana" antar akun sendiri + pilihan akun asal/tujuan |
| **P2** | **Sapu akun tutup siklus** | Satu-satunya jejak: copy `Tutup cicilan & pindahkan sisa Rp 5.200 ke Tabungan Ryu bulan depan` — satu baris teks, bukan alur | Layar sapu (per akun, sisa → aset), dengan dua perlakuan sesuai `sweep_policy`: `REQUIRED` = gate, `OFFERED` = kartu penawaran |
| **P3** | **Valuasi aset (fluktuasi)** | `valuasi`/`nilai pasar` nol; `Trend Alokasi Aset Likuid` hanya punya `Per Bulan` / `Akumulasi` | Input nilai pasar per posisi + tampilan "disisihkan vs nilai sekarang" |

**P3 adalah yang paling berbahaya kalau dibiarkan.** Screen 2C menampilkan
`Saldo Akumulasi Saat Ini — Rp 112.045.985` dan `Kenaikan sejak Jan +Rp 24.500.000
(+28,0%)`. Angka itu **murni penjumlahan setoran** (`accumulateAssets()`), tapi
labelnya berkata "Saldo Saat Ini" dan "+28,0%" — persis klaim "nilai sekarang"
yang §5.2 dan `insight.ts:18` sudah bilang **tidak boleh** diklaim. Jadi P3
bukan fitur baru yang menempel; ia **memperbaiki klaim yang sudah salah di
design**, dan itu prioritas lebih tinggi dari kelihatannya.

### 10.3 Yang perlu diubah (bukan baru) di design

| # | Frame | Perubahan | Alasan |
| --- | --- | --- | --- |
| **M1** | Screen 7B — Funding Gap | Buka `disabled` pada kartu `Pencairan Aset` | C3; design sudah menggambar kartunya, app mematikan tombolnya |
| **M2** | Screen 12 — Setup Choice | Tambah langkah/varian **"pilih akun primer"** | B5; hari ini akun primer tak pernah dipilih di onboarding, padahal Phase 12 bergantung padanya |
| **M3** | Screen 2C — Insight & Aset | Pisahkan `Disisihkan` vs `Nilai Sekarang` di Trend Aset Likuid | P3; menutup klaim palsu |
| **M4** | Screen 7B — Funding Gap | `Cicilan ke-1 dari 5` → nomor dinamis | A5; **design sendiri menulis "ke-1" sebagai literal**, jadi copy-nya harus diperbaiki agar tidak mengunci angka mati |

**M4 catatan halus:** design literally says `Cicilan ke-1 dari 5`. Itu kemungkinan
besar contoh statis, bukan maksud mengunci "ke-1" — tapi karena design adalah
*source of truth* untuk copy, seorang implementator bisa membacanya sebagai
instruksi. A5 sudah menyimpang dari literal itu dengan benar; design perlu
disamakan supaya tidak ada yang "mengembalikannya".

### 10.4 Yang **tidak** perlu diubah

- **Alokasi (Flow D)** — sudah punya `AKUN SUMBER`. A1 menyusul, bukan design.
- **Quick Add** — sudah menulis `MASUK KE AKUN` untuk income dan `AKUN` untuk
  expense; itu sudah benar. Bug default-nya (CC) ada di kode, bukan design.
- **Kelola Akun (Flow J)** — tipe akunnya sudah tepat dan **sengaja** tidak punya
  "investasi", konsisten dengan §2.2.
- **Template Rutin (Flow D)** — `Primary • Mandiri •• 4421` sudah menyebut akun;
  tidak berubah karena zero-based per akun.

### 10.5 Urutan yang disarankan untuk pen.dev

1. **P3 + M3** (valuasi aset) — menutup klaim angka yang sudah salah hari ini.
2. **P1** (relokasi) — membuka `FlowType TRANSFER`, prasyarat P2.
3. **P2 + M1** (sapu + asset release) — ritualnya, butuh setting `sweep_policy`.
4. **M2** (akun primer di onboarding) — menyambung Phase 12 B5.
5. **M4** (copy cicilan) — sekali jalan, bisa kapan saja.

**Ringkasnya:** dari 15 frame yang ada, **1 butuh frame baru besar** (relokasi),
**1 butuh frame baru + konsep** (sapu), **1 butuh frame baru + koreksi klaim**
(valuasi), dan **3 butuh perubahan kecil** (Funding Gap ×2, Setup Choice,
Insight Aset). Sisanya tidak berubah — dan itu kabar baik: pivot Phase 13
**tidak** membatalkan design, ia menambal tiga lubang dan mengoreksi satu klaim.

### 10.6 Prompt pen.dev siap pakai

Prompt-nya sudah ditulis, dipecah **tiga pass** yang masing-masing berdiri
sendiri dan bisa direview sebelum lanjut:

📄 **`Family Spending/PEN_DEV_ZERO_BASED_PER_AKUN_PROMPT.md`**

| Pass | Frame | Butuh keputusan? |
| --- | --- | --- |
| **A** | M1–M2 valuasi aset + koreksi Screen 2C | Tidak — bisa jalan sekarang |
| **B** | L1 relokasi antar akun | Tidak |
| **C** | L2–L3 sapu + buka Screen 7B + Screen 12 | Tidak (§7.1.1 aman untuk keduanya) |

Prompt itu memuat **larangan keras** yang eksplisit — "akun investasi", "saldo
akun", "gain sebagai pemasukan" — karena ketiganya ditolak model produk dan
skema, tapi mudah dihasilkan ulang oleh model desain yang hanya melihat
tampilannya.

**Pemetaan frame → aksi app** ada di bagian akhir prompt itu, jadi setelah
design selesai tidak perlu menebak mana yang mengerjakan apa.
