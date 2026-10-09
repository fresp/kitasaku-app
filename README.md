# Kitasaku — Family Spending Tracker

Zero-based family budgeting for one household (husband + wife share the same data),
built as an Expo / React Native app on top of Supabase.
Design: `../design/design.pen` · Spec: `../.claude/MVP.md` · pen.dev prompts: `../Family Spending/PEN_DEV_DESIGN_SYSTEM_PROMPTS.md`

Package id `id.my.fresp.kitasaku` · app version `0.9.0` (EAS uses remote versioning).

## Stack

Expo SDK 57 + expo-router, React Native 0.86, React 19.2, TypeScript 6,
@tanstack/react-query v5, Supabase (Postgres + RLS + Realtime + RPC),
Google sign-in via expo-auth-session, session in expo-secure-store,
lucide-react-native + react-native-svg, vitest.

Expo APIs change every SDK — verify against the v57 docs
(<https://docs.expo.dev/versions/v57.0.0/>) rather than from memory.

## Running

```bash
npm install --legacy-peer-deps
cp .env.example .env   # Supabase URL + anon key
npx expo start
```

`android/` and `ios/` are generated (CNG) and gitignored — never edit them by hand;
configure native behaviour through `app.json` and config plugins. A dependency that
ships native code needs a dev build (`npx expo run:android`) rather than Expo Go.
Add dependencies with `npx expo install`, not plain `npm install`.

APK builds go through EAS, profiles in `eas.json`: `preview` (internal distribution)
and `production` (auto-increment).

## Before calling anything done

```bash
npx tsc --noEmit
npx expo lint
npm test            # vitest, lib/__tests__
```

Pure domain logic lives in `lib/` with vitest coverage; screens stay thin.

## Structure

- `app/(auth)/` — welcome, sign-in, setup-choice, invite. Auth gate in `app/_layout.tsx`.
- `app/(tabs)/` — `index` (Home), `obligations`, `history`, `profile`.
- `app/*.tsx` — stack & modal screens: quick-add, payment-confirm, new-cycle, allocation,
  reconciliation, transfer, assets, asset-insight, loan-detail, cycle-history, cycle-detail,
  bulk-execute, transaction-edit, templates, manage-accounts, manage-categories,
  account-snapshots, account-summary, budget-health, funding-gap, category-detail,
  household, audit-history.
- `components/ui`, `components/obligations`, `components/quick-add` — reuse these
  (Badge, DeltaBadge, Button, HeroSplitCard, TransactionRow, SegmentedTabs,
  ZeroBasedProjection) before creating new ones.
- `constants/theme.ts` — tokens copied 1:1 from design.pen. Never invent or round a colour.
- `lib/` — pure domain modules (`zero-based`, `zero-based-accounting`, `cashflow`,
  `obligation`, `installments`, `insight`, `account`, `beneficiary`, `cash-account`,
  `cycle-history`, `profile`, `format`). `queries.ts` holds every react-query hook,
  `realtime.ts` one channel per household, `supabase.ts` exposes `requireSupabase()`.
- `supabase/migrations/NNN_*.sql` — applied by hand in the Supabase SQL Editor, in order.
- `docs/` — phase docs and audits; the source of truth for domain decisions.

## Domain contract

The short version; `docs/phase-1-domain-contract.md` is authoritative.

- Household-centric: every row carries `household_id`, RLS through `is_household_member`.
  Pairing by invite code (`join_household_by_code`).
- One active cycle per household. Opening clones ACTIVE recurring templates and writes
  PENDING transactions plus `cycle_allocations` at plan time. Closing goes through
  `close_cycle_reconciliation`. Cancellation is audited and terminal — money rows are
  never deleted and payments are never reversed.
- Zero-based, evaluated per account since Phase 13:
  `sourceFunds = operatingIncome + financingInflow + assetRelease`,
  `totalAllocation` comes only from `cycle_allocations` (never from summing outflows),
  `unallocated = source − allocation`, `fundingGap = max(required − source, 0)`.
  Income is a source, never an allocation. Investments live in the `assets` table.
- Execution: PENDING → PAID only through `canMarkAsPaid()` / `execute_planned_transaction`.
  One commitment = one allocation row = one decrement of `remaining_amount`.
  Any transaction with `obligation_id` is `DEBT_PAYMENT`.
- Amounts are integer rupiah (bigint); sanitize with `normalizeAmount`, display with
  `formatRupiah` / `formatRupiahShort` (id-ID).
- Multi-step money writes are a single SECURITY DEFINER RPC with a membership check,
  never a chain of client round trips. Every money-moving mutation calls
  `invalidateMoneyKeys(qc)`.
- DB triggers are the authority for guards; client-side checks are UX only.

### Cash accounts vs audit-only accounts (migration 028)

`BANK` and `E_WALLET` are the cash accounts a cycle is evaluated against. `CREDIT_CARD`
and `CASH` are audit-only: transactions on them are kept as history with `cycle_id = NULL`
and never count toward source funds, allocations, cashflow, reconciliation or sweep.

Enforced in the database, not only in the UI: `guard_cycle_transaction_account` and
`guard_template_account` reject cycle-bound rows and recurring templates on those accounts,
and `execute_planned_transaction` refuses to execute a legacy PENDING plan that still sits
on one. A plan that turns out to have been paid by card or cash is closed through
`settle_pending_outside_cycle`, which cancels the plan and its allocation and records a
`PAID` row outside the cycle linked back via `replaces_transaction_id`.
Details in `docs/phase-12-rekonsiliasi-tutup-siklus.md`.

## Migrations

Applied manually in the Supabase SQL Editor, in filename order, latest `028`.
Each file is idempotent and safe to re-run. Conventions: next number after the highest
existing one, a header comment stating the prerequisite range, `set search_path = public`
plus an explicit grant for every function, user-facing exception messages in Indonesian,
and a "Manual verification (SQL Editor, first run)" block at the end — run it, the queries
list the legacy rows a migration deliberately leaves alone.

Never assume a migration is live on remote Supabase; state what still needs verifying.

Note: `019` exists twice (`019_debt_payment_cash_account.sql` and
`019_installment_schedule_modes.sql`). Both are applied; keep the order above.

### Checking realtime

A new table that must sync across devices has to be added to the `supabase_realtime`
publication (one statement per table) with `REPLICA IDENTITY FULL`, registered in
`realtime_health()`, and subscribed in `lib/realtime.ts`. A client `SUBSCRIBED` status
proves nothing — verify in the SQL Editor:

```sql
select * from public.realtime_health();
-- registered must be true for: transactions, obligations, recurring_templates,
-- cycles, categories, accounts, household_members
-- (households is intentionally false — it does not need to sync between devices)
```

## UI rules

User-facing copy in Indonesian, warm family tone (Siklus, Kewajiban, Riwayat, Tagihan,
Tabungan). Light theme, portrait. Every data screen handles errors through `QueryError`.
No mock data and no offline mode: signed out, the app shows the auth flow.
