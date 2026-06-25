import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { addDays, listDates, monthStart, today, weekStartMonday } from "../lib/dates";
import { marketTotals, paceProjection, qualityScore, repStats, fmtMoney, fmtPct, fmt1, pct } from "../lib/calc";
import { Funnel, Thermometer } from "./viz";
import { setMarketGoal } from "../lib/api";
import { Card, SectionTitle, Btn, Select, Input } from "./ui";

// Market owners set their own market's monthly revenue goal here (regional can
// set any). Writes via the set_market_goal RPC so RLS lets MOs edit only theirs.
function GoalEditor({ markets, onSaved }) {
  const [vals, setVals] = useState(() => Object.fromEntries(markets.map((m) => [m.id, m.monthly_goal ?? ""])));
  const [msg, setMsg] = useState("");
  async function save(id) {
    setMsg("");
    try {
      await setMarketGoal(id, vals[id] === "" ? null : Number(vals[id]) || 0);
      setMsg("Saved ✓");
      onSaved();
    } catch (e) { setMsg(e.message || String(e)); }
  }
  return (
    <Card className="p-3">
      <h3 className="font-extrabold text-sm uppercase tracking-tight text-pw-muted mb-2">Monthly revenue goal</h3>
      <div className="space-y-1.5">
        {markets.map((m) => (
          <div key={m.id} className="flex items-center gap-2">
            <span className="text-sm text-white grow">{m.name}</span>
            <Input type="number" min="0" step="1000" value={vals[m.id]}
              onChange={(e) => setVals({ ...vals, [m.id]: e.target.value })} className="w-36" placeholder="No goal" />
            <Btn kind="subtle" onClick={() => save(m.id)}>Save</Btn>
          </div>
        ))}
      </div>
      {msg && <p className="text-xs text-pw-muted mt-1.5">{msg}</p>}
    </Card>
  );
}

function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Reports({ ctx }) {
  const { markets, reps, entries, sales = [], isRegional, profile, windowStart, refresh } = ctx;
  const myMarkets = isRegional ? markets : markets.filter((m) => m.id === profile.market_id);

  // last 6 selectable weeks, newest (current, partial) first
  const weeks = useMemo(() => {
    const cur = weekStartMonday(today());
    return Array.from({ length: 6 }, (_, i) => addDays(cur, -7 * i)).filter((w) => w >= windowStart);
  }, [windowStart]);
  const [weekStart, setWeekStart] = useState(() => (weeks[1] || weeks[0]));
  const weekEnd = addDays(weekStart, 6);
  const prevStart = addDays(weekStart, -7);
  const prevEnd = addDays(weekStart, -1);

  const weekRows = useMemo(() => {
    const inWeek = entries.filter((e) => e.entry_date >= weekStart && e.entry_date <= weekEnd);
    const inPrev = entries.filter((e) => e.entry_date >= prevStart && e.entry_date <= prevEnd);
    const salesWeek = sales.filter((s) => s.sale_date >= weekStart && s.sale_date <= weekEnd);
    const salesPrev = sales.filter((s) => s.sale_date >= prevStart && s.sale_date <= prevEnd);
    return myMarkets.map((m) => {
      const mReps = reps.filter((r) => r.market_id === m.id && r.active && !r.terminated);
      const cur = marketTotals(mReps, inWeek.filter((e) => e.market_id === m.id), salesWeek.filter((s) => s.market_id === m.id));
      const prev = marketTotals(mReps, inPrev.filter((e) => e.market_id === m.id), salesPrev.filter((s) => s.market_id === m.id));
      const knockers = mReps.filter((r) => r.role === "knocker");
      const kEntries = inWeek.filter((e) => e.market_id === m.id && knockers.some((r) => r.id === e.rep_id));
      const kStats = repStats({ role: "knocker" }, kEntries);
      return { market: m, cur, prev, quality: qualityScore(kStats) };
    });
  }, [myMarkets, reps, entries, sales, weekStart, weekEnd, prevStart, prevEnd]);

  const monthRows = useMemo(() => {
    const start = monthStart(today());
    const mtd = entries.filter((e) => e.entry_date >= start);
    const mtdSales = sales.filter((s) => s.sale_date >= start);
    return myMarkets.map((m) => {
      const mReps = reps.filter((r) => r.market_id === m.id);
      const t = marketTotals(mReps, mtd.filter((e) => e.market_id === m.id), mtdSales.filter((s) => s.market_id === m.id));
      return {
        market: m,
        revenue: t.revenue,
        closes: t.closes,
        revenuePace: paceProjection(t.revenue, today()),
        closesPace: paceProjection(t.closes, today()),
      };
    });
  }, [myMarkets, reps, entries, sales]);

  const [funnelMarket, setFunnelMarket] = useState("");
  const funnelTotals = useMemo(() => {
    const inWeek = entries.filter(
      (e) => e.entry_date >= weekStart && e.entry_date <= weekEnd && (!funnelMarket || e.market_id === funnelMarket)
    );
    const salesWeek = sales.filter(
      (s) => s.sale_date >= weekStart && s.sale_date <= weekEnd && (!funnelMarket || s.market_id === funnelMarket)
    );
    const scope = funnelMarket ? reps.filter((r) => r.market_id === funnelMarket) : reps;
    return marketTotals(scope, inWeek, salesWeek);
  }, [entries, reps, sales, weekStart, weekEnd, funnelMarket]);

  const trendData = useMemo(() => {
    const start = addDays(today(), -13);
    const byDate = Object.fromEntries(
      listDates(start, today()).map((d) => [d, { date: d.slice(5), doors: 0, convos: 0, sets: 0, closes: 0 }])
    );
    const closerIds = new Set(reps.filter((r) => r.role === "closer").map((r) => r.id));
    for (const e of entries) {
      const row = byDate[e.entry_date];
      if (!row) continue;
      if (!isRegional && e.market_id !== profile.market_id) continue;
      row.doors += e.doors_knocked || 0;
      row.convos += e.convos_had || 0;
      row.sets += (e.sets_set || 0) + (e.self_gen_sets || 0);
      if (closerIds.has(e.rep_id)) row.closes += (e.appts_closed || 0) + (e.self_gen_closes || 0);
    }
    for (const s of sales) {
      const row = byDate[s.sale_date];
      if (!row) continue;
      if (!isRegional && s.market_id !== profile.market_id) continue;
      row.closes += 1; // ledger close (incl cancelled — still a yes)
    }
    return Object.values(byDate);
  }, [entries, reps, sales, isRegional, profile]);

  function exportWeekSummary() {
    const rows = [["Market", "Doors", "Convos", "Sets", "Ran", "Closes", "Revenue", "Set quality"]];
    weekRows.forEach((r) =>
      rows.push([r.market.name, r.cur.doors, r.cur.convos, r.cur.sets, r.cur.ran, r.cur.closes, r.cur.revenue, r.quality ?? ""])
    );
    downloadCsv(`week-${weekStart}-summary.csv`, rows);
  }
  function exportRawEntries() {
    const cols = ["entry_date", "rep", "role", "market", "doors_knocked", "convos_had", "sets_set", "no_gos", "appts_ran",
      "appts_closed", "cads", "cancels", "credit_fails", "closes", "self_gen_sets", "self_gen_closes", "revenue", "notes"];
    const rows = [cols];
    const byRep = Object.fromEntries(reps.map((r) => [r.id, r]));
    entries
      .filter((e) => isRegional || e.market_id === profile.market_id)
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1))
      .forEach((e) => {
        const rep = byRep[e.rep_id];
        rows.push(cols.map((c) => {
          if (c === "rep") return rep?.name || "";
          if (c === "role") return rep?.role || "";
          if (c === "market") return markets.find((m) => m.id === e.market_id)?.name || "";
          return e[c] ?? "";
        }));
      });
    downloadCsv(`entries-${windowStart}-to-${today()}.csv`, rows);
  }
  function exportSales() {
    const cols = ["sale_date", "market", "closer", "knocker", "attribution", "amount", "cancelled"];
    const rows = [cols];
    const byRep = Object.fromEntries(reps.map((r) => [r.id, r]));
    sales
      .filter((s) => isRegional || s.market_id === profile.market_id)
      .sort((a, b) => (a.sale_date < b.sale_date ? -1 : 1))
      .forEach((s) => rows.push([
        s.sale_date,
        markets.find((m) => m.id === s.market_id)?.name || "",
        byRep[s.closer_id]?.name || "",
        s.attribution === "knocker" ? byRep[s.knocker_id]?.name || "" : s.attribution,
        s.attribution,
        s.amount,
        s.cancelled_at ? "yes" : "",
      ]));
    downloadCsv(`sales-${windowStart}-to-${today()}.csv`, rows);
  }

  const delta = (cur, prev) => {
    if (!prev) return null;
    const d = ((cur - prev) / prev) * 100;
    return (
      <span className={`text-[11px] font-bold ml-1 ${d >= 0 ? "text-pw-lightgreen" : "text-pw-orange"}`}>
        {d >= 0 ? "▲" : "▼"}{Math.abs(d).toFixed(0)}%
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <SectionTitle
        right={
          <div className="flex flex-wrap gap-2">
            <Select value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
              {weeks.map((w) => (
                <option key={w} value={w}>Week of {w}{w === weeks[0] ? " (current)" : ""}</option>
              ))}
            </Select>
            <Btn kind="subtle" onClick={exportWeekSummary}>⬇ Week CSV</Btn>
            <Btn kind="subtle" onClick={exportRawEntries}>⬇ Raw CSV</Btn>
            <Btn kind="subtle" onClick={exportSales}>⬇ Sales CSV</Btn>
          </div>
        }
      >
        Weekly Report
      </SectionTitle>

      <GoalEditor markets={myMarkets} onSaved={refresh} />

      <Card className="p-3 overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-pw-muted">
              <th className="py-1.5 pr-2">Market</th>
              <th className="py-1.5 pr-2 text-right">Doors</th>
              <th className="py-1.5 pr-2 text-right">Convos</th>
              <th className="py-1.5 pr-2 text-right">Sets</th>
              <th className="py-1.5 pr-2 text-right">Ran</th>
              <th className="py-1.5 pr-2 text-right">Closes</th>
              <th className="py-1.5 pr-2 text-right">Revenue</th>
              <th className="py-1.5 pr-2 text-right">D2C%</th>
              <th className="py-1.5 text-right">Quality</th>
            </tr>
          </thead>
          <tbody>
            {weekRows.map(({ market, cur, prev, quality }) => (
              <tr key={market.id} className="border-t border-pw-line/60">
                <td className="py-2 pr-2 font-bold text-white">{market.name}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{cur.doors}{delta(cur.doors, prev.doors)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{cur.convos}{delta(cur.convos, prev.convos)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{cur.sets}{delta(cur.sets, prev.sets)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{cur.ran}</td>
                <td className="py-2 pr-2 text-right tabular-nums font-extrabold text-pw-red">{cur.closes}{delta(cur.closes, prev.closes)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{fmtMoney(cur.revenue)}{delta(cur.revenue, prev.revenue)}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{fmtPct(pct(cur.convos, cur.doors))}</td>
                <td className="py-2 text-right tabular-nums">{quality ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-pw-muted mt-2">▲▼ vs. prior week. Closes and revenue are counted from closer entries.</p>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-extrabold uppercase tracking-tight text-white">Funnel · week of {weekStart}</h3>
            {isRegional && (
              <Select value={funnelMarket} onChange={(e) => setFunnelMarket(e.target.value)}>
                <option value="">All Markets</option>
                {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            )}
          </div>
          <Funnel totals={funnelTotals} />
        </Card>

        <Card className="p-4">
          <h3 className="font-extrabold uppercase tracking-tight text-white mb-3">This month · revenue & pace</h3>
          <div className="flex flex-wrap justify-around gap-4">
            {monthRows.map((r) => (
              <Thermometer key={r.market.id} name={r.market.name.split(",")[0]} current={r.revenue}
                goal={Number(r.market.monthly_goal) || 0} pace={r.revenuePace} />
            ))}
          </div>
          <div className="mt-3 text-[11px] text-pw-muted">
            Dashed line = projected month-end at current pace. Goals are set in Admin → Markets.
            {monthRows.map((r) => (
              <span key={r.market.id} className="ml-2">{r.market.name.split(",")[0]}: {r.closes} closes → on pace for {Math.round(r.closesPace)}.</span>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-3">
        <h3 className="font-extrabold uppercase tracking-tight text-white mb-2 px-1">Last 14 days</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={trendData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#403A3B" />
            <XAxis dataKey="date" fontSize={11} stroke="#9B9495" />
            <YAxis fontSize={11} stroke="#9B9495" />
            <Tooltip contentStyle={{ background: "#2C2728", border: "1px solid #403A3B", borderRadius: 12, color: "#fff" }} />
            <Legend />
            <Line type="monotone" dataKey="doors" stroke="#9B9495" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="convos" stroke="#A9D9F4" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="sets" stroke="#F6C444" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="closes" stroke="#EB2229" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
