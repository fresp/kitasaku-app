# Phase 6 — Brand assets

The asset pack in `assets/` is 30 SVGs plus the rasters `app.json` points at.
Wiring it up raised four problems that are not obvious from looking at the
files, and each answer is recorded here because the next asset added will hit
the same question.

## 1. Why the SVGs are transcribed into TypeScript

The normal way to use an SVG in a React Native app is
`react-native-svg-transformer`, which lets a screen write
`import Rumah from '../assets/category-rumah.svg'`. The transformer needs a
`metro.config.js`, and this project deliberately has none — the untouched
default Expo Metro setup is worth more than the import syntax.

So `lib/brand-art.ts` holds the geometry as data and
`components/ui/BrandIcon.tsx` is the single component that touches
`react-native-svg`. The geometry is not hand-copied: `gen-brand-art.py` walks
`assets/*.svg` and writes both `lib/brand-art.ts` (what the app imports) and
`brand-art.json` (what the verifier reads back).

`verify-brand-art.py` closes the loop. It renders each original SVG and an SVG
rebuilt from the transcribed JSON at the same size, and diffs them pixel by
pixel. A mistyped coordinate, a dropped attribute or a missing element shows up
as a different image, so the transcription never has to be trusted by eye. All
30 icons currently re-render at 0.00% differing pixels.

Adding an icon means dropping the SVG in `assets/`, rerunning
`gen-brand-art.py`, and rerunning `verify-brand-art.py`. No component changes.

## 2. A missing `fill` means black, and the pack relies on that not happening

SVG's default fill is black, not "no fill". An outline drawn with `stroke` and
no `fill` attribute renders as a solid black blob, and the pack arrived with 48
shapes that had lost their `fill="none"` — presumably in whatever export step
produced the SVGs.

`fix-svg-fills.py` restored them at the source, which is the right layer: fixing
it in `BrandIcon` would have made a genuine "no fill" indistinguishable from a
dropped attribute forever. `BrandIcon` still has to choose something when the
attribute is genuinely absent, and it chooses `'none'` rather than SVG's black,
because in a stroke-only icon pack the absence of `fill` almost always means the
outline case.

## 3. Native icons must stay rasters

`app.json` points at `icon.png`, `splash-icon.png`, `favicon.png` and the three
`android-icon-*.png` files. Expo's app config takes image files, not vectors, so
those six stay PNG and `gen-icons.py` rasters them from the matching SVG at the
right size. The `.original.png` files beside them are the pre-existing Expo
defaults, kept so a raster can be redone from a known baseline.

`assets/README.txt` lists which is which.

## 4. The picker needs a stored choice

Screen 2B is a grid of tappable icon tiles with a selected indicator, so it is a
real choice, not a decoration. `lib/category-icon.ts` derives an icon from the
category's name, which cannot represent "the family renamed this to Hobi and
deliberately kept the headphones", and would silently change the icon on every
rename.

Migration `009_category_icon.sql` adds `categories.icon`. It is deliberately
unconstrained and deliberately not backfilled, matching the stance `007` takes
on `households.payday_day` and `008` on `obligations.repayment_mode`: a backfill
would write a choice nobody made.

`categoryIconName` resolves in this order:

1. `cat.icon`, if it is a name the shipped pack actually has. A value the pack
   does not have is ignored rather than rendered as nothing, because the column
   is unconstrained by design and a row written by a different build must still
   render.
2. The two system categories, by `systemRole` — those are the app's own
   vocabulary, so a rename must not change them.
3. The name heuristic, then the type fallback.

Tests 153–157 pin that order, including that a pick outranks a rename, outranks
the system role, and that null/undefined/`''` all mean "derive from the name".

## 5. Where each illustration went

Categories (13) appear in the ledger rows, category chips, the allocation
screen, budget health, templates, and the 2B picker.

Empty states (6) are chosen by *why* the list is empty, not by which screen it
is: a filter matching nothing gets `empty-data-tidak-ditemukan`, a genuinely
empty ledger gets `empty-belum-ada-transaksi`, and the templates screen
distinguishes "no plans yet" from "no plan matches this filter".

Context illustrations (6) sit on the block each one draws: `context-home` on
Home's greeting, `context-family` on Ruang Keluarga's household card,
`context-budget` beside the budget ring, `context-calendar` on Buka Siklus,
`context-goal` on the zero-based allocation sheet, and `context-payment` on the
payment sheet's settled state.

Onboarding (3) had no screen. The design file's Flow F is the sign-in form, and
the three illustrations with their copy exist only in the asset library's
"03 Onboarding Illustrations" showcase — nothing in `design.pen` assembles them.
`app/(auth)/welcome.tsx` is that assembly, and `lib/onboarding.ts` remembers it
has been seen so it shows once. The gate in `app/_layout.tsx` reads that flag on
every navigation rather than caching it in state: tapping "Mulai" writes the
flag and pushes to sign-in in the same tick, so a state copy would still read
`false` on the next pass and bounce the family back to the slide they just left.

## 6. Migration to high-fidelity PNG illustrations

The original SVG pack contained minimal geometric outlines. A richer illustration
set from the Kitasaku showcase sheet (`design/assets-library.png`) provides 15
high-fidelity artwork pieces:

- 3 Onboarding illustrations (`onboarding-01` to `03`)
- 6 Empty state illustrations (`empty-*`)
- 6 Context illustrations (`context-*`)

### Mixed pipeline: PNG first with SVG fallback

1. **Dual resolution in `BrandIcon`**: `components/ui/BrandIcon.tsx` inspects a
   static `BRAND_PNG` registry. If an illustration exists as a PNG, it renders
   as a React Native `<Image>` preserving its natural aspect ratio scaled to `size`.
2. **SVG fallback**: All 13 category glyphs (`category-*`) and brand assets
   (`brand-mark`, `primary-logo`) remain vectors in `BRAND_ART`. At small sizes
   (16–24px) in ledger rows and picker grids, crisp vector outlines perform
   optimally, so keeping them on SVG without forcing raster equivalents avoids
   blurriness on high-DPI screens.
3. **Zero call site churn**: Screens continue to use `<BrandIcon name="..." size={...} />`
   without needing separate import paths or conditional rendering.

