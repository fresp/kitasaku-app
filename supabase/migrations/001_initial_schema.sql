-- Kitasaku initial schema: household-centric family spending
-- Run in the Supabase SQL Editor (or via the supabase CLI).

-- ============ Households ============
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name varchar not null,
  invite_code varchar(10) unique,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role varchar not null default 'PARTNER' check (role in ('OWNER', 'PARTNER')),
  joined_at timestamptz not null default now(),
  unique (household_id, user_id)
);

-- ============ Reference tables ============
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name varchar not null,
  monthly_budget bigint not null default 0,
  type varchar not null default 'EXPENSE' check (type in ('EXPENSE', 'INCOME', 'INVESTMENT'))
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name varchar not null,
  type varchar not null default 'BANK' check (type in ('BANK', 'CREDIT_CARD', 'E_WALLET', 'CASH'))
);

-- ============ Cycles & templates ============
create table if not exists public.cycles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name varchar not null,
  start_date date not null,
  end_date date not null,
  is_active boolean not null default false
);

create table if not exists public.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name varchar not null,
  category_id uuid references public.categories(id),
  account_id uuid references public.accounts(id),
  direction varchar not null default 'EXPENSE' check (direction in ('INCOME', 'EXPENSE')),
  default_amount bigint not null default 0,
  status varchar not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED')),
  notes text
);

-- ============ Obligations (payables & reimbursements) ============
create table if not exists public.obligations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title varchar not null,
  type varchar not null default 'BILL' check (type in ('REIMBURSE', 'DEBT', 'BILL')),
  recipient varchar,
  total_amount bigint not null default 0,
  remaining_amount bigint not null default 0,
  status varchar not null default 'UNPAID' check (status in ('UNPAID', 'PARTIAL', 'SETTLED')),
  created_at timestamptz not null default now(),
  notes text
);

-- ============ Transactions ============
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  cycle_id uuid references public.cycles(id) on delete set null,
  recurring_template_id uuid references public.recurring_templates(id) on delete set null,
  obligation_id uuid references public.obligations(id) on delete set null,
  name varchar not null,
  category_id uuid references public.categories(id),
  account_id uuid references public.accounts(id),
  direction varchar not null default 'EXPENSE' check (direction in ('INCOME', 'EXPENSE')),
  planned_amount bigint not null default 0,
  actual_amount bigint not null default 0,
  release_date date,
  status varchar not null default 'PENDING' check (status in ('PENDING', 'PAID')),
  created_by uuid references auth.users(id),
  executed_by uuid references auth.users(id),
  recipient varchar,
  is_final_payment boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============ RLS ============
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.categories enable row level security;
alter table public.accounts enable row level security;
alter table public.cycles enable row level security;
alter table public.recurring_templates enable row level security;
alter table public.obligations enable row level security;
alter table public.transactions enable row level security;

create policy "members_can_read_household"
  on public.households for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = households.id and m.user_id = auth.uid()
  ));

create policy "members_manage_household_tables"
  on public.household_members for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "household_scoped_select_categories"
  on public.categories for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = categories.household_id and m.user_id = auth.uid()
  ));
create policy "household_scoped_write_categories"
  on public.categories for all
  using (exists (
    select 1 from public.household_members m
    where m.household_id = categories.household_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = categories.household_id and m.user_id = auth.uid()
  ));

create policy "household_scoped_select_accounts"
  on public.accounts for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = accounts.household_id and m.user_id = auth.uid()
  ));
create policy "household_scoped_write_accounts"
  on public.accounts for all
  using (exists (
    select 1 from public.household_members m
    where m.household_id = accounts.household_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = accounts.household_id and m.user_id = auth.uid()
  ));

create policy "household_scoped_select_cycles"
  on public.cycles for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = cycles.household_id and m.user_id = auth.uid()
  ));
create policy "household_scoped_write_cycles"
  on public.cycles for all
  using (exists (
    select 1 from public.household_members m
    where m.household_id = cycles.household_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = cycles.household_id and m.user_id = auth.uid()
  ));

create policy "household_scoped_select_templates"
  on public.recurring_templates for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = recurring_templates.household_id and m.user_id = auth.uid()
  ));
create policy "household_scoped_write_templates"
  on public.recurring_templates for all
  using (exists (
    select 1 from public.household_members m
    where m.household_id = recurring_templates.household_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = recurring_templates.household_id and m.user_id = auth.uid()
  ));

create policy "household_scoped_select_obligations"
  on public.obligations for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = obligations.household_id and m.user_id = auth.uid()
  ));
create policy "household_scoped_write_obligations"
  on public.obligations for all
  using (exists (
    select 1 from public.household_members m
    where m.household_id = obligations.household_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = obligations.household_id and m.user_id = auth.uid()
  ));

create policy "household_scoped_select_transactions"
  on public.transactions for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = transactions.household_id and m.user_id = auth.uid()
  ));
create policy "household_scoped_write_transactions"
  on public.transactions for all
  using (exists (
    select 1 from public.household_members m
    where m.household_id = transactions.household_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = transactions.household_id and m.user_id = auth.uid()
  ));
