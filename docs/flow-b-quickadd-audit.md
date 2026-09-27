# Flow B — Audit & Rencana Penyesuaian

Sumber kebenaran: `design/design.pen`, frame `Flow B - Tanggungan QuickAdd Kategori`
(`RsQ1F`). Isinya lima layar:

| Design frame | Nama | Implementasi sekarang | Status |
| --- | --- | --- | --- |
| `U4FWZM` | Screen 3 - Tanggungan | `app/(tabs)/obligations.tsx` + `components/ui/ObligationRow.tsx` + `ObligationCard.tsx` | Sebagian — struktur cocok, detail visual & varian kartu belum |
| `xdPDT` | Screen - Detail Pinjaman | `app/loan-detail.tsx` | Paling dekat; sesi lain sedang menambah Flow K3 |
| `QNDJk` | Screen 4 - Quick Add (Terima Pinjaman aktif) | `app/quick-add.tsx` | **Berbeda jauh** — lihat §2 |
| `eixEN` | Screen 4B - Quick Add (Income aktif) | `app/quick-add.tsx` | **Berbeda jauh** — lihat §2 |
| `oyTdC` | Screen 5 - Budget Health | `app/budget-health.tsx` | Cocok secara isi, tapi **tidak bisa dijangkau** (§4) |

> **Catatan sesi paralel (sudah selesai).** Saat audit ini ditulis ada sesi Claude
> lain (`Counterparty beneficiaries`, Flow K) yang aktif menulis ke repo ini:
> `app/(tabs)/obligations.tsx`, `components/ui/ObligationCard.tsx`,
> `app/loan-detail.tsx`, `components/obligations/*`, `lib/beneficiary.ts`,
> `supabase/migrations/011_*.sql`. `obligations.tsx` berubah dari 222 → 192
> baris di tengah audit. Sesi itu sudah commit hasilnya (`6347858`) dan working
> tree bersih, jadi temuan Flow B di bawah aman untuk dikerjakan sekarang. Flow K
> menambah `ObligationFormSheet` + `BeneficiaryPickerSheet` dan badge bank di
> kartu — aditif, tidak mengubah gap di §2.

---

## 1. Akar masalahnya: satu layar untuk tiga alur

Di design, mencatat uang **dipisah menjadi dua tempat**:

- **Flow A `C4wuWy` — "Catat Pemasukan atau Pinjaman"** (full screen): segmented
  Income / Terima Pinjaman, field nominal, meta pinjaman, **"Cara pembayaran"
  (Lunas bln depan / Cicil per siklus / Atur manual)**, kartu penjelas, preview
  "Yang akan dibuat", CTA `Simpan Pinjaman`.
- **Flow B `QNDJk` / `eixEN` — Quick Add sebagai bottom sheet** di atas Screen 3,
  dengan toggle 3 arah (Pengeluaran / Income / Terima Pinjaman), preview
  "Yang akan dibuat (Linked Liability / Linked Effect)", dan kartu validasi.

Implementasi sekarang menggabungkan keduanya menjadi **satu `quick-add.tsx`**
(full-screen modal). Akibatnya dua sumbu yang di design terpisah ikut tercampur:

- design punya **`repayment_mode`** (bentuk rencana: Lunas / Cicil / Manual) →
  di app ini **tidak ada** di Quick Add;
- app malah menampilkan **`repayment_method`** (cara uang berpindah:
  Transfer / Tunai / Auto-debit / Potong gaji / Lainnya) + `installment_count` +
  bunga, yang di design tidak ada di Screen 4.

`lib/obligation.ts` sudah punya `REPAYMENT_MODES` dan `repaymentModeOf` (Phase 5B,
dipakai `loan-detail.tsx`) — jadi sumbu yang benar sudah ada di kode, hanya belum
dipakai di Quick Add.

---

## 2. Quick Add — gap per elemen

`app/quick-add.tsx` (329 baris). Perbandingan elemen:

| # | Design | Implementasi (`quick-add.tsx`) | Gap |
| --- | --- | --- | --- |
| 1 | **Bottom sheet** di atas scrim (`$overlay.scrim-light`), sudut atas `r=20`, grab handle | `presentation: 'modal'` full-screen + `SafeAreaView`, handle ada | Visual: bukan sheet berscrim. Medium |
| 2 | Toggle label `Pengeluaran` / **`Income`** / `Terima Pinjaman` | `Pengeluaran` / **`Pemasukan`** / `Terima Pinjaman` (L142-149) | Copy: "Pemasukan" ≠ "Income". Low |
| 3 | Amount **centered**, `fs=36`, lalu date hint | Amount rata kiri `fs=36` (L152) + `TextInput` terpisah (L153) | Tata letak. Low |
| 4 | Date hint kontekstual: `25 Sep 2026 • Pemasukan Pendanaan` (loan) / `• Income Operasional (Gaji Payroll)` (income) | `25 Sep 2026 • Hari Ini • Langsung Lunas` (L161-164) | Copy salah konteks: untuk pinjaman tidak muncul sebagai "Pemasukan Pendanaan". Medium |
| 5 | **`Loan Details Box`** read-only: Nama pinjaman / Pemberi pinjaman / **Rencana bayar** (dengan divider) | Input: `lender`, **`METODE PEMBAYARAN KEMBALI`** (5 chip), `JUMLAH ANGSURAN`, `BUNGA / BIAYA TOTAL` (L166-206) | **Sumbu berbeda.** Design menampilkan *hasil* rencana; app meminta cara transfer + bunga. High |
| 6 | **`YANG AKAN DIBUAT (LINKED LIABILITY)`**: baris `Pemasukan Pendanaan +Rp X` dan `Kewajiban Pinjaman Rp X` | Tidak ada untuk loan (hanya `preview` daftar angsuran, L208-221) | **Fitur hilang.** High |
| 7 | **Validation helper card** (`$state.financing.bg`): "Pinjaman harus memiliki rencana pembayaran agar muncul di daftar kewajiban." | Tidak ada | Fitur hilang. Medium |
| 8 | `AKUN` pills dengan state terpilih (outline) | Ada (L263-274) | Cocok. — |
| 9 | CTA berisi nominal: `Simpan Pinjaman • Rp 10 jt` | `Catat Pinjaman` (L282-293) | Copy. Low |
| 10 | **4B**: `KATEGORI INCOME OPERASIONAL` — hanya kategori income (`Gaji Rutin` / `Bonus` / `Side Hustle`) | `KATEGORI` = **semua** kategori, tanpa filter `type` (L233-251) | **Bug:** memilih income bisa memilih kategori EXPENSE. High |
| 11 | **4B**: `Zero Liability Explainer` (`$state.paid.bg`): "Income operasional menambah kas riil & surplus keluarga tanpa menimbulkan kewajiban utang." | Tidak ada | Fitur hilang. Medium |
| 12 | **4B**: `YANG AKAN DIBUAT (LINKED EFFECT)`: `Pemasukan operasional (+Rp X)` + `Kewajiban utang: Tidak ada (Rp 0)` | Tidak ada | Fitur hilang. Medium |
| 13 | **4B**: CTA `Simpan Income • Rp 15,8 jt` | `Simpan Transaksi` | Copy. Low |
| 14 | Expense: nominal, deskripsi, grid kategori, akun, tanggal, toggle rutin, `Simpan Transaksi` (Prompt 2D) | Ada semua (L225-259), termasuk switch rutin | **Paling selaras.** — |

### 2b. Bug navigasi: mode tidak pernah dipilihkan

`quick-add.tsx` **tidak membaca route param apa pun** (tidak ada
`useLocalSearchParams`), dan selalu mulai di `useState<Kind>('out')` (L47).

Akibatnya semua pintu masuk mendarat di **Pengeluaran**:

- `app/(tabs)/index.tsx:200` — tombol **"Catat pemasukan"** → `/quick-add` tanpa
  param → tetap Pengeluaran. Design jelas memaksudkan income.
- `app/funding-gap.tsx:332/337/342` — tiga strategi ("Tambah Pendapatan",
  "Pencairan Aset", "Pinjaman Baru") → `/quick-add` tanpa param → ketiganya
  Pengeluaran. "Pinjaman Baru" semestinya membuka mode loan.
- "Pencairan Aset (Asset Release)" **tidak punya jalur input sama sekali**:
  `quick-add.tsx` hanya mengenal `out` / `in` / `loan`, dan `in` selalu menulis
  `flow_type: 'OPERATING_INCOME'` (`lib/queries.ts:275`). `ASSET_RELEASE` ada di
  `FlowType` dan sudah dibaca Home/insight, tapi tidak ada yang bisa
  menghasilkannya dari UI.

### 2c. Validasi yang tidak sinkron dengan design

- Design mensyaratkan pinjaman **punya rencana pembayaran** (kartu validasi
  `#7`). App hanya mewajibkan `installmentCount >= 1` (L90) — dan `repayment_mode`
  tidak pernah dikirim, sehingga pinjaman baru selalu tampil `derived` di
  Detail Pinjaman.
- `name` untuk expense/income wajib ≥3 huruf (L85) — di design 4B tidak ada
  field nama sama sekali (nama diambil dari kategori). Inkonsistensi alur.

---

## 3. Screen 3 - Tanggungan — gap

`app/(tabs)/obligations.tsx` + `components/ui/ObligationCard.tsx`.

Sudah cocok: 5 filter tab, kartu overview gelap (`obligationBacklog`), kartu
per-state dari `loanState`, CTA "Alokasikan ke bulan ini", form tambah.

Belum cocok:

| Design | Implementasi | Gap |
| --- | --- | --- |
| Tab `Pinjaman` berwarna (`$state.loan.bg/border/text`), tab lain netral | Semua chip identik; aktif = `brandPrimary` (L205-211) | Tab kehilangan warna per-jenis. Low |
| `+ Tambah btn` = surface + border (`r=10`) | `addBtn` = `brandPrimary` penuh (L186-189) | Low |
| `Plan Info Row`: `Rencana: Rp X / siklus` • `Jatuh tempo: …` • `Bunga: Rp 0` | `line3`/breakdown saja; tidak ada baris rencana+tempo+bunga | Informasi rencana tidak muncul di kartu. Medium |
| Kartu Lunas punya `Track` 100% + sub `Lunas pada … • 5 dari 5 cicilan` | Ada | Cocok |
| Kartu Reimburse: badge `SEBAGIAN • 75%` / `BELUM DIBAYAR`, `History log` | `paidCue` + badge `obligationBadge` | Dekat, copy berbeda. Low |
| Icon box `26x26 r=8`; kartu `pad=16 r=16`; track `h=6` | `28x28`, `pad=14`, `h=6` | Spacing. Low |
| Judul `24/700` | `FontSize.sectionTitle` = 18 | Skala tipografi header. Low |

Catatan: karena Flow K (sesi lain) menambahkan `ObligationFormSheet` +
`BeneficiaryPickerSheet`, sebagian kartu kini juga menampilkan badge bank —
itu aditif di luar design.pen Flow B, bukan regresi.

---

## 4. Screen 5 - Budget Health: layar yatim

`app/budget-health.tsx` terdaftar di `app/_layout.tsx:91`, tapi **tidak ada satu
pun `router.push('/budget-health')` di seluruh app** (diverifikasi dengan grep).
Doc Phase 5A mengklaim design mencapainya *dari* Tanggungan, tapi Top Bar Screen 3
di `design.pen` hanya berisi Title + `+ Tambah` — tidak ada tautan Budget Health.
Aslinya (Prompt 2E) layar ini adalah **tab `Kategori`** di bottom nav; Phase 5A
mengeluarkannya dari tab bar tanpa memberi pintu masuk pengganti.

Isi layar sendiri sudah bagus (ring dari `BudgetRing`, verdict dari
`budgetHealthStatus`, kartu per kategori). Yang hilang hanya **pintu masuk**.
Pilihan: taruh tombol "Budget Health" di Top Bar Screen 3 (paling dekat dengan
narasi "verdict anggaran tinggal di sebelah kewajiban"), atau baris di My Profile
di bawah "Kelola Kategori".

Selisih kecil lain: design memformat angka besar sebagai `Rp 11,2jt / Rp 16,5jt`
(≈ `formatRupiahShort`) — app sudah pakai `formatRupiahShort` di kartu health,
tapi `formatRupiah` penuh di baris kategori (design juga penuh di sana). Cocok.
App menambah tombol "Kelola" yang tidak ada di design.

---

## 5. Rencana penyesuaian (berurut dampak)

> **Status.** Ketujuh slice (1–7) sudah dikerjakan. `tsc` bersih, 204 tes lulus,
> lint tetap 9 temuan lama di `setup-choice.tsx` / `manage-accounts.tsx`.
> Keputusan yang disetujui: tetap **full-screen modal** (bukan sheet), Quick Add
> **mengambil alih `repayment_mode`**, **Pencairan Aset ditunda**, Budget Health
> **dari Tanggungan**.

**Slice 1 — Quick Add: mode preselection + param (kecil, dampak besar) — ✅ SELESAI**
1. `quick-add.tsx` baca `useLocalSearchParams<{ kind?: string }>()` dan jadikan
   initial state lewat guard `isKind()`; nilai tak dikenal jatuh ke `out`.
   Karena `kind` tetap bisa diubah user, param di-*resync* saat render (bukan di
   effect) supaya push ulang ke layar yang masih ter-mount tidak nyangkut di mode
   lama.
2. Home "Catat pemasukan" → `?kind=in`; "Tambah transaksi"/FAB/empty-state →
   `?kind=out`; Funding Gap "Tambah Pendapatan" → `?kind=in`, "Pinjaman Baru" →
   `?kind=loan`.
3. Pencairan Aset: **ditunda** (sesuai keputusan). Baris strateginya sekarang
   `disabled` dengan catatan "Belum tersedia — catat lewat penyesuaian saldo
   akun", bukan lagi mengarah ke form yang akan menulis flow_type salah.

**Slice 2 — Quick Add: filter kategori per arah (kecil, bug) — ✅ SELESAI**
- Grid memfilter `type === 'INCOME'` di mode income dan `type !== 'INCOME'` di
  mode expense. Pilihan eksplisit hanya bertahan selama kategorinya masih
  terlihat, jadi pindah mode tidak menyisakan id kategori yang salah.
- Label toggle `Pemasukan` → `Income`.
- Label grid → `KATEGORI INCOME OPERASIONAL` di mode income.
- Empty-state membedakan "memuat" dari "belum ada kategori pemasukan".

**Slice 7 — CTA berisi nominal + copy (kecil) — ✅ SELESAI**
- `Simpan Pinjaman • Rp X jt` / `Simpan Income • Rp X jt` / `Simpan Transaksi •
  Rp X rb` via `formatRupiahShort`; nominal disembunyikan sampai ada isinya.
- Date hint: `• Pemasukan Pendanaan` (loan) / `• Income Operasional` (income) /
  `• Langsung Lunas` (expense).

**Slice 3 — Quick Add: kartu "Yang akan dibuat" + validasi — ✅ SELESAI**
- Komponen baru `components/quick-add/LinkedEffectCard.tsx`: loan → Pemasukan
  Pendanaan + Kewajiban Pinjaman; income → Pemasukan operasional + `Tidak ada
  (Rp 0)`. Baris Rp 0 itu intinya — di situ income dibedakan dari pinjaman.
- Kartu validasi loan (`financingBg`) dan Zero Liability Explainer (`paidBg`),
  keduanya setelah baris AKUN sesuai urutan design.
- `repayment_method` + `JUMLAH ANGSURAN` + bunga diganti **`REPAYMENT_MODES`**
  (Cara pembayaran) + nominal cicilan per siklus; jumlah angsuran diturunkan
  dari nominal itu (`ceil(amount / perCycle)`), bukan diminta terpisah.
- `repayment_mode` dikirim lewat RPC `set_obligation_repayment_mode` setelah
  `create_financing_with_obligation` (RPC itu tidak punya parameter ini). Kalau
  RPC kedua gagal: `console.warn`, tidak throw — melaporkan gagal untuk pinjaman
  yang nyatanya sudah dibuat akan memancing retry yang menduplikasinya.
- LUMP/MANUAL mengirim `installmentCount: null` supaya tidak dibuatkan jadwal
  palsu. `repayment_method` dibiarkan null, bukan ditebak "TRANSFER".

**Slice 4 — Quick Add jadi bottom sheet (visual) — ✅ SELESAI**
- Root dibungkus `styles.scrim` (`overlayScrimLight`, `justifyContent: flex-end`),
  di dalamnya `Pressable styles.scrimTap` (`flex: 1`) yang menutup lewat
  `router.back()`, lalu `SafeAreaView edges={['bottom']} styles.sheet` dengan
  `borderTopLeftRadius/RightRadius: 20` dan `maxHeight: '92%'`.
- `presentation: 'modal'` di `app/_layout.tsx` **tidak diubah**: yang berubah
  hanya chrome (scrim + radius + padding), bukan struktur navigasi.
- `sheet` diberi `overflow: 'hidden'` supaya konten yang ter-scroll melewati tepi
  atas tidak melukis sudut kotak di atas scrim; tanpa itu radius hanya terlihat
  saat kontennya pendek.

**Slice 5 — Screen 3: Plan Info Row + warna tab (kecil) — ✅ SELESAI**
- Helper baru `planInfo()` di `lib/obligation.ts` + 4 tes. Baris `Rencana /
  Jatuh tempo / Bunga` muncul di kartu pinjaman, setelah progress track.
- Tab Pinjaman diwarnai `state.loan.*`; tab aktif tetap brand fill.
- `+ Tambah` jadi surface + border; judul header 24/700; icon box 26×26;
  padding kartu 16.

**Slice 6 — Budget Health: beri pintu masuk (kecil) — ✅ SELESAI**
- Tombol ikon `Gauge` di Top Bar Screen 3 (sebelah `+ Tambah`). Sebelumnya
  `budget-health.tsx` terdaftar di `_layout.tsx` tapi nol `router.push` ke sana.


---

## 6. Keputusan (sudah dijawab)

1. **Quick Add: sheet atau full-screen?** → **Full-screen modal dipertahankan**;
   visual disamakan dengan design (Slice 4 jadi kerja layout, bukan navigasi).
2. **Sumbu rencana:** → **Quick Add mengambil alih `repayment_mode`** dari Flow A
   `C4wuWy`. `repayment_method` + bunga dibuang dari Quick Add (Slice 3).
3. **Pencairan Aset:** → **Ditunda.** Navigasi diperbaiki dulu; entri ditandai
   belum tersedia sampai ada slice tersendiri yang menyentuh `useQuickAdd` +
   trigger/RLS.
4. **Budget Health:** → **Dari Tanggungan** (Top Bar Screen 3).

Urutan kerja yang disepakati: Slice 1 → 2 → 7 → 3 → 5 → 6 → 4. **Ketujuhnya
selesai**, tidak ada slice tersisa dari audit ini.

Yang **sengaja tidak** dikerjakan (di luar cakupan audit, butuh slice sendiri):
Pencairan Aset (keputusan #3) dan badge bank Flow K yang tetap aditif.

