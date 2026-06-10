-- v2 relational schema. Lives alongside app_data (v1) until cutover.
-- Applied to project payymfcvjrhxlgzyplvx as migration "v2_relational_schema".

create table public.markets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  average_deal_value numeric,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null check (role in ('regional','market_owner')),
  market_id uuid references public.markets(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint mo_needs_market check (role <> 'market_owner' or market_id is not null)
);

create table public.reps (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id),
  name text not null,
  role text not null check (role in ('knocker','closer')),
  start_date date not null default current_date,
  active boolean not null default true,
  terminated boolean not null default false,
  terminated_at date,
  recruits int not null default 0,
  created_at timestamptz not null default now()
);
create index reps_market_idx on public.reps (market_id);

create table public.kpi_entries (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.reps(id) on delete cascade,
  market_id uuid not null references public.markets(id),
  entry_date date not null,
  doors_knocked int not null default 0,
  convos_had int not null default 0,
  sets_set int not null default 0,
  appts_ran int not null default 0,
  appts_closed int not null default 0,
  cads int not null default 0,
  closes int not null default 0,
  revenue numeric not null default 0,
  self_gen_sets int not null default 0,
  self_gen_closes int not null default 0,
  appt_sources text,
  credit_fails jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (rep_id, entry_date)
);
create index kpi_entries_market_date_idx on public.kpi_entries (market_id, entry_date);
create index kpi_entries_rep_date_idx on public.kpi_entries (rep_id, entry_date);

create table public.escalations (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.reps(id) on delete cascade,
  market_id uuid not null references public.markets(id),
  entry_date date not null default current_date,
  severity text not null check (severity in ('coaching','warning','final','termination')),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index escalations_market_idx on public.escalations (market_id);

create table public.event_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  actor_email text,
  message text not null,
  market_id uuid references public.markets(id)
);
create index event_log_market_ts_idx on public.event_log (market_id, ts desc);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- RLS helpers (security definer so policies on profiles don't recurse)
create or replace function public.is_regional()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'regional' and active) $$;

create or replace function public.my_market()
returns uuid language sql stable security definer set search_path = public as
$$ select market_id from profiles where id = auth.uid() and active $$;

create or replace function public.has_profile()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and active) $$;

revoke execute on function public.is_regional(), public.my_market(), public.has_profile() from anon;

alter table public.markets enable row level security;
alter table public.profiles enable row level security;
alter table public.reps enable row level security;
alter table public.kpi_entries enable row level security;
alter table public.escalations enable row level security;
alter table public.event_log enable row level security;
alter table public.app_settings enable row level security;

-- markets: MO sees own market; regional sees and manages all
create policy markets_select on public.markets for select to authenticated
  using (is_regional() or id = my_market());
create policy markets_write on public.markets for all to authenticated
  using (is_regional()) with check (is_regional());

-- profiles: users see their own row; regional sees/manages all (creation goes through edge function)
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or is_regional());
create policy profiles_write on public.profiles for all to authenticated
  using (is_regional()) with check (is_regional());

-- reps: MO manages own market roster (no delete; termination is a soft flag); regional everything
create policy reps_select on public.reps for select to authenticated
  using (is_regional() or market_id = my_market());
create policy reps_insert on public.reps for insert to authenticated
  with check (is_regional() or market_id = my_market());
create policy reps_update on public.reps for update to authenticated
  using (is_regional() or market_id = my_market())
  with check (is_regional() or market_id = my_market());
create policy reps_delete on public.reps for delete to authenticated
  using (is_regional());

-- kpi_entries / escalations: same market scoping
create policy kpi_select on public.kpi_entries for select to authenticated
  using (is_regional() or market_id = my_market());
create policy kpi_insert on public.kpi_entries for insert to authenticated
  with check (is_regional() or market_id = my_market());
create policy kpi_update on public.kpi_entries for update to authenticated
  using (is_regional() or market_id = my_market())
  with check (is_regional() or market_id = my_market());
create policy kpi_delete on public.kpi_entries for delete to authenticated
  using (is_regional() or market_id = my_market());

create policy esc_select on public.escalations for select to authenticated
  using (is_regional() or market_id = my_market());
create policy esc_insert on public.escalations for insert to authenticated
  with check (is_regional() or market_id = my_market());
create policy esc_delete on public.escalations for delete to authenticated
  using (is_regional() or market_id = my_market());

-- event_log: append-only audit; scoped reads
create policy log_select on public.event_log for select to authenticated
  using (is_regional() or market_id = my_market());
create policy log_insert on public.event_log for insert to authenticated
  with check (has_profile() and (is_regional() or market_id = my_market()));

-- app_settings: everyone with a profile reads; regional writes
create policy settings_select on public.app_settings for select to authenticated
  using (has_profile());
create policy settings_write on public.app_settings for all to authenticated
  using (is_regional()) with check (is_regional());

-- keep kpi_entries.updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql security definer set search_path = public as
$$ begin new.updated_at = now(); return new; end $$;
create trigger kpi_touch before update on public.kpi_entries
  for each row execute function public.touch_updated_at();

-- seed the 6 markets
insert into public.markets (name) values
  ('Birmingham, AL'), ('Boise, ID'), ('El Paso, TX'),
  ('Houston, TX'), ('Las Vegas, NV'), ('Phoenix, AZ');

-- bootstrap Jake as regional
insert into public.profiles (id, email, display_name, role)
select id, email, 'Jake', 'regional' from auth.users
where email = 'jacobtrichards51@gmail.com';

-- default global settings
insert into public.app_settings (key, value) values ('global', '{"averageDealValue": 0}'::jsonb);
