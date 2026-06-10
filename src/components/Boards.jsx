import { useMemo, useState } from "react";
import { addDays, monthStart, today, weekStartMonday, tenureLabel } from "../lib/dates";
import { repStats, streak, personalBests, fmt1, fmtPct, fmtMoney } from "../lib/calc";
import { Card, SectionTitle, Select } from "./ui";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "7d", label: "Last 7 Days" },
  { key: "month", label: "This Month" },
  { key: "30d", label: "Last 30 Days" },
];

export function rangeBounds(key) {
  const end = today();
  if (key === "today") return [end, end];
  if (key === "week") return [weekStartMonday(end), end];
  if (key === "7d") return [addDays(end, -6), end];
  if (key === "month") return [monthStart(end), end];
  return [addDays(end, -29), end];
}

const KNOCKER_SORTS = [
  ["doors_knocked", "Doors"], ["convos_had", "Convos"], ["sets_set", "Sets"], ["d2c", "D2C%"], ["c2s", "C2S%"],
];
const CLOSER_SORTS = [
  ["closes", "Closes"], ["closeRate", "Close%"], ["self_gen_closes", "Self-Gens"], ["hours", "Hours"], ["revenue", "Revenue"],
];

function useBoardRows(ctx, role, range, marketId) {
  const { reps, entries, markets } = ctx;
  return useMemo(() => {
    const [start, end] = rangeBounds(range);
    const inRange = entries.filter((e) => e.entry_date >= start && e.entry_date <= end);
    const allByRep = {};
    for (const e of entries) (allByRep[e.rep_id] ??= []).push(e);
    const byRep = {};
    for (const e of inRange) (byRep[e.rep_id] ??= []).push(e);
    return reps
      .filter((r) => r.role === role && r.active && !r.terminated)
      .filter((r) => !marketId || r.market_id === marketId)
      .map((rep) => {
        const list = byRep[rep.id] || [];
        const all = allByRep[rep.id] || [];
        const entriesByDate = Object.fromEntries(all.map((e) => [e.entry_date, e]));
        return {
          rep,
          market: markets.find((m) => m.id === rep.market_id)?.name || "—",
          stats: repStats(rep, list),
          streak: streak(rep, entriesByDate, today()),
          bests: personalBests(all),
        };
      });
  }, [reps, entries, markets, role, range, marketId]);
}

function Board({ ctx, role, range, marketId }) {
  const sorts = role === "knocker" ? KNOCKER_SORTS : CLOSER_SORTS;
  const [sortKey, setSortKey] = useState(sorts[0][0]);
  const [open, setOpen] = useState(null);
  const rows = useBoardRows(ctx, role, range, marketId);
  const sorted = [...rows].sort((a, b) => (b.stats[sortKey] || 0) - (a.stats[sortKey] || 0));

  const cols =
    role === "knocker"
      ? (s) => [s.doors_knocked, s.convos_had, s.sets_set, fmtPct(s.d2c), fmtPct(s.c2s), fmt1(s.setsAvg)]
      : (s) => [s.closes, fmtMoney(s.revenue), s.appts_ran, fmt1(s.hours), fmtPct(s.closeRate), fmtPct(s.cadRate)];
  const headers =
    role === "knocker"
      ? ["Doors", "Convos", "Sets", "D2C%", "C2S%", "Sets/Day"]
      : ["Closes", "Revenue", "Appts", "Hours", "Close%", "CAD%"];

  return (
    <Card className="p-3 overflow-x-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display text-xl tracking-wide capitalize">{role} board</h3>
        <Select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
          {sorts.map(([k, label]) => (
            <option key={k} value={k}>Sort: {label}</option>
          ))}
        </Select>
      </div>
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
            <th className="py-1 pr-2">#</th>
            <th className="py-1 pr-2">Rep</th>
            <th className="py-1 pr-2">Market</th>
            {headers.map((h) => (
              <th key={h} className="py-1 pr-2 text-right">{h}</th>
            ))}
            <th className="py-1 pr-2 text-right">Days</th>
            <th className="py-1 text-right">Streak</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <FragmentRow
              key={row.rep.id}
              i={i}
              row={row}
              cols={cols}
              open={open === row.rep.id}
              onToggle={() => setOpen(open === row.rep.id ? null : row.rep.id)}
            />
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={12} className="py-6 text-center text-gray-400">No data in range</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function FragmentRow({ i, row, cols, open, onToggle }) {
  const { rep, market, stats, bests } = row;
  return (
    <>
      <tr className="border-t border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="py-1.5 pr-2 text-gray-400">{i + 1}</td>
        <td className="py-1.5 pr-2 font-semibold text-gray-800">
          {rep.name}
          <span className="ml-1.5 text-[10px] text-gray-400">{tenureLabel(rep.start_date, today())}</span>
        </td>
        <td className="py-1.5 pr-2 text-gray-500">{market}</td>
        {cols(stats).map((v, j) => (
          <td key={j} className="py-1.5 pr-2 text-right tabular-nums">{v}</td>
        ))}
        <td className="py-1.5 pr-2 text-right text-gray-500">{stats.days}</td>
        <td className="py-1.5 text-right">{row.streak > 0 ? `🔥${row.streak}` : "—"}</td>
      </tr>
      {open && (
        <tr className="bg-gray-50/60">
          <td colSpan={12} className="px-4 py-2 text-xs text-gray-500">
            Personal bests (last {""}window): doors {bests.doors_knocked} · convos {bests.convos_had} · sets{" "}
            {bests.sets_set} · closes {bests.closes} · appts closed {bests.appts_closed}
          </td>
        </tr>
      )}
    </>
  );
}

export default function Boards({ ctx }) {
  const { markets, profile, isRegional } = ctx;
  const [range, setRange] = useState("week");
  const [marketId, setMarketId] = useState(isRegional ? "" : profile.market_id);

  return (
    <div className="space-y-3">
      <SectionTitle
        right={
          <div className="flex gap-2">
            {isRegional && (
              <Select value={marketId} onChange={(e) => setMarketId(e.target.value)}>
                <option value="">All Markets</option>
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            )}
            <Select value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </Select>
          </div>
        }
      >
        Boards
      </SectionTitle>
      <Board ctx={ctx} role="knocker" range={range} marketId={marketId} />
      <Board ctx={ctx} role="closer" range={range} marketId={marketId} />
    </div>
  );
}
