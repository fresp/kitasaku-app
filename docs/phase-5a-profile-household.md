# Phase 5A — My Profile and Ruang Keluarga

Phase 5 is the last design surface with no implementation behind it, and it
splits like Phase 2 did. 5A is the *identity* half: who is in this family, what
they are called, and where the cycle starts. 5B is the Tanggungan/Detail
Pinjaman/Funding Gap screens, 5C is Insight & Aset.

5A also settles a question that had been open since Phase 3: the app's bottom
nav did not match the design's.

## 1. The nav realignment

`design.pen`'s `BottomNavigation` (component `main-4`) has exactly four tabs —
Home (`house`), Tanggungan (`hand-coins`), Riwayat (`history`), My Profile
(`user-round`) — and Budget Health is *not* one of them. The app had five tabs
with Categories/Budget Health in the bar and no profile tab at all.

`app/(tabs)/_layout.tsx` is now the design's four:

| Tab | Icon | Screen |
| --- | --- | --- |
| Home | `house` | `app/(tabs)/index.tsx` |
| Tanggungan | `hand-coins` | `app/(tabs)/obligations.tsx` |
| Riwayat | `rotate-ccw-clock` | `app/(tabs)/history.tsx` |
| My Profile | `user-round` | `app/(tabs)/profile.tsx` |

lucide-react-native 1.48.0 has no `history` module; the icon lives in
`rotate-ccw-clock.mjs`, which is what the import path says. There is no
`home` icon either — `house` is the design's actual glyph name.

Budget Health moved to `app/budget-health.tsx`, a pushed screen with a back
button and the design's breadcrumb "Tanggungan / Budget Health" — the design
reaches it *from* Tanggungan, so it should not sit in the tab bar. Kelola
Kategori stays reachable from My Profile, matching "My Profile / Kelola
Kategori". `app/(tabs)/categories.tsx` is deleted.

The Home avatar used to jump to `/(auth)/invite`, the one-off post-signup
screen. Tapping your own face is the reflex for "my account", so it now opens
the My Profile tab, and it renders the same `memberInitials` glyph as the
profile header and the roster — one person, one set of letters.

## 2. Migration 007 — `supabase/migrations/007_household_profile.sql`

Eight sections; each is additive and idempotent (`ADD COLUMN IF NOT EXISTS`,
`drop policy if exists` before `create policy`, `CREATE OR REPLACE` for RPCs).

| # | Object | Why |
| --- | --- | --- |
| 1 | `households.payday_day` + check (null or 1–31) | "Siklus Payday: Tgl 25" — the day every cycle boundary is derived from |
| 2 | `household_members.display_name`, `.notify_partner_expense` | An identity that is not an email address; a per-member notification toggle |
| 3 | `is_household_member(uuid)` + `household_scoped_select_members` policy | Members must see each other |
| 4 | `list_household_members(uuid)` | The roster, with emails, scoped to the caller |
| 5 | `seed_member_display_name`, re-issued `create_household` / `join_household_by_code`, backfill | So a new member is not "Pasangan" until they open the profile screen |
| 6 | `household_scoped_update_households` UPDATE policy | 001 gave `households` only SELECT; the rename pencil had nowhere to write |
| 7 | `replica identity full` on `household_members` + realtime loop | A member leaving must produce a usable DELETE payload |
| 8 | (no-op) | Deliberately not backfilling `payday_day = 25` |

Three decisions worth naming:

- **The roster is an RPC, not a wider policy.** A policy on
  `household_members` that subqueries `household_members` is infinite recursion
  in PostgreSQL. `is_household_member()` is SECURITY DEFINER and owned by the
  migration role (the table owner), so RLS does not apply to it and the cycle
  breaks — the same mechanism 002/004/005 already rely on. Write access is
  deliberately *not* widened: 001's `members_manage_household_tables` still
  limits every write to the caller's own row, so a member can rename themselves
  and toggle their own preference but cannot touch anyone else. That is why
  `updateMyMemberProfile` takes no member id — passing one would silently no-op
  under RLS, which is a worse failure than not offering the parameter.
- **The email in the roster is a considered exception.** The design's member
  row literally reads `istri@example.com • Terhubung real-time`. Exposing it is
  safe only because the RPC is household-scoped and SECURITY DEFINER: a client
  cannot reach `auth.users`, a non-member gets zero rows, and the address is
  read at call time rather than stored in a table of ours.
- **Payday is not backfilled.** Guessing 25 would silently redefine "this
  cycle" for a family paid on the 1st. Until someone picks, the screen says
  "belum diatur" — which is true — instead of inventing a boundary.

## 3. `lib/profile.ts` — presentation rules, testable

Pure functions, no `react-native` import (Vitest cannot parse the Flow syntax
in `node_modules/react-native/index.js`, so anything the tests touch must stay
clear of `./supabase`):

`memberInitials`, `roleLabel`, `memberDisplayName`, `paydayShort`,
`paydayLabel(n, 'row' | 'meta')`, `memberCountLabel`, `rosterLabel`,
`joinedMonthLabel`, `householdMeta`, `cycleRangeLabel`, `cycleDayIndex`,
`realtimeLabel`, and `displayNameFromEmail`.

`displayNameFromEmail` moved here from `lib/household.ts`. It is the client
mirror of the SQL seed, and keeping it in `household.ts` meant the test file
imported `./supabase` → `react-native` and the whole suite failed to parse.
Moving it the other direction (household imports profile) keeps one definition
and makes it reachable from a test.

`joinedMonthLabel` parses only the leading `YYYY-MM` and never constructs a
`Date`, so "Dibuat Sep 2026" cannot shift a month for someone in a negative
offset. `cycleDayIndex` clamps at both ends: an unclosed cycle reports its last
valid day rather than a number that grows forever.

## 4. Screens

**`app/(tabs)/profile.tsx` — My Profile.** Eyebrow "AKUN & RUANG KELUARGA",
editable identity card (initials, name, role badge), a household summary card
reading `paydayLabel(..., 'row')`, then four groups: KEUANGAN (Insight & Aset
2026 — no handler yet, 5C; Kelola Kategori → `/manage-categories`), RUANG KELUARGA
(Ruang Keluarga, Undang Pasangan → `/household?focus=invite`, and the
notify switch), AKUN (Preferensi tampilan and Keamanan & privasi, rendered
disabled with a "Segera" badge rather than as dead links), and sign out.

**`app/household.tsx` — Ruang Keluarga (Screen 14).** Name + payday form
behind the pencil; invite card with copy (2s "Tersalin"), WhatsApp, and a QR
toggle; roster with per-member avatar/name/role/email; a notify switch; and a
footer count.

- The QR encodes the invite **code**, not a `kitasaku://` deep link. The code
  is what `join_household_by_code` accepts; a deep link would do nothing for
  anyone scanning with a camera app, and a short uppercase string keeps the
  symbol at a low version so it stays scannable off a partner's screen.
- `showQr` is initialised from `useLocalSearchParams().focus` via `useState`,
  not synced in an effect. A pushed screen's route param does not change while
  it is mounted, and an effect that set state on mount only causes a second
  render (and trips `react-hooks/set-state-in-effect`).
- An empty payday box does not clear an existing payday: the field is only sent
  when something was typed.
- The roster **degrades out loud**. When migration 007 has not run,
  `listHouseholdMembers` falls back to the 001-scoped direct select and returns
  `partial: true`; the screen then says the list is incomplete. Showing a
  one-person roster as if it were the whole family would read as "my partner
  left".

**`app/budget-health.tsx`** is the old `categories.tsx` moved out of the tab
bar, with a back button and the "Tanggungan / Budget Health" breadcrumb. Its
logic is unchanged.

## 5. Data layer

`lib/household.ts` gains `listHouseholdMembers`, `updateHousehold`,
`updateMyMemberProfile`, the `HouseholdMember` interface, and the
`display_name` / `notify_partner_expense` / `payday_day` / `created_at` fields.

`lib/queries.ts` gains `useHouseholdMembers`, `useUpdateHousehold`, and
`useUpdateMyMemberProfile`. `useUpdateHousehold` invalidates only `['members']`:
the household row itself lives in AuthProvider state, so the caller must
`await refresh()` for the header to change — invalidating a query nobody reads
would look like it worked when it did not.

## Verified

- `npx vitest run` — 49/49 passing (36 → 49: `lib/__tests__/profile.test.ts`
  tests 37–49).
- `npx tsc --noEmit` — clean.
- `npx expo lint` — the 2 pre-existing problems
  (`app/(auth)/setup-choice.tsx:27`, `app/_layout.tsx:32`). One new finding was
  introduced and fixed during this phase: `react-hooks/set-state-in-effect` in
  `household.tsx`, resolved by initialising `showQr` from the route param
  instead of syncing it in an effect.

## Not done in this phase

- Phase 5B — `Screen 3 - Tanggungan` filter tabs and loan-card states,
  `Screen - Detail Pinjaman` (repayment modes + payment history), `Screen 7B -
  Funding Gap`. The installment data they need already exists from Phase 2B.
- Phase 5C — `Screen 2C - Insight & Aset 2026` and its seven chart sections.
  "Insight & Aset 2026" on My Profile is rendered as a row with no handler.
- Migration 007 has not been run against a live database (same as 005 and 006).
