import { fmtMoney, fmtPct, pct } from "../lib/calc";

// Doors → convos → sets → ran → closed funnel with stage conversion rates.
export function Funnel({ totals, big = false }) {
  const stages = [
    ["Doors", totals.doors, "#9B9495"],
    ["Convos", totals.convos, "#A9D9F4"],
    ["Sets", totals.sets, "#F6C444"],
    ["Ran", totals.ran, "#EA6E30"],
    ["Closed", totals.closes, "#EB2229"],
  ];
  const max = Math.max(1, totals.doors);
  return (
    <div className="space-y-1.5">
      {stages.map(([label, val, color], i) => {
        const prev = i > 0 ? stages[i - 1][1] : null;
        const w = Math.max(2, (val / max) * 100);
        return (
          <div key={label} className="flex items-center gap-2">
            <span className={`${big ? "w-20 text-sm" : "w-16 text-xs"} text-right text-pw-muted shrink-0`}>{label}</span>
            <div className="grow bg-pw-black/60 rounded-lg overflow-hidden" style={{ height: big ? 34 : 24 }}>
              <div
                className="h-full rounded-lg flex items-center px-2 transition-all duration-700"
                style={{ width: w + "%", background: color, minWidth: "fit-content" }}
              >
                <span className={`font-extrabold tabular-nums ${big ? "text-base" : "text-xs"}`} style={{ color: "#231F20" }}>
                  {Number(val).toLocaleString()}
                </span>
              </div>
            </div>
            <span className={`${big ? "w-16 text-sm" : "w-14 text-xs"} text-pw-muted tabular-nums shrink-0`}>
              {prev != null ? fmtPct(pct(val, prev)) : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Monthly revenue goal thermometer with pace marker.
export function Thermometer({ name, current, goal, pace, big = false }) {
  const p = goal > 0 ? Math.min((current / goal) * 100, 100) : 0;
  const pacePct = goal > 0 ? Math.min((pace / goal) * 100, 100) : 0;
  const onPace = goal > 0 && pace >= goal;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`relative bg-pw-black/60 rounded-full overflow-hidden ${big ? "w-12 h-56" : "w-9 h-40"}`}>
        <div
          className="absolute bottom-0 left-0 right-0 bg-pw-red rounded-full transition-all duration-1000"
          style={{ height: p + "%" }}
        />
        {goal > 0 && pacePct > 0 && (
          <div className="absolute left-0 right-0 border-t-2 border-dashed border-pw-yellow" style={{ bottom: pacePct + "%" }} />
        )}
      </div>
      <div className="text-center">
        <div className={`font-extrabold text-white ${big ? "text-xl" : "text-sm"}`}>{fmtMoney(current)}</div>
        <div className={`text-pw-muted ${big ? "text-sm" : "text-[11px]"}`}>
          {goal > 0 ? `of ${fmtMoney(goal)}` : "no goal set"}
        </div>
        {goal > 0 && (
          <div className={`font-bold ${big ? "text-sm" : "text-[11px]"}`} style={{ color: onPace ? "#B8D576" : "#F6C444" }}>
            pace {fmtMoney(pace)}
          </div>
        )}
        <div className={`text-pw-muted font-bold uppercase tracking-wide ${big ? "text-sm mt-1" : "text-[10px]"}`}>{name}</div>
      </div>
    </div>
  );
}
