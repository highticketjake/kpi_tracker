// Weekly database backup. Reads every table with the Supabase service-role key
// (bypasses RLS) and writes a single JSON snapshot to db-backups/latest.json.
// Run by .github/workflows/backup-db.yml; needs the SUPABASE_SERVICE_ROLE_KEY
// secret. The project URL is public so it has a default.
//
// PostgREST caps every response at the project's db-max-rows (1000 on this
// project) regardless of any `limit` in the query string, so each table is
// paged through with Range headers. `Prefer: count=exact` gives the true row
// count in Content-Range, and the run fails loudly if what we collected does
// not match it — a short backup must never look like a good one.
import { writeFileSync, mkdirSync } from "node:fs";

const url = process.env.SUPABASE_URL || "https://payymfcvjrhxlgzyplvx.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY — add it as a GitHub repo secret.");
  process.exit(1);
}

const PAGE = 1000;

// Stable sort key per table so paging can't skip or repeat rows. Everything
// uses `id` except app_settings, whose primary key is `key`.
const tables = [
  { name: "markets", order: "id" },
  { name: "reps", order: "id" },
  { name: "profiles", order: "id" },
  { name: "kpi_entries", order: "id" },
  { name: "sales", order: "id" },
  { name: "escalations", order: "id" },
  { name: "app_settings", order: "key" },
  { name: "event_log", order: "id" },
];

async function fetchAll({ name, order }) {
  const rows = [];
  let total = null;

  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${name}?select=*&order=${order}.asc`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Range-Unit": "items",
        Range: `${from}-${from + PAGE - 1}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`Failed to read ${name}: ${res.status} ${await res.text()}`);
    }

    // Content-Range looks like "0-999/1083" (or "*/0" for an empty table).
    const range = res.headers.get("content-range") || "";
    const claimed = Number(range.split("/")[1]);
    if (Number.isFinite(claimed)) total = claimed;

    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (total !== null && rows.length >= total) break;
  }

  if (total !== null && rows.length !== total) {
    throw new Error(`${name}: exported ${rows.length} rows but the table holds ${total} — refusing to write a partial backup.`);
  }
  return rows;
}

try {
  const out = { exported_at: new Date().toISOString(), tables: {} };
  for (const t of tables) {
    const rows = await fetchAll(t);
    out.tables[t.name] = rows;
    console.log(`${t.name}: ${rows.length} rows`);
  }

  mkdirSync("db-backups", { recursive: true });
  writeFileSync("db-backups/latest.json", JSON.stringify(out, null, 2));
  console.log(`Wrote db-backups/latest.json (${Object.values(out.tables).reduce((a, r) => a + r.length, 0)} rows total)`);
} catch (err) {
  // Let the process wind down on its own; an abrupt process.exit() here can
  // abort with a confusing libuv assertion while a socket is still open.
  console.error(err.message);
  process.exitCode = 1;
}
