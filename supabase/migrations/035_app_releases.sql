-- Kitasaku 035: app_releases, the version gate for sideloaded APKs.
-- Apply only after 001–034. Fully idempotent. No existing rows are touched.
--
-- One row per platform. The app compares its own Android versionCode with:
--   latest_version_code → soft notice "Kitasaku x.y.z tersedia" (can be postponed)
--   min_version_code    → blocking "Perlu update dulu" screen
-- Not household data and not money: readable by anyone (the gate also runs
-- before sign-in), writable only from the SQL Editor (service role). No
-- realtime: the app re-reads it on launch and when it returns to foreground.
--
-- Release order for a breaking change (e.g. revoking an RPC grant):
--   1. apply the migration that ADDS the new path
--   2. build + publish the APK, then bump latest_version_code / apk_url
--   3. bump min_version_code to that build
--   4. only then apply the migration that REMOVES the old path

create table if not exists public.app_releases (
  platform text primary key check (platform in ('android')),
  latest_version_code int not null check (latest_version_code > 0),
  latest_version_name text not null check (length(trim(latest_version_name)) > 0),
  min_version_code int not null default 1 check (min_version_code > 0),
  apk_url text check (apk_url is null or apk_url ~ '^https://'),
  notes text check (notes is null or length(notes) <= 1000),
  updated_at timestamptz not null default now(),
  constraint app_releases_min_le_latest check (min_version_code <= latest_version_code)
);

alter table public.app_releases enable row level security;

drop policy if exists "app_releases_public_read" on public.app_releases;
create policy "app_releases_public_read"
  on public.app_releases for select
  to anon, authenticated
  using (true);
-- No insert/update/delete policies: edit the row from the SQL Editor.

grant select on public.app_releases to anon, authenticated;

create or replace function public.touch_app_releases_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists app_releases_touch_updated_at on public.app_releases;
create trigger app_releases_touch_updated_at
  before update on public.app_releases
  for each row execute function public.touch_app_releases_updated_at();

-- Seed with a no-op gate (min 1, latest 1) so nothing fires until a release is
-- published. Existing values are kept on re-run.
insert into public.app_releases (platform, latest_version_code, latest_version_name, min_version_code)
values ('android', 1, '1.0.0', 1)
on conflict (platform) do nothing;

-- ============ Manual verification (SQL Editor, first run) ============
--
-- 1. The row exists and is readable:
--   select * from public.app_releases;
--
-- 2. Publish a release after uploading the APK (versionCode from the EAS build page):
--   update public.app_releases
--      set latest_version_code = <versionCode>,
--          latest_version_name = '1.2.0',
--          apk_url = 'https://<public apk url>',
--          notes = E'Notifikasi Ruang Keluarga\nBayar beberapa tanggungan sekaligus'
--    where platform = 'android';
--
-- 3. Force every older build to update (only after step 2 is live):
--   update public.app_releases set min_version_code = latest_version_code where platform = 'android';
--
-- 4. The constraint rejects min above latest (expect an error):
--   update public.app_releases set min_version_code = latest_version_code + 1 where platform = 'android';
