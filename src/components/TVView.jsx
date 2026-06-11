import { useEffect, useMemo, useState } from "react";
import { addDays, monthStart, today, weekStartMonday } from "../lib/dates";
import { repStats, marketTotals, paceProjection, badgesFor, streak, challengeMatchups, fmtMoney } from "../lib/calc";
import { marketRangeTotals } from "../lib/api";
import { Funnel, Thermometer } from "./viz";
import logoNeg from "../assets/pw-logo-negative.png";

const SLIDE_SECONDS = 12;

// Office TV: auto-rotating, brand-dark, cast-friendly.
export default function TVView({ ctx, onExit }) {
  const { markets, reps, entries, isRegional, profile } = ctx;
  const [mode, setMode] = useState("week");
  const [marketId, setMarketId] = useState(isRegional ? "" : profile.market_id);
  const [slide, setSlide] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [challenge, setChallenge] = useState(null);

  const [start, end] = useMemo(() => {
    const t = today();
    return mode === "week" ? [weekStartMonday(t), t] : [monthStart(t), t];
  }, [mode]);

  useEffect(() => {
    const ws = weekStartMonday(today());
    marketRangeTotals(ws, addDays(ws, 6)).then(setChallenge).catch(() => setChallenge(null));
  }, []);

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
      return { rep, stats, strk, badges: badgesFor(rep, stats, strk) };
    });
    const knockers = rows.filter((r) => r.rep.role === "knocker").sort((a, b) => b.stats.sets_set - a.stats.sets_set);
    const closers = rows.filter((r) => r.rep.role === "closer").sort((a, b) => b.stats.totalCloses - a.stats.totalCloses);
    const totals = marketTotals(scope, inRange);
    const mtdEntries = entries.filter((e) => e.entry_date >= monthStart(today()) && (!marketId || e.market_id === marketId));
    const thermo = (marketId ? markets.filter((m) => m.id === marketId) : markets).map((m) => {
      const mReps = reps.filter((r) => r.market_id === m.id);
      const t = marketTotals(mReps, mtdEntries.filter((e) => e.market_id === m.id));
      return { market: m, revenue: t.revenue, pace: paceProjection(t.revenue, today()) };
    });
    return { knockers, closers, totals, thermo };
  }, [reps, entries, markets, start, end, marketId]);

  const slides = useMemo(() => {
    const s = ["knockers", "closers", "revenue", "funnel"];
    if (challenge && challenge.length > 1) s.push("challenge");
    return s;
  }, [challenge]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % slides.length), SLIDE_SECONDS * 1000);
    return () => clearInterval(t);
  }, [playing, slides.length]);

  const title = marketId ? markets.find((m) => m.id === marketId)?.name : "ALL MARKETS";
  const cur = slides[slide % slides.length];

  return (
    <div className="min-h-screen bg-pw-black text-white flex flex-col p-6">
      <header className="flex items-center gap-4 mb-5">
        <img src={logoNeg} alt="Performance Windows" className="h-12 w-auto" />
        <h1 className="font-extrabold text-4xl uppercase tracking-tight">
          {title} <span className="text-pw-muted text-2xl">{mode === "week" ? "this week" : "this month"}</span>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          {isRegional && (
            <select value={marketId} onChange={(e) => setMarketId(e.target.value)}
              className="bg-pw-surface border border-pw-line rounded-xl px-3 py-2 text-sm">
              <option value="">All Markets</option>
              {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          <button onClick={() => setMode(mode === "week" ? "month" : "week")}
            className="bg-pw-surface border border-pw-line rounded-xl px-3 py-2 text-sm font-bold">
            {mode === "week" ? "Month" : "Week"}
          </button>
          <button onClick={() => setPlaying(!playing)}
            className="bg-pw-surface border border-pw-line rounded-xl px-3 py-2 text-sm font-bold w-11">
            {playing ? "❚❚" : "▶"}
          </button>
          <button onClick={onExit} className="bg-pw-surface border border-pw-line rounded-xl px-3 py-2 text-sm font-bold">
            Exit
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[["Doors", data.totals.doors], ["Sets", data.totals.sets], ["Closes", data.totals.closes], ["Revenue", fmtMoney(data.totals.revenue)]].map(([label, v]) => (
          <div key={label} className="bg-pw-surface rounded-2xl border border-pw-line p-4 text-center">
            <div className="font-extrabold text-5xl tabular-nums">{v}</div>
            <div className="text-xs tracking-[0.25em] uppercase text-pw-muted mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="grow" key={cur + marketId + mode}>
        {cur === "knockers" && <LeaderSlide title="Knockers" accent="sets" rows={data.knockers} value={(s) => s.sets_set} unit="sets" />}
        {cur === "closers" && <LeaderSlide title="Closers" accent="closes" rows={data.closers} value={(s) => s.totalCloses} unit="closes" sub={(s) => fmtMoney(s.revenue)} />}
        {cur === "revenue" && (
          <div className="bg-pw-surface rounded-2xl border border-pw-line p-6 animate-pw-pop">
            <h2 className="font-extrabold text-3xl uppercase tracking-tight mb-4">Race to the goal <span className="text-pw-muted text-xl">— this month</span></h2>
            <div className="flex flex-wrap justify-around gap-6">
              {data.thermo.map((t) => (
                <Thermometer key={t.market.id} big name={t.market.name.split(",")[0]} current={t.revenue}
                  goal={Number(t.market.monthly_goal) || 0} pace={t.pace} />
              ))}
            </div>
          </div>
        )}
        {cur === "funnel" && (
          <div className="bg-pw-surface rounded-2xl border border-pw-line p-6 animate-pw-pop">
            <h2 className="font-extrabold text-3xl uppercase tracking-tight mb-5">The funnel</h2>
            <Funnel totals={data.totals} big />
          </div>
        )}
        {cur === "challenge" && challenge && <ChallengeSlide challenge={challenge} />}
      </div>

      <footer className="flex items-center justify-center gap-2 pt-4">
        {slides.map((s, i) => (
          <button key={s} onClick={() => setSlide(i)}
            className={`h-2 rounded-full transition-all ${i === slide % slides.length ? "w-8 bg-pw-red" : "w-2 bg-pw-line"}`} aria-label={s} />
        ))}
      </footer>
    </div>
  );
}

function LeaderSlide({ title, rows, value, unit, sub }) {
  const top = rows.slice(0, 10);
  const mvp = top[0] && value(top[0].stats) > 0 ? top[0] : null;
  return (
    <div className="bg-pw-surface rounded-2xl border border-pw-line p-6 animate-pw-pop">
      <h2 className="font-extrabold text-3xl uppercase tracking-tight mb-1">
        {title}
        {mvp && (
          <span className="ml-4 text-pw-yellow text-2xl">★ MVP: {mvp.rep.name}</span>
        )}
      </h2>
      {mvp && mvp.badges.length > 0 && (
        <div className="flex gap-2 mb-3">
          {mvp.badges.map((b) => (
            <span key={b.key} className="text-sm font-bold bg-pw-black/50 rounded-full px-3 py-1 animate-pw-pop">{b.label}</span>
          ))}
        </div>
      )}
      <ol className="mt-3 space-y-1.5">
        {top.map(({ rep, stats, strk }, i) => (
          <li key={rep.id} className="flex items-center gap-4 text-xl animate-pw-rise" style={{ animationDelay: `${i * 60}ms` }}>
            <span className={`w-8 text-right font-extrabold text-2xl ${i < 3 ? "text-pw-yellow" : "text-pw-muted"}`}>{i + 1}</span>
            <span className="grow truncate font-bold">{rep.name} {strk >= 3 ? <span className="text-pw-orange text-base">🔥{strk}</span> : null}</span>
            {sub && <span className="text-pw-muted text-lg tabular-nums">{sub(stats)}</span>}
            <span className="font-extrabold text-3xl tabular-nums text-pw-red">{value(stats)}</span>
            <span className="text-xs text-pw-muted w-12">{unit}</span>
          </li>
        ))}
        {top.length === 0 && <li className="text-pw-muted py-10 text-center">No data yet</li>}
      </ol>
    </div>
  );
}

function ChallengeSlide({ challenge }) {
  const allMarkets = challenge.map((t) => ({ id: t.market_id, name: t.market_name }));
  const pairing = challengeMatchups(allMarkets, today());
  const closesBy = Object.fromEntries(challenge.map((t) => [t.market_id, Number(t.closes)]));
  return (
    <div className="bg-pw-surface rounded-2xl border border-pw-line p-6 animate-pw-pop">
      <h2 className="font-extrabold text-3xl uppercase tracking-tight mb-4">
        Weekly challenge <span className="text-pw-muted text-xl">closes · Mon–Sun</span>
      </h2>
      <div className="grid sm:grid-cols-3 gap-4">
        {pairing.matchups.map(([a, b], i) => {
          const ca = closesBy[a.id] || 0, cb = closesBy[b.id] || 0;
          return (
            <div key={i} className="bg-pw-black/50 rounded-2xl p-5 flex items-center justify-between animate-pw-rise" style={{ animationDelay: `${i * 100}ms` }}>
              <Team name={a.name} closes={ca} winning={ca > cb} />
              <span className="font-extrabold text-2xl text-pw-line px-2">VS</span>
              <Team name={b.name} closes={cb} winning={cb > ca} right />
            </div>
          );
        })}
        {pairing.bye && (
          <div className="bg-pw-black/30 rounded-2xl p-5 flex items-center justify-center text-pw-muted">
            {pairing.bye.name} — bye week
          </div>
        )}
      </div>
    </div>
  );
}

function Team({ name, closes, winning, right }) {
  return (
    <div className={right ? "text-right" : ""}>
      <div className={`font-bold text-sm ${winning ? "text-pw-lightgreen" : "text-gray-300"}`}>{name.split(",")[0]} {winning ? "👑" : ""}</div>
      <div className="font-extrabold text-5xl tabular-nums">{closes}</div>
    </div>
  );
}
