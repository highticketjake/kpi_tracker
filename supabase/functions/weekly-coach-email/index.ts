// weekly-coach-email: Sunday-evening Coach's Card digest per market owner.
// Triggered by pg_cron (x-cron-secret header) or by a regional user from the
// Admin tab ({ test: true } sends only to the caller). Resend API key and the
// cron secret live in Supabase Vault. Mirrors the flag math in src/lib/calc.js.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/* ---------- date helpers (all "YYYY-MM-DD", week = Mon-Sun) ---------- */
function chicagoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}
function addDays(d: string, n: number): string {
  const x = new Date(d + "T12:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function listDates(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/* ---------- KPI math (ported from src/lib/calc.js) ---------- */
type Entry = Record<string, number | string | null> & { entry_date: string; rep_id: string };
type Rep = { id: string; name: string; role: string; market_id: string; recruits: number };

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
const num = (v: unknown) => Number(v) || 0;
const closerHours = (e: Entry) => num(e.appts_ran) + num(e.cads) * 0.5 + num(e.convos_had) / 10;
const repHours = (rep: Rep, e: Entry) => (rep.role === "knocker" ? num(e.convos_had) / 10 : closerHours(e));

function stats(rep: Rep, entries: Entry[]) {
  const f = ["doors_knocked", "convos_had", "sets_set", "appts_ran", "appts_closed", "cads", "closes", "revenue", "self_gen_sets", "self_gen_closes", "credit_fails", "cancels"];
  const t: Record<string, number> = Object.fromEntries(f.map((k) => [k, 0]));
  let hours = 0, days = 0, bestSets = 0, bestDoors = 0, bestCloses = 0, fullDays = 0;
  for (const e of entries) {
    days++;
    const h = repHours(rep, e);
    hours += h;
    if (h >= 5) fullDays++;
    bestSets = Math.max(bestSets, num(e.sets_set));
    bestDoors = Math.max(bestDoors, num(e.doors_knocked));
    bestCloses = Math.max(bestCloses, num(e.appts_closed) + num(e.self_gen_closes) + (rep.role === "knocker" ? num(e.closes) : 0));
    for (const k of f) t[k] += num(e[k]);
  }
  return {
    ...t, days, hours, fullDays, bestSets, bestDoors, bestCloses,
    totalCloses: rep.role === "knocker" ? t.closes : t.appts_closed + t.self_gen_closes,
    setsAvg: days ? t.sets_set / days : 0,
    hoursAvg: days ? hours / days : 0,
    closeRate: pct(t.appts_closed, t.appts_ran),
  };
}

function quality(s: ReturnType<typeof stats>): number | null {
  if (!s.sets_set) return null;
  const conv = Math.min(pct(s.sets_set, s.convos_had) / 10, 1);
  const cadShare = s.cads / s.sets_set, cancelShare = s.cancels / s.sets_set;
  return Math.round(100 * (0.4 * conv + 0.4 * Math.max(0, 1 - cadShare * 2) + 0.2 * Math.max(0, 1 - Math.max(0, cancelShare - 0.5) * 2)));
}

type Flag = { level: string; kind: "effort" | "skill"; text: string };
function flagsFor(rep: Rep, byDate: Record<string, Entry>, end: string): Flag[] {
  const out: Flag[] = [];
  const week = listDates(addDays(end, -6), end).map((d) => byDate[d]).filter(Boolean) as Entry[];
  if (week.length === 0) return [{ level: "action", kind: "effort", text: "No data logged this week" }];
  const wk = stats(rep, week);
  if (rep.role === "knocker") {
    const talking = wk.convos_had / Math.max(wk.days, 1) >= 40;
    if (wk.setsAvg < 3) out.push({ level: "action", kind: talking ? "skill" : "effort", text: `Sets avg ${wk.setsAvg.toFixed(1)}/day (<3)` });
    else if (wk.setsAvg < 4) out.push({ level: "coaching", kind: talking ? "skill" : "effort", text: `Sets avg ${wk.setsAvg.toFixed(1)}/day (<4)` });
    if (wk.appts_ran < 5) out.push({ level: "action", kind: "effort", text: `Only ${wk.appts_ran} appts ran this week (<5)` });
    if (wk.closes === 0) out.push({ level: "action", kind: wk.appts_ran >= 5 ? "skill" : "effort", text: "0 closes this week" });
    else if (wk.closes === 1) out.push({ level: "coaching", kind: "skill", text: "1 close this week (<2)" });
    const q = quality(wk);
    if (q != null && q < 40) out.push({ level: "coaching", kind: "skill", text: `Set quality ${q}/100 — CADs/cancels piling up` });
    if (wk.hoursAvg < 4) out.push({ level: "action", kind: "effort", text: `Avg hours ${wk.hoursAvg.toFixed(1)} (<4 — under 40 convos/day)` });
  } else {
    if (wk.hoursAvg < 4.5) out.push({ level: "action", kind: "effort", text: `Avg hours ${wk.hoursAvg.toFixed(1)} (<4.5)` });
    else if (wk.hoursAvg < 5) out.push({ level: "coaching", kind: "effort", text: `Avg hours ${wk.hoursAvg.toFixed(1)} (<5)` });
    if (wk.appts_ran >= 5 && wk.closeRate < 30) out.push({ level: "coaching", kind: "skill", text: `Close rate ${wk.closeRate.toFixed(0)}% on ${wk.appts_ran} appts (<30%)` });
    const mtdStart = end.slice(0, 8) + "01";
    const mtd = listDates(mtdStart, end).map((d) => byDate[d]).filter(Boolean) as Entry[];
    const sg = mtd.reduce((s, e) => s + num(e.self_gen_closes), 0);
    const dom = Number(end.slice(8, 10));
    if (sg === 0 && dom > 20) out.push({ level: "action", kind: "effort", text: "0 self-gen closes this month (past day 20)" });
    else if (sg === 0 && dom > 14) out.push({ level: "coaching", kind: "effort", text: "0 self-gen closes this month (past day 14)" });
  }
  return out;
}

function weekScore(rep: Rep, entries: Entry[]) {
  const s = stats(rep, entries);
  return rep.role === "knocker" ? s.sets_set * 3 + s.closes * 8 + s.doors_knocked / 40 : s.totalCloses * 8 + s.hours;
}

function wins(rep: Rep, s: ReturnType<typeof stats>): string[] {
  const out: string[] = [];
  if (rep.role === "knocker") {
    if (s.bestSets >= 5) out.push("5-set day");
    if (s.bestDoors >= 150) out.push("150-door day");
  } else {
    if (s.bestCloses >= 3) out.push("3-close day");
    if (s.revenue >= 25000) out.push("$25k week");
  }
  if (s.fullDays >= 5) out.push("5 full days");
  return out;
}

const SEV = ["coaching", "warning", "final", "termination"];
const SEV_LABEL: Record<string, string> = { coaching: "Coaching", warning: "Written Warning", final: "Final Warning", termination: "Termination" };

/* ---------- email rendering (light bg for email clients) ---------- */
const money = (n: number) => "$" + Math.round(n).toLocaleString();
function marketHtml(m: { name: string }, cardRows: string, winRows: string, totals: Record<string, number>, weekStart: string) {
  return `
  <div style="margin:0 0 28px;">
    <h2 style="font-family:Arial,sans-serif;color:#231F20;margin:0 0 4px;">${m.name}</h2>
    <p style="font-family:Arial,sans-serif;color:#888;font-size:13px;margin:0 0 12px;">Week of ${weekStart} · ${totals.doors} doors · ${totals.sets} sets · ${totals.closes} closes · ${money(totals.revenue)}</p>
    ${cardRows || `<p style="font-family:Arial,sans-serif;color:#108D07;font-size:14px;">Nobody needs a hard conversation this week. Standards met.</p>`}
    ${winRows}
  </div>`;
}
function cardHtml(c: { name: string; role: string; rec: string; trend: string; reasons: string; ladder: string }) {
  const recLabel = c.rec === "both" ? "1-ON-1 + SHADOW" : c.rec === "1on1" ? "1-ON-1 (effort)" : "SHADOW (skill — ride along)";
  const color = c.rec === "shadow" ? "#B8860B" : "#EB2229";
  const trend = c.trend === "down" ? "▼ worse than last week" : c.trend === "up" ? "▲ better than last week" : "■ about even with last week";
  return `
  <div style="border-left:4px solid ${color};background:#F7F0EC;padding:10px 14px;margin:0 0 10px;font-family:Arial,sans-serif;">
    <div style="font-size:14px;color:#231F20;"><strong style="color:${color};">${recLabel}</strong> — <strong>${c.name}</strong> <span style="color:#888;font-size:12px;">${c.role}</span> <span style="color:#888;font-size:12px;">· ${trend}</span></div>
    <div style="font-size:13px;color:#444;margin-top:4px;">${c.reasons}</div>
    <div style="font-size:12px;color:#888;margin-top:4px;">${c.ladder}</div>
  </div>`;
}

/* ---------- main ---------- */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Vault isn't exposed over PostgREST; go through the service-role-only RPC.
  const vault = async (name: string) => {
    const { data } = await admin.rpc("get_vault_secret", { p_name: name });
    return (data as string | null) ?? undefined;
  };

  // Authorize: cron secret header, or an active regional user's JWT.
  let testRecipient: string | null = null;
  let isTest = false;
  try {
    const body = await req.json().catch(() => ({}));
    isTest = !!body?.test;
  } catch { /* no body */ }

  const cronSecret = await vault("coach_email_cron_secret");
  const givenSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || givenSecret !== cronSecret) {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: caller } = await admin.auth.getUser(token);
    if (!caller?.user) return json({ error: "Not authorized" }, 401);
    const { data: prof } = await admin.from("profiles").select("role, active, email").eq("id", caller.user.id).maybeSingle();
    if (!prof || prof.role !== "regional" || !prof.active) return json({ error: "Regional role required" }, 403);
    testRecipient = prof.email;
    isTest = true; // manual invocations are always test sends to the caller
  }

  const apiKey = await vault("resend_api_key");
  if (!apiKey) {
    await admin.from("event_log").insert({ actor_email: "system", message: "Coach email skipped: no Resend API key in Vault" });
    return json({ skipped: "no resend_api_key in Vault" });
  }
  const fromAddr = (await vault("coach_email_from")) || "Performance Tracker <onboarding@resend.dev>";

  // Week ending "today" in Chicago (cron fires Sunday evening CT).
  const end = chicagoToday();
  const weekStart = addDays(end, -6);
  const windowStart = addDays(end, -34); // covers trend week + self-gen month-to-date

  const [{ data: markets }, { data: reps }, { data: entries }, { data: escalations }, { data: profiles }] = await Promise.all([
    admin.from("markets").select("*").order("name"),
    admin.from("reps").select("*").eq("active", true).eq("terminated", false),
    admin.from("kpi_entries").select("*").gte("entry_date", windowStart),
    admin.from("escalations").select("rep_id, severity"),
    admin.from("profiles").select("*").eq("active", true),
  ]);
  if (!markets || !reps || !entries || !profiles) return json({ error: "data load failed" }, 500);

  const byRepDate: Record<string, Record<string, Entry>> = {};
  for (const e of entries as Entry[]) (byRepDate[e.rep_id] ??= {})[e.entry_date] = e;
  const escByRep: Record<string, string[]> = {};
  for (const e of (escalations ?? []) as { rep_id: string; severity: string }[]) (escByRep[e.rep_id] ??= []).push(e.severity);
  const closerIds = new Set((reps as Rep[]).filter((r) => r.role === "closer").map((r) => r.id));

  // Build per-market sections.
  const sections: Record<string, { html: string; oneOnOnes: number; shadows: number; winCount: number }> = {};
  for (const m of markets as { id: string; name: string }[]) {
    const mReps = (reps as Rep[]).filter((r) => r.market_id === m.id);
    let cardRows = "", oneOnOnes = 0, shadows = 0;
    const winLines: string[] = [];
    const totals = { doors: 0, sets: 0, closes: 0, revenue: 0 };
    for (const rep of mReps) {
      const byDate = byRepDate[rep.id] || {};
      const weekEntries = listDates(weekStart, end).map((d) => byDate[d]).filter(Boolean) as Entry[];
      const s = stats(rep, weekEntries);
      totals.doors += s.doors_knocked;
      totals.sets += s.sets_set + (rep.role === "closer" ? s.self_gen_sets : 0);
      if (closerIds.has(rep.id)) { totals.closes += s.totalCloses; totals.revenue += s.revenue; }

      const fl = flagsFor(rep, byDate, end);
      const hasEffort = fl.some((f) => f.kind === "effort"), hasSkill = fl.some((f) => f.kind === "skill");
      const rec = hasEffort && hasSkill ? "both" : hasEffort ? "1on1" : hasSkill ? "shadow" : null;
      if (rec) {
        if (rec !== "shadow") oneOnOnes++;
        if (rec !== "1on1") shadows++;
        const prevWeek = listDates(addDays(weekStart, -7), addDays(end, -7)).map((d) => byDate[d]).filter(Boolean) as Entry[];
        const cur = weekScore(rep, weekEntries), prev = weekScore(rep, prevWeek);
        const trend = prevWeek.length === 0 ? "flat" : cur > prev * 1.1 ? "up" : cur < prev * 0.9 ? "down" : "flat";
        const worst = Math.max(-1, ...(escByRep[rep.id] ?? []).map((sv) => SEV.indexOf(sv)));
        const next = SEV[Math.min(worst + 1, SEV.length - 1)];
        const ladder = worst >= 0
          ? `On file: ${SEV_LABEL[SEV[worst]]} → next step if it continues: ${SEV_LABEL[next]}`
          : "Nothing on file — conversation first, paper only if it repeats.";
        cardRows += cardHtml({ name: rep.name, role: rep.role, rec, trend, reasons: fl.map((f) => f.text).join(" · "), ladder });
      }
      const w = wins(rep, s);
      if (w.length) winLines.push(`<strong>${rep.name}</strong> — ${w.join(", ")}`);
    }
    const winRows = winLines.length
      ? `<div style="background:#EAF3DE;padding:8px 14px;font-family:Arial,sans-serif;font-size:13px;color:#27500A;">WINS TO CALL OUT: ${winLines.join(" · ")}</div>`
      : "";
    sections[m.id] = { html: marketHtml(m, cardRows, winRows, totals, weekStart), oneOnOnes, shadows, winCount: winLines.length };
  }

  const wrap = (inner: string) => `
    <div style="max-width:640px;margin:0 auto;padding:20px;">
      <div style="border-top:4px solid #EB2229;padding-top:14px;">
        <p style="font-family:Arial,sans-serif;font-size:18px;font-weight:bold;color:#231F20;margin:0 0 2px;">PERFORMANCE TRACKER — COACH'S CARD</p>
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#888;margin:0 0 18px;">Plan Monday: 1-on-1s are effort conversations, shadows are ride-alongs to coach the craft.</p>
        ${inner}
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#888;margin-top:18px;">Full detail in the tracker → <a href="https://jakesregion.net" style="color:#EB2229;">jakesregion.net</a> · Accountability tab</p>
      </div>
    </div>`;

  async function send(to: string, subject: string, html: string) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromAddr, to: [to], subject, html }),
    });
    const out = await res.json().catch(() => ({}));
    return { ok: res.ok, detail: out };
  }

  const results: Record<string, unknown> = {};
  const subjectFor = (name: string, s: { oneOnOnes: number; shadows: number; winCount: number }) =>
    `${name} week of ${weekStart} — ${s.oneOnOnes} one-on-one${s.oneOnOnes === 1 ? "" : "s"}, ${s.shadows} shadow${s.shadows === 1 ? "" : "s"}, ${s.winCount} win${s.winCount === 1 ? "" : "s"}`;

  if (isTest && testRecipient) {
    // Test: full regional digest to the caller only.
    const inner = (markets as { id: string }[]).map((m) => sections[m.id].html).join("");
    const tot = Object.values(sections).reduce((a, s) => ({ o: a.o + s.oneOnOnes, sh: a.sh + s.shadows, w: a.w + s.winCount }), { o: 0, sh: 0, w: 0 });
    results[testRecipient] = await send(testRecipient, `[TEST] Region week of ${weekStart} — ${tot.o} one-on-ones, ${tot.sh} shadows, ${tot.w} wins`, wrap(inner));
  } else {
    // Real run: each MO gets their market; every regional gets the full digest.
    for (const p of profiles as { email: string; role: string; market_id: string | null }[]) {
      if (p.role === "market_owner" && p.market_id && sections[p.market_id]) {
        const m = (markets as { id: string; name: string }[]).find((x) => x.id === p.market_id)!;
        results[p.email] = await send(p.email, subjectFor(m.name, sections[p.market_id]), wrap(sections[p.market_id].html));
      } else if (p.role === "regional") {
        const inner = (markets as { id: string }[]).map((m) => sections[m.id].html).join("");
        const tot = Object.values(sections).reduce((a, s) => ({ o: a.o + s.oneOnOnes, sh: a.sh + s.shadows, w: a.w + s.winCount }), { o: 0, sh: 0, w: 0 });
        results[p.email] = await send(p.email, `Region week of ${weekStart} — ${tot.o} one-on-ones, ${tot.sh} shadows, ${tot.w} wins`, wrap(inner));
      }
    }
  }

  const sent = Object.entries(results).filter(([, r]) => (r as { ok: boolean }).ok).map(([e]) => e);
  const failed = Object.entries(results).filter(([, r]) => !(r as { ok: boolean }).ok);
  await admin.from("event_log").insert({
    actor_email: "system",
    message: `Coach email ${isTest ? "(test) " : ""}sent to ${sent.length} recipient(s)${failed.length ? `, ${failed.length} failed` : ""} for week of ${weekStart}`,
  });
  return json({ ok: true, sent, failed: failed.map(([e, r]) => ({ email: e, detail: (r as { detail: unknown }).detail })) });
});
