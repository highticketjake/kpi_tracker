// Weekly database backup. Reads every table with the Supabase service-role key
// (bypasses RLS) and writes a single JSON snapshot to db-backups/latest.json.
// Run by .github/workflows/backup-db.yml; needs the SUPABASE_SERVICE_ROLE_KEY
// secret. The project URL is public so it has a default.
import { writeFileSync, mkdirSync } from "node:fs";

const url = process.env.SUPABASE_URL || "https://payymfcvjrhxlgzyplvx.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY — add it as a GitHub repo secret.");
  process.exit(1);
}

const tables = ["markets", "reps", "profiles", "kpi_entries", "sales", "escalations", "app_settings", "event_log"];
const out = { exported_at: new Date().toISOString(), tables: {} };

for (const t of tables) {
  const res = await fetch(`${url}/rest/v1/${t}?select=*&limit=200000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error(`Failed to read ${t}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const rows = await res.json();
  out.tables[t] = rows;
  console.log(`${t}: ${rows.length} rows`);
}

mkdirSync("db-backups", { recursive: true });
writeFileSync("db-backups/latest.json", JSON.stringify(out, null, 2));
console.log("Wrote db-backups/latest.json");
