import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { logEvent } from "../lib/api";
import { today, tenureLabel } from "../lib/dates";
import { Card, SectionTitle, Btn, Input, Select, ErrorNote } from "./ui";

// Roster management. MOs manage their own market (RLS-enforced);
// regional manages any market. Termination is a soft flag, never a delete.
export default function Roster({ ctx }) {
  const { markets, reps, profile, isRegional, refresh } = ctx;
  const [marketId, setMarketId] = useState(profile.market_id || markets[0]?.id || "");
  const [form, setForm] = useState({ name: "", role: "knocker", start_date: today() });
  const [err, setErr] = useState("");

  const list = useMemo(
    () =>
      reps
        .filter((r) => r.market_id === marketId)
        .sort((a, b) => Number(a.terminated) - Number(b.terminated) || a.name.localeCompare(b.name)),
    [reps, marketId]
  );

  async function addRep() {
    setErr("");
    if (!form.name.trim()) return setErr("Name required");
    const { error } = await supabase.from("reps").insert({ ...form, name: form.name.trim(), market_id: marketId });
    if (error) return setErr(error.message);
    logEvent(profile.email, `Rep added: ${form.name.trim()} (${form.role})`, marketId);
    setForm({ name: "", role: "knocker", start_date: today() });
    refresh();
  }

  async function update(rep, patch, msg) {
    setErr("");
    const { error } = await supabase.from("reps").update(patch).eq("id", rep.id);
    if (error) return setErr(error.message);
    logEvent(profile.email, msg, rep.market_id);
    refresh();
  }

  return (
    <div className="space-y-3">
      <SectionTitle
        right={
          isRegional && (
            <Select value={marketId} onChange={(e) => setMarketId(e.target.value)}>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          )
        }
      >
        Roster â€” {markets.find((m) => m.id === marketId)?.name || ""}
      </SectionTitle>
      <ErrorNote>{err}</ErrorNote>

      <Card className="p-3">
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-[11px] text-pw-muted grow max-w-xs">
            Name
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full mt-0.5" />
          </label>
          <label className="text-[11px] text-pw-muted">
            Role
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="block mt-0.5">
              <option value="knocker">Knocker</option>
              <option value="closer">Closer</option>
            </Select>
          </label>
          <label className="text-[11px] text-pw-muted">
            Start date
            <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="block mt-0.5" />
          </label>
          <Btn onClick={addRep}>Add Rep</Btn>
        </div>
      </Card>

      <Card className="p-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-pw-muted">
              <th className="py-1 pr-2">Rep</th>
              <th className="py-1 pr-2">Role</th>
              <th className="py-1 pr-2">Tenure</th>
              <th className="py-1 pr-2 text-right">Recruits</th>
              <th className="py-1 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((rep) => (
              <tr key={rep.id} className={`border-t border-pw-line/60 ${rep.terminated ? "opacity-50" : ""}`}>
                <td className="py-1.5 pr-2 font-semibold text-white">{rep.name}</td>
                <td className="py-1.5 pr-2 capitalize text-pw-muted">{rep.role}</td>
                <td className="py-1.5 pr-2 text-pw-muted">{tenureLabel(rep.start_date, today())}</td>
                <td className="py-1.5 pr-2 text-right">
                  <Input
                    type="number"
                    min="0"
                    value={rep.recruits}
                    onChange={(e) => update(rep, { recruits: Number(e.target.value) || 0 }, `Recruits updated for ${rep.name}`)}
                    className="w-16 text-right"
                  />
                </td>
                <td className="py-1.5 text-right">
                  {rep.terminated ? (
                    <Btn kind="subtle" onClick={() => update(rep, { terminated: false, terminated_at: null, active: true }, `Rep reinstated: ${rep.name}`)}>
                      Reinstate
                    </Btn>
                  ) : (
                    <Btn
                      kind="danger"
                      onClick={() => {
                        if (window.confirm(`Mark ${rep.name} as terminated? Their history stays.`))
                          update(rep, { terminated: true, terminated_at: today(), active: false }, `Rep terminated: ${rep.name}`);
                      }}
                    >
                      Terminate
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-pw-muted">No reps yet â€” add the first one above.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
