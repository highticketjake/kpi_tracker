import { useMemo, useState } from "react";
import { monthStart, today, tenureLabel } from "../lib/dates";
import {
  repStats, repHours, coachAssessment, qualityScore, qualityGrade, meetsDailyStandard,
  fmt1, fmtPct, fmtMoney,
} from "../lib/calc";
import { Card, SectionTitle, Select, Stat, Badge, Btn } from "./ui";
import { Funnel } from "./viz";
import { rangeBounds } from "./RoleTab";

const RANGES = [
  ["week", "This Week"], ["7d", "Last 7 Days"], ["month", "This Month"], ["30d", "Last 30 Days"],
];

const REC_META = {
  "1on1": { label: "1-ON-1 · effort", color: "#f09595", bg: "rgba(235,34,41,0.15)" },
  shadow: { label: "SHADOW · skill", color: "#F6C444", bg: "rgba(246,196,68,0.14)" },
  both: { label: "1-ON-1 + SHADOW", color: "#f09595", bg: "rgba(235,34,41,0.15)" },
};
const TREND = {
  up: { text: "trending up vs last week", color: "#B8D576", arrow: "▲" },
  down: { text: "trending down vs last week", color: "#EB2229", arrow: "▼" },
  flat: { text: "about even with last week", color: "#9B9495", arrow: "■" },
};

// One day's combined numbers (legacy daily counts + sales ledger) for a rep.
// Shared by the list table and the calendar so they can never disagree.
function dayNumbers(rep, e, ds) {
  const isK = rep.role === "knocker";
  const dsRevenue = ds.reduce((a, x) => a + (x.cancelled_at ? 0 : Number(x.amount) || 0), 0);
  const legacyCloses = isK ? (e.closes || 0) : (e.appts_closed || 0) + (e.self_gen_closes || 0);
  const ran = (e.appts_ran || 0) + ds.length;
  const eff = { ...e, appts_ran: ran };
  return {
    doors_knocked: e.doors_knocked || 0, convos_had: e.convos_had || 0, sets_set: e.sets_set || 0,
    self_gen_sets: e.self_gen_sets || 0,
    no_gos: e.no_gos || 0, credit_fails: e.credit_fails || 0, cads: e.cads || 0, cancels: e.cancels || 0,
    closes: legacyCloses + ds.length,
    sg: (e.self_gen_closes || 0) + ds.filter((x) => x.attribution === "self_gen").length,
    revenue: (Number(e.revenue) || 0) + dsRevenue,
    ran,
    hours: repHours(rep, eff),
    met: meetsDailyStandard(rep, eff),
  };
}

// Per-rep deep-dive for 1-on-1s: pick a rep + range, see their numbers,
// the coach read, and a day-by-day history. v2.5: reads are region-wide, so
// every user gets the market picker (market owners default to their own).
export default function RepTracker({ ctx }) {
  const { markets, reps, entries, sales = [], escalations, profile, isRegional } = ctx;
  const [marketId, setMarketId] = useState(isRegional ? "" : profile.market_id);
  const [range, setRange] = useState("month");

  const repList = useMemo(
    () =>
      reps
        .filter((r) => !marketId || r.market_id === marketId)
        .slice()
        .sort((a, b) => Number(a.terminated) - Number(b.terminated) || a.name.localeCompare(b.name)),
    [reps, marketId]
  );
  const [repId, setRepId] = useState(repList[0]?.id || "");
  const rep = repList.find((r) => r.id === repId) || repList[0];

  const view = useMemo(() => {
    if (!rep) return null;
    const isK = rep.role === "knocker";
    const [start, end] = rangeBounds(range);
    const repEntries = entries.filter((e) => e.rep_id === rep.id);
    const repSales = sales.filter((s) => (isK ? s.knocker_id : s.closer_id) === rep.id);
    const inRange = repEntries.filter((e) => e.entry_date >= start && e.entry_date <= end);
    const inRangeSales = repSales.filter((s) => s.sale_date >= start && s.sale_date <= end);
    const byDate = {};
    for (const e of repEntries) byDate[e.entry_date] = e;
    const escByRep = escalations.filter((e) => e.rep_id === rep.id);
    const stats = repStats(rep, inRange, inRangeSales);
    const q = isK ? qualityScore(stats) : null;
    const coach = coachAssessment(rep, byDate, today(), escByRep, repSales);

    // All sales by date (full window) — the calendar isn't range-limited.
    const allSalesByDate = {};
    for (const s of repSales) (allSalesByDate[s.sale_date] ??= []).push(s);
    const salesByDate = {};
    for (const s of inRangeSales) (salesByDate[s.sale_date] ??= []).push(s);

    // Daily history merged from entries + sales (closes/revenue/ran are combined)
    const dates = Array.from(new Set([...inRange.map((e) => e.entry_date), ...Object.keys(salesByDate)]))
      .sort((a, b) => (a < b ? 1 : -1));
    const rows = dates.map((date) => ({ date, ...dayNumbers(rep, byDate[date] || {}, salesByDate[date] || []) }));
    const totals = {
      doors: stats.doors_knocked,
      convos: stats.convos_had,
      sets: stats.sets_set + (isK ? 0 : stats.self_gen_sets),
      ran: stats.appts_ran,
      closes: stats.totalCloses,
    };
    return { stats, q, grade: qualityGrade(q), coach, rows, totals, byDate, allSalesByDate };
  }, [rep, range, entries, sales, escalations]);

  const [histView, setHistView] = useState("cal");

  if (!rep)
    return (
      <Card className="p-6 text-center text-sm text-pw-muted">
        No reps to show{marketId ? " in this market" : ""}. Add them on the Roster tab.
      </Card>
    );

  const isKnocker = rep.role === "knocker";
  const s = view.stats;

  const statCards = isKnocker
    ? [
        ["Sets", s.sets_set, true], ["Doors", s.doors_knocked], ["Convos", s.convos_had],
        ["Ran", s.appts_ran], ["Closes", s.totalCloses], ["C2S%", fmtPct(s.c2s)],
        ["Quality", view.grade ? `${view.q} ${view.grade.letter}` : "—"],
        ["CADs", s.cads], ["Cancels", s.cancels], ["Full days", s.fullDays],
      ]
    : [
        ["Closes", s.totalCloses, true], ["Ran", s.appts_ran], ["Close%", fmtPct(s.closeRate)],
        ["CAD%", fmtPct(s.cadRate)], ["Revenue", fmtMoney(s.revenue)], ["Hours", fmt1(s.hours)],
        ["SG closes", s.self_gen_closes], ["CADs", s.cads], ["Cancels", s.cancels], ["Full days", s.fullDays],
      ];

  const histCols = isKnocker
    ? [["doors_knocked", "Doors"], ["convos_had", "Convos"], ["sets_set", "Sets"], ["no_gos", "No-go"], ["closes", "Cls"], ["credit_fails", "CF"], ["cads", "CAD"], ["cancels", "Can"], ["ran", "Ran"]]
    : [["convos_had", "Convos"], ["self_gen_sets", "SG sets"], ["no_gos", "No-go"], ["closes", "Cls"], ["credit_fails", "CF"], ["cads", "CAD"], ["cancels", "Can"], ["ran", "Ran"], ["sg", "SG cls"], ["revenue", "Rev"]];

  const t = TREND[view.coach.trend];
  const recMeta = view.coach.rec ? REC_META[view.coach.rec] : null;

  return (
    <div className="space-y-3">
      <SectionTitle
        right={
          <div className="flex flex-wrap gap-2">
            <Select value={marketId} onChange={(e) => { setMarketId(e.target.value); setRepId(""); }}>
              <option value="">All Markets</option>
              {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            <Select value={rep.id} onChange={(e) => setRepId(e.target.value)}>
              {repList.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.role}{r.terminated ? " (former)" : ""}
                </option>
              ))}
            </Select>
            <Select value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
          </div>
        }
      >
        Rep Tracker
      </SectionTitle>

      <Card className="p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-white text-lg">{rep.name}</span>
          <span className="text-[10px] uppercase tracking-widest text-pw-muted">{rep.role}</span>
          <span className="text-xs text-pw-muted">{markets.find((m) => m.id === rep.market_id)?.name}</span>
          <span className="text-xs text-pw-muted">· {tenureLabel(rep.start_date, today())}</span>
          <span className="ml-auto text-xs font-bold" style={{ color: t.color }}>{t.arrow} {t.text}</span>
        </div>
      </Card>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {statCards.map(([label, value, accent]) => <Stat key={label} label={label} value={value} accent={accent} />)}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <Card className="p-3.5">
          <h3 className="font-extrabold text-sm uppercase tracking-tight text-pw-muted mb-2.5">Funnel</h3>
          <Funnel totals={view.totals} />
        </Card>

        <Card className="p-3.5">
          <h3 className="font-extrabold text-sm uppercase tracking-tight text-pw-muted mb-2.5">Coach read (trailing week)</h3>
          {recMeta && <Badge color={recMeta.color} bg={recMeta.bg} className="mb-2">{recMeta.label}</Badge>}
          {view.coach.flags.length > 0 ? (
            <ul className="text-sm text-gray-300 space-y-1">
              {view.coach.flags.map((f, i) => (
                <li key={i}><span className="text-pw-muted">{f.kind === "skill" ? "🎯" : "⏱"}</span> {f.text}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-pw-lightgreen">Standards met — nothing to flag this week.</p>
          )}
          {view.coach.wins.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {view.coach.wins.map((w) => <Badge key={w.key}>{w.label}</Badge>)}
            </div>
          )}
          {view.coach.onFile && (
            <p className="text-xs text-pw-muted mt-2.5">On file: {view.coach.onFile.label} → next step: {view.coach.nextStep.label}</p>
          )}
        </Card>
      </div>

      <Card className="p-3 overflow-x-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-extrabold text-sm uppercase tracking-tight text-pw-muted">Daily history</h3>
          <div className="flex gap-1">
            {[["cal", "Calendar"], ["list", "List"]].map(([k, label]) => (
              <button key={k} onClick={() => setHistView(k)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                  histView === k ? "bg-pw-red text-white" : "bg-pw-surface2 text-gray-300"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {histView === "cal" ? (
          <HistoryCalendar rep={rep} byDate={view.byDate} salesByDate={view.allSalesByDate} />
        ) : (
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-pw-muted">
                <th className="py-1.5 pr-2">Date</th>
                <th className="py-1.5 pr-2 text-right">Hrs</th>
                {histCols.map(([, label]) => <th key={label} className="py-1.5 pr-2 text-right">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.date} className="border-t border-pw-line/60">
                  <td className="py-1.5 pr-2 text-gray-200">{row.date}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-pw-muted">{fmt1(row.hours)}</td>
                  {histCols.map(([key]) => (
                    <td key={key} className="py-1.5 pr-2 text-right tabular-nums text-gray-200">
                      {key === "revenue" ? fmtMoney(row[key]) : (row[key] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
              {view.rows.length === 0 && (
                <tr><td colSpan={histCols.length + 2} className="py-6 text-center text-pw-muted">No entries in this range.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ---------- calendar history (v2.5) ----------
   Month grid, Monday-start. Cell color tells the story at a glance:
   green = daily standard met, yellow = worked but below standard,
   plain = nothing logged. Knockers show sets + doors, closers show
   closes + revenue. Click a day for the full numbers. */
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function HistoryCalendar({ rep, byDate, salesByDate }) {
  const [anchor, setAnchor] = useState(monthStart(today()));
  const [selected, setSelected] = useState(null);
  const isK = rep.role === "knocker";

  const y = Number(anchor.slice(0, 4)), m = Number(anchor.slice(5, 7));
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Mon = 0
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${anchor.slice(0, 8)}${String(i + 1).padStart(2, "0")}`),
  ];
  const shiftMonth = (n) => {
    const d = new Date(y, m - 1 + n, 1);
    setAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
    setSelected(null);
  };

  const dayOf = (date) => dayNumbers(rep, byDate[date] || {}, salesByDate[date] || []);
  const hasData = (date) => !!byDate[date] || (salesByDate[date] || []).length > 0;
  const sel = selected && hasData(selected) ? dayOf(selected) : null;

  const cellStyle = (date) => {
    if (!hasData(date)) return date > today()
      ? "bg-transparent border-pw-line/30 text-pw-muted/40"
      : "bg-pw-black/30 border-pw-line/50 text-pw-muted";
    const d = dayOf(date);
    return d.met
      ? "bg-[rgba(16,141,7,0.18)] border-[rgba(184,213,118,0.45)]"
      : "bg-[rgba(246,196,68,0.10)] border-[rgba(246,196,68,0.35)]";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Btn kind="subtle" onClick={() => shiftMonth(-1)}>&lsaquo; prev</Btn>
        <span className="font-extrabold text-white">{MONTH_NAMES[m - 1]} {y}</span>
        <Btn kind="subtle" onClick={() => shiftMonth(1)} disabled={anchor >= monthStart(today())}>next &rsaquo;</Btn>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[9px] uppercase tracking-widest text-pw-muted mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) =>
          date === null ? (
            <div key={`x${i}`} />
          ) : (
            <button key={date} onClick={() => setSelected(selected === date ? null : date)}
              className={`rounded-lg border p-1 min-h-[52px] text-left transition ${cellStyle(date)} ${
                selected === date ? "ring-2 ring-pw-red" : ""} ${date === today() ? "outline outline-1 outline-pw-red/60" : ""}`}>
              <div className="text-[10px] text-pw-muted leading-none">{Number(date.slice(8, 10))}</div>
              {hasData(date) && (() => {
                const d = dayOf(date);
                return isK ? (
                  <>
                    <div className="font-extrabold text-white text-sm leading-tight">{d.sets_set}<span className="text-[9px] font-bold text-pw-muted ml-0.5">sets</span></div>
                    <div className="text-[9px] text-pw-muted tabular-nums">{d.doors_knocked} drs</div>
                  </>
                ) : (
                  <>
                    <div className="font-extrabold text-white text-sm leading-tight">{d.closes}<span className="text-[9px] font-bold text-pw-muted ml-0.5">cls</span></div>
                    <div className="text-[9px] text-pw-muted tabular-nums">{d.revenue > 0 ? fmtMoney(d.revenue) : `${fmt1(d.hours)}h`}</div>
                  </>
                );
              })()}
            </button>
          )
        )}
      </div>
      <div className="flex gap-3 mt-2 text-[10px] text-pw-muted">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[rgba(16,141,7,0.5)] mr-1 align-middle" />standard met</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[rgba(246,196,68,0.45)] mr-1 align-middle" />worked, below standard</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-pw-black/60 border border-pw-line mr-1 align-middle" />no data</span>
      </div>
      {sel && (
        <div className="mt-2.5 bg-pw-black/40 rounded-xl p-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-200 tabular-nums">
          <span className="font-bold text-white">{selected}</span>
          <span>Hrs {fmt1(sel.hours)}</span>
          {isK ? (
            <>
              <span>Doors {sel.doors_knocked}</span><span>Convos {sel.convos_had}</span>
              <span>Sets {sel.sets_set}</span><span>No-gos {sel.no_gos}</span>
              <span>Closes {sel.closes}</span><span>CF {sel.credit_fails}</span>
              <span>CADs {sel.cads}</span><span>Cancels {sel.cancels}</span><span>Ran {sel.ran}</span>
            </>
          ) : (
            <>
              <span>Convos {sel.convos_had}</span><span>SG sets {sel.self_gen_sets}</span>
              <span>No-gos {sel.no_gos}</span><span>Closes {sel.closes}</span>
              <span>CF {sel.credit_fails}</span><span>CADs {sel.cads}</span>
              <span>Cancels {sel.cancels}</span><span>Ran {sel.ran}</span>
              <span>SG closes {sel.sg}</span><span>Rev {fmtMoney(sel.revenue)}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
