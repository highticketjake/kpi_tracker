import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { addDays, listDates, today } from "../lib/dates";
import { Card, SectionTitle, Select } from "./ui";

const COLORS = { doors: "#8E8E93", convos: "#007AFF", sets: "#FF9500", closes: "#34C759" };

export default function Trends({ ctx }) {
  const { markets, entries, profile, isRegional } = ctx;
  const [days, setDays] = useState(14);
  const [marketId, setMarketId] = useState(isRegional ? "" : profile.market_id);

  const data = useMemo(() => {
    const start = addDays(today(), -(days - 1));
    const byDate = Object.fromEntries(
      listDates(start, today()).map((d) => [d, { date: d.slice(5), doors: 0, convos: 0, sets: 0, closes: 0 }])
    );
    for (const e of entries) {
      if (e.entry_date < start) continue;
      if (marketId && e.market_id !== marketId) continue;
      const row = byDate[e.entry_date];
      if (!row) continue;
      row.doors += e.doors_knocked || 0;
      row.convos += e.convos_had || 0;
      row.sets += e.sets_set || 0;
      row.closes += e.closes || 0;
    }
    return Object.values(byDate);
  }, [entries, days, marketId]);

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
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </Select>
          </div>
        }
      >
        Trends
      </SectionTitle>
      <Card className="p-3">
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip />
            <Legend />
            {Object.entries(COLORS).map(([k, c]) => (
              <Line key={k} type="monotone" dataKey={k} stroke={c} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
