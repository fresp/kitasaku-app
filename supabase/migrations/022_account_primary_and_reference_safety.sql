-- Kitasaku 022: keep active-cycle primary accounts usable and protect account history.
-- Forward-only; does not rewrite existing transactions or reconcile historical rows.

create or replace function public.validate_cycle_primary_account_household()
returns trigger
language plpgsql
as $$
declare
  v_ref_household uuid;
  v_type text;
  v_active boolean;
begin
  if new.primary_account_id is not null then
    select a.household_id, a.type, a.is_active
      into v_ref_household, v_type, v_active
      from public.accounts a
      where a.id = new.primary_account_id;
    if v_ref_household is null or v_ref_household <> new.household_id then
      raise exception 'cycles: primary account % does not belong to household %', new.primary_account_id, new.household_id;
    end if;
    if v_type <> 'BANK' or not coalesce(v_active, false) then
      raise exception 'cycles: primary account must be an active BANK account.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_archiving_primary_bank_account()
returns trigger
language plpgsql
as $$
begin
  if old.is_active is distinct from false
     and new.is_active = false
     and exists (
       select 1 from public.cycles c
       where c.household_id = old.household_id
         and c.primary_account_id = old.id
         and c.is_active = true
     ) then
    raise exception 'Pilih rekening utama pengganti sebelum mengarsipkan akun BANK ini.';
  end if;
  if new.type is distinct from old.type and new.type <> 'BANK'
     and old.type = 'BANK'
     and exists (
       select 1 from public.cycles c
       where c.household_id = old.household_id
         and c.primary_account_id = old.id
         and c.is_active = true
     ) then
    raise exception 'Pilih rekening utama pengganti sebelum mengubah tipe akun BANK ini.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_archiving_primary_bank_account on public.accounts;
create trigger trg_prevent_archiving_primary_bank_account
  before update of is_active, type on public.accounts
  for each row execute function public.prevent_archiving_primary_bank_account();

comment on function public.prevent_archiving_primary_bank_account() is
  'Prevents an account from becoming unavailable while referenced as an active cycle primary; history remains untouched.';

-- Account usage is queried by the client before offering permanent deletion.
-- Preserve every foreign-key reference, not just the displayed transaction side.
-- Manual verification: archive/type-change of an active cycle primary is rejected;
-- after choosing another primary, archive succeeds; account references remain intact.
