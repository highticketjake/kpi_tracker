import { useMemo, useState } from "react";
import { today } from "../lib/dates";
import { closerHours, fmt1 } from "../lib/calc";
import { saveEntry, logEvent } from "../lib/api";
import { Card, SectionTitle, Btn, Input, Select, ErrorNote } from "./ui";

const KNOCKER_FIELDS = [
  ["doors_knocked", "Doors"],
  ["convos_had", "Convos"],
  ["sets_set", "Sets"],
  ["appts_ran", "Appts Ran"],
  ["cads", "CADs"],
  ["closes", "Closes"],
  ["revenue", "Revenue $"],
];
const CLOSER_FIELDS = [
  ["appts_ran", "Appts Ran"],
  ["appts_closed", "Appts Closed"],
  ["cads", "CADs"],
  ["convos_had", "Convos"],
  ["doors_knocked", "Doors"],
  ["self_gen_sets", "SG Sets"],
  ["self_gen_closes", "SG Closes"],
  ["revenue", "Revenue $"],
];

function emptyEntry(rep, date) {
  return {
    rep_id: rep.id,
    market_id: rep.market_id,
    entry_date: date,
    doors_knocked: 0, convos_had: 0, sets_set: 0, appts_ran: 0, appts_closed: 0,
    cads: 0, closes: 0, revenue: 0, self_gen_sets: 0, self_gen_closes: 0,
    appt_sources: "", credit_fails: [], notes: "",
  };
}

function RepEntryRow({ rep, entry, closers, onSaved, actorEmail }) {
  const [form, setForm] = useState(() => ({ ...emptyEntry(rep, entry.entry_date), ...entry }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const fields = rep.role === "knocker" ? KNOCKER_FIELDS : CLOSER_FIELDS;

  function set(k, v) {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const { id, created_by, updated_at, ...payload } = form;
      for (const [k] of [...KNOCKER_FIELDS, ...CLOSER_FIELDS]) payload[k] = Number(payload[k]) || 0;
      await saveEntry(payload);
      logEvent(actorEmail, `KPIs saved for ${rep.name} (${form.entry_date})`, rep.market_id);
      setSaved(true);
      onSaved();
    } catch (e) {
      setErr(e.message || String(e));
    }
    setBusy(false);
  }

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="font-semibold text-gray-800">{rep.name}</span>
        <span className="text-xs uppercase tracking-wide text-gray-400">{rep.role}</span>
        {rep.role === "closer" && (
          <span className="ml-auto text-xs text-gray-500">Hours: {fmt1(closerHours(form))}</span>
        )}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {fields.map(([k, label]) => (
          <label key={k} className="text-[11px] text-gray-500">
            {label}
            <Input
              type="number"
              min="0"
              value={form[k]}
              onChange={(e) => set(k, e.target.value)}
              className="w-full mt-0.5"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mt-2 items-end">
        {rep.role === "knocker" && (
          <label className="text-[11px] text-gray-500 grow max-w-xs">
            Credit fails → closer
            <Select
              value=""
              onChange={(e) => {
                if (e.target.value) set("credit_fails", [...(form.credit_fails || []), { closerId: e.target.value }]);
              }}
              className="w-full mt-0.5"
            >
              <option value="">Add credit fail…</option>
              {closers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            {(form.credit_fails || []).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {form.credit_fails.map((cf, i) => (
                  <button
                    key={i}
                    onClick={() => set("credit_fails", form.credit_fails.filter((_, j) => j !== i))}
                    className="text-xs bg-orange-50 text-orange-600 rounded-full px-2 py-0.5"
                    title="Remove"
                  >
                    {closers.find((c) => c.id === cf.closerId)?.name || "?"} ✕
                  </button>
                ))}
              </div>
            )}
          </label>
        )}
        {rep.role === "closer" && (
          <label className="text-[11px] text-gray-500 grow max-w-xs">
            Appt sources
            <Input value={form.appt_sources || ""} onChange={(e) => set("appt_sources", e.target.value)} className="w-full mt-0.5" placeholder="e.g. knock, referral" />
          </label>
        )}
        <label className="text-[11px] text-gray-500 grow">
          Notes
          <Input value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} className="w-full mt-0.5" />
        </label>
        <Btn onClick={save} disabled={busy}>{busy ? "Saving…" : saved ? "Saved ✓" : "Save"}</Btn>
      </div>
      <ErrorNote>{err}</ErrorNote>
    </Card>
  );
}

export default function DataEntry({ ctx }) {
  const { markets, reps, entries, profile, isRegional, refresh } = ctx;
  const [date, setDate] = useState(today());
  const [marketId, setMarketId] = useState(profile.market_id || markets[0]?.id || "");

  const activeReps = useMemo(
    () => reps.filter((r) => r.market_id === marketId && r.active && !r.terminated),
    [reps, marketId]
  );
  const closers = activeReps.filter((r) => r.role === "closer");
  const byRep = useMemo(() => {
    const m = {};
    for (const e of entries) if (e.entry_date === date) m[e.rep_id] = e;
    return m;
  }, [entries, date]);

  return (
    <div className="space-y-3">
      <SectionTitle
        right={
          <div className="flex gap-2">
            {isRegional && (
              <Select value={marketId} onChange={(e) => setMarketId(e.target.value)}>
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            )}
            <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </div>
        }
      >
        Daily Entry
      </SectionTitle>
      {activeReps.length === 0 && (
        <Card className="p-6 text-center text-sm text-gray-400">
          No active reps in this market yet. Add them on the Roster tab.
        </Card>
      )}
      {activeReps.map((rep) => (
        <RepEntryRow
          key={rep.id + date}
          rep={rep}
          entry={byRep[rep.id] || emptyEntry(rep, date)}
          closers={closers}
          actorEmail={profile.email}
          onSaved={refresh}
        />
      ))}
    </div>
  );
}
