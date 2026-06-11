import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { adminUsers, fetchEvents, logEvent } from "../lib/api";
import { Card, SectionTitle, Btn, Input, Select, ErrorNote, Spinner } from "./ui";

// Regional-only: user accounts (via the admin-users edge function),
// market deal values, and the audit log.
export default function Admin({ ctx }) {
  return (
    <div className="space-y-5">
      <Users ctx={ctx} />
      <MarketSettings ctx={ctx} />
      <EventLog />
    </div>
  );
}

function Users({ ctx }) {
  const { markets, profile } = ctx;
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", display_name: "", role: "market_owner", market_id: markets[0]?.id || "" });

  async function load() {
    try {
      const res = await adminUsers({ action: "list_users" });
      setUsers(res.users);
    } catch (e) {
      setErr(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function createUser() {
    setBusy(true);
    setErr("");
    try {
      await adminUsers({ action: "create_user", ...form, market_id: form.role === "market_owner" ? form.market_id : null });
      setForm({ email: "", password: "", display_name: "", role: "market_owner", market_id: markets[0]?.id || "" });
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  async function resetPassword(u) {
    const password = window.prompt(`New password for ${u.email} (8+ chars):`);
    if (!password) return;
    setErr("");
    try {
      await adminUsers({ action: "reset_password", user_id: u.id, password });
      window.alert("Password updated.");
    } catch (e) {
      setErr(e.message);
    }
  }

  async function setActive(u, active) {
    setErr("");
    try {
      await adminUsers({ action: "set_active", user_id: u.id, active });
      await load();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <section>
      <SectionTitle>Team Accounts</SectionTitle>
      <ErrorNote>{err}</ErrorNote>
      <Card className="p-3 mb-3">
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-[11px] text-pw-muted grow max-w-xs">
            Email
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full mt-0.5" />
          </label>
          <label className="text-[11px] text-pw-muted">
            Temp password
            <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-0.5 w-36" />
          </label>
          <label className="text-[11px] text-pw-muted">
            Name
            <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className="mt-0.5 w-28" />
          </label>
          <label className="text-[11px] text-pw-muted">
            Role
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="block mt-0.5">
              <option value="market_owner">Market Owner</option>
              <option value="regional">Regional</option>
            </Select>
          </label>
          {form.role === "market_owner" && (
            <label className="text-[11px] text-pw-muted">
              Market
              <Select value={form.market_id} onChange={(e) => setForm({ ...form, market_id: e.target.value })} className="block mt-0.5">
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </label>
          )}
          <Btn onClick={createUser} disabled={busy || !form.email || form.password.length < 8}>
            {busy ? "Creatingâ€¦" : "Create Account"}
          </Btn>
        </div>
        <p className="text-[11px] text-pw-muted mt-2">
          Share the temp password directly with the MO; they can keep it or you can reset it any time.
        </p>
      </Card>
      <Card className="p-3">
        {!users ? (
          <Spinner label="Loading usersâ€¦" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-pw-muted">
                <th className="py-1 pr-2">Email</th>
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Role</th>
                <th className="py-1 pr-2">Market</th>
                <th className="py-1 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`border-t border-pw-line/60 ${u.active ? "" : "opacity-50"}`}>
                  <td className="py-1.5 pr-2">{u.email}</td>
                  <td className="py-1.5 pr-2">{u.display_name || "â€”"}</td>
                  <td className="py-1.5 pr-2">{u.role === "regional" ? "Regional" : "Market Owner"}</td>
                  <td className="py-1.5 pr-2">{markets.find((m) => m.id === u.market_id)?.name || "All"}</td>
                  <td className="py-1.5 text-right space-x-1">
                    <Btn kind="subtle" onClick={() => resetPassword(u)}>Reset PW</Btn>
                    {u.id !== profile.id &&
                      (u.active ? (
                        <Btn kind="danger" onClick={() => setActive(u, false)}>Deactivate</Btn>
                      ) : (
                        <Btn kind="subtle" onClick={() => setActive(u, true)}>Reactivate</Btn>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}

function MarketSettings({ ctx }) {
  const { markets, profile, refresh } = ctx;
  const [err, setErr] = useState("");

  async function setField(m, field, label, value) {
    setErr("");
    const { error } = await supabase
      .from("markets")
      .update({ [field]: value === "" ? null : Number(value) || 0 })
      .eq("id", m.id);
    if (error) return setErr(error.message);
    logEvent(profile.email, `${label} updated for ${m.name}`, m.id);
    refresh();
  }

  return (
    <section>
      <SectionTitle>Markets</SectionTitle>
      <ErrorNote>{err}</ErrorNote>
      <Card className="p-3">
        <table className="w-full text-sm max-w-md">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-pw-muted">
              <th className="py-1 pr-2">Market</th>
              <th className="py-1 pr-2 text-right">Avg deal value $</th>
              <th className="py-1 text-right">Monthly revenue goal $</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => (
              <tr key={m.id} className="border-t border-pw-line/60">
                <td className="py-1.5 pr-2 font-semibold text-white">{m.name}</td>
                <td className="py-1.5 pr-2 text-right">
                  <Input
                    type="number"
                    min="0"
                    defaultValue={m.average_deal_value ?? ""}
                    onBlur={(e) => setField(m, "average_deal_value", "Avg deal value", e.target.value)}
                    className="w-28 text-right"
                  />
                </td>
                <td className="py-1.5 text-right">
                  <Input
                    type="number"
                    min="0"
                    step="1000"
                    defaultValue={m.monthly_goal ?? ""}
                    onBlur={(e) => setField(m, "monthly_goal", "Monthly goal", e.target.value)}
                    className="w-32 text-right"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

function EventLog() {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    fetchEvents().then(setEvents).catch(() => setEvents([]));
  }, []);
  return (
    <section>
      <SectionTitle>Activity Log</SectionTitle>
      <Card className="p-3 max-h-96 overflow-y-auto">
        {!events ? (
          <Spinner label="Loadingâ€¦" />
        ) : events.length === 0 ? (
          <p className="text-sm text-pw-muted text-center py-4">No activity yet.</p>
        ) : (
          <div className="space-y-1">
            {events.map((e) => (
              <div key={e.id} className="text-xs text-gray-300 border-t border-pw-line/60 pt-1 first:border-0 first:pt-0">
                <span className="text-pw-muted">{new Date(e.ts).toLocaleString()}</span>{" "}
                <span className="font-semibold">{e.actor_email || "system"}</span> â€” {e.message}
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
