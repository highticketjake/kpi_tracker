import { supabase } from "./supabase";
import { addDays, today } from "./dates";

// Load everything the signed-in user can see for the working window.
// RLS scopes every query: MOs get their market, regional gets all.
export const WINDOW_DAYS = 70; // covers current + prior month for promotion math

export async function loadAll() {
  const start = addDays(today(), -(WINDOW_DAYS - 1));
  const [markets, reps, entries, sales, escalations, settings] = await Promise.all([
    supabase.from("markets").select("*").order("name"),
    supabase.from("reps").select("*").order("name"),
    supabase.from("kpi_entries").select("*").gte("entry_date", start),
    supabase.from("sales").select("*").gte("sale_date", start),
    supabase.from("escalations").select("*").order("created_at", { ascending: false }),
    supabase.from("app_settings").select("*"),
  ]);
  for (const r of [markets, reps, entries, sales, escalations, settings]) {
    if (r.error) throw r.error;
  }
  const globalSettings = settings.data.find((s) => s.key === "global")?.value || {};
  return {
    markets: markets.data,
    reps: reps.data,
    entries: entries.data,
    sales: sales.data,
    escalations: escalations.data,
    settings: globalSettings,
    windowStart: start,
  };
}

export async function getProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveEntry(entry) {
  const { error } = await supabase
    .from("kpi_entries")
    .upsert(entry, { onConflict: "rep_id,entry_date" });
  if (error) throw error;
}

export async function logEvent(actorEmail, message, marketId) {
  // Best-effort audit write; never block the action on it.
  try {
    await supabase.from("event_log").insert({ actor_email: actorEmail, message, market_id: marketId || null });
  } catch {
    /* ignore */
  }
}

export async function fetchEvents(limit = 200) {
  const { data, error } = await supabase
    .from("event_log")
    .select("*")
    .order("ts", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function marketRangeTotals(start, end) {
  const { data, error } = await supabase.rpc("market_range_totals", { p_start: start, p_end: end });
  if (error) throw error;
  return data;
}

// Region-wide snapshot (all markets) for TV + Challenge. Security-definer RPC,
// so every authenticated user sees the whole region for the leaderboards while
// base-table RLS still scopes editing to each owner's market.
export async function regionBoardData(start) {
  const { data, error } = await supabase.rpc("region_board_data", { p_start: start });
  if (error) throw error;
  return data || { markets: [], reps: [], entries: [], sales: [] };
}

// Sale ledger writes. A cancel sets cancelled_at (never deletes — the close,
// knocker credit, and ran must survive). Un-cancel clears it.
export async function addSale(sale) {
  const { data, error } = await supabase.from("sales").insert(sale).select().single();
  if (error) throw error;
  return data;
}
export async function setSaleCancelled(id, cancelled) {
  const { error } = await supabase
    .from("sales")
    .update({ cancelled_at: cancelled ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}
export async function deleteSale(id) {
  const { error } = await supabase.from("sales").delete().eq("id", id);
  if (error) throw error;
}

// Market owners can set their OWN market's monthly goal (regional can set any).
export async function setMarketGoal(marketId, goal) {
  const { data, error } = await supabase.rpc("set_market_goal", { p_market: marketId, p_goal: goal });
  if (error) throw error;
  return data;
}

// Regional-only user management via the admin-users edge function.
export async function adminUsers(body) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    // surface the function's JSON error message when present
    let msg = error.message;
    try {
      const ctx = await error.context?.json?.();
      if (ctx?.error) msg = ctx.error;
    } catch { /* keep default */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
