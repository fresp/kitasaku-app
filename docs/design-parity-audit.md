# Audit Paritas Design — UI / Flow / Journey

Sumber kebenaran: `../design/design.pen` (di luar repo ini — README sudah benar
menyebutnya `../design/design.pen`; file ini **tidak** ada di
`kitasaku-app/design/`).

Metode: pembacaan `design.pen` (JSON schema v2.19, 15 frame top-level) terhadap
source `app/`, `components/`, `lib/`. Audit ini **read-only** — tidak ada file
kode yang diubah. Semua rujukan baris di bawah diverifikasi saat audit
(2026-09-27).

Cakupan frame design: Foundations, Flow A–K, Asset Library, dan
`Screen 2 — Onboarding, Category Setup & Financial Insight`.

> **Catatan penulisan.** Repo ini sempat disentuh sesi lain (`88cb0b7`, `6347858`
> — account management + beneficiaries/Flow K; `cbe9031` — Slice 3–7 Flow B).
> Audit ini ditulis setelah semua itu mendarat dan working tree hanya berisi file
> audit ini, jadi temuan di bawah mengacu pada `HEAD` `cbe9031`.
>
> ⚠️ **Nomor baris bisa bergeser.** Sesi paralel yang menyelesaikan Slice 3–7
> Flow B mengubah `app/(tabs)/obligations.tsx`, `components/ui/ObligationCard.tsx`,
> `lib/obligation.ts`, `lib/seed.ts`, dan `app/quick-add.tsx` **setelah** draf
> pertama audit ini, lalu commit `cbe9031`. Nomor baris di bawah valid pada
> verifikasi akhir (2026-09-27) tetapi **verifikasi ulang dengan grep** sebelum
> mengandalkannya; semua klaim penting disertai kutipan teks atau path, bukan
> hanya nomor baris.
>
> **Rekonsiliasi.** Slice 3–7 Flow B sudah mendarat saat audit ini selesai, jadi
> temuan yang bersinggungan dengannya sudah ditandai ✅ di tabel §2 dan §6–§7.
> Daftar temuan yang **benar-benar masih terbuka**: §1 #1 (mock bocor),
> #2 (Template Rutin masih yatim), #3 (`isError` = 0), #4 (aritmetika Buka
> Siklus), #5 (join Screen 13), #6 (Flow K3), ditambah panel Alokasi (§7.12),
> copy Home (§4.5), baris menyesatkan `new-cycle.tsx:253` (§3.3), dan release
> hygiene (§4.7).
>
> Audit Flow B (Quick Add / Tanggungan / Budget Health) sudah punya dokumen
> sendiri: `docs/flow-b-quickadd-audit.md`. Dokumen ini tidak mengulang
> detailnya, hanya merangkum statusnya di §6.

---

## 1. Ringkasan eksekutif

| # | Temuan | Severity | Dampak |
| --- | --- | --- | --- |
| 1 | Data mock bocor ke user nyata (Home & Konfirmasi Pembayaran) | 🔴 Kritis | Angka/transaksi palsu tampil sebagai data keluarga. Lubang kepercayaan terbesar di app uang. |
| 2 | `/templates` tidak punya pintu masuk | 🟠 Tinggi | Template Rutin lengkap tapi tak terjangkau; `funding-gap.tsx:224` menunjuk fitur yang tak ada. (Budget Health **sudah** diperbaiki — §3.1.) |
| 3 | Nol penanganan error (`isError` = 0 di `app/` + `components/`) | 🔴 Kritis | Query gagal → layar kosong tanpa penjelasan; "kosong" terbaca "data hilang". |
| 4 | Aritmetika Buka Siklus tidak konsisten antar layar | 🟠 Tinggi | `new-cycle.tsx` melewatkan 2 baris proyeksi yang ada di design & di `funding-gap.tsx`; gate `canOpen` bisa beda. |
| 5 | Alur Gabung Keluarga jauh dari Screen 13 | 🔴 Kritis | 1 `TextInput` vs 6 kotak digit + QR + auto-verify + consent. |
| 6 | Tidak ada jalur edit tanggungan/beneficiary (Flow K3) | 🟠 Tinggi | `useUpdateBeneficiary()` ada tapi tak dipakai; K3 "Ubah Data Tanggungan & Rekening" tak terimplementasi. |

---

## 2. Peta paritas per layar

Severity: 🔴 Kritis · 🟠 Tinggi · 🟡 Sedang · ⚪ Rendah

| Design frame | Implementasi | Status | Severity |
| --- | --- | --- | --- |
| `y4yNUL` Screen 1 Home | `app/(tabs)/index.tsx` | Struktur cocok; copy beda; mock bocor | 🟠 |
| `wOUgb` Screen 2 Konfirmasi Sheet | `app/payment-confirm.tsx` | Tanggal terkunci ke hari ini & link "Hari ini" (`:143`) bukan `Pressable`; copy CTA; mock bocor | 🟠 |
| `F0gyAy` Konfirmasi Pembayaran Pinjaman | `app/payment-confirm.tsx` | Varian pinjaman hanya dibedakan badge "Dari pool tanggungan" (`:132`) — tanpa rincian pokok/bunga/preview lunas | 🟡 |
| `C4wuWy` Flow A Catat Pemasukan/Pinjaman | `app/quick-add.tsx` (mode loan) | "Cara pembayaran" (`REPAYMENT_MODES`) & "Yang akan dibuat" **sudah ada** (§6) | ⚪ |
| `U4FWZM` Screen 3 Tanggungan | `app/(tabs)/obligations.tsx` + `components/ui/ObligationCard.tsx` | Cocok: baris Rencana/Tempo/Bunga & warna tab Pinjaman **sudah ada** | ⚪ |
| `xdPDT` Detail Pinjaman | `app/loan-detail.tsx` | **Paling dekat** — hampir paritas penuh | ⚪ |
| `QNDJk` Screen 4 Quick Add (loan) | `app/quick-add.tsx` | "YANG AKAN DIBUAT (LINKED LIABILITY)" + validasi **sudah ada** (§6) | ⚪ |
| `eixEN` Screen 4B Quick Add (income) | `app/quick-add.tsx` | "YANG AKAN DIBUAT (LINKED EFFECT)" + explainer **sudah ada** (§6) | ⚪ |
| `oyTdC` Screen 5 Budget Health | `app/budget-health.tsx` | Isi cocok; pintu masuk dari Tanggungan **sudah ada** (§3.1) | ⚪ |
| `tA5DP` Screen 6 Riwayat | `app/(tabs)/history.tsx` | Cocok (+ bucket "Belum dieksekusi"; deviasi wajar) | ⚪ |
| `dgfIw` Screen 7 Buka Siklus | `app/new-cycle.tsx` | Proyeksi kurang 2 baris kunci; tanpa "31 hari" | 🟠 |
| `x1EGg3` Screen 7B Funding Gap | `app/funding-gap.tsx` | Proyeksi lengkap, tapi route terpisah | 🟡 |
| `lobTa` Screen 8 Alokasi Modal | panel `allocate` di `components/ui/ObligationRow.tsx` | Kurang breakdown Total/Sudah/Sisa, chip cepat, KATEGORI, DAMPAK | 🟡 |
| `L2Stc4` Screen 9 Template Rutin | `app/templates.tsx` | Isi cocok, **tak terjangkau** (masih) | 🟠 |
| `IHHkd` Screen 10 Detail Kategori | `app/category-detail.tsx` | Cocok (ada "Ubah pagu") | ⚪ |
| Flow F / `GZA4A` Sign In Welcome | `app/(auth)/sign-in.tsx` | Paritas (Google-only) | ⚪ |
| `EJTZQ` Screen 12 Setup Choice | `app/(auth)/setup-choice.tsx` | Design = 2 kartu pilihan besar; impl = segmented toggle | 🟠 |
| `xz0DY` Screen 13 Gabung Keluarga | `app/(auth)/setup-choice.tsx` (mode join) | Jauh: 1 input vs 6 kotak + QR + auto-verify | 🔴 |
| `Cu48Q` Screen 14 Ruang Keluarga | `app/household.tsx` | Kurang "Mode Rekonsiliasi Otomatis" | 🟡 |
| `wZrbc` My Profile | `app/(tabs)/profile.tsx` | Kurang baris "Bantuan" | 🟡 |
| `L8zHp` Kelola Kategori | `app/manage-categories.tsx` | Cocok | ⚪ |
| `jFLWe` 2B Tambah Kategori/Pilih Ikon | `app/manage-categories.tsx` | Cocok (ada "Pilih ikon") | ⚪ |
| `iZf7x` 2C Insight & Aset 2026 | `app/asset-insight.tsx` (1195 baris) | Sangat lengkap | ⚪ |
| `Z3M5B` 2A Splash | `components/ui/AppSplash.tsx` | Cocok | ⚪ |
| Flow J Managed Account (`TsR55`, `Ue1H8`, `c3lBqM`) | `app/manage-accounts.tsx` (1412 baris) | Ada (di luar Flow A–F) | ⚪ |
| Flow K K1 `vqQh2` / K2 `Rz5yN` | `components/obligations/ObligationFormSheet.tsx`, `BeneficiaryPickerSheet.tsx` | Ada | ⚪ |
| Flow K K3 `vHI29` | — | **Tidak ada jalur edit** "Ubah Data Tanggungan & Rekening" | 🟠 |
| Onboarding (Asset Library 01/02/03) | `app/(auth)/welcome.tsx` | Cocok; design tak punya screen perakitnya (didokumentasikan di file) | ⚪ |

---

## 3. Temuan journey / flow

### 3.1 Dead-end navigasi

- **Budget Health — SUDAH DIPERBAIKI.** `app/(tabs)/obligations.tsx:76-83` kini
  menaruh tombol ikon (lucide `gauge`) di Top Bar Screen 3 yang
  `router.push('/budget-health')`. Ini menutup temuan lama. Catatan: design
  `U4FWZM` hanya punya Title + "+ Tambah", jadi tombol ini adalah **tambahan
  yang disengaja** di luar design (alasan ada di komentar `:71-75`).
- **Template Rutin — MASIH YATIM.** `grep` atas seluruh `app/` + `components/`
  membuktikan **tidak ada satu pun** `router.push('/templates')`.
  `app/templates.tsx` (447 baris) hanya muncul di `app/_layout.tsx:86` sebagai
  registrasi `Stack.Screen`. Layar lengkap, tanpa pintu masuk.
- `app/funding-gap.tsx:224` menyuruh user menuju **"Riwayat → Template Rutin"**
  saat tak ada pos rutin. Riwayat (`app/(tabs)/history.tsx:203`) tidak punya
  tautan ke Template Rutin — pill siklusnya malah menuju `/new-cycle`. Ini
  pointer mati ke fitur yang juga tak punya pintu masuk.
- `app/budget-health.tsx:101` menulis breadcrumb "Tanggungan / Budget Health" —
  sekarang konsisten dengan tombol baru di Tanggungan.

### 3.2 Satu screen design, dua route di app

Design menaruh Buka Siklus **dan** Funding Gap sebagai dua state dari Screen 7
(`dgfIw` = state "Allocation complete", `x1EGg3` = state "Funding Gap").
Implementasi memecahnya jadi `/new-cycle` + `/funding-gap` dengan CTA bolak-balik
(`funding-gap.tsx:356` → `router.replace('/new-cycle')`).

Pemecahan ini bukan kesalahan arsitektur — tapi ia adalah **akar** dari
inkonsistensi aritmetika di §4.1: dua layar menghitung proyeksi dengan rumus
yang berbeda.

### 3.3 Jalur "Pencairan Aset" putus

`ASSET_RELEASE` ada di `FlowType`, dibaca Home & `asset-insight`, tapi tak ada
UI yang bisa menghasilkannya: `quick-add.tsx` hanya mengenal `out`/`in`/`loan`,
dan `in` selalu menulis `OPERATING_INCOME`. `funding-gap.tsx:340-342` sudah
jujur menandai strategi ini `disabled` dengan catatan "Belum tersedia — catat
lewat penyesuaian saldo akun". Fiturnya tetap kosong, tapi minimal tidak
menyesatkan. (Keputusan "ditunda" sudah dicatat di `flow-b-quickadd-audit.md` §6.)

Sisa satu salinan yang **masih menyesatkan**: `app/new-cycle.tsx:253-254` menulis
"Pencairan Aset (Asset Release) — catat lewat Quick Add" dan "Pinjaman Baru
(Financing Inflow) — catat lewat Quick Add". Baris pertama itu salah — Quick Add
tidak bisa menghasilkan `ASSET_RELEASE` sama sekali, jadi ini mengarahkan user
ke form yang akan mencatat flow type yang keliru. Baris kedua benar.

### 3.4 Flow K3 — jalur edit hilang

- `useUpdateBeneficiary()` ada di `lib/queries.ts:1690` tapi **tidak
  direferensikan di mana pun** (grep atas `app/`, `components/`, `lib/` →
  hanya definisinya).
- Tidak ada `useUpdateObligation` sama sekali.
- Design K3 `vHI29` menutup dengan dua aksi: "Catat Pembayaran" (ada) dan
  **"Ubah Data Tanggungan & Rekening"** (tidak ada). `loan-detail.tsx` hanya
  bisa mengubah *mode* pembayaran (`set_obligation_repayment_mode`), bukan data
  tanggungan atau rekening tujuannya.

### 3.5 Alur join (Screen 13)

Design `xz0DY`:

```
LANGKAH 2 DARI 2 • VERIFIKASI KODE
Minta kode 6-digit ke admin keluarga. Kode kedaluwarsa dalam 23:41.
KODE UNDANGAN   [A][N][D][7][8][2]   Tempel
6/6 digit • Memverifikasi otomatis...
Pindai QR Keluarga
[TERVERIFIKASI]  Keluarga Andra
                 Dibuat oleh Andra • 14 pos aktif
Bergabung sebagai: Pasangan
Data 23 tanggungan & anggaran ikut tersinkron otomatis setelah bergabung.
Gabung & Sinkronkan Data
Dengan bergabung kamu menyetujui aturan keluarga
```

Implementasi `app/(auth)/setup-choice.tsx`:

- Satu `TextInput` bebas (`:116`), bukan 6 kotak digit; tanpa tombol "Tempel".
- Tanpa scan QR (QR baru ada di sisi *pemberi* kode, `app/household.tsx:248`).
- Preview (`:125-134`) hanya "✓ {nama}" + "{n} anggota" — bukan kartu
  TERVERIFIKASI dengan "Dibuat oleh" / "14 pos aktif" / "Bergabung sebagai".
- Tanpa subtext consent.
- Hint format salah: `:115` menulis "KODE UNDANGAN (mis. KEL-782)" dan
  placeholder `KEL-782`, padahal `lib/household.ts:23-31` menghasilkan
  `{3 huruf}-{3 digit}` dari nama household — untuk "Keluarga Andra" hasilnya
  `KEL-782`-shaped, tapi untuk nama lain formatnya ikut berubah (mis. "Rumah
  Kita" → `RUM-…`). Hint memaku satu contoh yang tidak universal. Bandingkan
  design yang memakai `AND-782` dan `AND-782`-style 6-karakter.
- Gate panjang kode `>= 5` (`:26`, `:58`, `:135`) vs design "6/6 digit".

---

## 4. Temuan data & kualitas

### 4.1 Aritmetika zero-based tidak konsisten (🟠)

`app/new-cycle.tsx:237-259` merender proyeksi:

```
+ Pemasukan gajian
+ Pos pemasukan rutin
− Pengeluaran rutin
− Pembayaran kewajiban (n)
= Funding Gap  /  = Dana belum dialokasikan
```

Design (`dgfIw` & `x1EGg3`) **dan** `app/funding-gap.tsx:279-295` merender:

```
Total Sumber Dana (Income Operasional)
+ Financing Inflow / Asset Release
− Pengeluaran rutin (n pos)
− Pembayaran kewajiban (n)
− Alokasi Tabungan & Aset Likuid (n)      <-- hilang di new-cycle
= Dana Belum Dialokasikan / = Funding Gap
```

Dua baris yang hilang di `new-cycle.tsx` adalah baris yang justru **menentukan**
apakah sebuah siklus punya gap. Akibatnya `canOpen = fundingGap === 0`
(`new-cycle.tsx:91`) dihitung dari basis yang berbeda dari `canOpen` di
`funding-gap.tsx:73`. Untuk keluarga dengan alokasi tabungan/aset, gate di
Buka Siklus bisa meloloskan siklus yang sesungguhnya masih gap — dan sebaliknya.

Catatan pendukung: `new-cycle.tsx` juga tidak menampilkan "31 hari" atau
"terkonfirmasi" yang ada di design, dan tidak memuat kartu "Allocation complete
· All funds have been assigned" (design `dgfIw`).

### 4.2 Mock data bocor ke user nyata (🔴)

`app/(tabs)/index.tsx`:

| Baris | Isi |
| --- | --- |
| `:9` | `import { activeCycle as mockCycle, pendingTransactions } from '../../lib/mockData'` |
| `:87` | `(live ? txns.map(toRow).slice(0, 4) : pendingTransactions.slice(0, 4))` |
| `:91` | `cycleName = live ? … : mockCycle.name` |
| `:95-97` | `unpaidCount` / `pendingCount` / `paidCount` fallback ke mock |
| `:98-99` | `income = 15_844_000`, `expense = 9_810_000` |
| `:100-101` | `actualCash` / `projectedRemaining` dari `mockCycle` |
| `:108` | `displayName = membership?.display_name?.trim() \|\| 'Andra'` |

`app/payment-confirm.tsx`:

| Baris | Isi |
| --- | --- |
| `:7` | `import { pendingTransactions } from '../lib/mockData'` |
| `:36` | `const mock = pendingTransactions.find((t) => t.id === id) ?? pendingTransactions[1]` |
| `:38-41` | `name` / `category` / `accountName` / `planned` fallback ke mock |
| `:45` | `payable = !liveTxn \|\| canMarkAsPaid(liveTxn)` — tanpa `liveTxn` dianggap payable |
| `:129-130` | Badge `"Bulan lalu"` hanya muncul saat `!liveTxn` (yakni **hanya** untuk mock) |

`live` di Home = `!!householdId && !!cycleId && !!txnsQ.data` (`:72`). Jadi
fallback justru aktif pada kondisi yang **nyata dan umum**: user sudah punya
household tapi siklus belum dibuka / query belum selesai. Saat itu, Home
menampilkan "Rp 15.844.000" dan empat transaksi fiktif sebagai milik keluarga.

### 4.3 Nol penanganan error (🔴)

`grep -rn "isError" app components` → **0 kemunculan**. Setiap layar hanya
menangani `isLoading` + empty-state. Konsekuensi: kegagalan jaringan / RLS /
RPC memunculkan empty-state yang berbunyi "Belum ada transaksi di siklus ini" —
pernyataan yang salah dan menenangkan, padahal datanya ada di server.

### 4.4 Default personal ter-hardcode (⚪ risiko sedang)

| Lokasi | Nilai |
| --- | --- |
| `lib/seed.ts:59-61` | `'Siklus Okt 2026'`, `2026-09-25` – `2026-10-24` |
| `app/new-cycle.tsx:34-36` | `'Siklus Nov 2026'`, `2026-10-25` / `2026-11-24` |
| `app/new-cycle.tsx:37` | `incomeText = '15844000'` |
| `app/(auth)/setup-choice.tsx:16` | `'Keluarga Andra'` |
| `app/(auth)/setup-choice.tsx:110` | "Siklus Okt 2026 + kategori & akun standar otomatis dibuatkan." |
| `app/(tabs)/profile.tsx:194` | placeholder `"Andra"` |
| `app/household.tsx:189` | placeholder `"Keluarga Andra"` |

Untuk demo internal ini masuk akal; untuk rilis, user baru langsung melihat
nama & angka orang lain.

### 4.5 Copy Home yang menyimpang dari design (🟡)

| Design (`y4yNUL`) | Implementasi (`app/(tabs)/index.tsx`) |
| --- | --- |
| "2 tagihan belum dibayar" | `:217` `{unpaidCount} transaksi belum dibayar` — design bilang "tagihan", impl bilang "transaksi" (dan menghitung expense saja) |
| "Jadwal terdekat · Tagihan Rumah" | `:219` "Terdekat · {nama}" — tanpa kata "Jadwal" dan tanpa jenis |

Perlu dicatat: komentar `:92-94` **sengaja** membedakan `unpaidCount`
(expense saja) dari `pendingCount`, dan itu keputusan yang benar — tapi
labelnya jadi melenceng dari design. Perbaikan paling murah: pakai kata
"tagihan" saat yang dihitung memang tagihan.

### 4.6 Warning console web (⚪)

`components/ui/BrandIcon.tsx:38-43` menyusun props a11y termasuk
`{ accessible: false }` lalu menyebarnya ke `<Svg>`. Di web, React
memperingatkan `Received 'false' for a non-boolean attribute 'accessible'`.

### 4.7 Release hygiene (⚪)

- `app.json` tidak punya `ios.bundleIdentifier` maupun `android.package`.
- Tidak ada `eas.json`.
- `package.json` `"version": "1.0.0"`, tanpa CHANGELOG / tag.
- `README.md:19` menyebut tab `index (Budget), obligations, categories, history`
  — aslinya `index, obligations, history, profile`.
- `README.md:37-38` mengklaim "email OTP" — implementasi & design Google-only.

---

## 5. Yang sudah baik (jangan diutak-atik)

- **Detail Pinjaman** (`xdPDT` → `app/loan-detail.tsx`) — paritas tinggi,
  termasuk "Diterima … • Dana masuk ke …", kartu RINGKASAN KEWAJIBAN,
  Mode Pembayaran dengan penanda `derived`, dan riwayat pembayaran.
- **Insight & Aset 2026** (`iZf7x` → `app/asset-insight.tsx`) — 1195 baris,
  mencakup seluruh tujuh seksi design.
- **Riwayat** (`tA5DP` → `app/(tabs)/history.tsx`) — cocok; tambahan bucket
  "Belum dieksekusi" adalah deviasi yang dibenarkan (lihat komentar `:150-157`).
- **Kelola Kategori + 2B** — grid ikon & kategori sistem (`Pengeluaran` /
  `Sistem · Tidak dapat dihapus`) sesuai design. `lib/seed.ts` juga sudah
  menambah kategori `INCOME` (`Bonus`, `Side Hustle`) selain `Gaji & Pemasukan`,
  sehingga grid income di Quick Add tidak kosong.
- **Kartu Tanggungan** (`U4FWZM` → `components/ui/ObligationCard.tsx`) — baris
  `Rencana / Jatuh tempo / Bunga` untuk pinjaman, badge bank Flow K, dan warna
  chip Pinjaman sudah selaras design.
- **Sign In (Flow F)** — Google-only, value props, footer enkripsi: paritas.
- **2A Splash** — cocok.
- **Flow J** (managed account) & **Flow K K1/K2** (form tanggungan + beneficiary
  picker + badge bank) sudah ada, di luar Flow A–F.
- `constants/theme.ts` byte-identik dengan blok `variables` di `.pen`.
- Punya dokumentasi internal yang baik: `docs/release-readiness-audit.md`,
  `docs/flow-b-quickadd-audit.md`.

---

## 6. Status workflow yang sudah dikerjakan

`docs/flow-b-quickadd-audit.md` §5 kini mencatat **ketujuh slice selesai**.
Verifikasi ulang di audit ini (`grep` atas source terkini) mengonfirmasi:

- ✅ Slice 1 — `quick-add.tsx:42` membaca `useLocalSearchParams<{ kind }>()`
  dan me-resync saat render.
- ✅ Slice 2 — grid kategori difilter per arah; label
  "KATEGORI INCOME OPERASIONAL" (`quick-add.tsx:340`).
- ✅ Slice 3 — kartu "YANG AKAN DIBUAT" lewat
  `components/quick-add/LinkedEffectCard.tsx` (dipakai `quick-add.tsx:327`
  untuk loan, `:414` untuk income); `REPAYMENT_MODES` menggantikan
  `repayment_method` (`:276`, `:290`); `set_obligation_repayment_mode` dikirim
  terpisah setelah RPC create.
- ✅ Slice 4 — root dibungkus `styles.scrim` (`quick-add.tsx:219`, `:443`)
  dengan `scrimTap` dan sheet ber-radius 20 (`:450-452`).
- ✅ Slice 5 — Plan Info Row (`planInfo` di `lib/obligation.ts`,
  dirender `ObligationCard.tsx:185-191`) + warna chip Pinjaman
  (`obligations.tsx:116`, `:222`).
- ✅ Slice 6 — pintu masuk Budget Health (`obligations.tsx:76-83`).
- ✅ Slice 7 — CTA bernominal + date hint kontekstual.

Artinya baris `C4wuWy` / `QNDJk` / `eixEN` / `U4FWZM` / `oyTdC` di §2 dan
seluruh §7 Tier 3 **sudah tidak lagi berlaku** — keduanya tetap dicantumkan di
dokumen ini sebagai riwayat audit, bukan pekerjaan terbuka.

**Temuan yang masih terbuka:** §1 #1 (mock bocor), #2 (Template Rutin masih
yatim + pointer mati), #3 (`isError` = 0), #4 (aritmetika Buka Siklus), #5 (join
Screen 13), #6 (Flow K3); ditambah §3.3 baris menyesatkan di `new-cycle.tsx:253`,
§4.5 copy Home, §4.6 warning `BrandIcon`, panel Alokasi (§7.12), dan §4.7
release hygiene.

---

## 7. Rencana berurut dampak

### Tier 1 — Tutup lubang kepercayaan (usaha kecil, dampak besar)

1. **Hapus seluruh fallback mock.** Ganti dengan empty-state jujur saat
   `householdId` ada tapi siklus belum ada.
   - `app/(tabs)/index.tsx` — buang impor `mockData`, `:87`, `:91`, `:95-101`,
     dan `'Andra'` di `:108`.
   - `app/payment-confirm.tsx` — buang `:7`, `:36`, `:38-45`, `:129`; saat
     `!liveTxn` tampilkan "Transaksi tidak ditemukan" (bukan transaksi mock).
   - Setelah ini `lib/mockData.ts` mungkin bisa dihapus seluruhnya — cek dulu
     apakah masih dipakai test.
2. **Tambah penanganan error.** Satu komponen `<QueryError onRetry>`; pasang
   `isError` di layar uang utama: Home, Riwayat, Tanggungan, Buka Siklus,
   Funding Gap, Alokasi, Insight.
3. **Beri pintu masuk ke layar yatim.**
   - ~~Budget Health → tombol di Top Bar Screen 3~~ — ✅ **selesai**
     (`obligations.tsx:76-83`).
   - Template Rutin → **masih terbuka**: dari Buka Siklus (kartu "Clone N pos
     rutin") atau baris di My Profile.
   - Perbaiki pointer mati `app/funding-gap.tsx:224` (masih menunjuk
     "Riwayat → Template Rutin" yang tidak ada).
   - Perbaiki `app/new-cycle.tsx:253` yang menyuruh "Pencairan Aset (Asset
     Release) — catat lewat Quick Add" padahal Quick Add tak bisa
     menghasilkannya (§3.3).
4. **Samakan hint format kode undangan** dengan `generateInviteCode()`
   (`lib/household.ts:23-31`), atau ubah generator ke format design.

### Tier 2 — Selaraskan gate & aritmetika siklus (usaha sedang)

5. **Ekstrak satu komponen proyeksi zero-based** yang dipakai bersama
   `new-cycle.tsx` dan `funding-gap.tsx`. Hilangkan sumber angka berbeda
   (§4.1). Tambahkan baris `+ Financing Inflow / Asset Release` dan
   `− Alokasi Tabungan & Aset Likuid` yang hilang di `new-cycle.tsx`.
6. **Putuskan bentuk Buka Siklus.** Satukan jadi satu layar ber-state (sesuai
   design), **atau** pertahankan dua route tapi bagikan satu hook perhitungan.
   Trade-off: satu layar lebih setia ke design tapi state-nya lebih rumit;
   dua route lebih mudah dirawat tapi harus dijamin tak bisa berbeda.

### Tier 3 — Lengkapi Quick Add ke Flow A/B — ✅ SELESAI

7. ✅ `repayment_mode` (`Lunas bln depan` / `Cicil per siklus` / `Atur manual`)
   sudah diambil alih Quick Add lewat `REPAYMENT_MODES` (`quick-add.tsx:276`).
8. ✅ Kartu **"YANG AKAN DIBUAT"** ada di
   `components/quick-add/LinkedEffectCard.tsx` + kartu validasi loan.

### Tier 4 — Naikkan alur onboarding & join (usaha lebih besar)

9. **Screen 13**: 6 kotak digit + tombol "Tempel" + scan QR + "6/6 digit •
   Memverifikasi otomatis…" + kartu TERVERIFIKASI + subtext consent.
10. **Screen 12**: ganti segmented toggle jadi 2 kartu pilihan besar dengan
    sublabel "Untuk inisiator" / "Untuk pasangan" dan
    "Disarankan untuk inisiator".

### Tier 5 — Jalur edit & polish (usaha kecil–sedang)

11. Implementasi **K3** "Ubah Data Tanggungan & Rekening" — pakai
    `useUpdateBeneficiary()` yang sudah ada + tambah `useUpdateObligation`.
12. ✅ Polish kartu Tanggungan (baris `Rencana:` / `Jatuh tempo:` / `Bunga:`,
    warna chip per-jenis) — selesai (`ObligationCard.tsx:185-191`,
    `obligations.tsx:116`). **Masih terbuka:** panel Alokasi (breakdown
    Total/Sudah/Sisa, chip cepat `Lunas • 500rb`, `KATEGORI`,
    `DAMPAK KE ANGGARAN`) di `components/ui/ObligationRow.tsx`.
13. Copy Home: pakai kata "tagihan" saat yang dihitung tagihan (§4.5).
14. Tambah "Mode Rekonsiliasi Otomatis" di Ruang Keluarga & baris "Bantuan" di
    My Profile.
15. Perbaiki `BrandIcon.tsx:38-43` (jangan sebar `accessible: false` ke web).
16. Release hygiene: `bundleIdentifier` / `android.package`, `eas.json`,
    CHANGELOG, update README (`:19`, `:37-38`), bersihkan default personal.

---

## 8. Lampiran — rujukan cepat

**Route terdaftar** (`app/_layout.tsx:83-103`): `(tabs)`, `(auth)`,
`new-cycle`, `templates`, `category-detail`, `manage-categories`,
`manage-accounts`, `household`, `budget-health`, `loan-detail`, `funding-gap`,
`asset-insight`, `allocation` (semua `presentation: 'card'`);
`payment-confirm`, `quick-add` (`presentation: 'modal'`).

**Tab** (`app/(tabs)/_layout.tsx:46-72`): `index` (Home), `obligations`
(Tanggungan), `history` (Riwayat), `profile` (My Profile) — sesuai
`BottomNavigation / main-4` di design.

**Pintu masuk per layar** (hasil grep `router.push`/`replace`):

| Layar | Dibuka dari |
| --- | --- |
| `new-cycle` | Home `index.tsx:149`, Riwayat `history.tsx:203`, `funding-gap.tsx:356` |
| `funding-gap` | Home `index.tsx:148` |
| `allocation` | Home `index.tsx:189` (heroFooter "Estimasi sisa akhir") |
| `quick-add` | Home `index.tsx:197,204,235,264`; `funding-gap.tsx:332,347` |
| `payment-confirm` | Home `index.tsx:247`, Riwayat `history.tsx:352` |
| `loan-detail` | Tanggungan `obligations.tsx:174` |
| `budget-health` | Tanggungan `obligations.tsx:77` (ikon `gauge`) |
| `household` | Profile `profile.tsx:126,134` |
| `manage-categories` | Profile `profile.tsx:113`, `budget-health.tsx:109,170` |
| `manage-accounts` | Profile `profile.tsx:145` |
| `asset-insight` | Profile `profile.tsx:105` |
| `category-detail` | `budget-health.tsx:138` |
| `templates` | **tidak ada** |

**Tanpa penanganan `isError`** (`grep -c`): seluruh `app/` (0 kemunculan).
