import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import { loadAll, getProfile } from "./lib/api";
import { Spinner, Btn, Card } from "./components/ui";
import Login from "./components/Login";
import DataEntry from "./components/DataEntry";
import Boards from "./components/Boards";
import Rollup from "./components/Rollup";
import Trends from "./components/Trends";
import Accountability from "./components/Accountability";
import Challenge from "./components/Challenge";
import Promotion from "./components/Promotion";
import Roster from "./components/Roster";
import Admin from "./components/Admin";
import TVView from "./components/TVView";

const TABS = [
  { key: "entry", label: "Daily Entry" },
  { key: "boards", label: "Boards" },
  { key: "rollup", label: "All Markets", regionalOnly: true },
  { key: "trends", label: "Trends" },
  { key: "accountability", label: "Accountability" },
  { key: "promotion", label: "Promotion" },
  { key: "challenge", label: "Challenge" },
  { key: "roster", label: "Roster" },
  { key: "tv", label: "TV" },
  { key: "admin", label: "Admin", regionalOnly: true },
];

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = booting
  const [profile, setProfile] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("entry");

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
        setProfile(p);
        if (p?.active) await refresh();
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, refresh]);

  // Live updates: any KPI/roster change in scope triggers a (debounced) refetch.
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
          <h1 className="font-display text-3xl mb-2">NO ACCESS</h1>
          <p className="text-sm text-gray-500 mb-4">
            This account isn't set up for the tracker. Ask Jake to add you.
          </p>
          <Btn kind="subtle" onClick={() => supabase.auth.signOut()}>Sign out</Btn>
        </Card>
      </div>
    );
  }

  if (tab === "tv" && ctx) return <TVView ctx={ctx} onExit={() => setTab("boards")} />;

  return (
    <div className="min-h-screen max-w-6xl mx-auto p-3 sm:p-5">
      <header className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="font-display text-3xl tracking-wide mr-auto">
          KPI TRACKER
          <span className="ml-2 text-sm font-sans font-semibold text-gray-400 align-middle">
            {isRegional ? "Regional" : ctx?.markets.find((m) => m.id === profile.market_id)?.name || ""}
          </span>
        </h1>
        <span className="text-xs text-gray-400">{profile.email}</span>
        <Btn kind="subtle" onClick={() => supabase.auth.signOut()}>Sign out</Btn>
      </header>

      <nav className="flex gap-1 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
              tab === t.key ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {err ? (
        <Card className="p-4 text-sm text-red-600">
          {err} <Btn kind="subtle" onClick={refresh} className="ml-2">Retry</Btn>
        </Card>
      ) : !ctx ? (
        <Spinner />
      ) : (
        <>
          {tab === "entry" && <DataEntry ctx={ctx} />}
          {tab === "boards" && <Boards ctx={ctx} />}
          {tab === "rollup" && isRegional && <Rollup ctx={ctx} />}
          {tab === "trends" && <Trends ctx={ctx} />}
          {tab === "accountability" && <Accountability ctx={ctx} />}
          {tab === "promotion" && <Promotion ctx={ctx} />}
          {tab === "challenge" && <Challenge ctx={ctx} />}
          {tab === "roster" && <Roster ctx={ctx} />}
          {tab === "admin" && isRegional && <Admin ctx={ctx} />}
        </>
      )}
    </div>
  );
}
