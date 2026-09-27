-- Kitasaku 009: categories.icon.
--
-- Design source: design.pen "Screen 2B - Setup Category / Pick Icon" — the
-- "Pilih ikon" grid of 8 tiles, one of them selected, with a 48x48 box per tile.
-- The picker is a choice the family makes, so it has to be stored; deriving it
-- from the name at render time (what lib/category-icon.ts does today) cannot
-- represent "the family named this 'Hobi' and deliberately picked the
-- headphones", and it would silently change the icon whenever the name is
-- edited.
--
-- The column is deliberately NOT constrained to a list of values. The asset
-- pack grows, and a CHECK would then need a migration for every new icon;
-- worse, an icon removed from the pack would make its rows unwritable. Instead
-- the client validates against BRAND_ART_NAMES and falls back to the
-- name-derived icon when the stored name is not in the pack it ships with
-- (see `categoryIconName`). A stale value is therefore inert, not an error.
--
-- NULL means "no explicit choice", which is every row that exists today and
-- every category created before the picker is used. The client derives the icon
-- from the name and the category's type, so the screens look complete without a
-- backfill — and a backfill would be a guess that writes a choice nobody made,
-- the same stance 007 takes on `households.payday_day` and 008 on
-- `obligations.repayment_mode`.
--
-- Nothing in the money maths reads this column. It changes no amount, no
-- allocation and no status.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS; the comment is idempotent by nature.
--
-- ============ 1. categories.icon ============
alter table public.categories
  add column if not exists icon text;

comment on column public.categories.icon is
  'Asset-pack icon name, without .svg (e.g. category-hiburan). NULL = not chosen; the client derives one from the name and type. Validated client-side against BRAND_ART_NAMES, so a name the shipped pack does not have is ignored rather than fatal.';

-- Manual verification (SQL Editor, first run):
--   -- the column exists and every existing row is NULL (no backfill)
--   select count(*) filter (where icon is null) as unchosen, count(*) as total
--     from public.categories;
--   -- a picker choice round-trips
--   update public.categories set icon = 'category-hiburan' where id = '<category-uuid>';
--   select name, icon from public.categories where id = '<category-uuid>';
--   -- an unknown name is accepted by the database and ignored by the client
--   update public.categories set icon = 'category-yang-tidak-ada' where id = '<category-uuid>';
--   -- clearing the choice returns the row to "derive from the name"
--   update public.categories set icon = null where id = '<category-uuid>';
