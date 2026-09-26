-- Kitasaku 002: safe join via invite code + realtime between devices
-- Run in the Supabase SQL Editor after 001.

-- ============ RPC: create a household (selective RLS bypass) ============
create or replace function public.create_household(p_name text, p_invite_code text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hh public.households;
begin
  if auth.uid() is null then
    raise exception 'Belum login.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Nama ruang keluarga wajib diisi.';
  end if;

  insert into public.households (name, invite_code)
  values (trim(p_name), upper(trim(p_invite_code)))
  returning * into v_hh;

  insert into public.household_members (household_id, user_id, role)
  values (v_hh.id, auth.uid(), 'OWNER')
  on conflict (household_id, user_id) do update set role = 'OWNER';

  return v_hh;
exception
  when unique_violation then
    raise exception 'Kode undangan sudah dipakai, coba lagi.';
end;
$$;

-- ============ RPC: preview a household before joining (without leaking everything) ============
create or replace function public.lookup_household_by_code(p_code text)
returns table (id uuid, name text, active_count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Belum login.';
  end if;
  return query
  select h.id, h.name, count(m.id)::bigint
  from public.households h
  left join public.household_members m on m.household_id = h.id
  where h.invite_code = upper(trim(p_code))
  group by h.id, h.name
  limit 1;
end;
$$;

-- ============ RPC: join via invite code ============
create or replace function public.join_household_by_code(p_code text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hh public.households;
begin
  if auth.uid() is null then
    raise exception 'Belum login.';
  end if;

  select * into v_hh
  from public.households
  where invite_code = upper(trim(p_code))
  limit 1;

  if v_hh.id is null then
    raise exception 'Kode undangan tidak ditemukan. Cek lagi kodenya ya.';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_hh.id, auth.uid(), 'PARTNER')
  on conflict (household_id, user_id) do nothing;

  return v_hh;
end;
$$;

grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.lookup_household_by_code(text) to authenticated;
grant execute on function public.join_household_by_code(text) to authenticated;

-- ============ Realtime: register tables with the publication ============
do $$
begin
  alter publication supabase_realtime add table
    public.transactions,
    public.obligations,
    public.recurring_templates,
    public.cycles,
    public.categories,
    public.accounts,
    public.household_members;
exception
  when duplicate_object then null;
  when others then null;
end $$;
