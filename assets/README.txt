Kitasaku Asset Pack (Mixed Vector + Raster)
Visual assets aligned to the Kitasaku brand direction.

1. Raster PNGs (15 illustrations)
Extracted from the Kitasaku showcase sheet (assets-library.png) replacing old SVGs:
- Onboarding (3): onboarding-01-family-finance, onboarding-02-expense-tracking, onboarding-03-shared-goal
- Empty states (6): empty-belum-ada-pemasukan, empty-belum-ada-rencana, empty-belum-ada-tabungan, empty-belum-ada-transaksi, empty-data-tidak-ditemukan, empty-tidak-ada-tagihan
- Contextual (6): context-budget, context-calendar, context-family, context-goal, context-home, context-payment

2. Vector SVGs (preserved via lib/brand-art.ts)
- Brand marks: brand-mark, primary-logo, app-icon, splash-icon, favicon
- Category glyphs (13): category-belanja, category-hiburan, category-hutang, category-kesehatan, category-lainnya, category-makan-minum, category-pemasukan, category-pendidikan, category-rumah, category-tabungan, category-tagihan, category-transportasi, category-travel

How they are rendered:
`components/ui/BrandIcon.tsx` resolves assets by name. If an illustration has a
PNG raster asset, it renders as a native Image respecting the asset's aspect ratio.
If only vector data is present (categories and brand marks), it renders the SVG
geometry defined in `lib/brand-art.ts`.

Native app rasters:
The app icons (icon.png, splash-icon.png, favicon.png, android-icon-*.png) are
configured in app.json. The *.original.png files are baseline backups.
