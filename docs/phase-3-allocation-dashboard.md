# Phase 3 — Zero-based allocation dashboard & design tokens

Phase 3 turns the zero-based allocation model (defined in Phase 1, wired in
Phase 2) into the thing the user actually opens the app for: a Home screen that
states the cycle's equation in full, a detail screen where allocations are
created and removed, and a new-cycle gate that refuses to open a cycle that is
already in funding gap.

## 1. Tokens extracted from `design.pen`

`constants/theme.ts` was rewritten from the design file's `variables` block
rather than eyeballed. The pen document is JSON, so the token values were read
out of `design.pen` programmatically (parse the file, walk the `variables`
collection) and then transcribed — no colour in the theme is a guess.

Tokens added on top of the original set:

| Group | Tokens |
| --- | --- |
| Financing inflow state | `financingBg #FEF3C7`, `financingText #B45309`, `financingBorder #FCD34D` |
| Loan / liability state | `loanBg #FFF7ED`, `loanText #C2410C`, `loanBorder #EA580C` |
| Chart ramp | `chartIncome #059669`, `chartFinancing #D97706`, `chartExpense #DC2626`, `chartLiability #EA580C`, `chartNetCashflow #0F172A`, `chartAsset #334155`, `chartInvestment #475569`, `chartPlan #CBD5E1`, `chartGrid #E2E8F0`, `chartAxis #94A3B8` |
| Overlays | `overlayScrim #0F172AA6`, `overlayScrimLight #0F172A33`, `overlayGhost #FFFFFFCC`, `overlayTint #FFFFFF1A` |
| Type scale | `FontSize.microLabel 10`, `FontSize.microValue 14` |
| Radius | `Radius.xl 20` |

The financing/loan states exist because the design distinguishes *where money
came from* (operating income vs financing inflow vs asset release) as a colour
axis separate from *where money went*. The chart ramp and overlays are declared
now because the later phases (Budget Health, Insight & Aset) consume them; the
hero and the allocation screen use the overlay and state tokens already.

## 2. The hero renders in **planned** mode

`app/(tabs)/index.tsx` calls `useZeroBasedSummary(householdId, cycleId, 'planned')`.

Zero-based budgeting is a planning method: the question it answers is "does this
month's plan hold?" In `actual` mode the hero would report zero allocatable
funds on day one of the cycle — technically true, because nothing has been spent
yet, and completely useless for the person deciding what to do next. `planned`
mode reads `planned_amount` off every row, which is the number the plan is
actually built from. Actual mode is still available and is what a reconciliation
view will use in a later phase.

## 3. `AllocationHeroCard`

New: `components/ui/AllocationHeroCard.tsx`.

The hero always prints the whole equation, never just the unallocated figure:

```
Total Sumber Dana  −  Total Alokasi  =  Unallocated Funds
```

The method's only real claim is that those three terms balance, so collapsing
two of them into a "detail" screen would leave the headline unfalsifiable. The
card also carries a breakdown grid that names every source and every
destination, and a footer that restates the status in one sentence.

`presentStatus(summary)` maps the domain status to copy, colour, helper text,
and footer text:

| Status | Badge | Meaning |
| --- | --- | --- |
| `COMPLETE` | Alokasi selesai | `unallocatedFunds === 0` — every rupiah has a destination |
| `UNALLOCATED` | Belum dialokasikan | `unallocatedFunds > 0` — money is idle, not "savings" |
| `FUNDING_GAP` | Funding gap | `requiredAllocation > sourceFunds` — the plan cannot be funded |

### Deliberate deviation from `design.pen`

design.pen tints the savings/asset values with `$brand.primary` on a
`$brand.primary` background — the text is invisible. The intent behind that
token choice is "this is neither a cost nor an income, so it is neutral", which
is a real distinction in this domain. Rather than reproduce an invisible label,
those values use `borderStrong`, which expresses neutral-and-legible on the dark
surface. The deviation is recorded in the component's doc comment so a future
reader does not "fix" it back.

## 4. `app/allocation.tsx` — Detail Alokasi

A new card-presented screen (registered in `app/_layout.tsx`).

- **Summary block** — source / allocation / unallocated with a status tone, plus
  a Funding Gap row and the three gap-closing strategies when `fundingGap > 0`.
- **Create form** — allocation-type chips, amount input, an obligation picker
  that appears only for `DEBT_PAYMENT`, and optional category chips.
- **Grouped list** — allocations grouped by type in `ALLOCATION_ORDER`, each
  group totalled, each row deletable.

Allocations are the *only* thing that feeds `allocations.total`. Transaction
`flow_type` classifies ledger rows but is never summed into the allocation
total — that is the anti-double-count rule from Phase 1 and it is what makes the
equation trustworthy.

## 5. `app/new-cycle.tsx` — funding-gap gate

Opening a cycle is the moment the plan becomes binding, so it is the moment to
refuse an unfundable plan.

- Every open obligation (`remaining_amount > 0`, not `SETTLED`/`CANCELLED`) is
  selected by default. A carried-over debt is not optional spending; leaving one
  out is exactly how a silent funding gap is created.
- `requiredAllocation = totalRecurring + totalDebtPayment`.
- `fundingGap = max(requiredAllocation − income, 0)`; the CTA reads **Tutup
  Funding Gap Dulu** and `submit()` refuses while `fundingGap > 0`.
- The projection panel replaced the old "Estimasi Sisa Bersih" number. What is
  left over is *unallocated*, not "net remaining" — zero-based means it still
  needs a purpose.
- A note states that financing inflow is not routine income and is not cloned
  into the next cycle.

## Verified

- `npx vitest run` — 24/24 passing.
- `npx tsc --noEmit` — clean.
- `npx expo lint` — no new findings (the 2 reported problems pre-date this phase:
  `app/(auth)/setup-choice.tsx:27` and `app/_layout.tsx:32`).

## Not done in this phase

- The Home hero is not yet rendered from `actual` data anywhere; the
  reconciliation view that would use it belongs with the ledger work (Phase 4).
- `HeroSplitCard` is now unused by the Home screen and is kept only for the
  README's component list; it should be deleted or repurposed in Phase 4.
- Migration `005` (installment schedules) has still not been run against a live
  database — see `docs/phase-2b-loan-lifecycle.md`.
