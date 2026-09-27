# Phase 5C — Insight & Aset 2026

The last design surface. `Screen 2C - Insight & Aset 2026` is seven sections of
charts over a year of cycles, reached from My Profile.

## 1. The shape of the problem

Seven sections, one dataset. Every section claims to describe the same twelve
months — "Sumber Dana vs Alokasi" says October's operating income was X, and
"Plan vs Actual" says October's expenses were Y, and if those two charts each
run their own query they will eventually disagree about which cycle October is.

So the screen computes nothing. `lib/insight.ts` builds twelve `YearBucket`s
once, from a single query, and every section is a different projection of that
one array. The charts read `b.plannedExpense`; the tables read
`b.plannedExpense`; there is exactly one place the number can be wrong.

That is also why `useYearInsight` exists instead of composing the existing
`useX(householdId, cycleId)` hooks: the screen needs twelve months at once, and
per-month queries would give twelve independent loading states and five chances
for the sections to drift apart.

## 2. `lib/insight.ts`

Pure module, imports only `./format` and `./zero-based`. It may not transitively
reach `react-native` or Vitest cannot load it.

### Buckets

`buildYearBuckets({ cycles, txns, allocations, year })` returns twelve buckets,
always — a month with no cycle stays in the array with `hasCycle: false`.

That flag is the module's central honesty rule. Zero means "we spent nothing".
`hasCycle: false` means "we do not know". A chart that draws both as a
zero-height bar is lying, and it lies in the direction that flatters a family
with a gap in its records. The chart components render an absent month as a flat
grey stub with a dimmed label, never as a bar.

A cycle is placed on the month it **ends** in, not the month it starts. Cycles
are payday-to-payday (25 Oct – 24 Nov) and named for the month they close in, so
placing by `start_date` would file every cycle one month early and shift the
whole year by one column.

`sourceTotal` is planned; `actualSourceTotal` is realised. `fundingGap` is
computed against the planned total and only ever from `cycle_allocations` rows —
never from the transaction sum, which is the Phase 1 anti-double-count rule
still holding. Test 94 pins it with a transaction total deliberately larger than
both the source funds and the allocations, so reading the gap off the
transactions would give a different answer.

`netCashflow` needed both of those because of a bug the tests caught: the first
version compared planned source funds against *realised* outflow, so a month
that earned 10jt and spent 7jt reported a 3jt surplus while a month that planned
the same numbers reported 4jt. The two were not the same claim. Test 97 pins the
fix — both sides now use the same basis, chosen per month.

### Asset movement, with no assets table

There is no `assets` table in any migration. "Aset" therefore means an
allocation the family marked as not-spending: `ASSET | SAVINGS | INVESTMENT |
EMERGENCY_FUND`. It is what they set aside, not a market value, and the screen
says so in one line rather than implying a balance it cannot know.

`assetSeriesByType(buckets, 'monthly' | 'cumulative')` returns the four legend
bands per month, ordered for bottom-up drawing. `assetSummary` reports the
largest contributor as an *allocation type* (`SAVINGS`) while the legend is
keyed by *band* (`LIQUIDITY`) — `bandKeyOfAllocationType` maps between them, and
without it the contributor card would print the raw enum on a screen whose
legend calls the same money "Likuiditas". Tests 131–132 pin the mapping and
assert every asset type lands in exactly one band, so no money silently vanishes
from the stack.

`liabilitySeries` reconstructs the outstanding balance backwards from today's
figure, adding back the principal paid since. Walking forward from zero would be
wrong — it would miss everything borrowed before the year started. Months before
the first financing inflow clamp to 0: a debt that did not exist yet is not
"negative debt". It takes an optional obligation-id set so the section's type
pills can reconstruct loans and bills separately.

### Everything else

- `planVsActual(buckets, metric)` — the direction of "good" flips per metric.
  Spending under plan is good; income over plan is good. `favourable` is
  computed here, where the direction is known, so the chart's green/red never
  has to guess.
- `monthOverMonth(buckets, month, names)` — risers and fallers ranked by
  *absolute rupiah*, not percentage. A category appearing for the first time has
  `pct: null` and renders as "Baru bulan ini"; a "+∞%" pill is not information.
- `buildTrendInsights` — the design's five summary paragraphs are about a
  specific family's numbers ("bonus THR", "Gold Ryu"). Copying them would print
  another family's income on this family's screen. Each is generated from the
  data or omitted, and a quiet year yields fewer than five rows rather than a
  fabricated fifth (test 120).
- `windowEndingAt`, `niceMax`, `barPct`, `latestActiveMonth`.

## 3. `components/ui/Charts.tsx`

Plain `View`s. Every chart in the design is a bar chart on a fixed twelve-column
axis, which is a flexbox layout; a chart library would add a native dependency,
a gesture system and an animation model to draw rectangles whose heights are
already known.

`GroupedBarChart` covers all four bar charts (cashflow, income, expenses,
liability) — they differ only in what goes in `left`/`right` and how many
segments each carries. `StackedBarChart` is the asset trend. `VarianceBarChart`
is the signed one around a zero line. Plus `Legend`, `ChartScaleRow`,
`StatCard`/`StatGrid`, `ProgressTrack`.

One shared axis per chart: inflow and outflow are the same currency and answer
the same question ("how big was it"), so separate scales would make a 2jt
outflow as tall as a 20jt inflow. The net-cashflow indicator is a horizontal
tick whose *width* encodes magnitude — a vertical one would be indistinguishable
from a third bar.

## 4. `components/ui/InsightSections.tsx`

The blocks: `SectionCard`, `SectionHeader`, `InsightRow`/`TrendSummary`,
`RuleBanner`, `InsightCallout`, `MoverList`, `DeltaPill`.

The month-over-month reason lines ("Tagihan listrik tempo ganda") are the one
piece of design copy deliberately not implemented: the ledger records what was
spent, not why, and a hand-written explanation would be a fabrication on any
family but the one it was written about. The row omits the line.

## 5. Data layer

`useYearInsight(householdId, year)` — one query for the whole year: cycles
overlapping the year, then that year's transactions and allocations in two
parallel requests. Cycle overlap is `start_date <= yearEnd AND end_date >=
yearStart` rather than containment, so a cycle crossing New Year appears in both
years, which is what `cyclesInYear` expects.

`useCycleYears(householdId)` — the distinct years with data, for the selector. A
min/max would be wrong: a family with cycles in 2024 and 2026 but not 2025 has
two years with data and a three-year range.

## 6. Screen

`app/insight-aset.tsx` lays out the seven sections. Controls use the existing
`SegmentedTabs` (range, asset view, plan-vs-actual metric) and chips. The
category chip in the expenses section re-derives its buckets with
`expenseCategoryId` rather than filtering the finished ones — filtering after
the fact cannot work, because the realised per-category map has no *planned*
counterpart, so plan and actual must be restricted together or the variance
means nothing (tests 124–126).

The "Fokus Kategori" block is computed: the biggest overspend category in the
selected month, measured against its own monthly budget. The design names
"Tagihan", which is true of one family's October.

My Profile's "Insight & Aset 2026" row, previously inert, now routes here.

## Verified

- `npx vitest run` — 140/140 passing (123 → 140; `lib/__tests__/insight.test.ts`
  adds tests 85–139).
- `npx tsc --noEmit` — clean.
- `npx expo lint` — the 2 pre-existing problems only, no new findings.

## Not done here

The design's month-over-month reason lines and its risk-free-rate-style targets
("Target Akhir: Rp 120 jt") are not implemented; the target is read as the year's
planned asset allocation instead, since no target balance is stored anywhere.

No new migration. Phase 5C reads only tables that already exist, so unlike
005–008 there is nothing here waiting to be run against a live database.
