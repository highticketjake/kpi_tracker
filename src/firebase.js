// Supabase-backed compatibility layer.
//
// This file keeps the same export names the rest of the app already imports
// (getDoc, setDoc, runTransaction, onSnapshot, onAuthStateChanged, ...), but
// stores everything in a single Supabase table (public.app_data) keyed by
// document id ("state" and "access"). That way the app's data + access logic
// keeps running unchanged on top of Supabase instead of Firestore.

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing Supabase env var(s): VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY. See .env.example."
  );
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Parity handles. They hold no real state; the shim talks to `supabase` directly.
export const auth = { __supabase: true };
export const db = { __supabase: true };

const TABLE = "app_data";

/* ------------------------------- helpers ------------------------------- */

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}
function deepMerge(target, patch) {
  const out = isPlainObject(target) ? { ...target } : {};
  Object.keys(patch || {}).forEach(function (k) {
    const pv = patch[k];
    if (isPlainObject(pv) && isPlainObject(out[k])) out[k] = deepMerge(out[k], pv);
    else out[k] = pv;
  });
  return out;
}
// Apply one (path, value) mutation; supports the deleteField() sentinel.
function applyPath(obj, segments, value) {
  const root = isPlainObject(obj) ? { ...obj } : {};
  let cur = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    cur[seg] = isPlainObject(cur[seg]) ? { ...cur[seg] } : {};
    cur = cur[seg];
  }
  const last = segments[segments.length - 1];
  if (value && value.__deleteField) delete cur[last];
  else cur[last] = value;
  return root;
}
// updateDoc accepts either ({fieldMap}) or (path, value, path, value, ...).
function normalizeUpdateArgs(args) {
  const mutations = [];
  if (args.length === 1 && isPlainObject(args[0]) && !args[0].__fieldPath) {
    const map = args[0];
    Object.keys(map).forEach(function (k) {
      mutations.push({ segments: [k], value: map[k] });
    });
    return mutations;
  }
  for (let i = 0; i < args.length; i += 2) {
    const p = args[i];
    const v = args[i + 1];
    const segments = p && p.__fieldPath ? p.segments : [String(p)];
    mutations.push({ segments: segments, value: v });
  }
  return mutations;
}

async function readRow(id) {
  const res = await supabase.from(TABLE).select("data, version").eq("id", id).maybeSingle();
  if (res.error) throw res.error;
  return res.data; // { data, version } | null
}
function snapshotFrom(row) {
  const exists = !!row;
  const data = row && row.data ? row.data : {};
  return {
    exists: function () { return exists; },
    data: function () { return data; },
  };
}
// Optimistic-concurrency write. expectedVersion null => upsert (new/replace).
async function writeRow(id, newData, expectedVersion) {
  if (expectedVersion == null) {
    const up = await supabase
      .from(TABLE)
      .upsert({ id: id, data: newData, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (up.error) throw up.error;
    return true;
  }
  const upd = await supabase
    .from(TABLE)
    .update({ data: newData, version: expectedVersion + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("version", expectedVersion)
    .select("version");
  if (upd.error) throw upd.error;
  return upd.data && upd.data.length > 0; // false => version conflict, caller retries
}

/* --------------------------- Firestore-like API --------------------------- */

export function doc(_db, _collection, id) {
  return { id: id, __ref: true };
}
export function FieldPath() {
  return { __fieldPath: true, segments: Array.prototype.slice.call(arguments) };
}
export function deleteField() {
  return { __deleteField: true };
}

export async function getDoc(ref) {
  return snapshotFrom(await readRow(ref.id));
}

export async function setDoc(ref, data, opts) {
  const merge = opts && opts.merge;
  if (!merge) {
    const up = await supabase
      .from(TABLE)
      .upsert({ id: ref.id, data: data, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (up.error) throw up.error;
    return;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await readRow(ref.id);
    const merged = deepMerge(row && row.data ? row.data : {}, data);
    if (!row) {
      const up = await supabase.from(TABLE).upsert({ id: ref.id, data: merged }, { onConflict: "id" });
      if (up.error) throw up.error;
      return;
    }
    if (await writeRow(ref.id, merged, row.version)) return;
  }
  throw new Error("setDoc(merge) failed after retries (write conflict).");
}

export async function updateDoc(ref) {
  const args = Array.prototype.slice.call(arguments, 1);
  const mutations = normalizeUpdateArgs(args);
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await readRow(ref.id);
    let working = row && row.data ? row.data : {};
    mutations.forEach(function (m) { working = applyPath(working, m.segments, m.value); });
    if (await writeRow(ref.id, working, row ? row.version : null)) return;
  }
  throw new Error("updateDoc failed after retries (write conflict).");
}

// Mirrors Firestore runTransaction: read inside the callback, write atomically,
// retry the whole callback on a version conflict.
export async function runTransaction(_db, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const reads = {};
    const working = {};
    const touched = {};
    const tx = {
      get: async function (ref) {
        const row = await readRow(ref.id);
        reads[ref.id] = row ? row.version : null;
        working[ref.id] = row && row.data ? row.data : {};
        return snapshotFrom(row);
      },
      set: function (ref, data, opts) {
        const merge = opts && opts.merge;
        working[ref.id] = merge ? deepMerge(working[ref.id] || {}, data) : data;
        touched[ref.id] = true;
      },
      update: function (ref) {
        const a = Array.prototype.slice.call(arguments, 1);
        let w = working[ref.id] || {};
        normalizeUpdateArgs(a).forEach(function (m) { w = applyPath(w, m.segments, m.value); });
        working[ref.id] = w;
        touched[ref.id] = true;
      },
    };
    const result = await fn(tx);
    let conflict = false;
    const ids = Object.keys(touched);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const expected = Object.prototype.hasOwnProperty.call(reads, id) ? reads[id] : null;
      const ok = await writeRow(id, working[id], expected);
      if (!ok) { conflict = true; break; }
    }
    if (!conflict) return result;
  }
  throw new Error("Transaction failed after retries (write conflict).");
}

// Live updates via Supabase realtime (replaces Firestore onSnapshot).
export function onSnapshot(ref, onNext, onError) {
  let active = true;
  getDoc(ref)
    .then(function (snap) { if (active) onNext(snap); })
    .catch(function (e) { if (active && onError) onError(e); });

  const channel = supabase
    .channel("app_data_" + ref.id + "_" + Math.random().toString(36).slice(2))
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE, filter: "id=eq." + ref.id },
      function (payload) {
        if (!active) return;
        const row = payload && payload.new;
        if (row && row.data !== undefined) {
          onNext(snapshotFrom({ data: row.data, version: row.version }));
        } else {
          getDoc(ref).then(function (s) { if (active) onNext(s); }).catch(function () {});
        }
      }
    )
    .subscribe();

  return function () {
    active = false;
    try { supabase.removeChannel(channel); } catch (e) {}
  };
}

/* ------------------------------- Auth API ------------------------------- */

function mapUser(u) {
  if (!u) return null;
  const meta = u.user_metadata || {};
  return {
    uid: u.id,
    email: u.email || meta.email || "",
    displayName: meta.name || meta.full_name || "",
    photoURL: meta.avatar_url || meta.picture || "",
  };
}

export function onAuthStateChanged(_auth, cb) {
  supabase.auth.getSession().then(function (res) {
    cb(mapUser(res && res.data && res.data.session ? res.data.session.user : null));
  });
  const sub = supabase.auth.onAuthStateChange(function (_event, session) {
    cb(mapUser(session ? session.user : null));
  });
  return function () {
    try { sub.data.subscription.unsubscribe(); } catch (e) {}
  };
}

export function getRedirectResult() {
  return Promise.resolve(null);
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Email + password sign-in.
export async function signInWithPassword(email, password) {
  const res = await supabase.auth.signInWithPassword({ email: email, password: password });
  if (res.error) throw res.error;
  return mapUser(res.data ? res.data.user : null);
}
// Create an account with email + password. With "Confirm email" disabled in
// Supabase, this returns an active session immediately and the auth listener
// signs the user in. If confirmation is on, session is null until confirmed.
export async function signUpWithPassword(email, password) {
  const res = await supabase.auth.signUp({ email: email, password: password });
  if (res.error) throw res.error;
  return {
    user: mapUser(res.data ? res.data.user : null),
    hasSession: !!(res.data && res.data.session),
  };
}

// Kept only so any leftover imports don't break; no longer used by the UI.
export class GoogleAuthProvider {}
export function signInWithPopup() { return Promise.reject(new Error("Use email sign-in.")); }
export function signInWithRedirect() { return Promise.reject(new Error("Use email sign-in.")); }
