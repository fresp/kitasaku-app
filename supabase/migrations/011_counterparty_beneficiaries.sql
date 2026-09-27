-- Kitasaku 011: counterparty beneficiaries for obligations & bills (Flow K).
--
-- Architecture & Context:
--   Internal asset accounts (`public.accounts`) represent household payment sources
--   (e.g., Mandiri, CC, ShopeePay, Tunai) and must NEVER store external destination accounts.
--   Counterparty beneficiaries (e.g., school tuition, landlord rent, monthly laundry,
--   repair shop) belong strictly to deferred obligations (`public.obligations`).
--
-- Design source: design.pen (Flow K — Frames K1, K2, K3)
--   * Frame K1: Form Tanggungan with progressive disclosure card "+ Tambah Rekening Tujuan Transfer"
--   * Frame K2: Bottom Sheet Pilih / Tambah Rekening Penerima (saved counterparty or inline form)
--   * Frame K3: Detail Tanggungan & Action Card "Info Transfer Pembayaran" (bank badge,
--     tabular account number, 1-tap "Salin" CTA, and account holder name)

-- ============ 1. Table public.beneficiaries ============
create table if not exists public.beneficiaries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  bank_name text not null,
  account_number text not null,
  account_holder_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint beneficiaries_name_length_check check (length(trim(name)) >= 2),
  constraint beneficiaries_bank_name_length_check check (length(trim(bank_name)) >= 2),
  constraint beneficiaries_account_number_length_check check (length(trim(account_number)) between 4 and 34)
);

comment on table public.beneficiaries is
  'External counterparty payment destination accounts (e.g. landlord, school, vendor) attached to obligations/bills. Distinct from internal household accounts.';
comment on column public.beneficiaries.name is
  'User label for counterparty (e.g. "Pak Joko (Kontrakan)", "Yayasan Al-Azhar").';
comment on column public.beneficiaries.bank_name is
  'Name of bank or e-wallet provider (e.g. "BCA", "Mandiri", "BRI", "GoPay").';
comment on column public.beneficiaries.account_number is
  'Full destination account or virtual account number.';
comment on column public.beneficiaries.account_holder_name is
  'Account holder name printed on recipient bank account (e.g. "Joko Susilo").';

-- Index on household_id for fast household-scoped listing
create index if not exists idx_beneficiaries_household_id
  on public.beneficiaries (household_id);

-- ============ 2. Alter public.obligations ============
alter table public.obligations
  add column if not exists beneficiary_id uuid references public.beneficiaries(id) on delete set null;

comment on column public.obligations.beneficiary_id is
  'Optional reference to counterparty destination account for payments/transfers.';

-- Index on obligations.beneficiary_id for reverse lookups and joins
create index if not exists idx_obligations_beneficiary_id
  on public.obligations (beneficiary_id);

-- ============ 3. Row Level Security (RLS) ============
alter table public.beneficiaries enable row level security;

create policy "household_scoped_select_beneficiaries"
  on public.beneficiaries for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = beneficiaries.household_id and m.user_id = auth.uid()
  ));

create policy "household_scoped_write_beneficiaries"
  on public.beneficiaries for all
  using (exists (
    select 1 from public.household_members m
    where m.household_id = beneficiaries.household_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = beneficiaries.household_id and m.user_id = auth.uid()
  ));

-- ============ 4. Realtime Publication ============
-- Register beneficiaries in supabase_realtime publication with replica identity full
alter table public.beneficiaries replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.beneficiaries';
      raise notice 'realtime: beneficiaries added to publication';
    exception
      when duplicate_object then
        raise notice 'realtime: beneficiaries already registered (skipped)';
    end;
  end if;
end $$;
