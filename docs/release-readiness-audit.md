# Kitasaku — Audit Kesiapan Release

Repo: `kitasaku-app` · commit `9dcb1ec` · 2026-09-27
Verdict: **BELUM siap rilis.** 6 blocker, 2 di antaranya bikin app tidak jalan sama sekali untuk user baru.

---

## Ringkasan temuan

| # | Temuan | Tingkat | Dampak |
|---|---|---|---|
| B1 | Migrasi 005–009 belum dijalankan di DB live | **Blocker** | 5 query inti gagal (42703) → Home, Riwayat, Alokasi kosong/error |
| B2 | `obligations` tidak bisa di-embed ke `transactions` (PGRST201) | **Blocker** | Query ledger & instalmen mati walau migrasi sudah jalan |
| B3 | `app.json` belum punya `bundleIdentifier` / `android.package` | **Blocker** | `eas build` tidak bisa jalan |
| B4 | `eas.json` tidak ada, EAS project belum di-init | **Blocker** | Tidak ada jalur build/distribusi |
| B5 | Belum ada versi/tag; changelog belum ditulis; 2 commit aset belum di-push | **Blocker (gate)** | Tidak ada baseline rilis |
| B6 | Belum ada smoke test di device nyata (belum pernah run end-to-end di DB live) | **Blocker** | Semua fitur uang belum pernah dieksekusi sekali pun |
| H1 | Tidak ada UI error state di seluruh app (0 `isError` handling) | High | Query gagal → user lihat "Belum ada transaksi", bukan error di B1 |
| H2 | Home/payment-confirm tampilkan data mock | High | Salah data; bisa insert transaksi fiktif |
| M1 | `expo lint` exit 1 di clean checkout | Medium | Gate CI/pre-commit kalau dipasang nanti |
| M2 | Script generator brand asset tidak ada di repo | Medium | Aset tidak bisa diregenerasi |
| M3 | `.git/session-junk` 96 MB | Medium | Clone lambat |
| M4 | Seed default kategori/pagu/siklus hardcoded (data pribadi) | Medium | Istri/pasangan lihat kategori + nominal salah |
| M5 | `console.log` di jalur auth | Low | Noise + bocor redirect URI ke log produksi |
| M6 | Docs drift (README, phase-6, phase-5c) | Low | Dokumen tidak lagi cocok dengan kode |

---

## B1 — Migrasi 005–009 belum jalan di DB live

Hasil probe langsung ke `https://ycjznsqelzjnoxdvenio.supabase.co` (pakai anon key dari `.env`):

Yang sudah live: 001–004. Bukti — `rpc/allocate_debt_payment` (5 arg) balas `P0001 "Not a member of household..."` = fungsi ada. `realtime_health()` juga jalan dan melaporkan 7 tabel terdaftar.

Yang belum live:

| Migrasi | Bukti gagal |
|---|---|
| 005 | `create_financing_with_obligation` masih **8-arg** (004); `schedule_obligation_installments` & `set_installment_cycle` tidak ada |
| 006 | `column recurring_templates.due_day does not exist`; `column categories.is_system does not exist` |
| 007 | `column household_members.display_name does not exist`; `list_household_members` tidak ada |
| 008 | `column obligations.repayment_mode does not exist`; `set_obligation_repayment_mode` tidak ada |
| 009 | `column categories.icon does not exist` |

Cara jalanin: buka Supabase SQL Editor → paste `supabase/migrations/005_…sql` s.d. `009_…sql` → Run satu per satu, urut. Semua idempotent (`add column if not exists`, `create or replace`, `drop policy if exists`), aman diulang kalau gagal di tengah.

Setelah jalan, verifikasi:

```sql
select * from public.realtime_health();              -- 7 tabel terdaftar = true
select column_name from information_schema.columns
 where table_name = 'categories' and column_name = 'icon';   -- harus ada 1 baris
select * from public.list_household_members('<household-uuid>');
```

Catatan: setiap migrasi sudah menulis blok "Manual verification (SQL Editor, first run)" di komentar paling bawah file — pakai itu.

---

## B2 — `obligations` tidak bisa di-embed (karena 004 sudah jalan)

Ini yang paling gampang kelewat. Migrasi 004 menambahkan FK `obligations.source_transaction_id → transactions.id`. Akibatnya PostgREST melihat **dua** relasi antara `transactions` dan `obligations` dan menolak embed tanpa hint:

```
PGRST201: Could not embed because more than one relationship was found
for 'transactions' and 'obligations'
  - obligations_source_transaction_id_fkey
  - transactions_obligation_id_fkey
```

Dua tempat kena:

- `lib/queries.ts:491` — `useCycleAllocations()` → `.select('*, categories(name, icon), obligations(title), accounts(name)')`
- `lib/queries.ts:604` — `useYearInsight()` → jalur `transactions` di dalamnya juga nge-embed `obligations(title)`

Perbaikan (pilih satu):

1. **Disambiguate di client** — ganti `obligations(title)` jadi `obligations!transactions_obligation_id_fkey(title)`. Dua baris, tidak perlu migrasi baru.
2. **Alias relasi di SQL** — bikin migrasi 010 yang menamai ulang constraint jadi sesuatu yang tidak ambigu, lalu pakai nama itu.

Opsi 1 lebih cepat dan tidak menambah migrasi. Sudah saya uji: dengan FK hint, embed-nya diterima PostgREST.

---

## B3 & B4 — Build config belum ada

`app.json` tidak punya: `ios.bundleIdentifier`, `android.package`, `owner`, `extra.eas.projectId`, `runtimeVersion`, `updates`. Tidak ada `eas.json`. Artinya `eas build` akan gagal / minta init dulu.

Yang perlu ditambahkan:

```jsonc
// app.json
"ios":     { "bundleIdentifier": "id.kitasaku.app", "supportsTablet": true },
"android": { "package": "id.kitasaku.app", ... },
"runtimeVersion": { "policy": "appVersion" }
```

- `allowBackup: false` di Android kalau tidak mau sesi Supabase ikut ke Google Drive auto-backup.
- Putuskan: mau pakai EAS Update (OTA) atau tidak. Kalau ya, `updates.url` wajib.
- Commit `eas.json` setelah `eas init`, supaya build reproducible.

---

## H1 — Tidak ada UI error state

`grep -rn "isError" app components` → **0 hasil**. Semua error query network/skema berujung ke `data === undefined`, dan tiap layar merender **empty state yang salah**:

- `app/(tabs)/history.tsx:227` → "Belum ada transaksi di siklus ini."
- `app/(tabs)/obligations.tsx:139` → "Belum ada tagihan."
- `app/(tabs)/index.tsx` → balik ke angka mock

Itu sebabnya B1 tidak kelihatan seperti error — kelihatan seperti keluarga baru yang belum punya data. Untuk app keuangan, "kelihatannya kosong padahal uangnya ada" lebih berbahaya daripada crash.

Perbaikan: minimal satu komponen error state + cabang `isError` di 4 layar utama (Home, Riwayat, Tanggungan, Alokasi). Jangan tampilkan empty state saat `isError` true.

---

## H2 — Data mock masih tampil ke user

Bukan cuma fallback offline yang tidak pernah diuji:

- `app/(tabs)/index.tsx:96-97` — `income`/`expense` jatuh ke `15_844_000` / `9_810_000` kalau query gagal.
- `app/(tabs)/index.tsx:87` — daftar aktivitas jatuh ke `pendingTransactions.slice(0,4)`.
- `app/(tabs)/index.tsx:99` — sapaan jatuh ke hardcoded `'Andra'`.
- `app/payment-confirm.tsx:35` — `const mock = pendingTransactions.find(...) ?? pendingTransactions[1]`. Kalau `id` tidak match transaksi live, layar menampilkan nama/kategori/nominal **mock** dan `payable` jadi `true`. Tombolnya no-op (`if (!liveTxn) { router.back() }`), jadi tidak menulis ke DB — tapi user melihat tagihan yang tidak pernah ada, dengan tombol aktif.

Perbaikan: hapus fallback mock dari jalur produksi. Ganti dengan skeleton/error state. Kalau `!liveTxn && id` diberikan → tampilkan "Transaksi tidak ditemukan".

---

## Yang sudah bagus (jangan diutak-atik)

- `npx vitest run` → **160/160 passing** (naik dari 140 yang tercatat di memory).
- `npx tsc --noEmit` → bersih, `strict: true`.
- `npx expo-doctor` → **21/21 checks passed**.
- `npx expo export --platform ios` → **bundle sukses**, 1638 modul, output 4.4 MB. Bundle-nya valid.
- Working tree bersih, `main` sinkron dengan `origin/main` (0 ahead / 0 behind).
- `.env` tidak pernah masuk git history (`git log --all -- .env` kosong, `git check-ignore` mengonfirmasi ter-ignore). Scan `eyJ`/`service_role`/`sb_secret` di tracked files → bersih.
- RLS: setiap tabel punya policy household-scoped, `security definer` function semua sudah `set search_path = public`, `grant execute` hanya ke `authenticated`.
- Deploy note yang bikin ngeri sudah tertangani: `005:35` menulis `drop function if exists …(8-arg)` sebelum bikin versi 12-arg, jadi PostgREST tidak akan menemukan dua overload. Bagus.

---

## Checklist release

### Fase 0 — Data & DB (blocker, kerjakan dulu)

- [ ] Backup / snapshot project Supabase dulu
- [ ] Jalankan migrasi **005** di SQL Editor, cek output tanpa error
- [ ] Jalankan **006**, verifikasi blok "Manual verification" di akhir file
- [ ] Jalankan **007**, lalu `select * from public.list_household_members('<hh-uuid>')`
- [ ] Jalankan **008**
- [ ] Jalankan **009**, lalu `select count(*) filter (where icon is null), count(*) from public.categories`
- [ ] `select * from public.realtime_health()` → 7 tabel `terdaftar = true`
- [ ] Smoke test lewat PostgREST: `GET /rest/v1/transactions?select=*,categories(name),accounts(name)&limit=1` → `[]`, bukan `42703`
- [ ] Cek Isolasi: bikin 2 akun, pastikan akun A tidak bisa lihat household B

### Fase 1 — Perbaikan kode (blocker)

- [ ] B2: disambiguate embed `obligations` di `lib/queries.ts:491` dan `:604`
- [ ] H2: hapus fallback mock dari `app/(tabs)/index.tsx` dan `app/payment-confirm.tsx`
- [ ] H2: `payment-confirm` — kalau `id` ada tapi `liveTxn` tidak ketemu, tampilkan "tidak ditemukan", bukan mock
- [ ] H1: tambah error state + cabang `isError` di Home, Riwayat, Tanggungan, Alokasi
- [ ] M1: benerin `app/(auth)/setup-choice.tsx:27` (setState di dalam effect) sampai `expo lint` exit 0
- [ ] M5: hapus / gate `console.log` di `lib/google-auth.ts:15,29` di balik `__DEV__`

### Fase 2 — Smoke test di device (blocker)

Ini yang belum pernah dilakukan sekali pun. Jalankan di **dua HP** (kamu + istri) dengan `npx expo start`:

- [ ] Welcome 3 slide → tampil sekali saja, "Mulai" tidak bounce balik
- [ ] Sign in email OTP → masuk
- [ ] Sign in Google → masuk (callback `kitasaku://auth/callback` harus terdaftar di Supabase Auth → Redirect URLs)
- [ ] Buat household → kategori + akun + siklus ter-seed
- [ ] Kode undangan muncul, copy/share WhatsApp jalan
- [ ] HP kedua: join pakai kode → lihat data household yang sama
- [ ] Buka siklus baru (selective clone template)
- [ ] Tambah transaksi ad-hoc dari Home
- [ ] Catat pemasukan
- [ ] Buka pinjaman baru + jadwal angsuran (RPC 12-arg — ini yang belum ada di DB)
- [ ] Mark as paid dari Home → cek saldo kas riil berubah
- [ ] Ubah mode pembayaran di Detail Pinjaman → reload, pilihan tersimpan
- [ ] Alokasi zero-based → angka cocok dengan manual
- [ ] Insight & Aset 2026 → 7 seksi render, tidak crash saat tahun kosong
- [ ] Ruang Keluarga → roster 2 orang dengan email
- [ ] Ganti nama + set payday → tersimpan
- [ ] Pilih ikon kategori (Screen 2B) → tersimpan, tidak berubah saat nama diedit
- [ ] Realtime: HP A catat transaksi → HP B refresh sendiri < 3 detik
- [ ] Kelola Kategori: kategori sistem tidak bisa dihapus
- [ ] Kill & reopen app → sesi masih login, tidak balik ke onboarding

### Fase 3 — Build config (blocker)

- [ ] Putuskan bundle id (mis. `id.kitasaku.app`) dan samakan di iOS + Android
- [ ] Isi `ios.bundleIdentifier`, `android.package`, `runtimeVersion` di `app.json`
- [ ] `npx eas init` → commit `eas.json`
- [ ] Set `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` di EAS secrets (jangan andalkan `.env`, file itu ter-ignore)
- [ ] `eas build --profile preview --platform all` → install ke device, ulangi smoke test versi build
- [ ] Cek splash screen + icon di build nyata (bukan Expo Go)
- [ ] Putuskan: pakai EAS Update/OTA atau tidak

### Fase 4 — Housekeeping

- [ ] M2: masukkan `gen-brand-art.py`, `verify-brand-art.py`, `fix-svg-fills.py`, `gen-icons.py` ke `scripts/` — docs fase 6 menyuruh "rerun generator" tapi scriptnya tidak ada, `lib/brand-art.ts` jadi artefak mati
- [ ] M3: hapus `.git/session-junk` (96 MB, untracked), lalu `git gc --aggressive`
- [ ] M4: ganti seed default — hapus `monthly_budget` pribadi dari `lib/seed.ts`, atau kosongkan jadi kategori generik. `Sekolah Ryu`, `CC Mandiri`, `ShopeePay` itu data kamu, bukan template keluarga lain
- [ ] M4: `lib/seed.ts:56` hardcode siklus `'Siklus Okt 2026'` / `2026-09-25`–`2026-10-24`. Untuk rilis, hitung dari tanggal hari ini + `payday_day`
- [ ] M4: `app/(auth)/setup-choice.tsx:16` default nama `'Keluarga Andra'` + `index.tsx:99` fallback `'Andra'`
- [ ] M6: update `README.md` — klaim "4 main tabs: index, obligations, **categories**, history" padahal file-nya `profile.tsx`, dan daftar status berhenti di Screen 14
- [ ] M6: `docs/phase-6-brand-assets.md:3` bilang "30 SVGs", `assets/` isinya 33
- [ ] M6: `docs/phase-5c-insight-aset.md:167` bilang "no new migration" — faktanya 009 (category icon) menyusul di commit aset
- [ ] Update `README.md` Status: tambahkan fase 5A/5B/5C/6 + langkah migrasi 005–009
- [ ] Cek LICENSE — masih header MIT Expo (`Copyright (c) 2015-present 650 Industries, Inc.`)

### Fase 5 — Versioning & commit

- [ ] Putuskan nomor versi. Catatan: `package.json` dan `app.json` sudah `1.0.0` sejak commit pertama. Kalau `1.0.0` belum pernah dirilis, biarkan dan ini adalah rilis pertama
- [ ] Bikin `CHANGELOG.md`, tulis entri pertama `1.0.0 — 2026-09-27` (tidak ada file changelog sekarang)
- [ ] `c7566fe` + `9dcb1ec` (aset brand) belum di-push ke `origin/main` — ikut sertakan
- [ ] Commit perbaikan Fase 1 + housekeeping
- [ ] `git tag v1.0.0` (kamu yang push)
- [ ] `git push origin main && git push origin v1.0.0`

---

## Yang perlu kamu putuskan sendiri

1. **Nomor versi** — apakah `1.0.0` di `app.json`/`package.json` sudah pernah jadi rilis? Kalau belum, tidak perlu bump, tinggal tag.
2. **Bundle identifier** — pakai apa? (`id.kitasaku.app`, `com.fresp.kitasaku`, atau domain lain)
3. **Distribusi** — EAS Update/OTA dipakai atau tidak? Ini menentukan apakah `runtimeVersion` dan `updates.url` wajib.
4. **B2** — mau disambiguate di client (cepat, 2 baris) atau bikin migrasi 010 yang merapikan constraint?
5. **Seed default** — diganti generik, atau dikosongkan dan biarkan user bikin sendiri?

---

## Cara menjalankan ulang audit ini

```bash
cd ~/Documents/personal-repo/playground/family-spending/kitasaku-app
npx vitest run          # 160/160
npx tsc --noEmit        # harus bersih
npx expo lint           # sekarang exit 1
npx expo-doctor         # 21/21
npx expo export --platform ios --output-dir /tmp/export
```

Probe DB (pakai anon key dari `.env`):

```bash
set -a && . ./.env && set +a
curl -s "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/categories?select=icon&limit=1" \
  -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY"
# 42703 = migrasi 009 belum jalan; [] = sudah
```
