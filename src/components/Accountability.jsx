import { useMemo, useState } from "react";
import { today } from "../lib/dates";
import { accountabilityFlags, SEVERITIES } from "../lib/calc";
import { supabase } from "../lib/supabase";
import { logEvent } from "../lib/api";
import { Card, SectionTitle, Btn, Input, Select, Badge, ErrorNote } from "./ui";

function sevMeta(key) {
  return SEVERITIES.find((s) => s.key === key) || SEVERITIES[0];
}

// Suggested next severity: one step past the rep's worst existing escalation.
function nextSeverity(repEscalations) {
  const order = SEVERITIES.map((s) => s.key);
  const worst = Math.max(-1, ...repEscalations.map((e) => order.indexOf(e.severity)));
  return order[Math.min(worst + 1, order.length - 1)];
}

export default function Accountability({ ctx }) {
  const { markets, reps, entries, escalations, profile, isRegional, refresh } = ctx;
  const [marketId, setMarketId] = useState(isRegional ? "" : profile.market_id);
  const [form, setForm] = useState(null); // { repId, severity, note }
  const [err, setErr] = useState("");

  const activeReps = useMemo(
    () => reps.filter((r) => r.active && !r.terminated).filter((r) => !marketId || r.market_id === marketId),
    [reps, marketId]
  );

  const flagged = useMemo(() => {
    const byRep = {};
    for (const e of entries) (byRep[e.rep_id] ??= {})[e.entry_date] = e;
    return activeReps
      .map((rep) => ({ rep, flags: accountabilityFlags(rep, byRep[rep.id] || {}, today()) }))
      .filter((x) => x.flags.length > 0)
      .sort((a, b) => b.flags.filter((f) => f.level === "action").length - a.flags.filter((f) => f.level === "action").length);
  }, [activeReps, entries]);

  async function saveEscalation() {
    setErr("");
    const rep = reps.find((r) => r.id === form.repId);
    const { error } = await supabase.from("escalations").insert({
      rep_id: rep.id,
      market_id: rep.market_id,
      severity: form.severity,
      note: form.note || null,
      created_by: profile.id,
    });
    if (error) return setErr(error.message);
    logEvent(profile.email, `${sevMeta(form.severity).label} logged for ${rep.name}`, rep.market_id);
    setForm(null);
    refresh();
  }

  async function removeEscalation(esc) {
    const { error } = await supabase.from("escalations").delete().eq("id", esc.id);
    if (error) return setErr(error.message);
    logEvent(profile.email, `Escalation removed for ${reps.find((r) => r.id === esc.rep_id)?.name || "?"}`, esc.market_id);
    refresh();
  }

  const visibleEscalations = escalations.filter((e) => !marketId || e.market_id === marketId);

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
        Accountability
      </SectionTitle>
      <ErrorNote>{err}</ErrorNote>

      <Card className="p-3">
        <h3 className="font-display text-xl tracking-wide mb-2">Flags (trailing week)</h3>
        {flagged.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No flags. Standards met across the board.</p>}
        <div className="space-y-2">
          {flagged.map(({ rep, flags }) => (
            <div key={rep.id} className="flex flex-wrap items-center gap-2 border-t border-gray-50 pt-2 first:border-0 first:pt-0">
              <span className="font-semibold text-gray-800">{rep.name}</span>
              <span className="text-[10px] uppercase text-gray-400">{rep.role}</span>
              <span className="text-xs text-gray-400">{markets.find((m) => m.id === rep.market_id)?.name}</span>
              {flags.map((f, i) => (
                <Badge key={i} color={f.level === "action" ? "#FF3B30" : "#FF9500"} bg={f.level === "action" ? "#FFF0EF" : "#FFF8EE"}>
                  {f.text}
                </Badge>
              ))}
              <Btn
                kind="subtle"
                className="ml-auto"
                onClick={() =>
                  setForm({ repId: rep.id, severity: nextSeverity(escalations.filter((e) => e.rep_id === rep.id)), note: "" })
                }
              >
                Escalate
              </Btn>
            </div>
          ))}
        </div>
      </Card>

      {form && (
        <Card className="p-3 border-orange-200">
          <h3 className="font-semibold mb-2">
            Log escalation — {reps.find((r) => r.id === form.repId)?.name}
          </h3>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-[11px] text-gray-500">
              Severity
              <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="block mt-0.5">
                {SEVERITIES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </Select>
            </label>
            <label className="text-[11px] text-gray-500 grow">
              Note
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full mt-0.5" placeholder="What was discussed / agreed" />
            </label>
            <Btn onClick={saveEscalation}>Save</Btn>
            <Btn kind="subtle" onClick={() => setForm(null)}>Cancel</Btn>
          </div>
        </Card>
      )}

      <Card className="p-3">
        <h3 className="font-display text-xl tracking-wide mb-2">Escalation Log</h3>
        {visibleEscalations.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No escalations logged.</p>}
        <div className="space-y-1.5">
          {visibleEscalations.map((esc) => {
            const rep = reps.find((r) => r.id === esc.rep_id);
            const meta = sevMeta(esc.severity);
            return (
              <div key={esc.id} className="flex flex-wrap items-center gap-2 text-sm border-t border-gray-50 pt-1.5 first:border-0 first:pt-0">
                <Badge color={meta.color} bg={meta.bg}>{meta.label}</Badge>
                <span className="font-semibold">{rep?.name || "?"}</span>
                <span className="text-gray-500">{esc.note}</span>
                <span className="ml-auto text-xs text-gray-400">{esc.entry_date}</span>
                <Btn kind="danger" onClick={() => removeEscalation(esc)}>Remove</Btn>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
