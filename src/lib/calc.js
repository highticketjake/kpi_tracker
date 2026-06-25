// KPI math. Hours model (Jake, 2026-06):
//   knocker hours = convos / 10           (50 convos = 5-hr day = day worked)
//   closer hours  = appts ran + 0.5*CADs + convos/10
// Daily counts (kpi_entries): doors/convos/sets/no_gos/credit_fails/CADs/cancels.
// Closes + revenue + knocker attribution come from the `sales` ledger (v2.4):
//   each sale = closer + knocker + amount; cancel keeps the count (still a "yes",
//   still ran, still promotion credit) but drops the revenue. Legacy pre-ledger
//   closes/revenue stay in kpi_entries (frozen) and are added on top — the two
//   sources are disjoint so there is no double count.
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
  return (Number(e.convos_had) || 0) / 10;
}
export function closerHours(e) {
  return (Number(e.appts_ran) || 0) + (Number(e.cads) || 0) * 0.5 + (Number(e.convos_had) || 0) / 10;
}
export function repHours(rep, e) {
  return rep.role === "knocker" ? knockerHours(e) : closerHours(e);
}

// A ran appointment = no-go OR close OR credit fail. CADs and cancels never count.
// For closers the "close" is appts_closed; for knockers it's the attribution `closes`.
// appts_ran is stored but always kept equal to this so the rest of the app is unchanged.
export function derivedRan(rep, e) {
  const roleCloses = rep.role === "closer" ? Number(e.appts_closed) || 0 : Number(e.closes) || 0;
  return (Number(e.no_gos) || 0) + roleCloses + (Number(e.credit_fails) || 0);
}

// Aggregate a list of sale rows. closes counts ALL sales (cancelled ones are
// still a "yes"); revenue counts only active (non-cancelled) sales.
export function saleAgg(sales) {
  let closes = 0, revenue = 0, selfGen = 0;
  for (const s of sales) {
    closes += 1;
    if (!s.cancelled_at) revenue += Number(s.amount) || 0;
    if (s.attribution === "self_gen") selfGen += 1;
  }
  return { closes, revenue, selfGen };
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
  "credit_fails", "cancels", "no_gos",
];

// `sales` should be pre-filtered to the same date range as `entries`; repStats
// picks out this rep's rows (by closer_id for closers, knocker_id for knockers).
export function repStats(rep, entries, sales = []) {
  const t = Object.fromEntries(SUM_FIELDS.map((f) => [f, 0]));
  let days = 0, hours = 0, fullDays = 0, bestSets = 0, bestDoors = 0;
  for (const e of entries) {
    days++;
    const h = repHours(rep, e);
    hours += h;
    if (h >= DAY_HOURS_STD) fullDays++;
    bestSets = Math.max(bestSets, e.sets_set || 0);
    bestDoors = Math.max(bestDoors, e.doors_knocked || 0);
    for (const f of SUM_FIELDS) t[f] += Number(e[f]) || 0;
  }
  const isKnocker = rep.role === "knocker";
  const mySales = sales.filter((s) => (isKnocker ? s.knocker_id : s.closer_id) === rep.id);
  const ledgerCloses = mySales.length;                                  // incl cancelled (still a yes)
  const ledgerRevenue = mySales.reduce((a, s) => a + (s.cancelled_at ? 0 : Number(s.amount) || 0), 0);
  const ledgerSelfGen = mySales.reduce((a, s) => a + (s.attribution === "self_gen" ? 1 : 0), 0);
  // each close is a ran appointment (= an hour) for the closer
  if (!isKnocker) hours += ledgerCloses;

  // best single-day closes across legacy entries + ledger days (for badges)
  const dayCloses = {};
  for (const e of entries) {
    const legacy = (e.appts_closed || 0) + (e.self_gen_closes || 0) + (isKnocker ? e.closes || 0 : 0);
    if (legacy) dayCloses[e.entry_date] = (dayCloses[e.entry_date] || 0) + legacy;
  }
  for (const s of mySales) dayCloses[s.sale_date] = (dayCloses[s.sale_date] || 0) + 1;
  const bestCloses = Math.max(0, ...Object.values(dayCloses));

  const legacyCloses = isKnocker ? t.closes : t.appts_closed + t.self_gen_closes;
  const totalCloses = legacyCloses + ledgerCloses;
  const ran = t.appts_ran + ledgerCloses;            // legacy appts_ran holds legacy closes; ledger adds new
  const revenue = t.revenue + (isKnocker ? 0 : ledgerRevenue);
  return {
    ...t,
    days,
    hours,
    fullDays,
    bestSets,
    bestDoors,
    bestCloses,
    appts_ran: ran,                                  // combined ran (legacy + ledger)
    revenue,                                         // combined (closer)
    self_gen_closes: t.self_gen_closes + (isKnocker ? 0 : ledgerSelfGen),
    closes: isKnocker ? totalCloses : t.closes,      // knocker attribution credit, combined
    totalCloses,
    setsAvg: days ? t.sets_set / days : 0,
    hoursAvg: days ? hours / days : 0,
    d2c: pct(t.convos_had, t.doors_knocked),
    c2s: pct(t.sets_set, t.convos_had),
    closeRate: pct(totalCloses, ran),
    cadRate: pct(t.cads, ran + t.cads),
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
export function accountabilityFlags(rep, entriesByDate, endDate, sales = []) {
  const flags = [];
  const inRange = (d, start, end) => d >= start && d <= end;
  const weekStart = addDays(endDate, -6);
  const weekDates = listDates(weekStart, endDate);
  const weekEntries = weekDates.map((d) => entriesByDate[d]).filter(Boolean);
  const weekSales = sales.filter((s) => inRange(s.sale_date, weekStart, endDate));
  if (weekEntries.length === 0 && weekSales.length === 0) {
    flags.push({ level: "action", kind: "effort", text: "No data logged this week" });
    return flags;
  }
  const wk = repStats(rep, weekEntries, weekSales);
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
    const mStart = monthStart(endDate);
    const mtd = listDates(mStart, endDate).map((d) => entriesByDate[d]).filter(Boolean);
    const selfGens = mtd.reduce((s, e) => s + (Number(e.self_gen_closes) || 0), 0)
      + sales.filter((s) => s.closer_id === rep.id && s.attribution === "self_gen" && inRange(s.sale_date, mStart, endDate)).length;
    if (selfGens === 0 && dayOfMonth > 20) flags.push({ level: "action", kind: "effort", text: "0 self-gen closes this month (past day 20)" });
    else if (selfGens === 0 && dayOfMonth > 14) flags.push({ level: "coaching", kind: "effort", text: "0 self-gen closes this month (past day 14)" });
  }
  return flags;
}

// Single weekly activity score used only for week-over-week trend arrows.
export function weekScore(rep, entries, sales = []) {
  const s = repStats(rep, entries, sales);
  return rep.role === "knocker"
    ? s.sets_set * 3 + s.closes * 8 + s.doors_knocked / 40
    : s.totalCloses * 8 + s.hours;
}

// Coach's Card assessment for one rep: what conversation Monday needs.
export function coachAssessment(rep, entriesByDate, endDate, repEscalations, sales = []) {
  const flags = accountabilityFlags(rep, entriesByDate, endDate, sales);
  const weekOf = (end) => listDates(addDays(end, -6), end).map((d) => entriesByDate[d]).filter(Boolean);
  const salesOf = (end) => sales.filter((s) => s.sale_date >= addDays(end, -6) && s.sale_date <= end);
  const curEntries = weekOf(endDate);
  const curSales = salesOf(endDate);
  const cur = weekScore(rep, curEntries, curSales);
  const prevEntries = weekOf(addDays(endDate, -7));
  const prevSales = salesOf(addDays(endDate, -7));
  const prev = weekScore(rep, prevEntries, prevSales);
  const trend = prevEntries.length === 0 && prevSales.length === 0 ? "flat" : cur > prev * 1.1 ? "up" : cur < prev * 0.9 ? "down" : "flat";

  const hasEffort = flags.some((f) => f.kind === "effort");
  const hasSkill = flags.some((f) => f.kind === "skill");
  const rec = hasEffort && hasSkill ? "both" : hasEffort ? "1on1" : hasSkill ? "shadow" : null;

  const order = SEVERITIES.map((s) => s.key);
  const worst = Math.max(-1, ...(repEscalations || []).map((e) => order.indexOf(e.severity)));
  const nextStep = SEVERITIES[Math.min(worst + 1, order.length - 1)];
  const onFile = worst >= 0 ? SEVERITIES[worst] : null;

  const stats = repStats(rep, curEntries, curSales);
  const strk = streak(rep, entriesByDate, endDate);
  return { rep, flags, rec, trend, nextStep, onFile, wins: badgesFor(rep, stats, strk), stats };
}

// Knocker promotion track: credits = closes + 0.5 * credit fails;
// 8 this month + 8 prior month + 2 recruits, weighted 40/40/20.
// Sales attributed to this knocker count too — including CANCELLED ones (a
// cancel still counts toward the 8 needed to promote).
export function promotionTrack(rep, entries, refDate, sales = []) {
  const credits = (list) =>
    list.reduce((s, e) => s + (Number(e.closes) || 0) + 0.5 * (Number(e.credit_fails) || 0), 0);
  const saleCount = (start, end) =>
    sales.filter((s) => s.knocker_id === rep.id && s.sale_date >= start && s.sale_date <= end).length;
  const curStart = monthStart(refDate);
  const [prevStart, prevEnd] = prevMonthRange(refDate);
  const cur = credits(entries.filter((e) => e.entry_date >= curStart && e.entry_date <= refDate)) + saleCount(curStart, refDate);
  const prev = credits(entries.filter((e) => e.entry_date >= prevStart && e.entry_date <= prevEnd)) + saleCount(prevStart, prevEnd);
  const recruits = Number(rep.recruits) || 0;
  const track = Math.min(cur / 8, 1) * 0.4 + Math.min(prev / 8, 1) * 0.4 + Math.min(recruits / 2, 1) * 0.2;
  return { cur, prev, recruits, track: track * 100 };
}

// Market aggregates. Closes + revenue = legacy closer rows (frozen) + the sales
// ledger. `sales` should be pre-filtered to this market + date range.
export function marketTotals(reps, entries, sales = []) {
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
  for (const s of sales) {
    t.closes += 1;                                   // every sale is a close (incl cancelled)
    t.ran += 1;                                       // and a ran appointment
    if (!s.cancelled_at) t.revenue += Number(s.amount) || 0;
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
