import { useEffect, useState } from "react";
import { addDays, today, weekStartMonday } from "../lib/dates";
import { challengeMatchups, marketTotals } from "../lib/calc";
import { regionBoardData } from "../lib/api";
import { Card, SectionTitle, Spinner, ErrorNote } from "./ui";

// Weekly office-vs-office matchup decided by total closes Mon-Sun.
// Computed from a region-wide security-definer snapshot using the SAME
// marketTotals() math as Reports/TV, so the scoreboard always agrees with them.
export default function Challenge() {
  const [totals, setTotals] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const start = weekStartMonday(today());
    const end = addDays(start, 6);
    regionBoardData(start)
      .then((d) => {
        const inWeek = d.entries.filter((e) => e.entry_date >= start && e.entry_date <= end);
        setTotals(
          d.markets.map((m) => {
            const t = marketTotals(d.reps.filter((r) => r.market_id === m.id), inWeek.filter((e) => e.market_id === m.id));
            return { market_id: m.id, market_name: m.name, closes: t.closes };
          })
        );
      })
      .catch((e) => setErr(e.message || String(e)));
  }, []);

  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!totals) return <Spinner label="Loading scoreboard…" />;

  const allMarkets = totals.map((t) => ({ id: t.market_id, name: t.market_name }));
  const pairing = challengeMatchups(allMarkets, today());
  const closesBy = Object.fromEntries(totals.map((t) => [t.market_id, Number(t.closes)]));

  return (
    <div className="space-y-3">
      <SectionTitle right={<span className="text-xs text-pw-muted">Week of {pairing.weekStart}</span>}>
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
              {ca === cb && <p className="text-center text-xs text-pw-muted mt-2">Tied</p>}
            </Card>
          );
        })}
        {pairing.bye && (
          <Card className="p-4 flex items-center justify-center text-sm text-pw-muted">
            {pairing.bye.name} â€” bye week
          </Card>
        )}
      </div>
      <p className="text-xs text-pw-muted">
        Matchups rotate round-robin each week. Score = total closes Monâ€“Sun.
      </p>
    </div>
  );
}

function TeamScore({ name, closes, winning, right }) {
  return (
    <div className={`${right ? "text-right" : ""}`}>
      <div className={`font-semibold ${winning ? "text-pw-lightgreen" : "text-gray-200"}`}>
        {name} {winning ? "ðŸ‘‘" : ""}
      </div>
      <div className="font-display text-4xl">{closes}</div>
      <div className="text-[10px] uppercase tracking-wide text-pw-muted">closes</div>
    </div>
  );
}
