import { useMemo, useState } from "react";
import { addDays, monthStart, today, weekStartMonday, tenureLabel } from "../lib/dates";
import {
  repStats, repHours, derivedRan, streak, badgesFor, qualityScore, qualityGrade,
  fmt1, fmtPct, fmtMoney, DAY_HOURS_STD,
} from "../lib/calc";
import { saveEntry, logEvent, addSale, setSaleCancelled, deleteSale } from "../lib/api";
import { Card, SectionTitle, Btn, Input, Select, Stepper, Badge, HoursChip, ErrorNote } from "./ui";

const RANGES = [
  ["today", "Today"], ["week", "This Week"], ["7d", "Last 7 Days"], ["month", "This Month"], ["30d", "Last 30 Days"],
];
export function rangeBounds(key) {
  const end = today();
  if (key === "today") return [end, end];
  if (key === "week") return [weekStartMonday(end), end];
  if (key === "7d") return [addDays(end, -6), end];
  if (key === "month") return [monthStart(end), end];
  return [addDays(end, -29), end];
}

// "Appts ran" is derived (No-gos + Closes + Credit fails); CADs and cancelled
// appts are NOT ran. Closes + revenue are logged per-sale in the Sales section
// (see SalesSection), not as daily counts.
const KNOCKER_FIELDS = [
  ["doors_knocked", "Doors", 10],
  ["convos_had", "Convos", 5],
  ["sets_set", "Sets", 1],
  ["no_gos", "No-gos", 1],
  ["credit_fails", "Credit fails", 1],
  ["cads", "CADs", 1],
  ["cancels", "Cancelled appt", 1],
];
const CLOSER_KNOCK_FIELDS = [
  ["doors_knocked", "Doors", 10],
  ["convos_had", "Convos", 5],
  ["self_gen_sets", "SG sets", 1],
];
const CLOSER_CLOSE_FIELDS = [
  ["no_gos", "No-gos", 1],
  ["credit_fails", "Credit fails", 1],
  ["cads", "CADs", 1],
  ["cancels", "Cancelled appt", 1],
];
const ALL_NUM_FIELDS = [
  "doors_knocked", "convos_had", "sets_set", "appts_ran", "appts_closed",
  "cads", "closes", "revenue", "self_gen_sets", "self_gen_closes", "credit_fails", "cancels", "no_gos",
];

function emptyEntry(rep, date) {
  const e = { rep_id: rep.id, market_id: rep.market_id, entry_date: date, notes: "" };
  for (const f of ALL_NUM_FIELDS) e[f] = 0;
  return e;
}

// Per-sale ledger entry for a closer on one day. Each sale credits the closer +
// knocker, counts as a ran appointment, and rolls revenue to closer + office.
// Cancel keeps the count (still a yes / still ran / still promotion credit) but
// drops the revenue. All done by the market owner.
function SalesSection({ rep, date, daySales, knockers, profileId, actorEmail, onChange }) {
  const [who, setWho] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const whoName = (s) =>
    s.attribution === "self_gen" ? "Self-gen" : s.attribution === "house" ? "House" : (knockers.find((k) => k.id === s.knocker_id)?.name || "Knocker");

  async function add() {
    if (!who) return setErr("Pick who set the appointment");
    setBusy(true); setErr("");
    try {
      const attribution = who === "self_gen" || who === "house" ? who : "knocker";
      const sale = {
        market_id: rep.market_id, closer_id: rep.id,
        knocker_id: attribution === "knocker" ? who : null,
        attribution, amount: Number(amount) || 0, sale_date: date, created_by: profileId,
      };
      await addSale(sale);
      logEvent(actorEmail, `Sale logged for ${rep.name} (${fmtMoney(sale.amount)})`, rep.market_id);
      setWho(""); setAmount("");
      onChange();
    } catch (e) { setErr(e.message || String(e)); }
    setBusy(false);
  }
  async function toggle(s) {
    try {
      await setSaleCancelled(s.id, !s.cancelled_at);
      logEvent(actorEmail, `Sale ${s.cancelled_at ? "reinstated" : "cancelled"} for ${rep.name}`, rep.market_id);
      onChange();
    } catch (e) { setErr(e.message || String(e)); }
  }
  async function remove(s) {
    try { await deleteSale(s.id); onChange(); } catch (e) { setErr(e.message || String(e)); }
  }

  return (
    <div className="mt-2.5 border-t border-pw-line/60 pt-2.5">
      <div className="text-[10px] uppercase tracking-widest text-pw-muted mb-1.5">Sales (closes)</div>
      {daySales.length > 0 && (
        <div className="space-y-1 mb-2">
          {daySales.map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-sm">
              <span className={`font-bold tabular-nums ${s.cancelled_at ? "line-through text-pw-muted" : "text-white"}`}>{fmtMoney(s.amount)}</span>
              <span className="text-pw-muted">← {whoName(s)}</span>
              {s.cancelled_at && <Badge color="#EA6E30" bg="rgba(234,110,48,0.14)">cancelled</Badge>}
              <div className="ml-auto flex gap-1.5">
                <Btn kind="subtle" onClick={() => toggle(s)}>{s.cancelled_at ? "Reinstate" : "Cancel sale"}</Btn>
                <Btn kind="ghost" onClick={() => remove(s)} className="px-2" title="Remove (entered by mistake)">✕</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Who set it?</option>
          {knockers.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          <option value="self_gen">Self-generated</option>
          <option value="house">House / unattributed</option>
        </Select>
        <Input type="number" min="0" step="500" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount $" className="w-32" />
        <Btn onClick={add} disabled={busy}>{busy ? "Adding…" : "Add sale"}</Btn>
      </div>
      <ErrorNote>{err}</ErrorNote>
    </div>
  );
}

function EntryRow({ rep, entry, daySales = [], knockers = [], profileId, onSaved, actorEmail }) {
  const [form, setForm] = useState(() => ({ ...emptyEntry(rep, entry.entry_date), ...entry }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const isKnocker = rep.role === "knocker";
  const ran = derivedRan(rep, form) + daySales.length;
  const hours = repHours(rep, { ...form, appts_ran: ran });

  function set(k, v) {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  }
  async function save() {
    setBusy(true);
    setErr("");
    try {
      const { id, created_by, updated_at, ...payload } = form;
      for (const f of ALL_NUM_FIELDS) payload[f] = Number(payload[f]) || 0;
      payload.appts_ran = derivedRan(rep, payload); // keep ran consistent with its parts
      await saveEntry(payload);
      logEvent(actorEmail, `KPIs saved for ${rep.name} (${form.entry_date})`, rep.market_id);
      setSaved(true);
      onSaved();
    } catch (e) {
      setErr(e.message || String(e));
    }
    setBusy(false);
  }

  const grid = "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2";
  return (
    <Card className="p-3 animate-pw-rise">
      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        <span className="font-bold text-white">{rep.name}</span>
        <span className="text-[10px] uppercase tracking-widest text-pw-muted">{tenureLabel(rep.start_date, today())}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Badge color="#9ecbff" bg="rgba(158,203,255,0.12)">Ran {ran}</Badge>
          <HoursChip hours={hours} standard={DAY_HOURS_STD} />
        </div>
      </div>
      {isKnocker ? (
        <div className={grid}>
          {KNOCKER_FIELDS.map(([k, label, step]) => (
            <Stepper key={k} label={label} value={form[k]} step={step} onChange={(v) => set(k, v)} />
          ))}
        </div>
      ) : (
        <>
          <div className="text-[10px] uppercase tracking-widest text-pw-muted mb-1.5">Knocking</div>
          <div className={grid + " mb-2.5"}>
            {CLOSER_KNOCK_FIELDS.map(([k, label, step]) => (
              <Stepper key={k} label={label} value={form[k]} step={step} onChange={(v) => set(k, v)} />
            ))}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-pw-muted mb-1.5">Ran outcomes (non-sale)</div>
          <div className={grid}>
            {CLOSER_CLOSE_FIELDS.map(([k, label, step]) => (
              <Stepper key={k} label={label} value={form[k]} step={step} onChange={(v) => set(k, v)} />
            ))}
          </div>
          <SalesSection rep={rep} date={form.entry_date} daySales={daySales} knockers={knockers}
            profileId={profileId} actorEmail={actorEmail} onChange={onSaved} />
        </>
      )}
      <div className="flex gap-2 mt-2.5 items-center">
        <Input value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="Notes" className="grow" />
        <Btn onClick={save} disabled={busy} className="min-w-[88px]">
          {busy ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </Btn>
      </div>
      <ErrorNote>{err}</ErrorNote>
    </Card>
  );
}

const KNOCKER_SORTS = [
  ["sets_set", "Sets"], ["doors_knocked", "Doors"], ["convos_had", "Convos"], ["quality", "Quality"], ["closes", "Closes"],
];
const CLOSER_SORTS = [
  ["totalCloses", "Closes"], ["revenue", "Revenue"], ["hours", "Hours"], ["closeRate", "Close%"], ["self_gen_closes", "Self-gens"],
];

function Board({ role, reps, entries, sales = [], markets, range }) {
  const sorts = role === "knocker" ? KNOCKER_SORTS : CLOSER_SORTS;
  const [sortKey, setSortKey] = useState(sorts[0][0]);
  const [open, setOpen] = useState(null);

  const rows = useMemo(() => {
    const [start, end] = rangeBounds(range);
    const inRange = entries.filter((e) => e.entry_date >= start && e.entry_date <= end);
    const inRangeSales = sales.filter((s) => s.sale_date >= start && s.sale_date <= end);
    const byRepRange = {}, byRepAll = {};
    for (const e of inRange) (byRepRange[e.rep_id] ??= []).push(e);
    for (const e of entries) (byRepAll[e.rep_id] ??= {})[e.entry_date] = e;
    return reps.map((rep) => {
      const stats = repStats(rep, byRepRange[rep.id] || [], inRangeSales);
      const strk = streak(rep, byRepAll[rep.id] || {}, today());
      const q = role === "knocker" ? qualityScore(stats) : null;
      return {
        rep,
        market: markets.find((m) => m.id === rep.market_id)?.name || "—",
        stats: { ...stats, quality: q ?? -1 },
        strk,
        badges: badgesFor(rep, stats, strk),
        grade: qualityGrade(q),
      };
    });
  }, [reps, entries, sales, markets, range, role]);

  const sorted = [...rows].sort((a, b) => (b.stats[sortKey] || 0) - (a.stats[sortKey] || 0));
  const headers =
    role === "knocker"
      ? ["Doors", "Convos", "Hrs", "Sets", "Quality", "C2S%", "Closes"]
      : ["Hrs", "Appts", "Closes", "Close%", "SG", "Revenue", "Knock hrs"];
  const cols =
    role === "knocker"
      ? (r) => [r.stats.doors_knocked, r.stats.convos_had, fmt1(r.stats.hours),
          <span className="text-pw-red font-extrabold">{r.stats.sets_set}</span>,
          r.grade ? <span style={{ color: r.grade.color }} className="font-extrabold">{r.stats.quality} {r.grade.letter}</span> : "—",
          fmtPct(r.stats.c2s), r.stats.closes]
      : (r) => [fmt1(r.stats.hours), r.stats.appts_ran,
          <span className="text-pw-red font-extrabold">{r.stats.totalCloses}</span>,
          fmtPct(r.stats.closeRate), r.stats.self_gen_closes, fmtMoney(r.stats.revenue),
          `${fmt1(r.stats.knockHours)}h → ${r.stats.self_gen_sets}`];

  return (
    <Card className="p-3 overflow-x-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-extrabold text-lg uppercase tracking-tight text-white">Leaderboard</h3>
        <Select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
          {sorts.map(([k, label]) => (
            <option key={k} value={k}>Sort: {label}</option>
          ))}
        </Select>
      </div>
      <table className="w-full text-sm min-w-[680px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-pw-muted">
            <th className="py-1.5 pr-2">#</th>
            <th className="py-1.5 pr-2">Rep</th>
            <th className="py-1.5 pr-2">Market</th>
            {headers.map((h) => <th key={h} className="py-1.5 pr-2 text-right">{h}</th>)}
            <th className="py-1.5 text-right">Streak</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <BoardRow key={row.rep.id} i={i} row={row} cols={cols}
              open={open === row.rep.id} onToggle={() => setOpen(open === row.rep.id ? null : row.rep.id)} />
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={12} className="py-6 text-center text-pw-muted">No reps yet — add them on the Roster tab.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function BoardRow({ i, row, cols, open, onToggle }) {
  return (
    <>
      <tr className="border-t border-pw-line/60 hover:bg-pw-surface2/50 cursor-pointer" onClick={onToggle}>
        <td className={`py-2 pr-2 font-extrabold ${i < 3 ? "text-pw-yellow" : "text-pw-muted"}`}>{i + 1}</td>
        <td className="py-2 pr-2 font-bold text-white">
          {row.rep.name}
          {row.badges.length > 0 && <span className="ml-1.5 text-xs">{row.badges[0].label.split(" ")[0]}</span>}
        </td>
        <td className="py-2 pr-2 text-pw-muted">{row.market}</td>
        {cols(row).map((v, j) => <td key={j} className="py-2 pr-2 text-right tabular-nums text-gray-200">{v}</td>)}
        <td className="py-2 text-right">{row.strk > 0 ? <span className="text-pw-orange font-bold">🔥{row.strk}</span> : <span className="text-pw-muted">—</span>}</td>
      </tr>
      {open && (
        <tr className="bg-pw-black/40">
          <td colSpan={12} className="px-4 py-2">
            <div className="flex flex-wrap gap-1.5 items-center text-xs text-pw-muted">
              <span className="mr-1">Window bests: {row.stats.bestDoors} doors · {row.stats.bestSets} sets · {row.stats.bestCloses} closes · {row.stats.fullDays} full days</span>
              {row.badges.map((b) => <Badge key={b.key}>{b.label}</Badge>)}
              {row.stats.cads > 0 && <Badge color="#EB2229" bg="rgba(235,34,41,0.12)">{row.stats.cads} CADs</Badge>}
              {row.stats.cancels > 0 && <Badge color="#EA6E30" bg="rgba(234,110,48,0.12)">{row.stats.cancels} cancels</Badge>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function RoleTab({ ctx, role }) {
  const { markets, reps, entries, sales = [], profile, isRegional, refresh } = ctx;
  const [date, setDate] = useState(today());
  const [marketId, setMarketId] = useState(profile.market_id || markets[0]?.id || "");
  const [range, setRange] = useState("week");

  const activeReps = useMemo(
    () => reps.filter((r) => r.role === role && r.active && !r.terminated),
    [reps, role]
  );
  const marketReps = activeReps.filter((r) => r.market_id === marketId);
  const boardReps = isRegional ? activeReps : marketReps;
  const byRep = useMemo(() => {
    const m = {};
    for (const e of entries) if (e.entry_date === date) m[e.rep_id] = e;
    return m;
  }, [entries, date]);

  // knockers available for the sale's "who set it?" picker (same market)
  const marketKnockers = useMemo(
    () => reps.filter((r) => r.role === "knocker" && r.active && !r.terminated && r.market_id === marketId),
    [reps, marketId]
  );
  // sales on the selected day, indexed by both the closer and the credited knocker
  const daySalesByRep = useMemo(() => {
    const m = {};
    for (const s of sales) {
      if (s.sale_date !== date) continue;
      (m[s.closer_id] ??= []).push(s);
      if (s.knocker_id) (m[s.knocker_id] ??= []).push(s);
    }
    return m;
  }, [sales, date]);

  return (
    <div className="space-y-3">
      <SectionTitle
        right={
          <div className="flex flex-wrap gap-2">
            {isRegional && (
              <Select value={marketId} onChange={(e) => setMarketId(e.target.value)}>
                {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            )}
            <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </div>
        }
      >
        {role === "knocker" ? "Knockers" : "Closers"}
      </SectionTitle>

      {marketReps.length === 0 && (
        <Card className="p-6 text-center text-sm text-pw-muted">
          No active {role}s in this market. Add them on the Roster tab.
        </Card>
      )}
      {marketReps.map((rep) => (
        <EntryRow key={rep.id + date} rep={rep} entry={byRep[rep.id] || emptyEntry(rep, date)}
          daySales={daySalesByRep[rep.id] || []} knockers={marketKnockers} profileId={profile.id}
          actorEmail={profile.email} onSaved={refresh} />
      ))}

      <div className="flex items-center justify-between pt-2">
        <h3 className="font-extrabold text-lg uppercase tracking-tight text-pw-muted">
          {isRegional ? "All markets" : markets.find((m) => m.id === marketId)?.name}
        </h3>
        <Select value={range} onChange={(e) => setRange(e.target.value)}>
          {RANGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </Select>
      </div>
      <Board role={role} reps={boardReps} entries={entries} sales={sales} markets={markets} range={range} />
    </div>
  );
}
