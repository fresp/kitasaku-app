# Kitasaku — Family Spending Tracker

A collaborative husband-and-wife family budgeting mobile app (React Native / Expo + Supabase).
Design: `../design/design.pen` · Spec: `../.claude/MVP.md` · pen.dev prompt: `../Family Spending/PEN_DEV_DESIGN_SYSTEM_PROMPTS.md`

## Running the app

```bash
cd kitasaku-app
npm install --legacy-peer-deps
cp .env.example .env   # fill in your Supabase URL + anon key (optional during the mock stage)
npx expo start
```

Scan the QR code with the **Expo Go** app on your phone / your wife's phone.

## Structure

- `app/(tabs)/` — 4 main tabs: `index` (Budget), `obligations`, `categories`, `history`
- `app/payment-confirm.tsx` — payment confirmation modal (Screen 2)
- `app/quick-add.tsx` — ad-hoc quick add modal (Screen 4)
- `components/ui/` — Badge, DeltaBadge, Button, HeroSplitCard, TransactionRow, SegmentedTabs
- `constants/theme.ts` — color tokens mapped 1:1 from design.pen
- `lib/` — formatRupiah, supabase client, mockData
- `supabase/migrations/001_initial_schema.sql` — household-centric schema + RLS
- `supabase/migrations/002_fix_join_realtime.sql` — safe join RPC + realtime
- `supabase/migrations/003_fix_realtime_publication.sql` — per-table publication registration + `realtime_health()`

## Status

Iteration 2 (live Supabase): foundation + Screens 1, 2, 4 + the obligations/categories/history tabs —
all wired to live Supabase via react-query (the offline mock mode only applies when signed out).
Done: Screen 7 Open Cycle (`app/new-cycle.tsx`, selective clone of ACTIVE templates),
Screen 8 Obligation Allocation (inline in the obligations tab), Screen 9 Recurring Templates
(`app/templates.tsx`), Screen 10 Category Detail (`app/category-detail.tsx`),
Screens 11–14 auth & pairing (`app/(auth)/sign-in.tsx`, `setup-choice.tsx`, `invite.tsx`)
with the auth gate in `app/_layout.tsx` (email OTP + create/join a household via invite code
+ plain-text WhatsApp share + automatic seeding of categories/accounts/cycles).

### Checking Realtime

Run this in the Supabase SQL Editor, then call the RPC to confirm the tables are actually
registered in the publication (a client `SUBSCRIBED` status proves nothing):

```sql
select * from public.realtime_health();
-- registered must be true for: transactions, obligations, recurring_templates,
-- cycles, categories, accounts, household_members
-- (households is intentionally false — it does not need to sync between devices)
```
