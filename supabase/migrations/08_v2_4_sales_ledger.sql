-- Applied as migration "v2_4_sales_ledger" to project payymfcvjrhxlgzyplvx.
-- v2.4: individual sale ledger. Source of truth for closes + revenue + knocker
-- attribution going forward. Legacy June closes/revenue stay in kpi_entries
-- (frozen); totals combine the two disjoint sources. Cancel = set cancelled_at
-- (never delete) so the close/yes + knocker promotion credit + ran survive while
-- the revenue is excluded.
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id),
  closer_id uuid not null references public.reps(id) on delete cascade,
  knocker_id uuid references public.reps(id) on delete set null,
  attribution text not null default 'knocker' check (attribution in ('knocker','self_gen','house')),
  sale_date date not null default current_date,
  amount numeric not null default 0,
  cancelled_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index sales_market_date_idx on public.sales (market_id, sale_date);
create index sales_closer_date_idx on public.sales (closer_id, sale_date);
create index sales_knocker_date_idx on public.sales (knocker_id, sale_date);

alter table public.sales enable row level security;

create policy sales_select on public.sales for select to authenticated
  using (is_regional() or market_id = my_market());
create policy sales_insert on public.sales for insert to authenticated
  with check (is_regional() or market_id = my_market());
create policy sales_update on public.sales for update to authenticated
  using (is_regional() or market_id = my_market())
  with check (is_regional() or market_id = my_market());
create policy sales_delete on public.sales for delete to authenticated
  using (is_regional() or market_id = my_market());
