-- Kitasaku 003: perbaikan pendaftaran tabel ke publication Realtime + alat verifikasi.
--
-- Kenapa 002 tidak cukup:
--   `alter publication ... add table a, b, c` adalah SATU statement. Kalau salah satu
--   tabel sudah jadi member, seluruh statement gagal (duplicate_object) dan blok
--   `exception when duplicate_object then null` menelannya bulat-bulat → tabel lain
--   ikut batal terdaftar, tanpa pesan error apa pun. Jadi "sudah dijalankan" tidak
--   berarti tabelnya benar-benar terdaftar.
--
-- 003 ini: daftarkan SATU PER SATU (satu gagal tidak membatalkan yang lain),
-- set replica identity supaya filter DELETE/UPDATE jalan, lalu sediakan RPC
-- realtime_health() supaya statusnya bisa DIBUKTIKAN, bukan ditebak.

-- ============ 1. Pastikan publication-nya ada ============
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Publication supabase_realtime tidak ada. Aktifkan Realtime dulu di Dashboard Supabase (Database > Replication).';
  end if;
end $$;

-- ============ 2. Daftarkan tabel satu per satu (idempoten) ============
do $$
declare
  t text;
  tabel text[] := array[
    'transactions',
    'obligations',
    'recurring_templates',
    'cycles',
    'categories',
    'accounts',
    'household_members'
  ];
begin
  foreach t in array tabel loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'realtime: % ditambahkan ke publication', t;
    exception
      when duplicate_object then
        raise notice 'realtime: % sudah terdaftar (dilewati)', t;
    end;
  end loop;
end $$;

-- ============ 3. Replica identity: agar filter household_id ikut pada DELETE ============
-- Secara default hanya primary key yang dikirim saat DELETE, sehingga filter
-- `household_id=eq.<uuid>` di client tidak bisa dievaluasi dan event DELETE hilang.
alter table public.transactions        replica identity full;
alter table public.obligations         replica identity full;
alter table public.recurring_templates replica identity full;
alter table public.cycles              replica identity full;
alter table public.categories          replica identity full;
alter table public.accounts            replica identity full;

-- ============ 4. RPC verifikasi: buktikan tabel benar-benar terdaftar ============
create or replace function public.realtime_health()
returns table (tablename text, terdaftar boolean, replica_identity text)
language sql
security definer
set search_path = public, pg_catalog
as $$
  with daftar(tablename) as (
    values ('transactions'),('obligations'),('recurring_templates'),('cycles'),
           ('categories'),('accounts'),('household_members'),('households')
  )
  select
    d.tablename,
    exists (
      select 1 from pg_publication_tables pt
      where pt.pubname = 'supabase_realtime'
        and pt.schemaname = 'public'
        and pt.tablename = d.tablename
    ) as terdaftar,
    coalesce(c.relreplident::text, '-') as replica_identity
  from daftar d
  left join pg_class c
    on c.relname = d.tablename
   and c.relnamespace = 'public'::regnamespace
  order by d.tablename;
$$;

-- Boleh dipanggil dengan anon key supaya bisa dicek tanpa login.
grant execute on function public.realtime_health() to anon, authenticated;
