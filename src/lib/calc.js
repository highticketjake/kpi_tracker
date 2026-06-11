// KPI math. Hours model (Jake, 2026-06):
//   knocker hours = convos / 10           (50 convos = 5-hr day = day worked)
//   closer hours  = appts ran + 0.5*CADs + convos/10
// Set outcomes are tracked as daily counts: closes / credit fails / cancels / CADs.
// Market revenue + market closes always come from CLOSER rows to avoid double
// counting (knocker closes are attribution for boards/promotion only).
import { addDays, listDates, monthStart, prevMonthRange, challengeWeekIndex, weekStartMonday } from "./dates";

export const KNOCKER_DOORS_STD = 120;
export const KNOCKER_CONVOS_STD = 50;
export const DAY_HOURS_STD = 5;

export const SEVERITIES = [
  { key: "coaching", label: "Coaching", color: "#F6C444", bg: "rgba(246,196,68,0.12)" },
  { key: "warning", label: "Written Warning", color: "#EA6E30", bg: "rgba(234,110,48,0.14)" },
  { key: "final", label: "Final Warning", color: "#EB2229", bg: "rgba(235,34,41,0.14)" },
  { key: "termination", label: "Termination", color: "#fff", bg: "#831618" },
];

export function pct(n, d) {
  return d > 0 ? (n / d) * 100 : 0;
}

export function knockerHours(e) {
  return (e.convos_had || 0) / 10;
}
export function closerHours(e) {
  return (e.appts_ran || 0) + (e.cads || 0) * 0.5 + (e.convos_had || 0) / 10;
}
export function repHours(rep, e) {
  return rep.role === "knocker" ? knockerHours(e) : closerHours(e);
}

export function meetsDailyStandard(rep, e) {
  if (!e) return false;
  if (rep.role === "knocker")
    return (e.doors_knocked || 0) >= KNOCKER_DOORS_STD && (e.convos_had || 0) >= KNOCKER_CONVOS_STD;
  return closerHours(e) >= DAY_HOURS_STD;
}

const SUM_FIELDS = [
  "doors_knocked", "convos_had", "sets_set", "appts_ran", "appts_closed",
  "cads", "closes", "revenue", "self_gen_sets", "self_gen_closes",
  "credit_fails", "cancels",
];

export function repStats(rep, entries) {
  const t = Object.fromEntries(SUM_FIELDS.map((f) => [f, 0]));
  let days = 0, hours = 0, fullDays = 0, bestSets = 0, bestDoors = 0, bestCloses = 0;
  for (const e of entries) {
    days++;
    const h = repHours(rep, e);
    hours += h;
    if (h >= DAY_HOURS_STD) fullDays++;
    bestSets = Math.max(bestSets, e.sets_set || 0);
    bestDoors = Math.max(bestDoors, e.doors_knocked || 0);
    bestCloses = Math.max(bestCloses, (e.appts_closed || 0) + (e.self_gen_closes || 0) + (rep.role === "knocker" ? e.closes || 0 : 0));
    for (const f of SUM_FIELDS) t[f] += Number(e[f]) || 0;
  }
  const totalCloses = rep.role === "knocker" ? t.closes : t.appts_closed + t.self_gen_closes;
  return {
    ...t,
    days,
    hours,
    fullDays,
    bestSets,
    bestDoors,
    bestCloses,
    totalCloses,
    setsAvg: days ? t.sets_set / days : 0,
    hoursAvg: days ? hours / days : 0,
    d2c: pct(t.convos_had, t.doors_knocked),
    c2s: pct(t.sets_set, t.convos_had),
    closeRate: pct(t.appts_closed, t.appts_ran),
    cadRate: pct(t.cads, t.appts_ran + t.cads),
    knockHours: t.convos_had / 10,
  };
}

// Set Quality Score (0-100) for knockers: rewards convo->set conversion,
// punishes CADs (avoidable), tolerates cancels up to the expected ~50%.
export function qualityScore(s) {
  if (!s.sets_set) return null;
  const cadShare = s.cads / s.sets_set;
  const cancelShare = s.cancels / s.sets_set;
  const conv = Math.min(pct(s.sets_set, s.convos_had) / 10, 1); // 10% c2s = perfect
  const score =
    100 * (0.4 * conv + 0.4 * Math.max(0, 1 - cadShare * 2) + 0.2 * Math.max(0, 1 - Math.max(0, cancelShare - 0.5) * 2));
  return Math.round(score);
}
export function qualityGrade(score) {
  if (score == null) return null;
  if (score >= 85) return { letter: "A", color: "#B8D576" };
  if (score >= 70) return { letter: "B", color: "#108D07" };
  if (score >= 55) return { letter: "C", color: "#F6C444" };
  if (score >= 40) return { letter: "D", color: "#EA6E30" };
  return { letter: "F", color: "#EB2229" };
}

// Month-end pace projection from month-to-date totals.
export function paceProjection(mtdTotal, refDate) {
  const dayOfMonth = Number(refDate.slice(8, 10));
  const [y, m] = [Number(refDate.slice(0, 4)), Number(refDate.slice(5, 7))];
  const dim = new Date(y, m, 0).getDate();
  return dayOfMonth > 0 ? (mtdTotal / dayOfMonth) * dim : 0;
}

export function streak(rep, entriesByDate, anchor) {
  let n = 0;
  for (let d = anchor; ; d = addDays(d, -1)) {
    const e = entriesByDate[d];
    if (!e || !meetsDailyStandard(rep, e)) break;
    n++;
  }
  return n;
}

// Milestone badges over the loaded window (shown on boards + TV).
export function badgesFor(rep, stats, strk) {
  const out = [];
  if (strk >= 5) out.push({ key: "fire", label: `🔥 ${strk}-day streak` });
  if (rep.role === "knocker") {
    if (stats.bestSets >= 5) out.push({ key: "sets5", label: "⚡ 5-set day" });
    if (stats.bestDoors >= 150) out.push({ key: "doors150", label: "🚪 150-door day" });
  } else {
    if (stats.bestCloses >= 3) out.push({ key: "closes3", label: "💪 3-close day" });
    if (stats.revenue >= 25000) out.push({ key: "rev25", label: "💰 $25k window" });
  }
  if (stats.fullDays >= 5) out.push({ key: "week5", label: "✅ 5 full days" });
  return out;
}

// Trailing-week accountability flags (v1 thresholds kept).
// Each flag carries a kind: 'effort' (activity problem -> 1-on-1) or
// 'skill' (conversion problem -> shadow / ride-along).
export function accountabilityFlags(rep, entriesByDate, endDate) {
  const flags = [];
  const weekDates = listDates(addDays(endDate, -6), endDate);
  const weekEntries = weekDates.map((d) => entriesByDate[d]).filter(Boolean);
  if (weekEntries.length === 0) {
    flags.push({ level: "action", kind: "effort", text: "No data logged this week" });
    return flags;
  }
  const wk = repStats(rep, weekEntries);
  const endEntry = entriesByDate[endDate];

  if (rep.role === "knocker") {
    if (endEntry && (endEntry.doors_knocked || 0) < KNOCKER_DOORS_STD)
      flags.push({ level: "action", kind: "effort", text: `Doors below ${KNOCKER_DOORS_STD} (${endEntry.doors_knocked || 0})` });
    if (endEntry && (endEntry.convos_had || 0) < KNOCKER_CONVOS_STD)
      flags.push({ level: "action", kind: "effort", text: `Convos below ${KNOCKER_CONVOS_STD} (${endEntry.convos_had || 0})` });
    // low sets despite real conversation volume = pitch problem, not effort
    const talking = wk.convos_had / Math.max(wk.days, 1) >= 40;
    if (wk.setsAvg < 3) flags.push({ level: "action", kind: talking ? "skill" : "effort", text: `Sets avg ${wk.setsAvg.toFixed(1)}/day (<3)` });
    else if (wk.setsAvg < 4) flags.push({ level: "coaching", kind: talking ? "skill" : "effort", text: `Sets avg ${wk.setsAvg.toFixed(1)}/day (<4)` });
    if (wk.appts_ran < 5) flags.push({ level: "action", kind: "effort", text: `Only ${wk.appts_ran} appts ran this week (<5)` });
    if (wk.closes === 0) flags.push({ level: "action", kind: wk.appts_ran >= 5 ? "skill" : "effort", text: "0 closes this week" });
    else if (wk.closes === 1) flags.push({ level: "coaching", kind: "skill", text: "1 close this week (<2)" });
    const q = qualityScore(wk);
    if (q != null && q < 40) flags.push({ level: "coaching", kind: "skill", text: `Set quality ${q}/100 — CADs/cancels piling up` });
  } else {
    if (wk.hoursAvg < 4.5) flags.push({ level: "action", kind: "effort", text: `Avg hours ${wk.hoursAvg.toFixed(1)} (<4.5)` });
    else if (wk.hoursAvg < 5) flags.push({ level: "coaching", kind: "effort", text: `Avg hours ${wk.hoursAvg.toFixed(1)} (<5)` });
    if (wk.appts_ran >= 5 && wk.closeRate < 30)
      flags.push({ level: "coaching", kind: "skill", text: `Close rate ${wk.closeRate.toFixed(0)}% on ${wk.appts_ran} appts (<30%)` });
    const dayOfMonth = Number(endDate.slice(8, 10));
    const mtd = listDates(monthStart(endDate), endDate).map((d) => entriesByDate[d]).filter(Boolean);
    const selfGens = mtd.reduce((s, e) => s + (Number(e.self_gen_closes) || 0), 0);
    if (selfGens === 0 && dayOfMonth > 20) flags.push({ level: "action", kind: "effort", text: "0 self-gen closes this month (past day 20)" });
    else if (selfGens === 0 && dayOfMonth > 14) flags.push({ level: "coaching", kind: "effort", text: "0 self-gen closes this month (past day 14)" });
  }
  return flags;
}

// Single weekly activity score used only for week-over-week trend arrows.
export function weekScore(rep, entries) {
  const s = repStats(rep, entries);
  return rep.role === "knocker"
    ? s.sets_set * 3 + s.closes * 8 + s.doors_knocked / 40
    : s.totalCloses * 8 + s.hours;
}

// Coach's Card assessment for one rep: what conversation Monday needs.
export function coachAssessment(rep, entriesByDate, endDate, repEscalations) {
  const flags = accountabilityFlags(rep, entriesByDate, endDate);
  const weekOf = (end) => listDates(addDays(end, -6), end).map((d) => entriesByDate[d]).filter(Boolean);
  const curEntries = weekOf(endDate);
  const prevEntries = weekOf(addDays(endDate, -7));
  const cur = weekScore(rep, curEntries);
  const prev = weekScore(rep, prevEntries);
  const trend = prevEntries.length === 0 ? "flat" : cur > prev * 1.1 ? "up" : cur < prev * 0.9 ? "down" : "flat";

  const hasEffort = flags.some((f) => f.kind === "effort");
  const hasSkill = flags.some((f) => f.kind === "skill");
  const rec = hasEffort && hasSkill ? "both" : hasEffort ? "1on1" : hasSkill ? "shadow" : null;

  const order = SEVERITIES.map((s) => s.key);
  const worst = Math.max(-1, ...(repEscalations || []).map((e) => order.indexOf(e.severity)));
  const nextStep = SEVERITIES[Math.min(worst + 1, order.length - 1)];
  const onFile = worst >= 0 ? SEVERITIES[worst] : null;

  const stats = repStats(rep, curEntries);
  const strk = streak(rep, entriesByDate, endDate);
  return { rep, flags, rec, trend, nextStep, onFile, wins: badgesFor(rep, stats, strk), stats };
}

// Knocker promotion track: credits = closes + 0.5 * credit fails;
// 8 this month + 8 prior month + 2 recruits, weighted 40/40/20.
export function promotionTrack(rep, entries, refDate) {
  const credits = (list) =>
    list.reduce((s, e) => s + (Number(e.closes) || 0) + 0.5 * (Number(e.credit_fails) || 0), 0);
  const curStart = monthStart(refDate);
  const [prevStart, prevEnd] = prevMonthRange(refDate);
  const cur = credits(entries.filter((e) => e.entry_date >= curStart && e.entry_date <= refDate));
  const prev = credits(entries.filter((e) => e.entry_date >= prevStart && e.entry_date <= prevEnd));
  const recruits = Number(rep.recruits) || 0;
  const track = Math.min(cur / 8, 1) * 0.4 + Math.min(prev / 8, 1) * 0.4 + Math.min(recruits / 2, 1) * 0.2;
  return { cur, prev, recruits, track: track * 100 };
}

// Market aggregates. Closes + revenue come from closer rows only.
export function marketTotals(reps, entries) {
  const byRep = Object.fromEntries(reps.map((r) => [r.id, r]));
  const t = { doors: 0, convos: 0, sets: 0, ran: 0, closes: 0, revenue: 0, cads: 0, cancels: 0 };
  for (const e of entries) {
    const rep = byRep[e.rep_id];
    if (!rep) continue;
    t.doors += e.doors_knocked || 0;
    t.convos += e.convos_had || 0;
    t.sets += (e.sets_set || 0) + (rep.role === "closer" ? e.self_gen_sets || 0 : 0);
    t.cancels += e.cancels || 0;
    t.cads += e.cads || 0;
    if (rep.role === "closer") {
      t.ran += e.appts_ran || 0;
      t.closes += (e.appts_closed || 0) + (e.self_gen_closes || 0);
      t.revenue += Number(e.revenue) || 0;
    }
  }
  return t;
}

export function challengeMatchups(markets, dateStr) {
  const teams = [...markets].sort((a, b) => a.name.localeCompare(b.name));
  if (teams.length < 2) return { matchups: [], bye: null, weekStart: weekStartMonday(dateStr) };
  const list = teams.length % 2 === 1 ? [...teams, null] : teams;
  const n = list.length;
  const rounds = n - 1;
  const round = challengeWeekIndex(dateStr) % rounds;
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
