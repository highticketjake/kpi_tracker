-- Applied as migration "v2_3_ran_model" to project payymfcvjrhxlgzyplvx.
-- v2.3: introduce no_gos and make appts_ran a derived, consistent value.
-- ran = no_gos + (closer: appts_closed | knocker: closes) + credit_fails.
-- CADs and cancels never count as ran. Per Jake: old "appts_ran" already meant
-- no-gos + closes + credit-fails, so backfill no_gos from it (role-aware) and
-- re-derive appts_ran to repair rows where a close/credit-fail was logged but
-- ran was understated (9 rows corrected; 332 unchanged).

alter table public.kpi_entries add column if not exists no_gos int not null default 0;

-- 1) derive no_gos from the historical appts_ran (clamped at 0)
update public.kpi_entries k
set no_gos = greatest(
  0,
  k.appts_ran - (case when r.role = 'closer' then k.appts_closed else k.closes end) - k.credit_fails
)
from public.reps r
where r.id = k.rep_id;

-- 2) re-derive appts_ran so ran is internally consistent everywhere
update public.kpi_entries k
set appts_ran = k.no_gos + (case when r.role = 'closer' then k.appts_closed else k.closes end) + k.credit_fails
from public.reps r
where r.id = k.rep_id;
