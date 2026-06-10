import { useEffect, useState } from "react";
import { addDays, today, weekStartMonday } from "../lib/dates";
import { challengeMatchups } from "../lib/calc";
import { marketRangeTotals } from "../lib/api";
import { Card, SectionTitle, Spinner, ErrorNote } from "./ui";

// Weekly office-vs-office matchup decided by total closes Mon-Sun.
// Totals come from a security-definer RPC so MOs see other offices'
// aggregate score without seeing their rep-level data.
export default function Challenge() {
  const [totals, setTotals] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const start = weekStartMonday(today());
    marketRangeTotals(start, addDays(start, 6))
      .then(setTotals)
      .catch((e) => setErr(e.message || String(e)));
  }, []);

  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!totals) return <Spinner label="Loading scoreboard…" />;

  const allMarkets = totals.map((t) => ({ id: t.market_id, name: t.market_name }));
  const pairing = challengeMatchups(allMarkets, today());
  const closesBy = Object.fromEntries(totals.map((t) => [t.market_id, Number(t.closes)]));

  return (
    <div className="space-y-3">
      <SectionTitle right={<span className="text-xs text-gray-400">Week of {pairing.weekStart}</span>}>
        Weekly Challenge
      </SectionTitle>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {pairing.matchups.map(([a, b], i) => {
          const ca = closesBy[a.id] || 0;
          const cb = closesBy[b.id] || 0;
          return (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between">
                <TeamScore name={a.name} closes={ca} winning={ca > cb} />
                <span className="font-display text-2xl text-gray-300 px-2">VS</span>
                <TeamScore name={b.name} closes={cb} winning={cb > ca} right />
              </div>
              {ca === cb && <p className="text-center text-xs text-gray-400 mt-2">Tied</p>}
            </Card>
          );
        })}
        {pairing.bye && (
          <Card className="p-4 flex items-center justify-center text-sm text-gray-400">
            {pairing.bye.name} — bye week
          </Card>
        )}
      </div>
      <p className="text-xs text-gray-400">
        Matchups rotate round-robin each week. Score = total closes Mon–Sun.
      </p>
    </div>
  );
}

function TeamScore({ name, closes, winning, right }) {
  return (
    <div className={`${right ? "text-right" : ""}`}>
      <div className={`font-semibold ${winning ? "text-green-600" : "text-gray-700"}`}>
        {name} {winning ? "👑" : ""}
      </div>
      <div className="font-display text-4xl">{closes}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">closes</div>
    </div>
  );
}
