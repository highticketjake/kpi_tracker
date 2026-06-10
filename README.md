# KPI Tracker

A real-time sales KPI tracker for door-to-door teams. Reps log daily numbers; managers review dashboards, leaderboards, accountability flags, office-vs-office challenges, and a full-screen **TV mode** for office displays.

Built with **React + Vite**, **Firebase Auth (Google SSO)**, and **Firestore**. Almost all application logic lives in a single document (`app/state`) with a separate access-control document (`app/access`).

---

## Table of contents

1. [Quick start](#quick-start)
2. [Architecture overview](#architecture-overview)
3. [Firestore data model](#firestore-data-model)
4. [Authentication & access control](#authentication--access-control)
5. [Global UI concepts](#global-ui-concepts)
6. [Tabs & features](#tabs--features)
7. [TV display mode](#tv-display-mode)
8. [Rep profile modal](#rep-profile-modal)
9. [Business rules & formulas](#business-rules--formulas)
10. [KPI entry — concurrency & save behavior](#kpi-entry--concurrency--save-behavior)
11. [Accountability system](#accountability-system)
12. [Activity log (event log)](#activity-log-event-log)
13. [Constants, edge cases & gotchas](#constants-edge-cases--gotchas)
14. [Project structure](#project-structure)
15. [Firestore security rules](#firestore-security-rules)

---

## Quick start

### Firebase setup

1. Create a Firebase project.
2. Enable **Authentication → Sign-in method → Google**.
3. Create a **Firestore Database**.
4. Register a **Web app** and copy its config values.
5. Under **Authentication → Settings → Authorized domains**, add your dev host (`localhost`) and production domain.

### Local development

1. Copy env template and fill in values:

```bash
cp .env.example .env.local
```

Required variables:

| Variable | Required |
|---|---|
| `VITE_FIREBASE_API_KEY` | Yes |
| `VITE_FIREBASE_AUTH_DOMAIN` | Yes |
| `VITE_FIREBASE_PROJECT_ID` | Yes |
| `VITE_FIREBASE_APP_ID` | Yes |
| `VITE_FIREBASE_STORAGE_BUCKET` | No |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | No |

2. Install and run:

```bash
npm install
npm run dev
```

3. Open the app, sign in with Google. **The first person to sign in becomes the Owner** (bootstrapped automatically into `app/access`).

### Build & preview

```bash
npm run build
npm run preview
```

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│  React SPA (App.jsx — main app + all business logic)    │
│  ├── Firebase Auth (Google popup, redirect fallback)    │
│  ├── Firestore realtime listeners                       │
│  │     app/state   — KPI data, markets, reps, logs      │
│  │     app/access  — users, roles, invites, requests    │
│  └── TVView.jsx — full-screen scoreboard overlay        │
│        ├── TVAutoScroll.jsx — smooth auto-scroll        │
│        └── TVYouTubeAmbient.jsx — hidden lofi audio     │
└─────────────────────────────────────────────────────────┘
```

- **Single source of truth:** `app/state` in Firestore holds markets, reps, daily KPI rows, accountability entries, settings, and the activity log.
- **Realtime sync:** `onSnapshot` keeps all signed-in users in sync.
- **Most writes** call `setDoc(..., { merge: false })` — the full `app/state` document is replaced. KPI saves are the exception: they use a **Firestore transaction** to patch only changed `dailyKPIs` keys.
- **Scope selector:** Almost every view is filtered by the header office picker — either a single **market** (office) or **All Offices** (region-wide rollup).

---

## Firestore data model

### `app/state`

Default shape (merged with stored data on load):

```js
{
  markets: {},           // { [marketId]: { name, averageDealValue? } }
  reps: {},              // { [repId]: Rep }
  dailyKPIs: {},         // { "[repId]__[YYYY-MM-DD]": KpiEntry }
  accountabilityLog: {}, // { [repId]: AccountabilityEntry[] }
  settings: {},          // { averageDealValue? } — company-wide default
  eventLog: []           // Activity log entries (newest first, max 400)
}
```

#### Market

```js
{ name: "Austin", averageDealValue: 3500 }  // averageDealValue is optional
```

#### Rep

```js
{
  name: "Jane Doe",
  marketId: "<marketId>",
  role: "knocker" | "closer",
  active: true,              // false = deactivated (hidden from boards/entry)
  startDate: "2026-01-15", // used for tenure labels & new-hire ramp
  recruits: 0,               // knocker promotion tracking
  terminated: true?,         // soft-delete from active views; KPI history kept
  terminatedAt: "2026-03-01"?
}
```

**Roster rules (`onRoster`):** A rep appears on boards and in KPI entry when `active !== false` and `terminated !== true`.

**Historical stats (`repsInMarketForStats`):** Includes terminated reps and active reps; excludes inactive (deactivated) non-terminated reps.

#### Daily KPI entry

Stored at key `repId__YYYY-MM-DD` (see `kk()` helper).

**Knocker fields:**

| Field | Label in UI |
|---|---|
| `doorsKnocked` | Doors |
| `convosHad` | Convos |
| `setsSet` | Sets |
| `apptsRan` | Appts Ran |
| `cads` | CADs |
| `closes` | Closes |
| `revenue` | REV |
| `creditFails` | `[{ closerId }]` — assigned closer per fail |
| `notes` | Free text |

**Closer fields:**

| Field | Label in UI |
|---|---|
| `apptsRan` | Appts Ran |
| `cads` | CADs |
| `apptsClosed` | Closes |
| `convosHad` | Convos |
| `doorsKnocked` | Doors |
| `revenue` | REV |
| `selfGenSets` | SG Sets |
| `selfGenCloses` | SG Closes |
| `apptSources` | Optional free text (which knocker set each appt) |
| `notes` | Free text |

Every entry also stores `repId` and `date`.

#### Accountability entry

```js
{ id, date, note, severity: "coaching" | "warning" | "final" | "termination" }
```

#### Activity log entry

```js
{ ts: ISO8601, actor: email | uid, message: string, marketId: string | null }
```

- `marketId: null` = company-wide or access-related event.
- Capped at **400 entries** (`EVENT_LOG_MAX`); oldest are dropped.

### `app/access`

```js
{
  ownerUid: "<firebase uid>",
  users: {
    "<firebase uid>": { email, displayName, photoURL, role, updatedAt },
    "email:<normalized@email.com>": { email, role, pending: true, invitedBy, ... }
  },
  pendingInvites: {},   // legacy — email-keyed pending invites
  invites: {},          // legacy — token-keyed invite links
  accessRequests: {}    // uid-keyed requests from unauthorized sign-ins
}
```

---

## Authentication & access control

### Sign-in flow

1. Google popup sign-in (default).
2. If popup blocked or unsupported → automatic **redirect** sign-in fallback.
3. On load, `getRedirectResult()` completes redirect flows (Safari, embedded browsers).

### Roles

| Role | Rank | Capabilities |
|---|---|---|
| **Owner** | 2 | Full access. Can invite any role, change/remove anyone except cannot demote the primary owner. |
| **Admin** | 1 | Dashboard access. Can invite Default/Admin. Can remove Default users only. Cannot change Owner/Admin roles. |
| **Default** | 0 | Full dashboard access. Cannot invite or manage users. |

### First-time setup

- Empty `app/access.users` → first Google sign-in runs `bootstrapOwnerIfNeeded()` and becomes **Owner**.
- Subsequent users need an invite or access request.

### Inviting users (Owner/Admin)

Profile menu → enter email + role → **Add user**.

Creates a placeholder row at `users["email:<email>"]` with `pending: true`. When that person signs in with Google using the same email, `claimInviteForUser()`:

1. Moves the row to `users[<firebase uid>]`
2. Deletes the placeholder / legacy invite record
3. Logs "Access granted" to the activity log

Also supports legacy paths: `pendingInvites[email]` and `invites[token]`.

### Access requests

Unauthorized sign-ins see a **Request access** screen. Owners/Admins get a notification bell with pending requests → Accept (Default role) or Deny.

### Manage users modal

Profile menu → **Manage users** — change roles (within permission) or remove users.

---

## Global UI concepts

### Header

| Control | Behavior |
|---|---|
| **Brand ("Jake's Region")** | Returns to Dashboard, closes overlays/TV mode |
| **Office picker** | Choose **All Offices** or a specific market — persists across tabs |
| **TV icon** | Opens full-screen TV mode |
| **Notification bell** | Pending access requests (Owner/Admin only) |
| **Profile menu** | Role badge, invite form, manage users, switch account, sign out |

### Office scope

- **`__REGION__` (`REGION_KEY`)** = All Offices — region-wide rollups, cross-market leaderboards.
- **Single market ID** = that office only.

Some tabs require a single market (Enter, Accountability, Report). Others work with either scope.

### Date range bar

Visible on most tabs (hidden on Enter, Manage, Accountability, Report, Challenge).

Presets: **Today**, **7 Days**, **14 Days**, **30 Days**, **This Month**, or custom start/end dates.

The selected range drives Dashboard flags, leaderboards, Trends, Markets rollup, and Revenue rankings.

### Tab navigation

11 tabs in order:

Dashboard → Enter → Knockers → Closers → Trends → Log → Markets → Revenue → Weekly Challenge → Report → Manage

- Tab strip auto-scrolls active tab into view.
- **Mobile swipe:** horizontal swipe on the main content area moves between tabs (disabled inside inputs and on the Challenge tab via `data-no-swipe-tab`).

---

## Tabs & features

### Dashboard

**Purpose:** At-a-glance coaching and action flags for the selected scope and date range.

**Summary cards:** Total reps, Action count, Coach count, total Doors/Sets, monthly Credit fails (single market only).

**Missing entry alert:** When a single market is selected, lists active reps with no KPI row for the **end date** of the range.

**Region scorecard** (All Offices only): Per-market row with roster size, 14-day entry consistency %, avg closes/rep, terminated count. Click **Open market** to drill in.

**Action / Coaching sections:** Reps flagged by analysis rules (see [Business rules](#business-rules--formulas)). Each card shows:

- Name (opens profile), role, tenure badge, prior incident count, suggested next severity
- Flag labels (red = action, orange = coaching)
- Quick stats for the date range
- **Edit KPIs** — jumps to Enter tab for that rep's market/date
- **Log** — opens accountability modal
- **Hist** — expands inline accountability history

### Enter

**Purpose:** Daily KPI data entry for one market on one date.

**Requirements:** Select a single market (not All Offices).

**Date picker:** Defaults to today; **Yesterday** shortcut available.

**View modes:**

| Mode | Best for |
|---|---|
| **Cards** | Per-rep detail — credit fail rows with closer dropdown, appt sources textarea, live hours calc for closers, promotion credit preview for knockers |
| **Grid** | Bulk entry — spreadsheet-style table; credit fails via count + assign-closer columns |

**Save:** Floating **Save changes** button (bottom-right). Only dirty rep rows are written. See [KPI entry concurrency](#kpi-entry--concurrency--save-behavior).

**Knocker credit fails (Cards mode):** Each fail links to a closer in the market. Worth **0.5 promotion sales credits** each.

**Closer hours preview:** `Appts Ran + CADs × 0.5 + Convos ÷ 10` — target is 5.

### Knockers (leaderboard)

**Scope:** Single market or All Offices.

**Includes closers** who knocked during the period (anyone with doors or revenue > 0).

**Weekly MVP banner:** Top knocker by sets in the current Mon–Sun week.

**Sortable columns:** Doors, Convos, Sets, REV, D2C%, C2S%, CAD%.

**Podium + table** with streak 🔥, market column (region scope), role badge if closer.

**Minimum activity gate:** Reps with 0 doors AND 0 revenue are excluded.

### Closers (leaderboard)

**Scope:** Single market or All Offices. **Closers only.**

**Weekly MVP banner:** Top closer by closes (`apptsClosed`) in current week.

**Sortable columns:** Closes, REV, Close%, Self-Gens (month-to-date), Hours.

**Table columns:** Appts Ran, Sets, Closes, REV, Close%, CAD%, total Hours, Hours/Day avg, monthly Self-Gens.

**Self-gen coloring:** Red if 0, green if ≥ 3.

### Trends

**Scope:** Single market or All Offices.

Two charts over the date range:

1. **Activity** (bar): Doors + Convos per day
2. **Production** (line): Sets + Closes per day

Closes = knocker `closes` + closer `apptsClosed` summed per day.

### Log (Accountability)

**Requirements:** Single market only.

Per-rep cards with incident history, severity badges, and **+ Log** button. Incidents can be deleted inline.

Logging uses the shared accountability modal (also available from Dashboard flag cards).

### Markets (rollup)

**Always region-wide** — ranks all markets by total closes in the date range.

Podium for top 3 + clickable cards showing doors/sets/closes and knocker/closer counts. Click a market → switches scope and opens Dashboard.

### Revenue

**Always region-wide** — ranks markets by total `revenue` field in the date range.

**Current month chart:** Cumulative REV per market, one line per office. Selected market (if any) gets a thicker highlighted line; others fade when a single market is selected in the header.

Uses entered REV values directly — not estimated from closes × deal value.

### Weekly Challenge

**Office-vs-office matchups** for the selected Mon–Sun week.

- **52 weeks** of history selectable via horizontal week tabs.
- **Pairing algorithm:** Round-robin rotation based on week index since epoch Monday `2020-01-06`. Odd number of offices → one **bye** each week.
- **Winner:** Market with more total **closes** (knocker closes + closer apptsClosed aggregated across all reps in that market).
- **Region scope:** Shows all matchups.
- **Single market scope:** Shows only that market's matchup (or bye).

Challenge tab disables mobile swipe-to-change-tab to avoid conflicting with week tab scrolling.

### Report

**Requirements:** Single market (not Region).

Fixed **last 7 days** vs prior 7 days comparison. **Print / PDF** via browser print (`.no-print` elements hidden).

Sections:

- Market totals (doors, convos, sets, closes, D2C%, C2S%) with week-over-week delta
- Top 3 performers by production
- Reps needing action (same flag rules as Dashboard)

### Manage

**Markets:** Add, delete (also removes all reps in that market), set per-market average deal value.

**Defaults:** Company-wide average deal value (fallback when market has none).

**Reps** (single market selected): Add with name, role, start date. Toggle active/inactive, switch role, set recruits (knockers), terminate.

**Terminated reps:** Hidden from boards/entry but KPI history preserved. Toggle "Show terminated" to view.

**Activity log panel:** Expandable, filterable, exportable — see [Activity log](#activity-log-event-log).

---

## TV display mode

Full-screen, read-only scoreboard for office TVs. Open via header TV icon or **`?tv=1` URL param** (param is stripped after load).

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Header: market/region, period picker, Week/Month toggle,     │
│         Region/Market scope, clock, Exit                     │
├──────────────────────────────────────────────────────────────┤
│ MVP Banner: Weekly/Monthly MVP — top knocker (sets) +        │
│               top closer (closes)                            │
├──────────────────────────┬───────────────────────────────────┤
│ Closers leaderboard      │ Market summary card               │
│ (top 15, auto-scroll)    │ (doors, sets, closes, D2C, etc.)  │
│                          │                                   │
│ Knockers leaderboard     │ Weekly challenge matchups         │
│ (top 15, auto-scroll)    │ (auto-scroll in region scope)     │
└──────────────────────────┴───────────────────────────────────┘
```

### TV controls

| Control | Behavior |
|---|---|
| **Week / Month** | Toggle period aggregation. Double-click resets to current week/month. |
| **Period detail** (clickable) | Dropdown — 52 past weeks or 24 past months |
| **Region / Market** | Region = All Offices data. Market = single office (uses header selection; from Region, picks first market alphabetically) |
| **Exit** or **Escape** | Close TV mode |

### TV-specific behavior

- **Clock** updates every 45 seconds.
- **Leaderboards:** Top 15 by sets (knockers) or closes (closers). Include streak badges. Auto-scroll when overflowing (`TVAutoScroll` — ~0.11 px/frame, loops to top).
- **Challenge strip:** Same round-robin pairings as Weekly Challenge tab; region scope scrolls through all matchups.
- **Ambient audio:** Hidden YouTube lofi stream at ~25% volume (`TVYouTubeAmbient`). Disabled when `prefers-reduced-motion: reduce`.
- **Animations:** Background breathe/drift/grid/float effects — also respect reduced-motion.
- **Page scroll locked** while TV mode is open.

### Branding note

TV header shows hardcoded `"Jake's Region"` as the region label. Main app header uses the same brand string.

---

## Rep profile modal

Click any underlined rep name (Dashboard, boards, Report, Enter, etc.) to open.

**Contents:**

- Role, tenure, streak, market
- Weekly MVP badge if applicable
- **Promotion tracker** (knockers): progress toward closer promotion
- **Est. revenue** (closers): month closes × deal value
- **New hire ramp** (first 30 days): weekly averages
- **Personal bests** (single-day records)
- **Last 30 days conversion** stats
- **Trend charts:** 7 / 14 / 30 day lines
- Link to accountability history

Deal value = market `averageDealValue` ?? company `settings.averageDealValue`.

---

## Business rules & formulas

### Conversion rates

| Metric | Formula |
|---|---|
| **D2C** | `convos / doors × 100` (1 decimal) |
| **C2S** | `sets / convos × 100` |
| **Close rate** | `apptsClosed / apptsRan × 100` |
| **CAD rate** | `cads / (apptsRan + cads) × 100` |

### Closer hours

```
hours = apptsRan + cads × 0.5 + convosHad / 10
```

Daily standard: **≥ 5 hours**. Streak uses this for closers.

### Knocker daily standards (for streaks)

- Doors ≥ **120**
- Convos ≥ **50**

### Streak

Consecutive days (backward from anchor date) where the rep has KPI data **and** meets their role's daily standard. Shown as 🔥 Nd on leaderboards.

### Knocker action flags (Dashboard / Report)

Evaluated over the **selected date range**, with some checks on the **last day** and rolling 7-day window:

| Flag | Condition |
|---|---|
| No data | Zero days with entries in range |
| Doors | Last day doors < 120 |
| Convos | Last day convos < 50 |
| Sets avg | Range avg < 3 (action) or < 4 (coaching) |
| Wk appts | Last 7 days appts ran < 5 |
| Wk closes | Last 7 days closes < 2 (0 = action, 1 = coaching) |

### Closer action flags

| Flag | Condition |
|---|---|
| No data | Zero days with entries |
| Avg hrs | Range avg < 4.5 (action) or < 5 (coaching) |
| Self-gens | 0 month self-gen closes after day 14 (coaching) or day 20 (action) |

### Promotion to closer (knockers)

Requires **all** of:

- **≥ 8 sales credits** in the current calendar month
- **≥ 8 sales credits** in the previous calendar month
- **≥ 2 recruits** (set in Manage)

**Sales credits** = `closes + 0.5 × creditFailCount` for the month.

Progress bar: 40% current month + 40% previous month + 20% recruits.

Constants: `PROMO_SALES_NEED = 8`, `PROMO_RECRUITS_NEED = 2`.

### Weekly / monthly MVP

- **Knocker MVP:** Most `setsSet` in period.
- **Closer MVP:** Most `apptsClosed` in period.
- Weekly = Mon–Sun week containing anchor date.
- Monthly = calendar month (days ≤ anchor date for current month).

### Weekly Challenge pairings

- Epoch: Monday `2020-01-06`.
- `roundIndex = floor((weekMonday - epoch) / 7 days)`.
- Standard circle-method round-robin; odd count → bye (`b === null`).

### Market aggregation (`aggregateMarketChallenge`)

Sums across `repsInMarketForStats` (includes terminated):

- **closes** = knocker `closes` + closer `apptsClosed`
- Also aggregates doors, convos, sets, appts, revenue, rep count
- Computes D2C and C2S from totals

### Data entry consistency (region scorecard)

For each of the last **14 days**, checks whether **every on-roster rep** in the market has a non-empty KPI entry. Returns `{ pct, complete, total }`.

### Week definition

Weeks are **Monday–Sunday**. `weekStartMonday()` handles Sunday as previous week's end.

---

## KPI entry — concurrency & save behavior

Enter tab implements **optimistic dirty tracking** for multi-user safety.

### How it works

1. Editing a rep marks them **dirty** and snapshots the server baseline at first edit.
2. Every **60 seconds** (and on tab visibility resume), the form **re-merges** from server data — dirty rows are preserved, clean rows update.
3. If server data changed for non-dirty rows → silent merge. If dirty rows' market/day fingerprint changed → banner: *"Someone else updated this day — your unsaved rows are unchanged."*
4. **Save** reads fresh server state, detects conflicts (server changed since baseline for dirty reps):
   - All conflicts, nothing else → refresh conflicted rows, abort
   - Mixed → confirm dialog to save non-conflicted rows
5. Successful save uses **`saveKpiEntries()` transaction** — patches only changed `dailyKPIs` keys + prepends activity log entries.
6. Overwrite confirm if replacing existing non-empty data.

### Empty entry handling

A row is only saved if it has at least one non-zero numeric field, credit fails, appt sources, or notes. Clearing all values does not create a new entry.

---

## Accountability system

### Severity levels (escalation order)

| # | Key | Label |
|---|---|---|
| 0 | `coaching` | Coaching |
| 1 | `warning` | Written Warning |
| 2 | `final` | Final Warning |
| 3 | `termination` | Termination |

**Next suggested severity** = `SEV[min(incidentCount, 3)]` based on total incidents for that rep.

When logging, severity defaults to the next level but can be overridden in the modal.

### Storage

`accountabilityLog[repId]` = array of `{ id, date, note, severity }`.

Deleting an entry does not re-number future suggestions — count is based on array length.

---

## Activity log (event log)

Append-only audit trail stored in `app/state.eventLog`.

### What gets logged

- KPI saves (with field-level delta summary)
- Market/rep CRUD
- Accountability actions
- Access grants, role changes, invite additions
- Access requests

### Viewing & export (Manage tab)

- Filter by header office scope + time range (24h / 7d / 30d / all)
- **All Offices** shows global events (`marketId: null`) and all market-tagged events
- **Single market** shows only events tagged with that `marketId` (global events hidden)
- **Export .txt** downloads filtered results

---

## Constants, edge cases & gotchas

### `TODAY` is frozen at page load

```js
var TODAY = new Date().toISOString().split("T")[0];
```

This is computed **once** when the JS module loads. A tab left open overnight will still use yesterday's date for presets, entry defaults, and flag calculations until **page refresh**.

### Full document writes

Most `persist()` calls replace the entire `app/state` document. Avoid concurrent edits to unrelated fields from external tools — last write wins.

### Deleting a market

Deletes the market **and all reps** assigned to it. KPI rows remain orphaned in `dailyKPIs` (keys still reference rep IDs).

### Terminated vs inactive

| State | Boards | Entry | Historical stats |
|---|---|---|---|
| **Inactive** (`active: false`) | Hidden | Hidden | Excluded |
| **Terminated** | Hidden | Hidden | **Included** |

### TV Market scope quirk

Switching TV from Region → Market while on All Offices selects `mIds[0]` (first market **sorted alphabetically by name**), not necessarily the one you were viewing in the main app.

### Knocker board includes closers

Anyone on roster with doors > 0 or revenue > 0 appears, regardless of role.

### Revenue tab vs profile estimate

- **Revenue tab** uses entered `revenue` KPI field.
- **Profile est. revenue** for closers = `month apptsClosed × deal value`.

### Credit fail grid mode limit

Grid view caps credit fail count input at **30** per rep per save.

### Event log cap

Only the **400 most recent** entries are kept.

### Reduced motion

When the user prefers reduced motion:
- TV auto-scroll still runs but scroll animation intent is skipped at setup... actually TVAutoScroll returns early and does not scroll.
- YouTube ambient audio does not load.
- CSS TV animations disabled via `motion-reduce:animate-none`.

### Mobile header

Below 768px the brand block hides; office picker moves to the start column.

### Print styles

Report tab uses `.weekly-report-print` and hides `.no-print` elements (header, date bar, buttons) when printing.

---

## Project structure

```
kpi_tracker/
├── index.html              # Fonts: Bebas Neue (TV display), IBM Plex Sans (TV body)
├── vite.config.js
├── tailwind.config.js      # TV animations (tv-breathe, tv-drift, tv-grid, tv-float, tv-shimmer)
├── postcss.config.js
├── .env.example
└── src/
    ├── main.jsx            # React entry
    ├── App.jsx             # Entire app (~6400 lines) — all tabs, logic, Firebase, auth
    ├── firebase.js         # Firebase init + env validation
    ├── TVView.jsx          # TV overlay UI
    ├── TVAutoScroll.jsx    # Overflow auto-scroll for TV leaderboards
    ├── TVYouTubeAmbient.jsx# Hidden lofi audio in TV mode
    ├── styles.css          # Tailwind imports
    └── assets/
        └── notif.png       # Access request bell icon
```

---

## Firestore security rules

Minimal rules — any authenticated user can read/write everything:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

**Note:** Role enforcement is **application-level only** (via `app/access`). Tighten rules for production if needed — e.g. separate write access to `app/access` for owners only.

---

## Deployment checklist

- [ ] Set all `VITE_FIREBASE_*` env vars in your hosting platform
- [ ] Add production domain to Firebase Auth authorized domains
- [ ] Deploy Firestore security rules
- [ ] First sign-in after deploy becomes Owner — plan who signs in first
- [ ] For TV displays: bookmark with `?tv=1` or tap TV icon after load
- [ ] Consider a nightly refresh on TV devices (due to frozen `TODAY` constant)
