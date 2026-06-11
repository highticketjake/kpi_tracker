-- Applied as migration "v2_1_simplified_counts".
-- v2.1 revamp: simplified daily-counts model + market revenue goals.
-- No production data existed yet, so reshaping in place was safe.
alter table public.kpi_entries drop column credit_fails;
alter table public.kpi_entries add column credit_fails int not null default 0;
alter table public.kpi_entries add column cancels int not null default 0;
alter table public.kpi_entries drop column appt_sources;
alter table public.markets add column monthly_goal numeric;
