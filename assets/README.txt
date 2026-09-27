Kitasaku SVG Asset Pack
Lightweight vector assets aligned to the current Kitasaku visual direction.

All assets are scalable and can be resized without quality loss.
Import the individual SVGs into Pen.dev rather than using raster screenshots.

Brand: primary-logo, brand-mark, app-icon, splash-icon, favicon
Category: 13 category-*.svg files
Onboarding: 3 onboarding-*.svg files
Empty states: 6 empty-*.svg files
Contextual: 6 context-*.svg files

The SVGs are wired into the app. lib/brand-art.ts is generated from this folder
by gen-brand-art.py and rendered by components/ui/BrandIcon.tsx — see
docs/phase-6-brand-assets.md. Do not hand-edit lib/brand-art.ts; edit the SVG
and rerun the generator.

The raster icons here (icon.png, splash-icon.png, favicon.png,
android-icon-*.png) are the ones app.json points at, so keep those names. Expo's
app config takes image files rather than vectors, so these six are rastered from
the matching SVG by gen-icons.py. The *.original.png files are the pre-existing
Expo defaults, kept so a raster can be redone from a known baseline.
