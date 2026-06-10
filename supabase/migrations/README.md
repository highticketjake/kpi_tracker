# Database migrations (reference copies)

These SQL files mirror migrations that were applied to the Supabase project
`kpi-tracker` (ref `payymfcvjrhxlgzyplvx`) via the Supabase MCP on 2026-06-10.
They are kept in the repo so the schema is documented and reproducible —
applying them again on the same project will fail (objects already exist).

Order:
1. `01_v2_relational_schema.sql` — v2 tables, RLS helpers + policies, market seed, owner profile bootstrap
2. `02_v2_harden_function_grants.sql` — lock down SECURITY DEFINER function grants
3. `03_v2_market_totals_rpc.sql` — aggregate totals RPC for the weekly challenge scoreboard

The v1 `app_data` table and its permissive policies are intentionally left
untouched until v1 is retired. At cutover, drop the permissive policies on
`app_data` (or the table itself once data is archived).
