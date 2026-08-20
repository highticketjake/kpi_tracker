-- v2.5: region-wide READ visibility (Jake, 2026-08-19).
-- Market owners could only SELECT their own market's rows, so every tab except
-- TV/Challenge (which use the region_board_data RPC) looked market-scoped and
-- cross-market visibility "never worked". Fix it at the source: anyone with an
-- active profile can READ all markets' numbers; INSERT/UPDATE/DELETE stay
-- scoped to the owner's market (unchanged). Escalations remain market-private —
-- they're disciplinary records, not scoreboard numbers.
-- Bonus: postgres_changes realtime events follow SELECT policies, so market
-- owners now receive live updates for every market (the "Google doc" behavior).

drop policy if exists markets_select on public.markets;
create policy markets_select on public.markets
  for select to authenticated using (has_profile());

drop policy if exists reps_select on public.reps;
create policy reps_select on public.reps
  for select to authenticated using (has_profile());

drop policy if exists kpi_select on public.kpi_entries;
create policy kpi_select on public.kpi_entries
  for select to authenticated using (has_profile());

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
  for select to authenticated using (has_profile());
