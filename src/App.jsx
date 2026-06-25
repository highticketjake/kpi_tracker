import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { loadAll, getProfile } from "./lib/api";
import { Spinner, Btn, Card, ErrorBoundary } from "./components/ui";
import Login from "./components/Login";
import RoleTab from "./components/RoleTab";
import Reports from "./components/Reports";
import Accountability from "./components/Accountability";
import Challenge from "./components/Challenge";
import Promotion from "./components/Promotion";
import Roster from "./components/Roster";
import RepTracker from "./components/RepTracker";
import Admin from "./components/Admin";
import TVView from "./components/TVView";
import pwIcon from "./assets/pw-icon.png";

const TABS = [
  { key: "knockers", label: "Knockers" },
  { key: "closers", label: "Closers" },
  { key: "reports", label: "Reports" },
  { key: "accountability", label: "Accountability" },
  { key: "promotion", label: "Promotion" },
  { key: "challenge", label: "Challenge" },
  { key: "rep", label: "Rep" },
  { key: "roster", label: "Roster" },
  { key: "tv", label: "TV" },
  { key: "admin", label: "Admin", regionalOnly: true },
];

export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("knockers");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    try {
      setErr("");
      setData(await loadAll());
    } catch (e) {
      setErr(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const p = await getProfile(session.user.id);
        if (cancelled) return;
        setProfile(p ?? false); // false = checked, no profile row
        if (p?.active) await refresh();
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, refresh]);

  useEffect(() => {
    if (!profile?.active) return;
    let timer = null;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 800);
    };
    const ch = supabase
      .channel("v2-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "kpi_entries" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "reps" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "escalations" }, bump)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [profile, refresh]);

  const isRegional = profile?.role === "regional";
  const visibleTabs = useMemo(() => TABS.filter((t) => isRegional || !t.regionalOnly), [isRegional]);
  const ctx = useMemo(
    () => (data && profile ? { ...data, profile, isRegional, refresh } : null),
    [data, profile, isRegional, refresh]
  );

  if (session === undefined) return <Spinner label="Starting…" />;
  if (!session) return <Login />;
  if (profile === null && !err) return <Spinner label="Checking access…" />;

  if (!profile || !profile.active) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-sm p-6 text-center">
          <h1 className="font-extrabold text-2xl uppercase mb-2">No access</h1>
          <p className="text-sm text-pw-muted mb-4">This account isn't set up for the tracker. Ask Jake to add you.</p>
          <Btn kind="subtle" onClick={() => supabase.auth.signOut()}>Sign out</Btn>
        </Card>
      </div>
    );
  }

  if (tab === "tv" && ctx)
    return (
      <ErrorBoundary key="tv">
        <TVView ctx={ctx} onExit={() => setTab("knockers")} />
      </ErrorBoundary>
    );

  return (
    <div className="min-h-screen max-w-6xl mx-auto p-3 sm:p-5">
      <header className="flex flex-wrap items-center gap-3 mb-4">
        <img src={pwIcon} alt="" className="w-9 h-9" />
        <h1 className="font-extrabold text-2xl uppercase tracking-tight mr-auto">
          Performance <span className="text-pw-red">tracker</span>
          <span className="ml-2 text-sm font-bold text-pw-muted normal-case align-middle">
            {isRegional ? "Regional" : ctx?.markets.find((m) => m.id === profile.market_id)?.name || ""}
          </span>
        </h1>
        <span className="text-xs text-pw-muted hidden sm:inline">{profile.email}</span>
        <Btn kind="subtle" onClick={() => supabase.auth.signOut()}>Sign out</Btn>
      </header>

      <nav className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3.5 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition ${
              tab === t.key ? "bg-pw-red text-white" : "bg-pw-surface text-gray-300 hover:bg-pw-surface2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {err ? (
        <Card className="p-4 text-sm text-red-300">
          {err} <Btn kind="subtle" onClick={refresh} className="ml-2">Retry</Btn>
        </Card>
      ) : !ctx ? (
        <Spinner />
      ) : (
        <ErrorBoundary key={tab}>
          {tab === "knockers" && <RoleTab ctx={ctx} role="knocker" />}
          {tab === "closers" && <RoleTab ctx={ctx} role="closer" />}
          {tab === "reports" && <Reports ctx={ctx} />}
          {tab === "accountability" && <Accountability ctx={ctx} />}
          {tab === "promotion" && <Promotion ctx={ctx} />}
          {tab === "challenge" && <Challenge ctx={ctx} />}
          {tab === "roster" && <Roster ctx={ctx} />}
          {tab === "rep" && <RepTracker ctx={ctx} />}
          {tab === "admin" && isRegional && <Admin ctx={ctx} />}
        </ErrorBoundary>
      )}
    </div>
  );
}
