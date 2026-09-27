# Brainstorm Opsi Perbaikan — Urut Dampak vs Usaha

Lanjutan dari [`design-parity-audit.md`](./design-parity-audit.md). Dokumen ini
mengambil §4 (temuan yang masih terbuka) dan §5 (yang sudah baik) sebagai bahan,
lalu menyusun opsi perbaikan yang **belum** dikerjakan — bukan mengulang Tier 1–3
yang sudah selesai.

> **Status per 2026-09-27.** Tier 1 (mock + `QueryError` + pintu masuk layar
> yatim) dan Tier 2 #5 (satu komponen proyeksi + `cycleReadiness`) **selesai**,
> berikut opsi **#2 (bersihkan default personal)** dari dokumen ini. Sisa daftar
> di bawah masih membuka. Lihat commit pada branch
> `fix/tier1-trust-and-tier2-gate`.

Skala: **Dampak** dan **Usaha** 1–5 (5 = paling besar). **Rasio** = dampak ÷ usaha;
makin tinggi makin layak dikerjakan lebih dulu.

---

## Ringkasan peringkat

| # | Opsi | Dampak | Usaha | Rasio | Kuadran |
| --- | --- | --- | --- | --- | --- |
| 1 | Jalur tangkap **Asset Release** (`flow_type: ASSET_RELEASE`) | 5 | 3 | 1.67 | A |
| 2 | ~~Bersihkan **default personal**~~ ✅ **selesai** | 3 | 2 | 1.50 | A |
| 3 | **Release hygiene**: `bundleIdentifier`, `android.package`, `eas.json`, CHANGELOG | 4 | 3 | 1.33 | A |
| 4 | **K3 — Ubah Data Tanggungan & Rekening** | 4 | 3 | 1.33 | A |
| 5 | **Screen 13 (join)** — 6 kotak digit, Tempel, QR, verifikasi otomatis | 5 | 4 | 1.25 | B |
| 6 | Panel **Alokasi** di `ObligationRow` (Total/Sudah/Sisa, chip cepat, KATEGORI, DAMPAK) | 3 | 3 | 1.00 | C |
| 7 | **Screen 12** — dua kartu besar, bukan segmented toggle | 3 | 3 | 1.00 | C |
| 8 | Satukan pola layar uang jadi satu pembungkus (`QueryError` sudah di 7 layar) | 3 | 3 | 1.00 | C |
| 9 | Baris **"Mode Rekonsiliasi Otomatis"** (Ruang Keluarga) & **"Bantuan"** (My Profile) | 2 | 2 | 1.00 | C |
| 10 | Copy Home `Jadwal terdekat · Tagihan Rumah` | 1 | 1 | 1.00 | C |
| 11 | Warning web `BrandIcon` (sudah sebagian dikerjakan) | 1 | 1 | 1.00 | C |
| 12 | Indeks dokumen + checklist paritas yang bisa dijalankan | 2 | 3 | 0.67 | D |

**A** = kerjakan sekarang · **B** = rencanakan · **C** = isi waktu luang ·
**D** = tunda.

---

## Kuadran A — dampak besar, usaha kecil–sedang

### 1. Jalur tangkap Asset Release (rasio 1.67)

**Masalah.** `ASSET_RELEASE` adalah salah satu dari enam `flow_type` di
`lib/zero-based.ts:14-20`, `sourceFunds.assetRelease` sudah dihitung di
`calculateSourceFunds`, dan Funding Gap punya kartu "Pencairan Aset (Asset
Release)". Tapi **tidak ada satu pun jalur yang bisa menuliskannya**:
`quick-add.tsx` selalu menulis `OPERATING_INCOME` untuk income apa pun. Karena itu
dua layar menampilkan kartu ini dalam keadaan `disabled`
(`funding-gap.tsx:337-342`) atau sebagai teks mati (`new-cycle.tsx:310`).

**Kenapa dampaknya besar.** Ini satu-satunya dari tiga strategi tutup funding gap
di design yang benar-benar hilang, dan ia menghalangi keluarga yang punya dana
darurat untuk membuka siklus tanpa berutang — persis kasus yang design-nya
dirancang untuk melayani. Selama ini keluarga dipaksa memilih "pinjam" padahal
"pakai tabungan sendiri" adalah jawaban yang benar.

**Kenapa usahanya sedang, bukan besar.** Domain-nya sudah ada di ujung kedua:
kolomnya ada, agregatornya ada, `ZeroBasedSummary.sourceFunds.assetRelease` sudah
memisahkannya dari operating income, dan tes `zero-based.test.ts` sudah mengunci
bahwa asset release masuk source tapi bukan income. Yang belum ada hanya
pemilih `flow_type` di Quick Add (± 1 layar) dan rute dari kartu strategi.
Tidak ada migrasi baru.

**Bentuk termurah:** tambahkan `flowType` eksplisit ke `QuickAddInput` (saat ini
di-derive dari `direction`), jadikan chip "Pencairan Aset" sebagai pilihan ketiga
di kartu strategi, dan buka `disabled` di `funding-gap.tsx`.

### 2. Bersihkan default personal (rasio 1.50) — ✅ SELESAI

> **Sudah dikerjakan.** `cycleWindowFrom(paydayDay, todayISO)` ada di
> `lib/profile.ts` dengan 7 tes (`profile.test.ts` #50–56); `lib/seed.ts`,
> `app/new-cycle.tsx`, dan `app/(auth)/setup-choice.tsx` semuanya menurunkan
> tanggal dari situ; nama keluarga mulai kosong dengan placeholder netral; kolom
> gaji tidak lagi terisi `15844000`. Teks di bawah adalah analisis aslinya.

**Masalah.** `lib/seed.ts:57-63` membuat siklus bernama `'Siklus Okt 2026'`
dengan tanggal mati `2026-09-25`–`2026-10-24`; `new-cycle.tsx:36-39`
menginisialisasi form dengan `'Siklus Nov 2026'`, `2026-10-25`, `2026-11-24`, dan
gaji `15844000`; `setup-choice.tsx:16` dan `household.tsx:189` memakai
`'Keluarga Andra'`.

**Kenapa dampaknya sedang-besar.** Ini bukan sekadar polish: keluarga yang baru
mendaftar hari ini langsung melihat siklus yang **sudah lewat** dan menampilkan
"Rp 15.844.000" sebagai gaji mereka. Untuk aplikasi yang seluruh nilainya
bergantung pada angka yang bisa dipercaya, itu kesan pertama yang salah — dan
`household.payday_day` (migration 007) sudah ada untuk menghitungnya dengan benar.

**Kenapa usahanya kecil.** Semua bahannya sudah ada: `payday_day` di
`lib/household.ts`, `MONTHS_ID` dan `cycleRangeLabel` di `lib/*`, dan
`new-cycle.tsx` sudah menerima `household` dari `useAuth()`. Yang perlu ditulis
hanya satu fungsi murni `cycleWindowFrom(paydayDay, todayISO)` di `lib/profile.ts`
plus tesnya, lalu tiga pemanggil mengganti literal.

**Catatan:** `seed.ts` tidak punya akses ke `payday_day` saat seeding (baru dibuat
setelahnya), jadi fallback-nya "tanggal 25" tetap wajar — yang penting bukan
angka mati bertahun 2026.

### 3. Release hygiene (rasio 1.33)

**Masalah.** `app.json` belum punya `ios.bundleIdentifier` maupun
`android.package`; tidak ada `eas.json`; `package.json` masih `1.0.0` tanpa
CHANGELOG. README sudah diperbaiki di Tier 1 (daftar tab + klaim email OTP),
tapi sisa ini belum.

**Kenapa dampaknya besar untuk usaha sekecil ini.** Tanpa keduanya, build gagal di
EAS pada langkah pertama, dan bundle id harus unik per profil — makin lama
ditunda, makin mahal diganti (nomor versi di store tidak bisa dipakai ulang).

**Catatan urutan:** identitas aplikasi hanya boleh diputuskan **sekali** oleh
pemilik produk (nama paket). Ini satu-satunya opsi di kuadran A yang butuh
keputusan manusia, bukan keputusan teknis.

### 4. K3 — Ubah Data Tanggungan & Rekening (rasio 1.33)

**Masalah.** Flow K3 adalah satu-satunya jalur edit di seluruh design yang belum
ada. `useUpdateBeneficiary()` **sudah ditulis** dan belum dipakai; `useUpdateObligation()`
belum ada. Akibatnya salah ketik nominal pinjaman atau nama bank hanya bisa
diperbaiki dengan menghapus dan mencatat ulang.

**Kenapa usahanya sedang.** Separuhnya sudah jadi (mutation beneficiary, form
`ObligationFormSheet` sudah ada sebagai basis), dan `loan-detail.tsx` sudah punya
tempat yang jelas untuk menaruh tombolnya.

---

## Kuadran B — dampak besar, usaha besar

### 5. Screen 13 — alur join (rasio 1.25)

**Masalah.** Design-nya: 6 kotak digit, tombol "Tempel", scan QR, status
"6/6 digit • Memverifikasi otomatis…", kartu TERVERIFIKASI, dan subteks consent.
Implementasi sekarang cuma satu `TextInput` teks bebas dengan debounce 500 ms.

**Kenapa dampaknya paling besar dari semua opsi.** Ini satu-satunya journey yang
menentukan apakah pasangan **pernah** masuk ke aplikasi. Seluruh model produknya
"suami istri, satu data" — kalau langkah join gagal atau terasa ragu, aplikasinya
berhenti jadi aplikasi keluarga dan jadi buku catatan pribadi. Ini juga satu-satunya
tempat di mana input manual 8 karakter bisa salah ketik tanpa cara memeriksanya.

**Kenapa usahanya besar.** Perlu komponen OTP baru, izin kamera untuk QR (izin
platform, bukan kode), dan state verifikasi yang benar-benar memanggil
`previewHouseholdByCode`. Tapi separuhnya sudah ada: `previewHouseholdByCode()`
sudah bekerja dan sudah menampilkan kartu preview hijau — tinggal diangkat jadi
state "TERVERIFIKASI" yang design minta.

**Saran:** pecah jadi dua langkah. Langkah 1 (usaha kecil, dampak sebagian besar):
6 kotak digit + "Tempel" + kartu TERVERIFIKASI + subteks consent, tanpa QR.
Langkah 2: QR scanner. QR hanya *mempercepat* isian yang sudah punya jalur.

---

## Kuadran C — isi waktu luang (dampak kecil–sedang, usaha kecil–sedang)

### 6. Panel Alokasi di `ObligationRow` (rasio 1.00)

Breakdown Total / Sudah / Sisa, chip cepat nominal (`Lunas • 500rb`), blok
`KATEGORI`, dan `DAMPAK KE ANGGARAN`. `obligations.tsx` sudah punya
`cycleQ.data?.id` yang dilewatkan ke setiap baris — jadi data untuk "dampak ke
anggaran" sudah tersedia di tempat; yang belum hanya tampilannya.

**Turunkan prioritasnya** karena Flow K1/K2 sudah membuat pencatatan bekerja:
alokasi tetap bisa dilakukan, hanya lewat layar penuh (`allocation.tsx`).

### 7. Screen 12 — dua kartu besar (rasio 1.00)

Ganti segmented toggle jadi dua kartu dengan sublabel "Untuk inisiator" /
"Untuk pasangan" dan badge "Disarankan untuk inisiator". Usaha kecil, dampak
sedang: mengarahkan peran sebelum user memilih mengurangi salah-pilih mode yang
mahal untuk dibatalkan (satu rumah tangga per akun).

### 8. Satukan pola layar uang (rasio 1.00)

Sekarang `<QueryError>` dipasang tangan di 7 layar dengan pola yang sama:
`{q.isError && householdId && <QueryError onRetry={...} />}` lalu empty-state
diberi pagar `!q.isError`. Itu tiga baris yang bisa lupa ditulis di layar
kedelapan. Satu helper (`useMoneyQueries([...])` yang mengembalikan
`{isError, refetchAll, retrying}`) akan mengunci polanya.

**Usaha naik sedikit** karena menyentuh 7 layar sekaligus — kerjakan saat ada
layar uang baru, bukan sebagai refactor tersendiri.

### 9–11. Polish (rasio 1.00, usaha 1)

- Baris **"Mode Rekonsiliasi Otomatis"** di Ruang Keluarga dan **"Bantuan"** di
  My Profile — dua baris statis dari design yang belum ada.
- Copy Home `Jadwal terdekat · Tagihan Rumah` (§4.5); sekarang tertulis
  `Terdekat · {nama}` tanpa kata "Jadwal" dan tanpa jenis tagihan.
- Warning web `BrandIcon` — `label=""` sudah tidak lagi menyebar
  `accessible: false` ke `<Svg>`; sisanya tinggal memastikan tidak ada pemanggil
  yang lolos lewat cabang `Image`.

---

## Kuadran D — jangan dikerjakan

### 12. Indeks dokumen + checklist paritas yang bisa dijalankan (rasio 0.67)

Menambah `docs/README.md` dan skrip paritas otomatis terasa rapi, tapi audit ini
sendiri menunjukkan masalahnya: checklist berbasis nomor baris **selalu basi**
(dokumen ini pun butuh blok caveat "nomor baris bisa bergeser"). Nilai
sebenarnya lahir dari mengerjakan opsinya, bukan dari menambah dokumen tentang
opsi itu. Pertahankan dua dokumen audit yang sudah ada, jangan tambah lapisan
ketiga.

---

## Dua hal yang **tidak** perlu diperbaiki

Dari §5, dua penyimpangan ini disengaja dan menguntungkan — jangan "diperbaiki"
untuk mengejar paritas visual:

1. **Bucket "Belum dieksekusi" di Riwayat.** Design tidak punya bucket ini, tapi
   baris PENDING yang diparkir di "Hari Ini" akan berbohong tentang tanggal
   terjadinya. Komentar `history.tsx:150-157` sudah mencatat alasannya.
2. **Kategori income tambahan di `seed.ts` (`Bonus`, `Side Hustle`).** Grid
   income di Quick Add akan kosong tanpa ini.

---

## Urutan yang disarankan

1. **Bersihkan default personal** (#2) — prasyarat kepercayaan, usaha paling kecil.
2. **Release hygiene** (#3) — setelah pemilik memutuskan nama paket.
3. **Asset Release** (#1) — menutup lubang domain terakhir yang belum punya jalur.
4. **K3** (#4) — melengkapi jalur edit Flow K.
5. **Screen 13 langkah 1** (#5, tanpa QR) — menyambung journey yang menentukan.
6. Sisanya (#6–#11) mengikuti waktu yang tersisa.
