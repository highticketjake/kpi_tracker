# KPI Tracker (v2)

Sales KPI tracker for a 6-market door-to-door region: daily knocker/closer
entry, leaderboards, accountability standards, promotion track, weekly office
challenge, and a TV display mode.

**v2** is a full rebuild of the contractor-built v1: the single shared JSON
document is replaced with a relational Supabase schema, and per-market
row-level security means each Market Owner sees and edits only their own
office while the regional role sees everything.

## Stack

- Vite + React 18 + Tailwind + recharts
- Supabase (Postgres + Auth + RLS + one edge function)
- Netlify (auto-deploys `main`; build `npm run build`, publish `dist`)

## Roles

| Role | Access |
|---|---|
| `regional` | All markets, all tabs, Admin (accounts, deal values, audit log) |
| `market_owner` | Their market only: entry, boards, roster, flags, TV |

Accounts are created by the regional admin in **Admin → Team Accounts**
(no public signup). User management runs through the `admin-users` edge
function with the service role; the client only ever holds the anon key.

## Local dev

```sh
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev
```

## Database

Schema + RLS policies are documented in [`supabase/migrations/`](supabase/migrations/)
(reference copies of migrations already applied to the live project).
Key tables: `markets`, `profiles`, `reps`, `kpi_entries`, `escalations`,
`event_log`, `app_settings`. The v1 `app_data` table remains untouched until
v1 is retired.

## KPI rules (carried over from v1)

- Knocker daily standard: 120 doors and 50 convos; weekly: 5 appts ran, 2 closes
- Closer "hours" = appts ran + 0.5 × CADs + convos ÷ 10; standard 5/day
- Self-gen rules: coaching flag after day 14 of the month with 0 self-gen closes, action after day 20
- Promotion track: 8 sales credits this month + 8 prior month + 2 recruits (40/40/20); credits = closes + 0.5 × credit fails
- Escalation ladder: coaching → written warning → final warning → termination
- Weekly challenge: round-robin office matchups, scored by closes Mon–Sun
