-- Applied as migration "v2_4_sales_rpcs" to project payymfcvjrhxlgzyplvx.
-- region_board_data v2: also return region-wide sales (>= p_start) so TV +
-- Challenge can compute closes/revenue from the ledger with the same calc math.
create or replace function public.region_board_data(p_start date)
returns jsonb
language sql stable security definer set search_path = public as
$$
  select case when has_profile() then jsonb_build_object(
    'markets', (select coalesce(jsonb_agg(to_jsonb(m) order by m.name), '[]'::jsonb) from markets m),
    'reps',    (select coalesce(jsonb_agg(to_jsonb(r) order by r.name), '[]'::jsonb) from reps r),
    'entries', (select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb)
                  from kpi_entries k where k.entry_date >= p_start),
    'sales',   (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
                  from sales s where s.sale_date >= p_start)
  ) else null end;
$$;
revoke execute on function public.region_board_data(date) from public, anon;
grant execute on function public.region_board_data(date) to authenticated;

-- Let a market owner set their OWN market's monthly goal (regional can set any).
-- Security definer so it works without granting MOs broad write on markets.
create or replace function public.set_market_goal(p_market uuid, p_goal numeric)
returns numeric
language plpgsql security definer set search_path = public as
$$
declare v numeric;
begin
  if not (is_regional() or p_market = my_market()) then
    raise exception 'not allowed to set this market''s goal';
  end if;
  update markets set monthly_goal = p_goal where id = p_market returning monthly_goal into v;
  return v;
end;
$$;
revoke execute on function public.set_market_goal(uuid, numeric) from public, anon;
grant execute on function public.set_market_goal(uuid, numeric) to authenticated;
