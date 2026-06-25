-- Applied as migration "v2_3_region_board_data" to project payymfcvjrhxlgzyplvx.
-- Region-wide read for TV + Challenge. Security definer so every authenticated
-- profile sees all markets' aggregate + rep-level board data (Jake's call:
-- full region-wide leaderboards for the competition). Base-table RLS is
-- unchanged, so EDITING stays market-scoped; only these read-only boards go wide.
create or replace function public.region_board_data(p_start date)
returns jsonb
language sql stable security definer set search_path = public as
$$
  select case when has_profile() then jsonb_build_object(
    'markets', (select coalesce(jsonb_agg(to_jsonb(m) order by m.name), '[]'::jsonb) from markets m),
    'reps',    (select coalesce(jsonb_agg(to_jsonb(r) order by r.name), '[]'::jsonb) from reps r),
    'entries', (select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb)
                  from kpi_entries k where k.entry_date >= p_start)
  ) else null end;
$$;
revoke execute on function public.region_board_data(date) from public, anon;
grant execute on function public.region_board_data(date) to authenticated;

-- Fix the weekly challenge totals to match calc.marketTotals (closer closes only).
-- Knocker 'closes' is attribution and must NOT count as a market close.
create or replace function public.market_range_totals(p_start date, p_end date)
returns table(market_id uuid, market_name text, closes bigint, revenue numeric, sets bigint)
language sql stable security definer set search_path = public as
$$
  select m.id, m.name,
         coalesce(sum(case when r.role='closer' then k.appts_closed + k.self_gen_closes else 0 end), 0)::bigint,
         coalesce(sum(case when r.role='closer' then k.revenue else 0 end), 0),
         coalesce(sum(k.sets_set + case when r.role='closer' then k.self_gen_sets else 0 end), 0)::bigint
  from markets m
  left join reps r on r.market_id = m.id
  left join kpi_entries k on k.rep_id = r.id and k.entry_date between p_start and p_end
  where has_profile()
  group by m.id, m.name
  order by m.name
$$;
revoke execute on function public.market_range_totals(date, date) from public, anon;
grant execute on function public.market_range_totals(date, date) to authenticated;
