import { useEffect, useMemo, useState } from "react";
import { addDays, monthStart, today, weekStartMonday } from "../lib/dates";
import {
  repStats, marketTotals, paceProjection, badgesFor, streak, challengeMatchups, fmtMoney,
} from "../lib/calc";
import { regionBoardData } from "../lib/api";
import { Spinner } from "./ui";
import logoNeg from "../assets/pw-logo-negative.png";

// Cast-friendly TV dashboard: everything visible at once, no clicking.
// Left: revenue goal thermometer. Center: overall leaderboard.
// Sides: knockers / sets / ran. Bottom: rotating hype ticker.
export default function TVView({ ctx, onExit }) {
  const [region, setRegion] = useState(null);
  const [mode, setMode] = useState("week");
  // Default everyone to the region-wide view; any viewer can drill into a market.
  const [marketId, setMarketId] = useState("");
  const [tick, setTick] = useState(0);

  // Region-wide snapshot drives every board so all markets show for any viewer.
  // Wide window so the monthly view and streaks have history; refresh on a timer
  // since this is an unattended cast screen.
  useEffect(() => {
    let alive = true;
    const load = () =>
      regionBoardData(addDays(today(), -70)).then((d) => alive && setRegion(d)).catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const markets = region?.markets || [];
  const reps = region?.reps || [];
  const entries = region?.entries || [];

  const [start, end] = useMemo(() => {
    const t = today();
    return mode === "week" ? [weekStartMonday(t), t] : [monthStart(t), t];
  }, [mode]);

  const challenge = useMemo(() => {
    if (!region) return null;
    const ws = weekStartMonday(today());
    const we = addDays(ws, 6);
    const inWeek = entries.filter((e) => e.entry_date >= ws && e.entry_date <= we);
    return markets.map((m) => {
      const t = marketTotals(reps.filter((r) => r.market_id === m.id), inWeek.filter((e) => e.market_id === m.id));
      return { market_id: m.id, market_name: m.name, closes: t.closes };
    });
  }, [region, entries, markets, reps]);

  const data = useMemo(() => {
    const inRange = entries.filter(
      (e) => e.entry_date >= start && e.entry_date <= end && (!marketId || e.market_id === marketId)
    );
    const byRep = {}, allByRep = {};
    for (const e of inRange) (byRep[e.rep_id] ??= []).push(e);
    for (const e of entries) (allByRep[e.rep_id] ??= {})[e.entry_date] = e;
    const scope = reps.filter((r) => r.active && !r.terminated && (!marketId || r.market_id === marketId));
    const rows = scope.map((rep) => {
      const stats = repStats(rep, byRep[rep.id] || []);
      const strk = streak(rep, allByRep[rep.id] || {}, today());
      return {
        rep, stats, strk,
        badges: badgesFor(rep, stats, strk),
        sets: stats.sets_set + (rep.role === "closer" ? stats.self_gen_sets : 0),
        ran: stats.appts_ran,
        closes: stats.totalCloses,
      };
    });
    const totals = marketTotals(scope, inRange);
    const mtdEntries = entries.filter((e) => e.entry_date >= monthStart(today()) && (!marketId || e.market_id === marketId));
    const thermo = (marketId ? markets.filter((m) => m.id === marketId) : markets).map((m) => {
      const mReps = reps.filter((r) => r.market_id === m.id);
      const t = marketTotals(mReps, mtdEntries.filter((e) => e.market_id === m.id));
      const goal = Number(m.monthly_goal) || 0;
      return {
        market: m, revenue: t.revenue, goal,
        pace: paceProjection(t.revenue, today()),
        p: goal > 0 ? Math.min((t.revenue / goal) * 100, 100) : 0,
      };
    });
    return { rows, totals, thermo };
  }, [reps, entries, markets, start, end, marketId]);

  // Rotating ticker: streaks, badges, challenge scores, pace lines.
  const tickerItems = useMemo(() => {
    const items = [];
    for (const r of data.rows) {
      if (r.strk >= 3) items.push(`🔥 ${r.rep.name} is on a ${r.strk}-day standard streak`);
      for (const b of r.badges) if (b.key !== "fire") items.push(`${b.label} — ${r.rep.name}`);
    }
    for (const t of data.thermo) {
      if (t.goal > 0)
        items.push(
          `📈 ${t.market.name.split(",")[0]}: ${Math.round(t.p)}% of goal · on pace for ${fmtMoney(t.pace)}`
        );
    }
    if (challenge && challenge.length > 1) {
      const pairing = challengeMatchups(challenge.map((c) => ({ id: c.market_id, name: c.market_name })), today());
      const closesBy = Object.fromEntries(challenge.map((c) => [c.market_id, Number(c.closes)]));
      for (const [a, b] of pairing.matchups)
        items.push(`⚔️ ${a.name.split(",")[0]} ${closesBy[a.id] || 0} — ${closesBy[b.id] || 0} ${b.name.split(",")[0]}`);
    }
    if (items.length === 0) items.push("Performance Windows — go set some records today");
    return items;
  }, [data, challenge]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 6000);
    return () => clearInterval(t);
  }, []);

  const knockers = data.rows.filter((r) => r.rep.role === "knocker").sort((a, b) => b.sets - a.sets || b.closes - a.closes);
  const overall = [...data.rows].sort((a, b) => b.closes - a.closes || b.sets - a.sets || b.stats.revenue - a.stats.revenue);
  const bySets = [...data.rows].sort((a, b) => b.sets - a.sets).filter((r) => r.sets > 0 || true).slice(0, 6);
  const byRan = [...data.rows].sort((a, b) => b.ran - a.ran).slice(0, 6);
  const mvp = overall[0] && overall[0].closes > 0 ? overall[0] : null;
  const title = marketId ? markets.find((m) => m.id === marketId)?.name : "All Markets";

  if (!region)
    return (
      <div className="h-screen bg-pw-black text-white flex items-center justify-center">
        <Spinner label="Loading region scoreboard…" />
      </div>
    );

  return (
    <div className="h-screen bg-pw-black text-white flex flex-col p-5 overflow-hidden">
      <header className="flex items-center gap-4 mb-4 shrink-0">
        <img src={logoNeg} alt="Performance Windows" className="h-11 w-auto" />
        <h1 className="font-extrabold text-3xl uppercase tracking-tight whitespace-nowrap">
          {title} <span className="text-pw-muted text-xl">· {mode === "week" ? "this week" : "this month"}</span>
        </h1>
        <div className="flex gap-3 ml-6 grow justify-center">
          {[["Doors", data.totals.doors], ["Convos", data.totals.convos], ["Sets", data.totals.sets], ["Closes", data.totals.closes], ["Revenue", fmtMoney(data.totals.revenue)]].map(([label, v]) => (
            <div key={label} className="bg-pw-surface rounded-xl border border-pw-line px-4 py-1.5 text-center min-w-[100px]">
              <div className="font-extrabold text-2xl tabular-nums leading-tight">{v}</div>
              <div className="text-[9px] tracking-[0.25em] uppercase text-pw-muted">{label}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select value={marketId} onChange={(e) => setMarketId(e.target.value)}
            className="bg-pw-surface border border-pw-line rounded-xl px-3 py-2 text-sm">
            <option value="">All Markets</option>
            {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button onClick={() => setMode(mode === "week" ? "month" : "week")}
            className="bg-pw-surface border border-pw-line rounded-xl px-3 py-2 text-sm font-bold">
            {mode === "week" ? "Month" : "Week"}
          </button>
          <button onClick={onExit} className="bg-pw-surface border border-pw-line rounded-xl px-3 py-2 text-sm font-bold">Exit</button>
        </div>
      </header>

      <div className="grow grid grid-cols-12 gap-4 min-h-0">
        <GoalColumn thermo={data.thermo} single={!!marketId} />

        <Panel className="col-span-3" title="Knockers" subtitle="by sets">
          <RowList rows={knockers.slice(0, 8)} value={(r) => r.sets} unit="sets" />
        </Panel>

        <Panel className="col-span-4" title="Overall" subtitle="by closes" big highlight>
          {mvp && (
            <div className="flex items-center gap-2 mb-2 animate-pw-pop">
              <span className="text-pw-yellow font-extrabold text-xl">★ MVP {mvp.rep.name}</span>
              {mvp.badges.slice(0, 2).map((b) => (
                <span key={b.key} className="text-xs font-bold bg-pw-black/60 rounded-full px-2.5 py-1">{b.label}</span>
              ))}
            </div>
          )}
          <RowList big rows={overall.slice(0, 8)} value={(r) => r.closes} unit="closes"
            sub={(r) => `${r.sets} sets · ${fmtMoney(r.stats.revenue)}`} />
        </Panel>

        <div className="col-span-3 flex flex-col gap-4 min-h-0">
          <Panel title="Total sets" subtitle="everyone" className="flex-1">
            <RowList compact rows={bySets} value={(r) => r.sets} unit="" />
          </Panel>
          <Panel title="Total ran" subtitle="appointments" className="flex-1">
            <RowList compact rows={byRan} value={(r) => r.ran} unit="" />
          </Panel>
        </div>
      </div>

      <footer className="shrink-0 mt-4 bg-pw-surface border border-pw-line rounded-2xl flex items-center overflow-hidden">
        <div className="bg-pw-red self-stretch flex items-center px-4 font-extrabold uppercase tracking-widest text-sm shrink-0">Live</div>
        <div key={tick} className="px-5 py-3 text-xl font-bold animate-pw-rise truncate">
          {tickerItems[tick % tickerItems.length]}
        </div>
        <div className="ml-auto pr-4 flex gap-1.5 shrink-0">
          {tickerItems.slice(0, 8).map((_, i) => (
            <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === tick % tickerItems.length ? "bg-pw-red" : "bg-pw-line"}`} />
          ))}
        </div>
      </footer>
    </div>
  );
}

function Panel({ title, subtitle, children, className = "", highlight = false }) {
  return (
    <div className={`bg-pw-surface rounded-2xl border ${highlight ? "border-pw-red/50" : "border-pw-line"} p-4 min-h-0 overflow-hidden flex flex-col ${className}`}>
      <h2 className="font-extrabold uppercase tracking-tight text-xl shrink-0">
        {title} <span className="text-pw-muted text-sm normal-case font-bold">{subtitle}</span>
      </h2>
      <div className="grow min-h-0 mt-2">{children}</div>
    </div>
  );
}

function RowList({ rows, value, unit, sub, big = false, compact = false }) {
  if (rows.length === 0) return <div className="text-pw-muted text-center py-8">No data yet</div>;
  return (
    <ol className={compact ? "space-y-1" : "space-y-1.5"}>
      {rows.map((r, i) => (
        <li key={r.rep.id}
          className={`flex items-center gap-2.5 animate-pw-rise ${big ? "text-lg" : compact ? "text-sm" : "text-base"} ${i === 0 ? "bg-pw-black/50 rounded-xl px-2 py-1 -mx-1" : ""}`}
          style={{ animationDelay: `${i * 60}ms` }}>
          <span className={`w-6 text-right font-extrabold ${i < 3 ? "text-pw-yellow" : "text-pw-muted"} ${big ? "text-xl" : ""}`}>{i + 1}</span>
          <span className="grow truncate font-bold">
            {r.rep.name}
            {r.strk >= 3 && <span className="text-pw-orange text-xs ml-1">🔥{r.strk}</span>}
          </span>
          {sub && <span className="text-pw-muted text-xs tabular-nums hidden xl:inline">{sub(r)}</span>}
          <span className={`font-extrabold tabular-nums text-pw-red ${big ? "text-3xl" : compact ? "text-lg" : "text-xl"}`}>{value(r)}</span>
          {unit && <span className="text-[10px] text-pw-muted w-9">{unit}</span>}
        </li>
      ))}
    </ol>
  );
}

// Always-visible left column: % of monthly revenue goal.
function GoalColumn({ thermo, single }) {
  return (
    <div className="col-span-2 bg-pw-surface rounded-2xl border border-pw-line p-4 flex flex-col min-h-0 overflow-hidden">
      <h2 className="font-extrabold uppercase tracking-tight text-xl shrink-0">
        Goal <span className="text-pw-muted text-sm normal-case font-bold">this month</span>
      </h2>
      {single ? (
        thermo.map((t) => <BigThermo key={t.market.id} t={t} />)
      ) : (
        <div className="grow flex flex-col justify-around mt-2 min-h-0">
          {thermo.map((t) => (
            <div key={t.market.id} className="flex items-center gap-2.5">
              <div className="grow">
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-bold truncate">{t.market.name.split(",")[0]}</span>
                  <span className="font-extrabold text-pw-yellow tabular-nums">{t.goal > 0 ? Math.round(t.p) + "%" : "—"}</span>
                </div>
                <div className="h-3 bg-pw-black/60 rounded-full overflow-hidden">
                  <div className="h-full bg-pw-red rounded-full transition-all duration-1000" style={{ width: t.p + "%" }} />
                </div>
                <div className="text-[10px] text-pw-muted mt-0.5 tabular-nums">{fmtMoney(t.revenue)}{t.goal > 0 ? ` / ${fmtMoney(t.goal)}` : " · no goal"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BigThermo({ t }) {
  return (
    <div className="grow flex flex-col items-center justify-center gap-3 min-h-0">
      <div className="font-extrabold text-5xl text-pw-yellow tabular-nums animate-pw-pop">
        {t.goal > 0 ? Math.round(t.p) + "%" : "—"}
      </div>
      <div className="relative w-14 grow max-h-[45vh] bg-pw-black/60 rounded-full overflow-hidden">
        <div className="absolute bottom-0 left-0 right-0 bg-pw-red rounded-full transition-all duration-1000" style={{ height: t.p + "%" }} />
        {t.goal > 0 && (
          <div className="absolute left-0 right-0 border-t-2 border-dashed border-pw-yellow"
            style={{ bottom: Math.min((t.pace / t.goal) * 100, 100) + "%" }} />
        )}
      </div>
      <div className="text-center shrink-0">
        <div className="font-extrabold text-2xl tabular-nums">{fmtMoney(t.revenue)}</div>
        <div className="text-sm text-pw-muted">{t.goal > 0 ? `of ${fmtMoney(t.goal)}` : "no goal set"}</div>
        {t.goal > 0 && <div className="text-sm font-bold" style={{ color: t.pace >= t.goal ? "#B8D576" : "#F6C444" }}>pace {fmtMoney(t.pace)}</div>}
      </div>
    </div>
  );
}
