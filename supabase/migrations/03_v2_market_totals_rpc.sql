-- Applied as migration "v2_market_totals_rpc".
-- Aggregate market totals for the weekly challenge scoreboard.
-- Security definer on purpose: MOs may see other markets' TOTALS (closes/revenue),
-- never rep-level rows. Gated on having an active profile.
create or replace function public.market_range_totals(p_start date, p_end date)
returns table(market_id uuid, market_name text, closes bigint, revenue numeric, sets bigint)
language sql stable security definer set search_path = public as
$$
  select m.id, m.name,
         coalesce(sum(k.closes), 0)::bigint,
         coalesce(sum(k.revenue), 0),
         coalesce(sum(k.sets_set), 0)::bigint
  from markets m
  left join kpi_entries k on k.market_id = m.id and k.entry_date between p_start and p_end
  where has_profile()
  group by m.id, m.name
  order by m.name
$$;
revoke execute on function public.market_range_totals(date, date) from public, anon;
grant execute on function public.market_range_totals(date, date) to authenticated;
