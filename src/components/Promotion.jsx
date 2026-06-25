import { useMemo, useState } from "react";
import { today } from "../lib/dates";
import { promotionTrack } from "../lib/calc";
import { Card, SectionTitle, Select } from "./ui";

// Knocker promotion track (v1 rules): 8 sales credits this month +
// 8 prior month + 2 recruits, weighted 40/40/20.
export default function Promotion({ ctx }) {
  const { markets, reps, entries, sales = [], profile, isRegional } = ctx;
  const [marketId, setMarketId] = useState(isRegional ? "" : profile.market_id);

  const rows = useMemo(() => {
    const byRep = {};
    for (const e of entries) (byRep[e.rep_id] ??= []).push(e);
    return reps
      .filter((r) => r.role === "knocker" && r.active && !r.terminated)
      .filter((r) => !marketId || r.market_id === marketId)
      .map((rep) => ({ rep, ...promotionTrack(rep, byRep[rep.id] || [], today(), sales) }))
      .sort((a, b) => b.track - a.track);
  }, [reps, entries, sales, marketId]);

  return (
    <div className="space-y-3">
      <SectionTitle
        right={
          isRegional && (
            <Select value={marketId} onChange={(e) => setMarketId(e.target.value)}>
              <option value="">All Markets</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          )
        }
      >
        Promotion Track
      </SectionTitle>
      <Card className="p-3 overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-pw-muted">
              <th className="py-1 pr-2">Knocker</th>
              <th className="py-1 pr-2">Market</th>
              <th className="py-1 pr-2 text-right">Credits (mo)</th>
              <th className="py-1 pr-2 text-right">Credits (prev)</th>
              <th className="py-1 pr-2 text-right">Recruits</th>
              <th className="py-1 w-1/3">Progress</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ rep, cur, prev, recruits, track }) => (
              <tr key={rep.id} className="border-t border-pw-line/60">
                <td className="py-1.5 pr-2 font-semibold text-white">{rep.name}</td>
                <td className="py-1.5 pr-2 text-pw-muted">{markets.find((m) => m.id === rep.market_id)?.name}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{cur.toFixed(1)} / 8</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{prev.toFixed(1)} / 8</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{recruits} / 2</td>
                <td className="py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="grow h-2 bg-pw-black/60 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${track >= 100 ? "bg-pw-green" : "bg-pw-red"}`}
                        style={{ width: `${Math.min(track, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs tabular-nums w-10 text-right">{track.toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-pw-muted">No active knockers</td></tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-pw-muted">
        Credits = closes (incl. cancelled sales) + 0.5 × credit fails. Promotion-ready at 100%: 8 credits this month, 8 last month, 2 recruits.
      </p>
    </div>
  );
}
