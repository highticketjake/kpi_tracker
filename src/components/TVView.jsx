import { useMemo, useState } from "react";
import { addDays, monthStart, today, weekStartMonday } from "../lib/dates";
import { repStats, fmtMoney } from "../lib/calc";
import { Btn } from "./ui";

// Office TV leaderboard: dark fullscreen, top knockers by sets and
// closers by closes, MVPs, market totals. Scoped by RLS like the rest.
export default function TVView({ ctx, onExit }) {
  const { markets, reps, entries, isRegional, profile } = ctx;
  const [mode, setMode] = useState("week");
  const [marketId, setMarketId] = useState(isRegional ? "" : profile.market_id);

  const [start, end] = useMemo(() => {
    const t = today();
    return mode === "week" ? [weekStartMonday(t), t] : [monthStart(t), t];
  }, [mode]);

  const { knockers, closers, totals } = useMemo(() => {
    const inRange = entries.filter(
      (e) => e.entry_date >= start && e.entry_date <= end && (!marketId || e.market_id === marketId)
    );
    const byRep = {};
    for (const e of inRange) (byRep[e.rep_id] ??= []).push(e);
    const rows = reps
      .filter((r) => r.active && !r.terminated && (!marketId || r.market_id === marketId))
      .map((rep) => ({ rep, stats: repStats(rep, byRep[rep.id] || []) }));
    const sum = (f) => inRange.reduce((s, e) => s + (Number(e[f]) || 0), 0);
    return {
      knockers: rows.filter((r) => r.rep.role === "knocker").sort((a, b) => b.stats.sets_set - a.stats.sets_set).slice(0, 15),
      closers: rows.filter((r) => r.rep.role === "closer").sort((a, b) => b.stats.closes - a.stats.closes).slice(0, 15),
      totals: { doors: sum("doors_knocked"), sets: sum("sets_set"), closes: sum("closes"), revenue: sum("revenue") },
    };
  }, [reps, entries, start, end, marketId]);

  const title = marketId ? markets.find((m) => m.id === marketId)?.name : "ALL MARKETS";

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 font-tv">
      <header className="flex items-center gap-3 mb-6">
        <h1 className="font-display text-5xl tracking-wider mr-auto">
          {title} <span className="text-gray-500 text-3xl">{mode === "week" ? "THIS WEEK" : "THIS MONTH"}</span>
        </h1>
        {isRegional && (
          <select
            value={marketId}
            onChange={(e) => setMarketId(e.target.value)}
            className="bg-gray-800 rounded-xl px-3 py-1.5 text-sm"
          >
            <option value="">All Markets</option>
            {markets.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}
        <Btn kind="subtle" onClick={() => setMode(mode === "week" ? "month" : "week")}>
          {mode === "week" ? "Month" : "Week"}
        </Btn>
        <Btn kind="subtle" onClick={onExit}>Exit</Btn>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          ["DOORS", totals.doors],
          ["SETS", totals.sets],
          ["CLOSES", totals.closes],
          ["REVENUE", fmtMoney(totals.revenue)],
        ].map(([label, v]) => (
          <div key={label} className="bg-gray-900 rounded-2xl p-4 text-center animate-tv-float">
            <div className="font-display text-5xl">{v}</div>
            <div className="text-xs tracking-[0.2em] text-gray-400">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <LeaderList title="KNOCKERS" emoji="🚪" rows={knockers} value={(s) => s.sets_set} unit="sets" />
        <LeaderList title="CLOSERS" emoji="🤝" rows={closers} value={(s) => s.closes} unit="closes" />
      </div>
    </div>
  );
}

function LeaderList({ title, emoji, rows, value, unit }) {
  return (
    <div className="bg-gray-900 rounded-2xl p-5">
      <h2 className="font-display text-3xl tracking-wider mb-3">
        {emoji} {title}
        {rows[0] && value(rows[0].stats) > 0 && (
          <span className="ml-3 text-yellow-400 text-xl">MVP: {rows[0].rep.name}</span>
        )}
      </h2>
      <ol className="space-y-1.5">
        {rows.map(({ rep, stats }, i) => (
          <li key={rep.id} className="flex items-center gap-3 text-lg">
            <span className={`w-7 text-right font-display text-2xl ${i < 3 ? "text-yellow-400" : "text-gray-500"}`}>
              {i + 1}
            </span>
            <span className="grow truncate">{rep.name}</span>
            <span className="font-display text-3xl tabular-nums">{value(stats)}</span>
            <span className="text-xs text-gray-500 w-12">{unit}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-gray-500 py-6 text-center">No data yet</li>}
      </ol>
    </div>
  );
}
