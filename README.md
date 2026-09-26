# Kitasaku — Family Spending Tracker

Aplikasi mobile anggaran keluarga kolaboratif suami-istri (React Native / Expo + Supabase).
Desain: `../design/design.pen` · Spesifikasi: `../.claude/MVP.md` · Prompt pen.dev: `../Family Spending/PEN_DEV_DESIGN_SYSTEM_PROMPTS.md`

## Cara menjalankan

```bash
cd kitasaku-app
npm install --legacy-peer-deps
cp .env.example .env   # isi URL + anon key Supabase (opsional di tahap mock)
npx expo start
```

Scan QR dengan aplikasi **Expo Go** di HP Anda / HP istri.

## Struktur

- `app/(tabs)/` — 4 tab utama: Anggaran (Home), Tanggungan, Kategori, Riwayat
- `app/payment-confirm.tsx` — modal konfirmasi bayar (Screen 2)
- `app/quick-add.tsx` — modal quick add ad-hoc (Screen 4)
- `components/ui/` — Badge, DeltaBadge, Button, HeroSplitCard, TransactionRow, SegmentedTabs
- `constants/theme.ts` — token warna 1:1 dari design.pen
- `lib/` — formatRupiah, supabase client, mockData
- `supabase/migrations/001_initial_schema.sql` — skema household-centric + RLS
- `supabase/migrations/002_fix_join_realtime.sql` — RPC join aman + realtime
- `supabase/migrations/003_fix_realtime_publication.sql` — pendaftaran publication per-tabel + `realtime_health()`

## Status

Iterasi 2 (live Supabase): fondasi + Screen 1, 2, 4 + tab Tanggungan/Kategori/Riwayat —
semua sudah terhubung ke Supabase live via react-query (mode offline mock hanya jika belum login).
Selesai: Screen 7 Buka Siklus (`app/new-cycle.tsx`, selective clone template ACTIVE),
Screen 8 Alokasi Tanggungan (inline di tab Tanggungan), Screen 9 Template Rutin
(`app/templates.tsx`), Screen 10 Detail Kategori (`app/category-detail.tsx`),
Screen 11–14 auth & pairing (`app/(auth)/sign-in.tsx`, `setup-choice.tsx`, `invite.tsx`)
dengan auth-gate di `app/_layout.tsx` (OTP email + buat/gabung ruang keluarga via kode
undangan + share WhatsApp teks biasa + seed otomatis kategori/akun/siklus).

### Cek Realtime

Jalankan di Supabase SQL Editor, lalu panggil RPC-nya untuk memastikan tabel benar-benar
terdaftar di publication (status `SUBSCRIBED` di client tidak membuktikan apa pun):

```sql
select * from public.realtime_health();
-- terdaftar harus true untuk: transactions, obligations, recurring_templates,
-- cycles, categories, accounts, household_members
-- (households sengaja false — tidak perlu disinkron antar HP)
```
