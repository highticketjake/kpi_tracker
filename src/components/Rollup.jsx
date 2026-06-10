import { useMemo, useState } from "react";
import { listDates } from "../lib/dates";
import { pct, fmtPct, fmtMoney } from "../lib/calc";
import { rangeBounds } from "./Boards";
import { Card, SectionTitle, Select } from "./ui";

const RANGES = [
  ["today", "Today"], ["week", "This Week"], ["7d", "Last 7 Days"], ["month", "This Month"], ["30d", "Last 30 Days"],
];

// Regional-only: aggregate every market side by side (v1 All-Markets rollup),
// plus the data-entry consistency score.
export default function Rollup({ ctx }) {
  const { markets, reps, entries } = ctx;
  const [range, setRange] = useState("week");

  const rows = useMemo(() => {
    const [start, end] = rangeBounds(range);
    const inRange = entries.filter((e) => e.entry_date >= start && e.entry_date <= end);
    return markets
      .map((m) => {
        const mReps = reps.filter((r) => r.market_id === m.id && r.active && !r.terminated);
        const mEntries = inRange.filter((e) => e.market_id === m.id);
        const sum = (f) => mEntries.reduce((s, e) => s + (Number(e[f]) || 0), 0);
        const repsWithData = new Set(mEntries.map((e) => e.rep_id)).size;
        // consistency: share of rep-days in range with an entry logged
        const days = listDates(start, end).length;
        const expected = mReps.length * days;
        return {
          id: m.id,
          name: m.name,
          reps: mReps.length,
          knockers: mReps.filter((r) => r.role === "knocker").length,
          closers: mReps.filter((r) => r.role === "closer").length,
          doors: sum("doors_knocked"),
          convos: sum("convos_had"),
          sets: sum("sets_set"),
          closes: sum("closes"),
          revenue: sum("revenue"),
          repsWithData,
          d2c: pct(sum("convos_had"), sum("doors_knocked")),
          c2s: pct(sum("sets_set"), sum("convos_had")),
          consistency: expected > 0 ? (mEntries.length / expected) * 100 : 0,
        };
      })
      .sort((a, b) => b.closes - a.closes);
  }, [markets, reps, entries, range]);

  const totals = rows.reduce(
    (t, r) => ({
      doors: t.doors + r.doors, convos: t.convos + r.convos, sets: t.sets + r.sets,
      closes: t.closes + r.closes, revenue: t.revenue + r.revenue,
    }),
    { doors: 0, convos: 0, sets: 0, closes: 0, revenue: 0 }
  );

  return (
    <div className="space-y-3">
      <SectionTitle
        right={
          <Select value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGES.map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </Select>
        }
      >
        All Markets
      </SectionTitle>
      <Card className="p-3 overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-1 pr-2">Market</th>
              <th className="py-1 pr-2 text-right">Reps</th>
              <th className="py-1 pr-2 text-right">Doors</th>
              <th className="py-1 pr-2 text-right">Convos</th>
              <th className="py-1 pr-2 text-right">Sets</th>
              <th className="py-1 pr-2 text-right">Closes</th>
              <th className="py-1 pr-2 text-right">Revenue</th>
              <th className="py-1 pr-2 text-right">D2C%</th>
              <th className="py-1 pr-2 text-right">C2S%</th>
              <th className="py-1 text-right">Entry Consistency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-50">
                <td className="py-1.5 pr-2 font-semibold text-gray-800">
                  {r.name}
                  <span className="ml-1.5 text-[10px] text-gray-400">{r.knockers}K / {r.closers}C</span>
                </td>
                <td className="py-1.5 pr-2 text-right">{r.reps}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.doors}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.convos}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.sets}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">{r.closes}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmtMoney(r.revenue)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmtPct(r.d2c)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmtPct(r.c2s)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmtPct(r.consistency)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="py-1.5 pr-2">Region</td>
              <td />
              <td className="py-1.5 pr-2 text-right tabular-nums">{totals.doors}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{totals.convos}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{totals.sets}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{totals.closes}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{fmtMoney(totals.revenue)}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
