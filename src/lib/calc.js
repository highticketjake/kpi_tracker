// KPI math carried over from v1 unchanged: standards, weighted closer hours,
// streaks, accountability flags, promotion track, round-robin challenge.
import { addDays, listDates, monthStart, prevMonthRange, challengeWeekIndex, weekStartMonday } from "./dates";

export const KNOCKER_DOORS_STD = 120;
export const KNOCKER_CONVOS_STD = 50;
export const CLOSER_HOURS_STD = 5;

export const SEVERITIES = [
  { key: "coaching", label: "Coaching", color: "#FF9500", bg: "#FFF8EE" },
  { key: "warning", label: "Written Warning", color: "#FF6B00", bg: "#FFF3E8" },
  { key: "final", label: "Final Warning", color: "#FF3B30", bg: "#FFF0EF" },
  { key: "termination", label: "Termination", color: "#8B0000", bg: "#FFE5E5" },
];

export function pct(n, d) {
  return d > 0 ? (n / d) * 100 : 0;
}

// Weighted closer "hours": appts + half-credit CADs + convos/10 (v1 formula).
export function closerHours(e) {
  return (e.appts_ran || 0) + (e.cads || 0) * 0.5 + (e.convos_had || 0) / 10;
}

export function meetsDailyStandard(rep, e) {
  if (!e) return false;
  if (rep.role === "knocker")
    return (e.doors_knocked || 0) >= KNOCKER_DOORS_STD && (e.convos_had || 0) >= KNOCKER_CONVOS_STD;
  return closerHours(e) >= CLOSER_HOURS_STD;
}

const SUM_FIELDS = [
  "doors_knocked", "convos_had", "sets_set", "appts_ran", "appts_closed",
  "cads", "closes", "revenue", "self_gen_sets", "self_gen_closes",
];

// Aggregate a rep's entries over a range into board stats.
export function repStats(rep, entries) {
  const t = Object.fromEntries(SUM_FIELDS.map((f) => [f, 0]));
  let days = 0, hours = 0, creditFailCount = 0;
  for (const e of entries) {
    days++;
    hours += closerHours(e);
    creditFailCount += Array.isArray(e.credit_fails) ? e.credit_fails.length : 0;
    for (const f of SUM_FIELDS) t[f] += Number(e[f]) || 0;
  }
  return {
    ...t,
    days,
    hours,
    creditFailCount,
    setsAvg: days ? t.sets_set / days : 0,
    hoursAvg: days ? hours / days : 0,
    d2c: pct(t.convos_had, t.doors_knocked),
    c2s: pct(t.sets_set, t.convos_had),
    closeRate: pct(t.appts_closed, t.appts_ran),
    cadRate: pct(t.cads, t.appts_ran + t.cads),
  };
}

// Consecutive days (back from anchor) with an entry meeting the daily standard.
export function streak(rep, entriesByDate, anchor) {
  let n = 0;
  for (let d = anchor; ; d = addDays(d, -1)) {
    const e = entriesByDate[d];
    if (!e || !meetsDailyStandard(rep, e)) break;
    n++;
  }
  return n;
}

export function personalBests(entries) {
  const best = { doors_knocked: 0, convos_had: 0, sets_set: 0, closes: 0, appts_closed: 0 };
  for (const e of entries)
    for (const k of Object.keys(best)) best[k] = Math.max(best[k], Number(e[k]) || 0);
  return best;
}

// Accountability flags, evaluated over the trailing week ending `endDate`
// plus month-to-date self-gen rules for closers (v1 thresholds).
export function accountabilityFlags(rep, entriesByDate, endDate) {
  const flags = []; // { level: 'action' | 'coaching', text }
  const weekDates = listDates(addDays(endDate, -6), endDate);
  const weekEntries = weekDates.map((d) => entriesByDate[d]).filter(Boolean);
  if (weekEntries.length === 0) {
    flags.push({ level: "action", text: "No data logged this week" });
    return flags;
  }
  const wk = repStats(rep, weekEntries);
  const endEntry = entriesByDate[endDate];

  if (rep.role === "knocker") {
    if (endEntry && (endEntry.doors_knocked || 0) < KNOCKER_DOORS_STD)
      flags.push({ level: "action", text: `Doors below ${KNOCKER_DOORS_STD} (${endEntry.doors_knocked || 0})` });
    if (endEntry && (endEntry.convos_had || 0) < KNOCKER_CONVOS_STD)
      flags.push({ level: "action", text: `Convos below ${KNOCKER_CONVOS_STD} (${endEntry.convos_had || 0})` });
    if (wk.setsAvg < 3) flags.push({ level: "action", text: `Sets avg ${wk.setsAvg.toFixed(1)}/day (<3)` });
    else if (wk.setsAvg < 4) flags.push({ level: "coaching", text: `Sets avg ${wk.setsAvg.toFixed(1)}/day (<4)` });
    if (wk.appts_ran < 5) flags.push({ level: "action", text: `Only ${wk.appts_ran} appts ran this week (<5)` });
    if (wk.closes === 0) flags.push({ level: "action", text: "0 closes this week" });
    else if (wk.closes === 1) flags.push({ level: "coaching", text: "1 close this week (<2)" });
  } else {
    if (wk.hoursAvg < 4.5) flags.push({ level: "action", text: `Avg hours ${wk.hoursAvg.toFixed(1)} (<4.5)` });
    else if (wk.hoursAvg < 5) flags.push({ level: "coaching", text: `Avg hours ${wk.hoursAvg.toFixed(1)} (<5)` });
    const dayOfMonth = Number(endDate.slice(8, 10));
    const mtd = listDates(monthStart(endDate), endDate).map((d) => entriesByDate[d]).filter(Boolean);
    const selfGens = mtd.reduce((s, e) => s + (Number(e.self_gen_closes) || 0), 0);
    if (selfGens === 0 && dayOfMonth > 20) flags.push({ level: "action", text: "0 self-gen closes this month (past day 20)" });
    else if (selfGens === 0 && dayOfMonth > 14) flags.push({ level: "coaching", text: "0 self-gen closes this month (past day 14)" });
  }
  return flags;
}

// Knocker promotion track: 8 credits this month + 8 prior month + 2 recruits,
// weighted 40/40/20. Credits = closes + 0.5 * credit fails.
export function promotionTrack(rep, entries, refDate) {
  const credits = (list) =>
    list.reduce(
      (s, e) => s + (Number(e.closes) || 0) + 0.5 * (Array.isArray(e.credit_fails) ? e.credit_fails.length : 0),
      0
    );
  const curStart = monthStart(refDate);
  const [prevStart, prevEnd] = prevMonthRange(refDate);
  const cur = credits(entries.filter((e) => e.entry_date >= curStart && e.entry_date <= refDate));
  const prev = credits(entries.filter((e) => e.entry_date >= prevStart && e.entry_date <= prevEnd));
  const recruits = Number(rep.recruits) || 0;
  const track =
    Math.min(cur / 8, 1) * 0.4 + Math.min(prev / 8, 1) * 0.4 + Math.min(recruits / 2, 1) * 0.2;
  return { cur, prev, recruits, track: track * 100 };
}

// Weekly office challenge: round-robin (circle method), rotated by week index.
export function challengeMatchups(markets, dateStr) {
  const teams = [...markets].sort((a, b) => a.name.localeCompare(b.name));
  if (teams.length < 2) return { matchups: [], bye: null, weekStart: weekStartMonday(dateStr) };
  const list = teams.length % 2 === 1 ? [...teams, null] : teams;
  const n = list.length;
  const rounds = n - 1;
  const round = challengeWeekIndex(dateStr) % rounds;
  // circle method: fix list[0], rotate the rest by `round`
  const rest = list.slice(1);
  const rotated = rest.slice(rest.length - (round % rest.length)).concat(rest.slice(0, rest.length - (round % rest.length)));
  const order = [list[0], ...rotated];
  const matchups = [];
  let bye = null;
  for (let i = 0; i < n / 2; i++) {
    const a = order[i];
    const b = order[n - 1 - i];
    if (!a || !b) bye = a || b;
    else matchups.push([a, b]);
  }
  return { matchups, bye, weekStart: weekStartMonday(dateStr) };
}

export function fmtMoney(n) {
  return "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
export function fmt1(n) {
  return Number(n || 0).toFixed(1);
}
export function fmtPct(n) {
  return Number(n || 0).toFixed(1) + "%";
}
