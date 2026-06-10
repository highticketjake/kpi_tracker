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
          <label className="text-[11px] text-gray-500 grow max-w-xs">
            Email
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full mt-0.5" />
          </label>
          <label className="text-[11px] text-gray-500">
            Temp password
            <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-0.5 w-36" />
          </label>
          <label className="text-[11px] text-gray-500">
            Name
            <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className="mt-0.5 w-28" />
          </label>
          <label className="text-[11px] text-gray-500">
            Role
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="block mt-0.5">
              <option value="market_owner">Market Owner</option>
              <option value="regional">Regional</option>
            </Select>
          </label>
          {form.role === "market_owner" && (
            <label className="text-[11px] text-gray-500">
              Market
              <Select value={form.market_id} onChange={(e) => setForm({ ...form, market_id: e.target.value })} className="block mt-0.5">
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </label>
          )}
          <Btn onClick={createUser} disabled={busy || !form.email || form.password.length < 8}>
            {busy ? "Creating…" : "Create Account"}
          </Btn>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Share the temp password directly with the MO; they can keep it or you can reset it any time.
        </p>
      </Card>
      <Card className="p-3">
        {!users ? (
          <Spinner label="Loading users…" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-1 pr-2">Email</th>
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Role</th>
                <th className="py-1 pr-2">Market</th>
                <th className="py-1 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`border-t border-gray-50 ${u.active ? "" : "opacity-50"}`}>
                  <td className="py-1.5 pr-2">{u.email}</td>
                  <td className="py-1.5 pr-2">{u.display_name || "—"}</td>
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

  async function setDealValue(m, value) {
    setErr("");
    const { error } = await supabase
      .from("markets")
      .update({ average_deal_value: value === "" ? null : Number(value) || 0 })
      .eq("id", m.id);
    if (error) return setErr(error.message);
    logEvent(profile.email, `Avg deal value updated for ${m.name}`, m.id);
    refresh();
  }

  return (
    <section>
      <SectionTitle>Markets</SectionTitle>
      <ErrorNote>{err}</ErrorNote>
      <Card className="p-3">
        <table className="w-full text-sm max-w-md">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-1 pr-2">Market</th>
              <th className="py-1 text-right">Avg deal value $</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => (
              <tr key={m.id} className="border-t border-gray-50">
                <td className="py-1.5 pr-2 font-semibold text-gray-800">{m.name}</td>
                <td className="py-1.5 text-right">
                  <Input
                    type="number"
                    min="0"
                    defaultValue={m.average_deal_value ?? ""}
                    onBlur={(e) => setDealValue(m, e.target.value)}
                    className="w-28 text-right"
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
          <Spinner label="Loading…" />
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No activity yet.</p>
        ) : (
          <div className="space-y-1">
            {events.map((e) => (
              <div key={e.id} className="text-xs text-gray-600 border-t border-gray-50 pt-1 first:border-0 first:pt-0">
                <span className="text-gray-400">{new Date(e.ts).toLocaleString()}</span>{" "}
                <span className="font-semibold">{e.actor_email || "system"}</span> — {e.message}
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
