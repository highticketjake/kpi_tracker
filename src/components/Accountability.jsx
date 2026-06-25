import { useMemo, useState } from "react";
import { today } from "../lib/dates";
import { coachAssessment, SEVERITIES } from "../lib/calc";
import { supabase } from "../lib/supabase";
import { logEvent } from "../lib/api";
import { Card, SectionTitle, Btn, Input, Select, Badge, ErrorNote } from "./ui";

function sevMeta(key) {
  return SEVERITIES.find((s) => s.key === key) || SEVERITIES[0];
}

const REC_META = {
  "1on1": { label: "1-ON-1 · effort", color: "#f09595", bg: "rgba(235,34,41,0.15)", border: "border-l-pw-red" },
  shadow: { label: "SHADOW · skill", color: "#F6C444", bg: "rgba(246,196,68,0.14)", border: "border-l-pw-yellow" },
  both: { label: "1-ON-1 + SHADOW", color: "#f09595", bg: "rgba(235,34,41,0.15)", border: "border-l-pw-red" },
};
const TREND = {
  up: { text: "better than last week", color: "#B8D576", arrow: "▲" },
  down: { text: "worse than last week", color: "#EB2229", arrow: "▼" },
  flat: { text: "about even with last week", color: "#9B9495", arrow: "■" },
};

export default function Accountability({ ctx }) {
  const { markets, reps, entries, sales = [], escalations, profile, isRegional, refresh } = ctx;
  const [marketId, setMarketId] = useState(isRegional ? "" : profile.market_id);
  const [form, setForm] = useState(null); // { repId, severity, note }
  const [err, setErr] = useState("");

  const cards = useMemo(() => {
    const byRep = {};
    for (const e of entries) (byRep[e.rep_id] ??= {})[e.entry_date] = e;
    const escByRep = {};
    for (const e of escalations) (escByRep[e.rep_id] ??= []).push(e);
    return reps
      .filter((r) => r.active && !r.terminated)
      .filter((r) => !marketId || r.market_id === marketId)
      .map((rep) => coachAssessment(rep, byRep[rep.id] || {}, today(), escByRep[rep.id], sales))
      .filter((c) => c.rec || c.wins.length > 0)
      .sort((a, b) => {
        const w = { both: 0, "1on1": 1, shadow: 2 };
        return (w[a.rec] ?? 3) - (w[b.rec] ?? 3);
      });
  }, [reps, entries, sales, escalations, marketId]);

  const needTalk = cards.filter((c) => c.rec);
  const allWins = cards.filter((c) => c.wins.length > 0);

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
        Coach's Card
      </SectionTitle>
      <p className="text-xs text-pw-muted -mt-2">
        Trailing week, built for Monday morning: who needs an accountability 1-on-1, who needs a ride-along, who earned a shout-out.
      </p>
      <ErrorNote>{err}</ErrorNote>

      {needTalk.length === 0 && (
        <Card className="p-6 text-center text-sm text-pw-muted">
          Nobody needs a hard conversation this week. Standards met across the board.
        </Card>
      )}
      {needTalk.map((c) => {
        const meta = REC_META[c.rec];
        const t = TREND[c.trend];
        return (
          <Card key={c.rep.id} className={`p-3.5 border-l-4 rounded-l-none ${meta.border} animate-pw-rise`}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge color={meta.color} bg={meta.bg}>{meta.label}</Badge>
              <span className="font-bold text-white">{c.rep.name}</span>
              <span className="text-[10px] uppercase tracking-widest text-pw-muted">{c.rep.role}</span>
              {isRegional && !marketId && (
                <span className="text-xs text-pw-muted">{markets.find((m) => m.id === c.rep.market_id)?.name}</span>
              )}
              <span className="ml-auto text-xs font-bold" style={{ color: t.color }}>
                {t.arrow} {t.text}
              </span>
            </div>
            <div className="text-sm text-gray-300 mt-2">{c.flags.map((f) => f.text).join(" · ")}</div>
            {(c.rec === "shadow" || c.rec === "both") && (
              <div className="text-xs text-pw-yellow/90 mt-1.5">
                Skill signals — working but the craft is off. Ride along and watch the pitch before going to paper.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              {c.onFile ? (
                <span className="text-xs text-pw-muted flex items-center gap-1.5 flex-wrap">
                  On file: <Badge color={sevMeta(c.onFile.key).color} bg={sevMeta(c.onFile.key).bg}>{c.onFile.label}</Badge>
                  → next step: <Badge color={sevMeta(c.nextStep.key).color} bg={sevMeta(c.nextStep.key).bg}>{c.nextStep.label}</Badge>
                </span>
              ) : (
                <span className="text-xs text-pw-muted">Nothing on file — conversation first, paper only if it repeats.</span>
              )}
              <Btn kind="subtle" className="ml-auto" onClick={() => setForm({ repId: c.rep.id, severity: c.nextStep.key, note: "" })}>
                Log {c.nextStep.label} →
              </Btn>
            </div>
          </Card>
        );
      })}

      {allWins.length > 0 && (
        <Card className="p-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[11px] font-bold tracking-[0.15em] text-pw-lightgreen">WINS TO CALL OUT</span>
            {allWins.map((c) => (
              <span key={c.rep.id} className="text-sm text-gray-300">
                <span className="font-bold text-white">{c.rep.name}</span>
                <span className="text-pw-muted"> — {c.wins.map((w) => w.label).join(", ")}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      {form && (
        <Card className="p-3 border-pw-orange/40">
          <h3 className="font-semibold mb-2 text-white">
            Log escalation — {reps.find((r) => r.id === form.repId)?.name}
          </h3>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-[11px] text-pw-muted">
              Severity
              <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="block mt-0.5">
                {SEVERITIES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </Select>
            </label>
            <label className="text-[11px] text-pw-muted grow">
              Note
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full mt-0.5" placeholder="What was discussed / agreed" />
            </label>
            <Btn onClick={saveEscalation}>Save</Btn>
            <Btn kind="subtle" onClick={() => setForm(null)}>Cancel</Btn>
          </div>
        </Card>
      )}

      <Card className="p-3">
        <h3 className="font-extrabold text-lg uppercase tracking-tight text-white mb-2">Escalation Log</h3>
        {visibleEscalations.length === 0 && <p className="text-sm text-pw-muted py-4 text-center">No escalations logged.</p>}
        <div className="space-y-1.5">
          {visibleEscalations.map((esc) => {
            const rep = reps.find((r) => r.id === esc.rep_id);
            const meta = sevMeta(esc.severity);
            return (
              <div key={esc.id} className="flex flex-wrap items-center gap-2 text-sm border-t border-pw-line/60 pt-1.5 first:border-0 first:pt-0">
                <Badge color={meta.color} bg={meta.bg}>{meta.label}</Badge>
                <span className="font-semibold text-white">{rep?.name || "?"}</span>
                <span className="text-pw-muted">{esc.note}</span>
                <span className="ml-auto text-xs text-pw-muted">{esc.entry_date}</span>
                <Btn kind="danger" onClick={() => removeEscalation(esc)}>Remove</Btn>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
