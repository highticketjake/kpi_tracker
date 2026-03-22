import { useState, useEffect, useCallback, useRef } from "react";
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth";
import {
  deleteField,
  doc,
  FieldPath,
  getDoc,
  onSnapshot,
  runTransaction,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "./firebase.js";
import notifPng from "./assets/notif.png";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
} from "recharts";

var DD = { markets: {}, reps: {}, dailyKPIs: {}, accountabilityLog: {}, settings: {}, eventLog: [] };
var ACCESS_DD = { users: {}, invites: {}, pendingInvites: {}, ownerUid: null, accessRequests: {} };
var ROLE_RANK = { owner: 2, admin: 1, default: 0 };
var EVENT_LOG_MAX = 400;
var PROMO_SALES_NEED = 8;
var PROMO_RECRUITS_NEED = 2;
var TODAY = new Date().toISOString().split("T")[0];
var REGION_KEY = "__REGION__";

/** Main nav tab order (used for mobile swipe between tabs). */
var MAIN_TABS = [
  { k: "dashboard", l: "Dashboard" },
  { k: "enter", l: "Enter" },
  { k: "knockerboard", l: "Knockers" },
  { k: "closerboard", l: "Closers" },
  { k: "trends", l: "Trends" },
  { k: "accountability", l: "Log" },
  { k: "rollup", l: "Markets" },
  { k: "challenge", l: "Challenge" },
  { k: "report", l: "Report" },
  { k: "manage", l: "Manage" },
];

function isRegion(selM) {
  return selM === REGION_KEY;
}
/** Activity log visibility: All Offices shows everything; a single market shows only that market (and hides global-only rows). */
function eventLogMatchesSelection(selM, e) {
  if (!selM || isRegion(selM)) return true;
  var mid = e && e.marketId;
  if (mid == null || mid === "") return false;
  return mid === selM;
}
/** Rolling window from entry timestamp. range: day | week | month | all */
function eventLogMatchesTimeRange(e, range) {
  if (range === "all") return true;
  if (!e || !e.ts) return false;
  var t = new Date(e.ts).getTime();
  if (isNaN(t)) return false;
  var now = Date.now();
  var msDay = 86400000;
  var maxAge = range === "day" ? msDay : range === "week" ? 7 * msDay : range === "month" ? 30 * msDay : 0;
  return now - t <= maxAge;
}
function eventLogEntryMatchesFilters(selM, timeRange, e) {
  return eventLogMatchesSelection(selM, e) && eventLogMatchesTimeRange(e, timeRange);
}
function onRoster(rep) {
  return rep.active !== false && rep.terminated !== true;
}

var K_FIELDS = [
  { key: "doorsKnocked", label: "Doors", min: 120 },
  { key: "convosHad", label: "Convos", min: 50 },
  { key: "setsSet", label: "Sets" },
  { key: "apptsRan", label: "Appts" },
  { key: "closes", label: "Closes" },
];
var C_FIELDS = [
  { key: "apptsRan", label: "Appts Ran" },
  { key: "apptsClosed", label: "Closed" },
  { key: "cads", label: "CADs" },
  { key: "convosHad", label: "Convos" },
  { key: "doorsKnocked", label: "Doors" },
  { key: "selfGenSets", label: "SG Sets" },
  { key: "selfGenCloses", label: "SG Closes" },
];
var KPI_FIELD_LABEL = {};
K_FIELDS.forEach(function (f) {
  KPI_FIELD_LABEL[f.key] = f.label;
});
C_FIELDS.forEach(function (f) {
  KPI_FIELD_LABEL[f.key] = f.label;
});
var SEV = [
  { key: "coaching", label: "Coaching", color: "#FF9500", bg: "#FFF8EE" },
  {
    key: "warning",
    label: "Written Warning",
    color: "#FF6B00",
    bg: "#FFF3E8",
  },
  { key: "final", label: "Final Warning", color: "#FF3B30", bg: "#FFF0EF" },
  { key: "termination", label: "Termination", color: "#8B0000", bg: "#FFE5E5" },
];

function gid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}
function pct(a, b) {
  return b > 0 ? Math.round((a / b) * 1000) / 10 : 0;
}
function daysBetween(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / 86400000);
}

function getDatesInRange(start, end) {
  var d = [];
  var cur = new Date(start);
  var endD = new Date(end);
  while (cur <= endD) {
    d.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return d;
}

function daysAgo(n) {
  var d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}
function monthStart() {
  return TODAY.slice(0, 8) + "01";
}

function authErrorMessage(e) {
  var code = e && e.code ? String(e.code) : "";
  if (code === "auth/unauthorized-domain") {
    return "This domain isn't authorized in Firebase Auth. Add it under Authentication → Settings → Authorized domains.";
  }
  if (code === "auth/popup-blocked") return "Popup was blocked by the browser. Trying redirect sign-in…";
  if (code === "auth/popup-closed-by-user") return "Popup was closed before completing sign-in.";
  if (code === "auth/cancelled-popup-request") return "Another sign-in popup is already open.";
  if (code === "auth/operation-not-supported-in-this-environment") return "Popup sign-in not supported here. Trying redirect sign-in…";
  if (code) return code;
  return "Sign-in failed. Check your Firebase config and authorized domains.";
}

async function load() {
  var ref = doc(db, "app", "state");
  var snap = await getDoc(ref);
  if (!snap.exists()) return DD;
  var d = snap.data();
  return { ...DD, ...d };
}
async function save(d) {
  var ref = doc(db, "app", "state");
  await setDoc(ref, d, { merge: false });
}
/** Append one row to `app/state` event log (e.g. when `data` is not loaded in memory). */
async function appendEventLogEntry(message, actorEmail) {
  var ref = doc(db, "app", "state");
  var snap = await getDoc(ref);
  var raw = snap.exists() ? snap.data() : {};
  var merged = { ...DD, ...raw };
  var prevLog = Array.isArray(merged.eventLog) ? merged.eventLog.slice() : [];
  prevLog.unshift({
    ts: new Date().toISOString(),
    actor: actorEmail != null && actorEmail !== "" ? actorEmail : null,
    message: String(message),
    marketId: null,
  });
  if (prevLog.length > EVENT_LOG_MAX) prevLog = prevLog.slice(0, EVENT_LOG_MAX);
  merged.eventLog = prevLog;
  await setDoc(ref, merged, { merge: false });
}

function accessRef() {
  return doc(db, "app", "access");
}
function normalizeEmail(s) {
  if (!s) return "";
  return String(s).trim().toLowerCase();
}
function canInviteWithRole(inviterRole, targetRole) {
  if (!inviterRole || inviterRole === "default") return false;
  if (targetRole === "owner") return inviterRole === "owner";
  return (ROLE_RANK[inviterRole] || 0) >= (ROLE_RANK[targetRole] || 0);
}
function roleLabel(r) {
  if (r === "owner") return "Owner";
  if (r === "admin") return "Admin";
  return "Default";
}
/** Stable key for a not-yet-signed-in user row under access.users (map key, not a Firebase UID). */
function emailSlotKey(normalizedEmail) {
  return "email:" + normalizedEmail;
}
async function bootstrapOwnerIfNeeded(user) {
  var ref = accessRef();
  await runTransaction(db, function (transaction) {
    return transaction.get(ref).then(function (snap) {
      var data = snap.exists() ? snap.data() : {};
      var users = data.users && typeof data.users === "object" ? data.users : {};
      if (Object.keys(users).length > 0) return;
      var now = new Date().toISOString();
      transaction.set(
        ref,
        {
          ownerUid: user.uid,
          users: {
            [user.uid]: {
              email: normalizeEmail(user.email),
              displayName: user.displayName || "",
              photoURL: user.photoURL || "",
              role: "owner",
              updatedAt: now,
            },
          },
          invites: data.invites && typeof data.invites === "object" ? data.invites : {},
          pendingInvites: data.pendingInvites && typeof data.pendingInvites === "object" ? data.pendingInvites : {},
          accessRequests: data.accessRequests && typeof data.accessRequests === "object" ? data.accessRequests : {},
        },
        { merge: true }
      );
    });
  });
}
/** True if this email can still be linked on first sign-in (placeholder row, legacy pendingInvites, or legacy token invite). */
function hasPendingForEmail(access, em) {
  if (!em || !access) return false;
  var users = access.users && typeof access.users === "object" ? access.users : {};
  var sk = emailSlotKey(em);
  if (users[sk] && users[sk].pending) return true;
  if (access.pendingInvites && access.pendingInvites[em]) return true;
  var invites = access.invites && typeof access.invites === "object" ? access.invites : {};
  for (var tok in invites) {
    var inv = invites[tok];
    if (inv && normalizeEmail(inv.email) === em) return true;
  }
  return false;
}
/**
 * Link Firebase auth to access.users: placeholder row users["email:…"], legacy pendingInvites[email], or legacy invites[token].
 * @returns {Promise<{ email: string, role: string } | null>}
 */
async function claimInviteForUser(firebaseUser) {
  var ref = accessRef();
  var em = normalizeEmail(firebaseUser.email);
  if (!em) return null;
  var result = null;
  await runTransaction(db, function (transaction) {
    return transaction.get(ref).then(function (snap) {
      if (!snap.exists()) throw new Error("Access is not configured yet.");
      var data = snap.data();
      var users = data.users && typeof data.users === "object" ? data.users : {};
      if (users[firebaseUser.uid]) return;
      var now = new Date().toISOString();
      var pendingInvites = data.pendingInvites && typeof data.pendingInvites === "object" ? data.pendingInvites : {};
      var pending = pendingInvites[em];
      var invites = data.invites && typeof data.invites === "object" ? data.invites : {};
      function roleFromStored(r) {
        return r === "owner" ? "owner" : r === "admin" ? "admin" : "default";
      }
      var sk = emailSlotKey(em);
      var emailSlot = users[sk];
      if (emailSlot && emailSlot.pending) {
        var prSlot = roleFromStored(emailSlot.role);
        result = { email: em, role: prSlot };
        var userRowSlot = {
          email: em,
          displayName: firebaseUser.displayName || "",
          photoURL: firebaseUser.photoURL || "",
          role: prSlot,
          updatedAt: now,
        };
        transaction.update(
          ref,
          new FieldPath("users", firebaseUser.uid),
          userRowSlot,
          new FieldPath("users", sk),
          deleteField()
        );
        return;
      }
      if (pending) {
        var pr = roleFromStored(pending.role);
        result = { email: em, role: pr };
        var userRow = {
          email: em,
          displayName: firebaseUser.displayName || "",
          photoURL: firebaseUser.photoURL || "",
          role: pr,
          updatedAt: now,
        };
        // Must use FieldPath + varargs update — computed object keys break FieldPath (see Firebase docs).
        transaction.update(
          ref,
          new FieldPath("users", firebaseUser.uid),
          userRow,
          new FieldPath("pendingInvites", em),
          deleteField()
        );
        return;
      }
      var tokenToDelete = null;
      for (var tok in invites) {
        var inv = invites[tok];
        if (inv && normalizeEmail(inv.email) === em) {
          tokenToDelete = tok;
          break;
        }
      }
      if (!tokenToDelete) return;
      var inv2 = invites[tokenToDelete];
      var invitedRole = roleFromStored(inv2.role);
      result = { email: em, role: invitedRole };
      var userRow2 = {
        email: em,
        displayName: firebaseUser.displayName || "",
        photoURL: firebaseUser.photoURL || "",
        role: invitedRole,
        updatedAt: now,
      };
      transaction.update(
        ref,
        new FieldPath("users", firebaseUser.uid),
        userRow2,
        new FieldPath("invites", tokenToDelete),
        deleteField()
      );
    });
  });
  return result;
}

function kk(rid, dt) {
  return rid + "__" + dt;
}
function gK(d, rid, dt) {
  return d.dailyKPIs[kk(rid, dt)] || null;
}
function offCt(log, rid) {
  return (log[rid] || []).length;
}
function nSev(log, rid) {
  return SEV[Math.min(offCt(log, rid), SEV.length - 1)];
}
function mReps(d, mId, role) {
  return Object.entries(d.reps)
    .filter(function (p) {
      return (
        p[1].marketId === mId &&
        onRoster(p[1]) &&
        (!role || p[1].role === role)
      );
    })
    .sort(function (a, b) {
      return a[1].name.localeCompare(b[1].name);
    });
}
function allActive(d, role) {
  return Object.entries(d.reps).filter(function (p) {
    return (
      onRoster(p[1]) &&
      d.markets[p[1].marketId] &&
      (!role || p[1].role === role)
    );
  });
}
function scopedActiveReps(d, selM, role) {
  if (!selM) return [];
  if (isRegion(selM)) {
    return Object.entries(d.reps)
      .filter(function (p) {
        return onRoster(p[1]) && d.markets[p[1].marketId] && (!role || p[1].role === role);
      })
      .sort(function (a, b) {
        return a[1].name.localeCompare(b[1].name);
      });
  }
  return mReps(d, selM, role);
}
/** Reps tied to a market for historical rollup stats (includes terminated; excludes inactive non-terminated). */
function repsInMarketForStats(d, mId) {
  return Object.entries(d.reps)
    .filter(function (p) {
      var r = p[1];
      if (r.marketId !== mId || !d.markets[mId]) return false;
      if (r.terminated) return true;
      return r.active !== false;
    })
    .sort(function (a, b) {
      return a[1].name.localeCompare(b[1].name);
    });
}

function closerHours(kpi) {
  return (kpi.apptsRan || 0) + (kpi.cads || 0) * 0.5 + (kpi.convosHad || 0) / 10;
}

function getRangeStats(data, rid, dates) {
  var t = {
    setsSet: 0,
    apptsRan: 0,
    closes: 0,
    doorsKnocked: 0,
    convosHad: 0,
    apptsClosed: 0,
    cads: 0,
    selfGenSets: 0,
    selfGenCloses: 0,
    creditFailCount: 0,
    days: 0,
    hours: 0,
  };
  dates.forEach(function (d) {
    var k = gK(data, rid, d);
    if (k) {
      t.setsSet += k.setsSet || 0;
      t.apptsRan += k.apptsRan || 0;
      t.closes += k.closes || 0;
      t.doorsKnocked += k.doorsKnocked || 0;
      t.convosHad += k.convosHad || 0;
      t.apptsClosed += k.apptsClosed || 0;
      t.cads += k.cads || 0;
      t.selfGenSets += k.selfGenSets || 0;
      t.selfGenCloses += k.selfGenCloses || 0;
      var cf = k.creditFails;
      t.creditFailCount += Array.isArray(cf) ? cf.length : 0;
      t.hours += closerHours(k);
      t.days++;
    }
  });
  t.setsAvg = t.days > 0 ? Math.round((t.setsSet / t.days) * 10) / 10 : 0;
  t.hoursAvg = t.days > 0 ? Math.round((t.hours / t.days) * 10) / 10 : 0;
  t.closeRate = t.apptsRan > 0 ? pct(t.apptsClosed, t.apptsRan) : 0;
  t.cadRate = t.apptsRan + t.cads > 0 ? pct(t.cads, t.apptsRan + t.cads) : 0;
  t.d2c = pct(t.convosHad, t.doorsKnocked);
  t.c2s = pct(t.setsSet, t.convosHad);
  return t;
}

function getMonthSelfGens(data, rid, dt) {
  var ms = dt.slice(0, 8) + "01";
  var total = 0;
  var dim = new Date(new Date(dt).getFullYear(), new Date(dt).getMonth() + 1, 0).getDate();
  for (var i = 0; i < dim; i++) {
    var d = new Date(ms);
    d.setDate(d.getDate() + i);
    var ds = d.toISOString().split("T")[0];
    var k = gK(data, rid, ds);
    if (k) total += k.selfGenCloses || 0;
  }
  return total;
}

function monthDateRange(ymdAnchor) {
  var ms = ymdAnchor.slice(0, 8) + "01";
  var dim = new Date(new Date(ymdAnchor).getFullYear(), new Date(ymdAnchor).getMonth() + 1, 0).getDate();
  var out = [];
  for (var i = 0; i < dim; i++) {
    var d = new Date(ms);
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().split("T")[0]);
  }
  return out;
}

/** Knocker promotion “sales” credits for a calendar month: closes + 0.5 per credit fail (knocker row only). */
function promotionSalesCreditsForMonth(data, rid, monthAnchorYmd) {
  var dr = monthDateRange(monthAnchorYmd);
  var closes = 0,
    cf = 0;
  dr.forEach(function (d) {
    var k = gK(data, rid, d);
    if (!k) return;
    closes += k.closes || 0;
    cf += Array.isArray(k.creditFails) ? k.creditFails.length : 0;
  });
  return closes + 0.5 * cf;
}

function monthCreditFailsForMarket(data, mId, monthAnchorYmd) {
  var dr = monthDateRange(monthAnchorYmd);
  var total = 0;
  repsInMarketForStats(data, mId).forEach(function (p) {
    if (p[1].role === "closer") return;
    total += getRangeStats(data, p[0], dr).creditFailCount;
  });
  return total;
}

function normalizeCreditFails(arr, validCloserIds) {
  if (!Array.isArray(arr)) return [];
  var set = {};
  validCloserIds.forEach(function (id) {
    set[id] = true;
  });
  return arr
    .filter(function (x) {
      return x && x.closerId && set[x.closerId];
    })
    .map(function (x) {
      return { closerId: x.closerId };
    });
}

function kpiNumericKeys(rep) {
  return rep.role === "closer"
    ? ["apptsRan", "apptsClosed", "cads", "convosHad", "doorsKnocked", "selfGenSets", "selfGenCloses"]
    : ["doorsKnocked", "convosHad", "setsSet", "apptsRan", "closes"];
}

function existingKpiHasValues(k, rep) {
  if (!k) return false;
  var keys = kpiNumericKeys(rep);
  for (var i = 0; i < keys.length; i++) {
    if ((k[keys[i]] || 0) !== 0) return true;
  }
  if (rep.role !== "closer" && Array.isArray(k.creditFails) && k.creditFails.length > 0) return true;
  if (rep.role === "closer" && k.apptSources && String(k.apptSources).trim()) return true;
  if (k.notes && String(k.notes).trim()) return true;
  return false;
}
function dayEntryMissing(data, rid, rep, dt) {
  return !existingKpiHasValues(gK(data, rid, dt), rep);
}

function syncKnockerCreditFailsFromGrid(v, closerIdsForMarket) {
  var n = parseInt(v.creditFailCount, 10);
  if (isNaN(n) || n < 0) n = 0;
  var assign = v.creditFailAssignCloser || "";
  if (closerIdsForMarket.indexOf(assign) < 0) assign = closerIdsForMarket[0] || "";
  var arr = [];
  for (var i = 0; i < n; i++) arr.push({ closerId: assign });
  return normalizeCreditFails(arr, closerIdsForMarket);
}

function buildEntryFromForm(rid, rep, v, notes, entryDate, closerIdsForMarket, gridMode) {
  var entry = { repId: rid, date: entryDate, notes: notes || "" };
  kpiNumericKeys(rep).forEach(function (k) {
    entry[k] = parseInt(v[k], 10) || 0;
  });
  if (rep.role !== "closer") {
    entry.creditFails = gridMode
      ? syncKnockerCreditFailsFromGrid(v, closerIdsForMarket)
      : normalizeCreditFails(v.creditFails || [], closerIdsForMarket);
  } else {
    entry.apptSources = v.apptSources != null ? String(v.apptSources) : "";
  }
  return entry;
}

function entryFormDiffersFromSaved(data, rid, rep, v, notes, entryDate, closerIdsForMarket, gridMode) {
  var prev = gK(data, rid, entryDate);
  var next = buildEntryFromForm(rid, rep, v, notes, entryDate, closerIdsForMarket, gridMode);
  if (!prev) return false;
  var keys = kpiNumericKeys(rep);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if ((prev[k] || 0) !== (next[k] || 0)) return true;
  }
  if (String(prev.notes || "") !== String(next.notes || "")) return true;
  if (rep.role !== "closer") {
    var pa = JSON.stringify(prev.creditFails || []);
    var na = JSON.stringify(next.creditFails || []);
    if (pa !== na) return true;
  }
  if (rep.role === "closer" && String(prev.apptSources || "") !== String(next.apptSources || "")) return true;
  return false;
}

function kpiEntryNeedsSave(data, rid, rep, v, notes, entryDate, closerIdsForMarket, gridMode) {
  var prev = gK(data, rid, entryDate);
  var next = buildEntryFromForm(rid, rep, v, notes, entryDate, closerIdsForMarket, gridMode);
  if (!prev) {
    return existingKpiHasValues(next, rep);
  }
  return entryFormDiffersFromSaved(data, rid, rep, v, notes, entryDate, closerIdsForMarket, gridMode);
}

function truncateStr(s, max) {
  if (!s) return "";
  s = String(s);
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function describeKpiDelta(data, rep, prev, next) {
  var parts = [];
  var keys = kpiNumericKeys(rep);
  prev = prev || {};
  keys.forEach(function (key) {
    var pv = prev[key] != null ? Number(prev[key]) : 0;
    var nv = next[key] != null ? Number(next[key]) : 0;
    if (pv !== nv) {
      parts.push((KPI_FIELD_LABEL[key] || key) + " " + pv + "→" + nv);
    }
  });
  var pn = prev.notes ? String(prev.notes) : "";
  var nn = next.notes ? String(next.notes) : "";
  if (pn !== nn) {
    parts.push("Notes " + (pn ? '"' + truncateStr(pn, 60) + '"' : "—") + " → " + (nn ? '"' + truncateStr(nn, 60) + '"' : "—"));
  }
  if (rep.role !== "closer") {
    var pcf = Array.isArray(prev.creditFails) ? prev.creditFails : [];
    var ncf = Array.isArray(next.creditFails) ? next.creditFails : [];
    var ps = JSON.stringify(pcf.map(function (x) {
      return x && x.closerId ? x.closerId : "";
    }));
    var ns = JSON.stringify(ncf.map(function (x) {
      return x && x.closerId ? x.closerId : "";
    }));
    if (ps !== ns) {
      function fmtCf(arr) {
        return arr.map(function (x) {
          var id = x && x.closerId ? x.closerId : "";
          return data.reps[id] ? data.reps[id].name : id || "?";
        }).join(", ");
      }
      parts.push("Credit fails " + pcf.length + "→" + ncf.length + (ncf.length ? " (" + fmtCf(ncf) + ")" : ""));
    }
  } else {
    var pa = prev.apptSources != null ? String(prev.apptSources) : "";
    var na = next.apptSources != null ? String(next.apptSources) : "";
    if (pa !== na) parts.push("Appt sources " + truncateStr(pa, 40) + " → " + truncateStr(na, 40));
  }
  return parts.length ? parts.join(" · ") : "updated";
}

function countEntryDayActionFlags(data, rid, rep, dt) {
  var a =
    rep.role === "closer"
      ? analyzeCloser(data, rid, rep, [dt], dt)
      : analyzeKnocker(data, rid, rep, [dt], dt);
  return a.actionFlags.length;
}

function tenureLabel(rep) {
  if (!rep || !rep.startDate) return "";
  var d = daysBetween(rep.startDate, TODAY);
  if (d < 0) return "";
  if (d < 7) return "Day " + (d + 1);
  if (d < 30) return "Wk " + Math.ceil((d + 1) / 7);
  return Math.floor(d / 30) + "mo";
}

function analyzeKnocker(data, rid, rep, dates, endDate) {
  var s = getRangeStats(data, rid, dates);
  var flags = [];
  var lastDay = gK(data, rid, endDate);
  if (s.days === 0) {
    flags.push({ type: "action", label: "No data" });
  } else {
    if (lastDay && (lastDay.doorsKnocked || 0) < 120)
      flags.push({ type: "action", label: "Doors: " + (lastDay.doorsKnocked || 0) + "/120" });
    if (lastDay && (lastDay.convosHad || 0) < 50)
      flags.push({ type: "action", label: "Convos: " + (lastDay.convosHad || 0) + "/50" });
    if (s.setsAvg < 3) flags.push({ type: "action", label: "Sets avg " + s.setsAvg });
    else if (s.setsAvg < 4) flags.push({ type: "coaching", label: "Sets avg " + s.setsAvg });
    var w7 = getRangeStats(data, rid, getDatesInRange(daysAgo(6), endDate));
    if (w7.apptsRan < 5) flags.push({ type: "action", label: "Wk appts " + w7.apptsRan + "/5" });
    if (w7.closes < 2)
      flags.push({
        type: w7.closes === 0 ? "action" : "coaching",
        label: "Wk closes " + w7.closes + "/2",
      });
  }
  return {
    rid: rid,
    rep: rep,
    role: "knocker",
    stats: s,
    flags: flags,
    actionFlags: flags.filter(function (f) {
      return f.type === "action";
    }),
    coachFlags: flags.filter(function (f) {
      return f.type === "coaching";
    }),
  };
}

function analyzeCloser(data, rid, rep, dates, endDate) {
  var s = getRangeStats(data, rid, dates);
  var mSG = getMonthSelfGens(data, rid, endDate);
  var flags = [];
  if (s.days === 0) {
    flags.push({ type: "action", label: "No data" });
  } else {
    if (s.hoursAvg < 4.5) flags.push({ type: "action", label: "Avg hrs " + s.hoursAvg + "/5" });
    else if (s.hoursAvg < 5) flags.push({ type: "coaching", label: "Avg hrs " + s.hoursAvg + "/5" });
  }
  var dom = parseInt(endDate.slice(8, 10));
  if (dom > 20 && mSG < 1) flags.push({ type: "action", label: "0 self-gens this month" });
  else if (dom > 14 && mSG < 1) flags.push({ type: "coaching", label: "0 self-gens mid-month" });
  return {
    rid: rid,
    rep: rep,
    role: "closer",
    stats: s,
    monthSelfGens: mSG,
    flags: flags,
    actionFlags: flags.filter(function (f) {
      return f.type === "action";
    }),
    coachFlags: flags.filter(function (f) {
      return f.type === "coaching";
    }),
  };
}

function addDaysYmd(ymd, n) {
  var d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}
function weekStartMonday(ymd) {
  var d = new Date(ymd + "T12:00:00");
  var day = d.getDay();
  var diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}
function weekRangeForDate(ymd) {
  var ws = weekStartMonday(ymd);
  return { start: ws, end: addDaysYmd(ws, 6) };
}
/** Top knocker by setsSet and top closer by apptsClosed in the ISO week containing anchorDate (Mon–Sun). */
function weeklyMVP(data, selM, anchorDate) {
  var wr = weekRangeForDate(anchorDate);
  var dates = getDatesInRange(wr.start, wr.end);
  var bestK = { rid: null, name: "", sets: -1, market: "" };
  var bestC = { rid: null, name: "", closes: -1, market: "" };
  scopedActiveReps(data, selM).forEach(function (p) {
    var rid = p[0],
      rep = p[1];
    var s = getRangeStats(data, rid, dates);
    var mname = data.markets[rep.marketId] ? data.markets[rep.marketId].name : "";
    if (rep.role !== "closer" && s.setsSet > bestK.sets) {
      bestK = { rid: rid, name: rep.name, sets: s.setsSet, market: mname };
    }
    if (rep.role === "closer" && s.apptsClosed > bestC.closes) {
      bestC = { rid: rid, name: rep.name, closes: s.apptsClosed, market: mname };
    }
  });
  if (bestK.sets < 0) bestK.sets = 0;
  if (bestC.closes < 0) bestC.closes = 0;
  return { weekStart: wr.start, weekEnd: wr.end, knocker: bestK, closer: bestC };
}

function dayMeetsStandardKnocker(k) {
  if (!k) return false;
  return (k.doorsKnocked || 0) >= 120 && (k.convosHad || 0) >= 50;
}
function dayMeetsStandardCloser(k) {
  if (!k) return false;
  return closerHours(k) >= 5;
}
function streakCount(data, rid, rep, asOfDate) {
  var streak = 0;
  var d = new Date(asOfDate + "T12:00:00");
  for (var guard = 0; guard < 800; guard++) {
    var ds = d.toISOString().split("T")[0];
    var k = gK(data, rid, ds);
    if (!k || !existingKpiHasValues(k, rep)) break;
    var ok = rep.role === "closer" ? dayMeetsStandardCloser(k) : dayMeetsStandardKnocker(k);
    if (!ok) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function personalBestsForRep(data, rid, rep) {
  var o = {
    doors: 0,
    convos: 0,
    sets: 0,
    closes: 0,
    apptsClosed: 0,
  };
  Object.keys(data.dailyKPIs || {}).forEach(function (key) {
    if (key.indexOf(rid + "__") !== 0) return;
    var k = data.dailyKPIs[key];
    if (!k) return;
    if (rep.role === "closer") {
      o.doors = Math.max(o.doors, k.doorsKnocked || 0);
      o.convos = Math.max(o.convos, k.convosHad || 0);
      o.apptsClosed = Math.max(o.apptsClosed, k.apptsClosed || 0);
    } else {
      o.doors = Math.max(o.doors, k.doorsKnocked || 0);
      o.convos = Math.max(o.convos, k.convosHad || 0);
      o.sets = Math.max(o.sets, k.setsSet || 0);
      o.closes = Math.max(o.closes, k.closes || 0);
    }
  });
  return o;
}

function profileSeries(data, rid, rep, anchorYmd, numDays) {
  var out = [];
  for (var i = numDays - 1; i >= 0; i--) {
    var ds = addDaysYmd(anchorYmd, -i);
    var k = gK(data, rid, ds);
    if (rep.role === "closer") {
      out.push({
        date: ds.slice(5),
        appts: k ? k.apptsRan || 0 : 0,
        closed: k ? k.apptsClosed || 0 : 0,
        hours: k ? closerHours(k) : 0,
      });
    } else {
      out.push({
        date: ds.slice(5),
        doors: k ? k.doorsKnocked || 0 : 0,
        convos: k ? k.convosHad || 0 : 0,
        sets: k ? k.setsSet || 0 : 0,
        closes: k ? k.closes || 0 : 0,
      });
    }
  }
  return out;
}

function priorMonthAnchor(ymd) {
  var d = new Date(ymd + "T12:00:00");
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().split("T")[0];
}

function promotionKnockerProgress(data, rid, rep) {
  var cur = promotionSalesCreditsForMonth(data, rid, TODAY);
  var prevM = priorMonthAnchor(TODAY);
  var prev = promotionSalesCreditsForMonth(data, rid, prevM);
  var recruits = typeof rep.recruits === "number" ? rep.recruits : parseInt(rep.recruits, 10) || 0;
  var salesTrack = Math.min(cur / PROMO_SALES_NEED, 1) * 0.4 + Math.min(prev / PROMO_SALES_NEED, 1) * 0.4;
  var recTrack = Math.min(recruits / PROMO_RECRUITS_NEED, 1) * 0.2;
  var qualified = cur >= PROMO_SALES_NEED && prev >= PROMO_SALES_NEED && recruits >= PROMO_RECRUITS_NEED;
  return {
    cur: cur,
    prev: prev,
    recruits: recruits,
    qualified: qualified,
    barPct: Math.round((salesTrack + recTrack) * 100),
  };
}

function aggregateMarketChallenge(data, mId, dates) {
  var t = { doors: 0, sets: 0, closes: 0, convos: 0, appts: 0, reps: 0 };
  repsInMarketForStats(data, mId).forEach(function (p) {
    var st = getRangeStats(data, p[0], dates);
    if (st.days === 0) return;
    t.reps++;
    t.doors += st.doorsKnocked;
    t.convos += st.convosHad;
    t.sets += st.setsSet;
    t.closes += st.closes + st.apptsClosed;
    t.appts += st.apptsRan;
  });
  t.d2c = t.doors > 0 ? pct(t.convos, t.doors) : 0;
  t.c2s = t.convos > 0 ? pct(t.sets, t.convos) : 0;
  return t;
}

function dealValueForMarket(data, mId) {
  var m = data.markets[mId];
  var v = m && m.averageDealValue != null ? m.averageDealValue : data.settings && data.settings.averageDealValue;
  var n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function newHireWeekAvgs(data, rid, rep) {
  if (!rep.startDate) return null;
  var days = daysBetween(rep.startDate, TODAY);
  if (days > 30) return null;
  var w1 = getDatesInRange(rep.startDate, addDaysYmd(rep.startDate, 6));
  var w2 = getDatesInRange(addDaysYmd(rep.startDate, 7), addDaysYmd(rep.startDate, 13));
  var w3 = getDatesInRange(addDaysYmd(rep.startDate, 14), addDaysYmd(rep.startDate, 20));
  function avgFor(dr) {
    if (dr.length === 0) return { doors: 0, convos: 0, sets: 0, closes: 0 };
    var s = getRangeStats(data, rid, dr);
    var n = dr.length;
    var closeAvg =
      rep.role === "closer" ? (n ? Math.round((s.apptsClosed / n) * 10) / 10 : 0) : n ? Math.round((s.closes / n) * 10) / 10 : 0;
    return {
      doors: n ? Math.round(s.doorsKnocked / n) : 0,
      convos: n ? Math.round(s.convosHad / n) : 0,
      sets: n ? Math.round((s.setsSet / n) * 10) / 10 : 0,
      closes: closeAvg,
    };
  }
  return { w1: avgFor(w1), w2: avgFor(w2), w3: avgFor(w3) };
}

/** % of days in lookback where every on-roster rep had an entry (single market). */
function dataEntryConsistencyScore(data, mId, lookbackDays) {
  var roster = mReps(data, mId);
  if (roster.length === 0) return { pct: 100, complete: 0, total: 0 };
  var complete = 0,
    total = 0;
  for (var i = 0; i < lookbackDays; i++) {
    var ds = addDaysYmd(TODAY, -i);
    var ok = true;
    roster.forEach(function (p) {
      if (dayEntryMissing(data, p[0], p[1], ds)) ok = false;
    });
    total++;
    if (ok) complete++;
  }
  return { pct: total ? Math.round((complete / total) * 1000) / 10 : 0, complete: complete, total: total };
}

// ===== COMPONENTS =====
var sh = "0 1px 3px rgba(0,0,0,0.06)";
var shL = "0 4px 16px rgba(0,0,0,0.08)";

function Badge(p) {
  return (
    <span
      style={{
        display: "inline-flex",
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        color: p.color || "#666",
        background: p.bg || "#F2F2F7",
      }}
    >
      {p.text}
    </span>
  );
}
function Card(p) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 16,
        padding: 18,
        marginBottom: 12,
        boxShadow: sh,
        border: p.bc ? "2px solid " + p.bc : "1px solid rgba(0,0,0,0.04)",
        ...(p.style || {}),
      }}
    >
      {p.children}
    </div>
  );
}
function StatCard(p) {
  var c =
    {
      red: { bg: "#FFF0EF", t: "#FF3B30", b: "#FFD4D1" },
      amber: { bg: "#FFF8EE", t: "#FF9500", b: "#FFE4B8" },
      green: { bg: "#F0FFF4", t: "#34C759", b: "#C6F6D5" },
      gray: { bg: "#F9F9F9", t: "#1C1C1E", b: "#E5E5EA" },
    }[p.v || "gray"];
  return (
    <div
      style={{
        background: c.bg,
        borderRadius: 14,
        padding: "14px 10px",
        flex: "1 1 80px",
        textAlign: "center",
        border: "1px solid " + c.b,
        minWidth: 75,
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700, color: c.t, lineHeight: 1 }}>{p.value}</div>
      <div
        style={{
          fontSize: 9,
          color: "#8E8E93",
          marginTop: 5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {p.label}
      </div>
    </div>
  );
}
function Btn(p) {
  var s =
    {
      primary: { background: "#1C1C1E", color: "#fff" },
      danger: { background: "#FF3B30", color: "#fff" },
      secondary: { background: "#F2F2F7", color: "#1C1C1E" },
      ghost: { background: "transparent", color: "#8E8E93" },
    }[p.v || "primary"];
  return (
    <button
      onClick={p.onClick}
      disabled={p.disabled}
      style={{
        fontSize: 13,
        fontWeight: 600,
        padding: "8px 18px",
        borderRadius: 10,
        border: "none",
        cursor: p.disabled ? "not-allowed" : "pointer",
        opacity: p.disabled ? 0.4 : 1,
        ...s,
        ...(p.style || {}),
      }}
    >
      {p.children}
    </button>
  );
}
function NI(p) {
  return (
    <input
      type="number"
      min="0"
      value={p.value}
      onChange={p.onChange}
      style={{
        width: p.w || 58,
        textAlign: "center",
        fontSize: 15,
        fontWeight: 600,
        padding: "8px 4px",
        border: "1.5px solid #E5E5EA",
        borderRadius: 10,
        background: "#FAFAFA",
        outline: "none",
        ...(p.style || {}),
      }}
    />
  );
}
function SL(p) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: p.color || "#8E8E93",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 10,
        marginTop: p.mt || 0,
      }}
    >
      {p.children}
    </div>
  );
}
function RoleBadge(p) {
  var isC = p.role === "closer";
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 6,
        background: isC ? "#1C1C1E" : "#F2F2F7",
        color: isC ? "#fff" : "#8E8E93",
        textTransform: "uppercase",
      }}
    >
      {isC ? "Closer" : "Knocker"}
    </span>
  );
}

function Podium(p) {
  var items = p.items || [];
  if (items.length < 1) return null;
  var medals = [
    { e: "🥇", bg: "linear-gradient(135deg,#FFF9E6,#FFF3CC)", b: "#FFD700" },
    { e: "🥈", bg: "linear-gradient(135deg,#F8F8F8,#ECECEC)", b: "#C0C0C0" },
    { e: "🥉", bg: "linear-gradient(135deg,#FFF5EB,#FFE8D6)", b: "#CD7F32" },
  ];
  function PB(item, rank, h) {
    if (!item) return <div style={{ flex: 1 }} />;
    var m = medals[rank];
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
        <div style={{ fontSize: 30, marginBottom: 2 }}>{m.e}</div>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#1C1C1E", textAlign: "center" }}>{item.name}</div>
        <div style={{ fontSize: 10, color: "#8E8E93", marginBottom: 6 }}>{item.sub}</div>
        <div
          style={{
            width: "100%",
            background: m.bg,
            border: "2px solid " + m.b,
            borderRadius: "14px 14px 0 0",
            height: h,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px 6px",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: "#1C1C1E" }}>{item.val}</div>
          <div style={{ fontSize: 9, color: "#8E8E93", fontWeight: 600, textTransform: "uppercase" }}>{item.metric}</div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-end", maxWidth: 440, margin: "0 auto 16px", padding: "0 8px" }}>
      {PB(items[1] || null, 1, 100)}
      {PB(items[0], 0, 140)}
      {PB(items[2] || null, 2, 80)}
    </div>
  );
}

// ===== DATE RANGE PICKER =====
function DateRangeBar(p) {
  var presets = [
    { label: "Today", s: TODAY, e: TODAY },
    { label: "7 Days", s: daysAgo(6), e: TODAY },
    { label: "14 Days", s: daysAgo(13), e: TODAY },
    { label: "30 Days", s: daysAgo(29), e: TODAY },
    { label: "This Month", s: monthStart(), e: TODAY },
  ];
  var activePreset = presets.find(function (pr) {
    return pr.s === p.startDate && pr.e === p.endDate;
  });
  var numDays = getDatesInRange(p.startDate, p.endDate).length;

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 14,
        padding: "12px 16px",
        marginBottom: 14,
        boxShadow: sh,
        border: "1px solid rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
        {presets.map(function (pr) {
          var active = activePreset && activePreset.label === pr.label;
          return (
            <button
              key={pr.label}
              onClick={function () {
                p.onChange(pr.s, pr.e);
              }}
              style={{
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                padding: "6px 14px",
                borderRadius: 8,
                border: "none",
                background: active ? "#1C1C1E" : "#F2F2F7",
                color: active ? "#fff" : "#8E8E93",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {pr.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="date"
          value={p.startDate}
          onChange={function (e) {
            p.onChange(e.target.value, p.endDate < e.target.value ? e.target.value : p.endDate);
          }}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: "6px 10px",
            border: "1px solid #E5E5EA",
            borderRadius: 8,
            background: "#FAFAFA",
          }}
        />
        <span style={{ fontSize: 12, color: "#C7C7CC" }}>to</span>
        <input
          type="date"
          value={p.endDate}
          onChange={function (e) {
            p.onChange(p.startDate > e.target.value ? e.target.value : p.startDate, e.target.value);
          }}
          style={{
            fontSize: 13,
            fontWeight: 600,
            padding: "6px 10px",
            border: "1px solid #E5E5EA",
            borderRadius: 8,
            background: "#FAFAFA",
          }}
        />
        <span style={{ fontSize: 11, color: "#8E8E93", fontWeight: 600 }}>
          {numDays + (numDays === 1 ? " day" : " days")}
        </span>
      </div>
    </div>
  );
}

// ===== MAIN =====
export default function App() {
  var _d = useState(DD),
    data = _d[0],
    setData = _d[1];
  var _lo = useState(false),
    loaded = _lo[0],
    setLoaded = _lo[1];
  var _au = useState(null),
    user = _au[0],
    setUser = _au[1];
  var _ar = useState(false),
    authReady = _ar[0],
    setAuthReady = _ar[1];
  var _t = useState("dashboard"),
    tab = _t[0],
    setTab = _t[1];
  var _m = useState(REGION_KEY),
    selM = _m[0],
    setSelM = _m[1];
  var _nm = useState(""),
    newMkt = _nm[0],
    setNewMkt = _nm[1];
  var _nr = useState(""),
    newRep = _nr[0],
    setNewRep = _nr[1];
  var _nrd = useState(""),
    newRepDate = _nrd[0],
    setNewRepDate = _nrd[1];
  var _nrr = useState("knocker"),
    newRepRole = _nrr[0],
    setNewRepRole = _nrr[1];
  var _sd = useState(TODAY),
    startDate = _sd[0],
    setStartDate = _sd[1];
  var _ed = useState(TODAY),
    endDate = _ed[0],
    setEndDate = _ed[1];
  var _entryDate = useState(TODAY),
    entryDate = _entryDate[0],
    setEntryDate = _entryDate[1];
  var _ki = useState({}),
    kpiIn = _ki[0],
    setKpiIn = _ki[1];
  var _kn = useState({}),
    kpiNotes = _kn[0],
    setKpiNotes = _kn[1];
  var _ln = useState(""),
    logNote = _ln[0],
    setLogNote = _ln[1];
  var _lr = useState(null),
    logRep = _lr[0],
    setLogRep = _lr[1];
  var _sl = useState(false),
    showLog = _sl[0],
    setShowLog = _sl[1];
  var _so = useState(null),
    logSevO = _so[0],
    setLogSevO = _so[1];
  var _ex = useState({}),
    expanded = _ex[0],
    setExpanded = _ex[1];
  var _to = useState(""),
    toast = _to[0],
    setToast = _to[1];
  var _lb = useState("doors"),
    lbSort = _lb[0],
    setLbSort = _lb[1];
  var _cs = useState("closes"),
    clSort = _cs[0],
    setClSort = _cs[1];
  var _ev = useState("cards"),
    enterViewMode = _ev[0],
    setEnterViewMode = _ev[1];
  var _st = useState(false),
    showTerminatedManage = _st[0],
    setShowTerminatedManage = _st[1];
  var _pr = useState(null),
    profileRepId = _pr[0],
    setProfileRepId = _pr[1];
  var _chA = useState(null),
    chMktA = _chA[0],
    setChMktA = _chA[1];
  var _chB = useState(null),
    chMktB = _chB[0],
    setChMktB = _chB[1];
  var _evl = useState(false),
    eventLogOpen = _evl[0],
    setEventLogOpen = _evl[1];
  var _alr = useState("all"),
    activityLogRange = _alr[0],
    setActivityLogRange = _alr[1];
  var _ac = useState(null),
    access = _ac[0],
    setAccess = _ac[1];
  var _acr = useState(false),
    accessReady = _acr[0],
    setAccessReady = _acr[1];
  var _bs = useState(false),
    accessBootstrapping = _bs[0],
    setAccessBootstrapping = _bs[1];
  var _pf = useState(false),
    profileMenuOpen = _pf[0],
    setProfileMenuOpen = _pf[1];
  var _mu = useState(false),
    manageUsersOpen = _mu[0],
    setManageUsersOpen = _mu[1];
  var _ie = useState(""),
    inviteEmailIn = _ie[0],
    setInviteEmailIn = _ie[1];
  var _ir = useState("default"),
    inviteRoleIn = _ir[0],
    setInviteRoleIn = _ir[1];
  var _cf = useState(false),
    claimFailed = _cf[0],
    setClaimFailed = _cf[1];
  var _an = useState(false),
    accessNotifOpen = _an[0],
    setAccessNotifOpen = _an[1];
  var _op = useState(false),
    officePickerOpen = _op[0],
    setOfficePickerOpen = _op[1];
  var profileMenuRef = useRef(null);
  var accessNotifRef = useRef(null);
  var officePickerRef = useRef(null);
  var claimStartedRef = useRef(false);
  var swipeTabTouchRef = useRef({ x: 0, y: 0, ignore: false, axisLock: null, tracking: false });

  var onSwipeTabTouchStart = useCallback(function (e) {
    var el = e.target;
    if (el && el.closest && (el.closest("input, textarea, select") || el.closest("[data-no-swipe-tab]"))) {
      swipeTabTouchRef.current.ignore = true;
      swipeTabTouchRef.current.tracking = false;
      return;
    }
    swipeTabTouchRef.current.ignore = false;
    swipeTabTouchRef.current.axisLock = null;
    if (!e.touches || e.touches.length === 0) return;
    swipeTabTouchRef.current.x = e.touches[0].clientX;
    swipeTabTouchRef.current.y = e.touches[0].clientY;
    swipeTabTouchRef.current.tracking = true;
  }, []);

  var onSwipeTabTouchMove = useCallback(function (e) {
    if (!swipeTabTouchRef.current.tracking) return;
    if (swipeTabTouchRef.current.ignore) return;
    if (swipeTabTouchRef.current.axisLock) return;
    if (!e.touches || e.touches.length === 0) return;
    var x = e.touches[0].clientX;
    var y = e.touches[0].clientY;
    var dx = x - swipeTabTouchRef.current.x;
    var dy = y - swipeTabTouchRef.current.y;
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
    if (Math.abs(dx) > Math.abs(dy)) swipeTabTouchRef.current.axisLock = "h";
    else swipeTabTouchRef.current.axisLock = "v";
  }, []);

  var onSwipeTabTouchEnd = useCallback(
    function (e) {
      if (!swipeTabTouchRef.current.tracking) return;
      swipeTabTouchRef.current.tracking = false;
      if (swipeTabTouchRef.current.ignore) {
        swipeTabTouchRef.current.ignore = false;
        swipeTabTouchRef.current.axisLock = null;
        return;
      }
      var start = swipeTabTouchRef.current;
      if (!e.changedTouches || e.changedTouches.length === 0) {
        swipeTabTouchRef.current.axisLock = null;
        return;
      }
      var endX = e.changedTouches[0].clientX;
      var endY = e.changedTouches[0].clientY;
      var dx = endX - start.x;
      var dy = endY - start.y;
      var al = swipeTabTouchRef.current.axisLock;
      swipeTabTouchRef.current.axisLock = null;
      if (al === "v") return;
      var minPx = 44;
      if (al === "h") {
        if (Math.abs(dx) < minPx) return;
      } else {
        if (Math.abs(dx) < minPx || Math.abs(dx) < Math.abs(dy)) return;
      }
      var keys = MAIN_TABS.map(function (x) {
        return x.k;
      });
      var idx = keys.indexOf(tab);
      if (idx < 0) return;
      if (dx < 0 && idx < keys.length - 1) setTab(keys[idx + 1]);
      else if (dx > 0 && idx > 0) setTab(keys[idx - 1]);
    },
    [tab, setTab]
  );

  var onSwipeTabTouchCancel = useCallback(function () {
    swipeTabTouchRef.current.tracking = false;
    swipeTabTouchRef.current.ignore = false;
    swipeTabTouchRef.current.axisLock = null;
  }, []);

  useEffect(function () {
    var unsub = onAuthStateChanged(auth, function (u) {
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  useEffect(function () {
    // Complete redirect sign-in flows (Safari / blocked popups fallback).
    getRedirectResult(auth).catch(function (e) {
      flash(authErrorMessage(e));
    });
  }, []);

  useEffect(function () {
    if (!authReady || !user) {
      setAccess(null);
      setAccessReady(false);
      setClaimFailed(false);
      claimStartedRef.current = false;
      return;
    }
    var aref = accessRef();
    var unsub = onSnapshot(
      aref,
      function (snap) {
        var d = snap.exists() ? snap.data() : {};
        var merged = {
          ...ACCESS_DD,
          ...d,
          users: d.users && typeof d.users === "object" ? d.users : {},
          invites: d.invites && typeof d.invites === "object" ? d.invites : {},
          pendingInvites: d.pendingInvites && typeof d.pendingInvites === "object" ? d.pendingInvites : {},
          accessRequests: d.accessRequests && typeof d.accessRequests === "object" ? d.accessRequests : {},
        };
        setAccess(merged);
        var nUsers = Object.keys(merged.users || {}).length;
        setAccessBootstrapping(nUsers === 0);
        setAccessReady(true);
      },
      function () {
        setAccessReady(true);
      }
    );
    return unsub;
  }, [authReady, user]);

  useEffect(
    function () {
      if (!authReady || !user) {
        setLoaded(false);
        return;
      }
      if (!accessReady || !access || !access.users || !access.users[user.uid]) {
        setLoaded(false);
        return;
      }

      var ref = doc(db, "app", "state");
      var unsub = onSnapshot(
        ref,
        function (snap) {
          var d = snap.exists() ? snap.data() : DD;
          var merged = { ...DD, ...d };
          setData(merged);
          if (selM == null) setSelM(REGION_KEY);
          setLoaded(true);
        },
        function () {
          setLoaded(true);
        }
      );

      return unsub;
    },
    [authReady, user, accessReady, access, selM]
  );

  var persist = useCallback(function (n, eventPayload) {
    var toSave = n;
    if (eventPayload != null && eventPayload !== "") {
      var prevLog = Array.isArray(n.eventLog) ? n.eventLog.slice() : [];
      var actor = user && user.email ? user.email : user && user.uid ? user.uid : null;
      var tsBatch = new Date().toISOString();
      function pushOne(message, marketId) {
        prevLog.unshift({
          ts: tsBatch,
          actor: actor,
          message: String(message),
          marketId: marketId != null && marketId !== "" ? marketId : null,
        });
      }
      if (typeof eventPayload === "string") {
        pushOne(eventPayload, null);
      } else if (eventPayload.entries && Array.isArray(eventPayload.entries)) {
        for (var j = eventPayload.entries.length - 1; j >= 0; j--) {
          var ev = eventPayload.entries[j];
          pushOne(ev.message, ev.marketId);
        }
      } else if (eventPayload.message != null) {
        pushOne(eventPayload.message, eventPayload.marketId);
      }
      if (prevLog.length > EVENT_LOG_MAX) prevLog = prevLog.slice(0, EVENT_LOG_MAX);
      toSave = { ...n, eventLog: prevLog };
    }
    setData(toSave);
    save(toSave);
  }, [user]);
  function doSignIn() {
    var provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return signInWithPopup(auth, provider).catch(function (e) {
      var code = e && e.code ? String(e.code) : "";
      var shouldRedirect =
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment";
      flash(authErrorMessage(e));
      if (shouldRedirect) return signInWithRedirect(auth, provider);
      throw e;
    });
  }
  /** Clears Firebase session, then opens Google sign-in so the user can pick another account. */
  function trySwitchGoogleAccount() {
    return signOut(auth)
      .catch(function () {})
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(resolve, 150);
        });
      })
      .then(function () {
        return doSignIn();
      });
  }
  function doSignOut() {
    return signOut(auth);
  }
  function flash(m, ms) {
    setToast(m);
    setTimeout(function () {
      setToast("");
    }, ms != null ? ms : 2000);
  }

  function submitAccessRequest() {
    if (!user || !access) return;
    var email = normalizeEmail(user.email);
    if (!email) {
      flash("Sign in with a Google account that has an email address.");
      return;
    }
    var reqs = access.accessRequests && typeof access.accessRequests === "object" ? access.accessRequests : {};
    var existingId = null;
    Object.keys(reqs).forEach(function (id) {
      var r = reqs[id];
      if (!r) return;
      if (r.uid === user.uid || normalizeEmail(r.email) === email) existingId = id;
    });
    if (existingId) {
      flash("You already have a pending access request.");
      return;
    }
    var id =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : gid() + gid();
    var now = new Date().toISOString();
    setDoc(
      accessRef(),
      {
        accessRequests: {
          [id]: {
            email: email,
            displayName: user.displayName || "",
            photoURL: user.photoURL || "",
            uid: user.uid,
            requestedAt: now,
          },
        },
      },
      { merge: true }
    )
      .then(function () {
        flash("Access requested. An owner or admin will review it.");
        appendEventLogEntry("Access requested — " + email, email).catch(function () {});
      })
      .catch(function (e) {
        flash(e.message || "Could not submit request.");
      });
  }

  useEffect(function () {
    if (!user || !accessReady || !access) return;
    var umap = access.users || {};
    if (Object.keys(umap).length > 0) return;
    bootstrapOwnerIfNeeded(user).catch(function (e) {
      flash(e.message || "Could not set up access.");
      setAccessBootstrapping(false);
    });
  }, [user, accessReady, access]);

  useEffect(function () {
    if (!user || !access || !access.users || !access.users[user.uid]) return;
    var row = access.users[user.uid];
    var nu = user.displayName || "";
    var pu = user.photoURL || "";
    var em = normalizeEmail(user.email);
    if (row.displayName === nu && row.photoURL === pu && row.email === em) return;
    setDoc(
      accessRef(),
      {
        users: {
          [user.uid]: {
            ...row,
            displayName: nu,
            photoURL: pu,
            email: em,
            updatedAt: new Date().toISOString(),
          },
        },
      },
      { merge: true }
    ).catch(function () {});
  }, [user, access]);

  useEffect(
    function () {
      if (!user || !accessReady || !access) return;
      var em = normalizeEmail(user.email);
      if (em && hasPendingForEmail(access, em)) setClaimFailed(false);
    },
    [user, accessReady, access]
  );

  useEffect(
    function () {
      if (!user || !accessReady || !access) return;
      if (access.users && access.users[user.uid]) {
        var params = new URLSearchParams(window.location.search);
        if (params.get("invite")) {
          params.delete("invite");
          var q1 = params.toString();
          window.history.replaceState({}, "", window.location.pathname + (q1 ? "?" + q1 : "") + window.location.hash);
        }
        return;
      }
      var em = normalizeEmail(user.email);
      if (!em || !hasPendingForEmail(access, em)) return;
      if (claimStartedRef.current) return;
      claimStartedRef.current = true;
      claimInviteForUser(user)
        .then(function (info) {
          if (info && user.email) {
            flash("You're in.");
            appendEventLogEntry("Access granted — " + info.email + " (" + roleLabel(info.role) + ")", user.email).catch(function () {});
          }
          var params2 = new URLSearchParams(window.location.search);
          if (params2.get("invite")) {
            params2.delete("invite");
            var q2 = params2.toString();
            window.history.replaceState({}, "", window.location.pathname + (q2 ? "?" + q2 : "") + window.location.hash);
          }
          if (!info) claimStartedRef.current = false;
        })
        .catch(function (e) {
          flash(e.message || "Could not grant access.");
          setClaimFailed(true);
          claimStartedRef.current = false;
        });
    },
    [user, accessReady, access]
  );

  useEffect(
    function () {
      if (!profileMenuOpen) return;
      function onDown(e) {
        if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
          setProfileMenuOpen(false);
        }
      }
      document.addEventListener("mousedown", onDown);
      return function () {
        document.removeEventListener("mousedown", onDown);
      };
    },
    [profileMenuOpen]
  );

  useEffect(
    function () {
      if (!accessNotifOpen) return;
      function onDown(e) {
        if (accessNotifRef.current && !accessNotifRef.current.contains(e.target)) {
          setAccessNotifOpen(false);
        }
      }
      document.addEventListener("mousedown", onDown);
      return function () {
        document.removeEventListener("mousedown", onDown);
      };
    },
    [accessNotifOpen]
  );

  useEffect(
    function () {
      if (!officePickerOpen) return;
      function onDown(e) {
        if (officePickerRef.current && !officePickerRef.current.contains(e.target)) {
          setOfficePickerOpen(false);
        }
      }
      function onKey(e) {
        if (e.key === "Escape") setOfficePickerOpen(false);
      }
      document.addEventListener("mousedown", onDown);
      document.addEventListener("keydown", onKey);
      return function () {
        document.removeEventListener("mousedown", onDown);
        document.removeEventListener("keydown", onKey);
      };
    },
    [officePickerOpen]
  );

  function setRange(s, e) {
    setStartDate(s);
    setEndDate(e);
  }

  function addMarket() {
    if (!newMkt.trim()) return;
    var id = gid();
    var label = newMkt.trim();
    persist({ ...data, markets: { ...data.markets, [id]: { name: label } } }, { message: "Market added: " + label, marketId: id });
    setSelM(id);
    setNewMkt("");
  }
  function delMarket(id) {
    if (!confirm("Delete?")) return;
    var mname = data.markets[id] && data.markets[id].name ? data.markets[id].name : id;
    var n = JSON.parse(JSON.stringify(data));
    delete n.markets[id];
    Object.keys(n.reps).forEach(function (r) {
      if (n.reps[r].marketId === id) delete n.reps[r];
    });
    persist(n, { message: "Market deleted: " + mname + " (reps removed)", marketId: id });
    var rem = Object.keys(n.markets);
    setSelM(rem.length ? rem[0] : REGION_KEY);
  }
  function addRep() {
    if (!newRep.trim() || !selM || isRegion(selM)) return;
    var mlabel = data.markets[selM] ? data.markets[selM].name : "market";
    var rname = newRep.trim();
    persist(
      {
        ...data,
        reps: {
          ...data.reps,
          [gid()]: {
            name: rname,
            marketId: selM,
            active: true,
            startDate: newRepDate || TODAY,
            role: newRepRole,
            recruits: 0,
          },
        },
      },
      { message: "Rep added: " + rname + " (" + newRepRole + ") — " + mlabel, marketId: selM }
    );
    setNewRep("");
    setNewRepDate("");
  }
  function togRep(rid) {
    var rep = data.reps[rid];
    if (!rep) return;
    var wasOn = rep.active !== false;
    persist(
      { ...data, reps: { ...data.reps, [rid]: { ...data.reps[rid], active: !data.reps[rid].active } } },
      { message: "Rep " + (wasOn ? "deactivated" : "reactivated") + ": " + rep.name, marketId: rep.marketId }
    );
  }
  function setRepRole(rid, role) {
    var rep = data.reps[rid];
    if (!rep) return;
    persist({ ...data, reps: { ...data.reps, [rid]: { ...data.reps[rid], role: role } } }, { message: "Rep role set to " + role + ": " + rep.name, marketId: rep.marketId });
  }
  function terminateRep(rid) {
    if (!confirm("Terminate this rep? They disappear from boards and entry; past KPIs stay for history.")) return;
    var rep = data.reps[rid];
    var rname = rep ? rep.name : rid;
    persist(
      {
        ...data,
        reps: {
          ...data.reps,
          [rid]: { ...data.reps[rid], terminated: true, terminatedAt: TODAY },
        },
      },
      { message: "Rep terminated: " + rname, marketId: rep ? rep.marketId : null }
    );
  }
  function setRepRecruits(rid, n) {
    var num = parseInt(n, 10);
    if (isNaN(num) || num < 0) num = 0;
    var rep = data.reps[rid];
    var rname = rep ? rep.name : rid;
    persist({ ...data, reps: { ...data.reps, [rid]: { ...data.reps[rid], recruits: num } } }, { message: "Recruits set to " + num + " for " + rname, marketId: rep.marketId });
  }
  function setMarketDealValue(mId, val) {
    var num = parseFloat(String(val));
    if (isNaN(num) || num < 0) num = 0;
    var mname = data.markets[mId] && data.markets[mId].name ? data.markets[mId].name : mId;
    persist(
      {
        ...data,
        markets: { ...data.markets, [mId]: { ...data.markets[mId], averageDealValue: num } },
      },
      { message: "Avg deal ($) for " + mname + ": " + num, marketId: mId }
    );
  }
  function setGlobalDealValue(val) {
    var num = parseFloat(String(val));
    if (isNaN(num) || num < 0) num = 0;
    persist({ ...data, settings: { ...(data.settings || {}), averageDealValue: num } }, { message: "Company average deal ($): " + num, marketId: null });
  }

  function initKI(mId, dt) {
    var reps = mReps(data, mId);
    var inp = {};
    var notes = {};
    reps.forEach(function (p) {
      var id = p[0],
        rep = p[1],
        ex = gK(data, id, dt);
      if (rep.role === "closer") {
        inp[id] = ex
          ? {
              apptsRan: ex.apptsRan || "",
              apptsClosed: ex.apptsClosed || "",
              cads: ex.cads || "",
              convosHad: ex.convosHad || "",
              doorsKnocked: ex.doorsKnocked || "",
              selfGenSets: ex.selfGenSets || "",
              selfGenCloses: ex.selfGenCloses || "",
              apptSources: ex.apptSources != null ? String(ex.apptSources) : "",
            }
          : { apptsRan: "", apptsClosed: "", cads: "", convosHad: "", doorsKnocked: "", selfGenSets: "", selfGenCloses: "", apptSources: "" };
      } else {
        var cf = [];
        if (ex && Array.isArray(ex.creditFails)) {
          cf = ex.creditFails.map(function (x) {
            return { closerId: x.closerId || "" };
          });
        }
        var closers = mReps(data, rep.marketId, "closer");
        var defAssign = (cf[0] && cf[0].closerId) || (closers[0] ? closers[0][0] : "") || "";
        inp[id] = ex
          ? {
              doorsKnocked: ex.doorsKnocked,
              convosHad: ex.convosHad || "",
              setsSet: ex.setsSet,
              apptsRan: ex.apptsRan,
              closes: ex.closes,
              creditFails: cf,
              creditFailCount: String(cf.length),
              creditFailAssignCloser: defAssign,
            }
          : {
              doorsKnocked: "",
              convosHad: "",
              setsSet: "",
              apptsRan: "",
              closes: "",
              creditFails: [],
              creditFailCount: "0",
              creditFailAssignCloser: closers[0] ? closers[0][0] : "",
            };
      }
      notes[id] = ex && ex.notes ? ex.notes : "";
    });
    setKpiIn(inp);
    setKpiNotes(notes);
  }
  useEffect(
    function () {
      if (selM && !isRegion(selM) && loaded) initKI(selM, entryDate);
    },
    [selM, entryDate, loaded, JSON.stringify(data.reps)]
  );

  function saveKPIs() {
    if (!selM || isRegion(selM)) return;
    var closerLists = {};
    function closerIdsForRep(rid) {
      var mid = data.reps[rid] && data.reps[rid].marketId;
      if (!mid) return [];
      if (!closerLists[mid]) closerLists[mid] = mReps(data, mid, "closer").map(function (x) {
        return x[0];
      });
      return closerLists[mid];
    }
    var gridMode = enterViewMode === "grid";
    var needOverwrite = [];
    var toWrite = [];
    Object.entries(kpiIn).forEach(function (p) {
      var rid = p[0],
        v = p[1],
        rep = data.reps[rid];
      if (!rep) return;
      if (!kpiEntryNeedsSave(data, rid, rep, v, kpiNotes[rid], entryDate, closerIdsForRep(rid), gridMode)) return;
      if (
        existingKpiHasValues(gK(data, rid, entryDate), rep) &&
        entryFormDiffersFromSaved(data, rid, rep, v, kpiNotes[rid], entryDate, closerIdsForRep(rid), gridMode)
      ) {
        needOverwrite.push(rep.name);
      }
      toWrite.push({ rid: rid, v: v, rep: rep });
    });
    if (toWrite.length === 0) {
      flash("No changes to save.");
      return;
    }
    if (needOverwrite.length && !confirm("Data already exists for " + needOverwrite.length + " rep(s) on " + entryDate + " — overwrite?")) return;

    var n = { ...data, dailyKPIs: { ...data.dailyKPIs } };
    var saved = 0,
      flagged = 0;
    var logEntries = [];
    var mk = data.markets[selM] && data.markets[selM].name ? data.markets[selM].name : selM;
    toWrite.forEach(function (item) {
      var rid = item.rid,
        rep = item.rep,
        v = item.v;
      var prev = gK(data, rid, entryDate);
      var entry = buildEntryFromForm(rid, rep, v, kpiNotes[rid], entryDate, closerIdsForRep(rid), gridMode);
      n.dailyKPIs[kk(rid, entryDate)] = entry;
      saved++;
      if (countEntryDayActionFlags(n, rid, rep, entryDate) > 0) flagged++;
      var delta = describeKpiDelta(data, rep, prev, entry);
      var roleLab = rep.role === "closer" ? "Closer" : "Knocker";
      logEntries.push({
        message: "KPI · " + mk + " · " + entryDate + " · " + rep.name + " (" + roleLab + ") — " + delta,
        marketId: selM,
      });
    });
    persist(n, { entries: logEntries });
    flash(saved + " rep" + (saved === 1 ? "" : "s") + " saved for " + entryDate + ". " + flagged + " flagged below standard.", 4500);
  }
  function openLog(rid) {
    setLogRep(rid);
    setLogNote("");
    setLogSevO(null);
    setShowLog(true);
  }
  function saveLog() {
    if (!logRep || !logNote.trim()) return;
    var sev = logSevO || nSev(data.accountabilityLog, logRep).key;
    var rname = data.reps[logRep] ? data.reps[logRep].name : logRep;
    var notePrev = logNote.trim().length > 80 ? logNote.trim().slice(0, 80) + "…" : logNote.trim();
    var logMkt = data.reps[logRep] && data.reps[logRep].marketId ? data.reps[logRep].marketId : null;
    persist(
      {
        ...data,
        accountabilityLog: {
          ...data.accountabilityLog,
          [logRep]: [...(data.accountabilityLog[logRep] || []), { date: TODAY, note: logNote.trim(), severity: sev, id: gid() }],
        },
      },
      { message: "Accountability logged (" + sev + ") — " + rname + ": " + notePrev, marketId: logMkt }
    );
    setShowLog(false);
    flash("Logged");
  }
  function delLogE(rid, eid) {
    var rname = data.reps[rid] ? data.reps[rid].name : rid;
    var logMkt = data.reps[rid] && data.reps[rid].marketId ? data.reps[rid].marketId : null;
    persist(
      {
        ...data,
        accountabilityLog: {
          ...data.accountabilityLog,
          [rid]: (data.accountabilityLog[rid] || []).filter(function (e) {
            return e.id !== eid;
          }),
        },
      },
      { message: "Accountability entry removed — " + rname, marketId: logMkt }
    );
  }

  if (!authReady)
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#8E8E93" }}>
        Loading...
      </div>
    );

  if (!user)
    return (
      <div style={{ minHeight: "100vh", background: "#F2F2F7", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 520 }}>
          <div style={{ textAlign: "center", fontWeight: 900, fontSize: 26, marginBottom: 8, color: "#1C1C1E" }}>KPI Tracker</div>
          <div style={{ textAlign: "center", color: "#8E8E93", fontWeight: 600, marginBottom: 18 }}>
            Sign in with Google to continue.
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Btn
              onClick={function () {
                doSignIn().catch(function () {});
              }}
              style={{ padding: "12px 18px", borderRadius: 12, fontSize: 14 }}
            >
              Sign in with Google
            </Btn>
          </div>
          {toast ? (
            <div style={{ marginTop: 14, textAlign: "center", color: "#8E8E93", fontWeight: 600, fontSize: 12 }}>{toast}</div>
          ) : null}
        </div>
      </div>
    );

  var accessRow = access && user && access.users ? access.users[user.uid] : null;
  var accessUserCount = access && access.users ? Object.keys(access.users).length : 0;
  var accessAllowed = !!accessRow;

  if (!accessReady)
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#8E8E93" }}>
        Loading...
      </div>
    );

  if (!accessRow && accessUserCount === 0) {
    if (accessBootstrapping)
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", color: "#8E8E93", gap: 8 }}>
          <div>Setting up access…</div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>First sign-in becomes the owner account.</div>
        </div>
      );
    return (
      <div style={{ minHeight: "100vh", background: "#F2F2F7", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 520, textAlign: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 22, marginBottom: 8, color: "#1C1C1E" }}>Access setup failed</div>
          <div style={{ color: "#8E8E93", fontWeight: 600, marginBottom: 18 }}>Could not create the owner account. Check Firestore permissions and try again.</div>
          <Btn
            v="secondary"
            onClick={function () {
              doSignOut().catch(function () {});
            }}
            style={{ padding: "12px 18px", borderRadius: 12 }}
          >
            Sign out
          </Btn>
        </div>
      </div>
    );
  }

  var emForClaim = user && user.email ? normalizeEmail(user.email) : "";
  if (
    accessReady &&
    access &&
    user &&
    !access.users[user.uid] &&
    emForClaim &&
    hasPendingForEmail(access, emForClaim) &&
    !claimFailed
  ) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#8E8E93" }}>
        Loading…
      </div>
    );
  }

  if (!accessAllowed)
    return (
      <div style={{ minHeight: "100vh", background: "#F2F2F7", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 440 }}>
          {user ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: 12,
                background: "#fff",
                borderRadius: 12,
                border: "1px solid #E5E5EA",
                marginBottom: 12,
              }}
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="" width={40} height={40} style={{ borderRadius: "50%", objectFit: "cover" }} referrerPolicy="no-referrer" />
              ) : (
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    background: "#E5E5EA",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: 15,
                    color: "#636366",
                  }}
                >
                  {(user.displayName || user.email || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div style={{ minWidth: 0, textAlign: "left" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#1C1C1E", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {user.displayName || "Google user"}
                </div>
                <div style={{ fontSize: 12, color: "#8E8E93", fontWeight: 600, wordBreak: "break-all" }}>{user.email}</div>
              </div>
            </div>
          ) : null}
          {accessUserCount > 0 ? (
            <p style={{ color: "#FF3B30", fontWeight: 600, fontSize: 13, margin: "0 0 14px 0", lineHeight: 1.45, textAlign: "center" }}>
              You are not authorized to use this app. Contact an owner for access.
            </p>
          ) : (
            <div style={{ color: "#8E8E93", fontWeight: 600, marginBottom: 18, lineHeight: 1.5, textAlign: "center", fontSize: 14 }}>Access could not be initialized.</div>
          )}
          {accessUserCount > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "stretch" }}>
              <Btn
                onClick={function () {
                  submitAccessRequest();
                }}
                style={{ padding: "12px 18px", borderRadius: 12, width: "100%", background: "#007AFF", color: "#fff" }}
              >
                Request access
              </Btn>
              <Btn
                v="secondary"
                onClick={function () {
                  trySwitchGoogleAccount().catch(function () {});
                }}
                style={{ padding: "12px 18px", borderRadius: 12, width: "100%" }}
              >
                Choose a different Google account
              </Btn>
            </div>
          ) : null}
          {toast ? (
            <div style={{ marginTop: 14, color: "#8E8E93", fontWeight: 600, fontSize: 12, textAlign: "center" }}>{toast}</div>
          ) : null}
        </div>
      </div>
    );

  if (!loaded)
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#8E8E93" }}>
        Loading...
      </div>
    );

  var myRole = accessRow.role || "default";
  var showInviteUi = myRole === "owner" || myRole === "admin";
  var isOwnerUi = myRole === "owner";
  var pendingAccessRequests = [];
  if (access && access.accessRequests && typeof access.accessRequests === "object") {
    Object.keys(access.accessRequests).forEach(function (rid) {
      var row = access.accessRequests[rid];
      if (row && typeof row === "object") pendingAccessRequests.push({ id: rid, ...row });
    });
    pendingAccessRequests.sort(function (a, b) {
      return String(a.requestedAt || "").localeCompare(String(b.requestedAt || ""));
    });
  }

  function addPendingAccessByEmail() {
    if (!user || !access || !access.users || !access.users[user.uid]) return;
    var email = normalizeEmail(inviteEmailIn);
    if (!email) {
      flash("Enter an email address.");
      return;
    }
    if (normalizeEmail(user.email) === email) {
      flash("You're already signed in with that account.");
      return;
    }
    var inviterRole = access.users[user.uid].role || "default";
    if (!canInviteWithRole(inviterRole, inviteRoleIn)) {
      flash("You can only add users at your level or below.");
      return;
    }
    var umap = access.users || {};
    for (var uk in umap) {
      if (umap[uk] && normalizeEmail(umap[uk].email) === email) {
        flash("That email is already on the list.");
        return;
      }
    }
    var leg = access.pendingInvites && typeof access.pendingInvites === "object" ? access.pendingInvites : {};
    if (leg[email]) {
      flash("That email already has pending access (legacy). It will apply on first sign-in.");
      return;
    }
    var sk = emailSlotKey(email);
    if (umap[sk]) {
      flash("That email is already on the list.");
      return;
    }
    var now = new Date().toISOString();
    var roleToSet =
      inviteRoleIn === "owner" ? "owner" : inviteRoleIn === "admin" ? "admin" : "default";
    setDoc(
      accessRef(),
      {
        users: {
          [sk]: {
            email: email,
            role: roleToSet,
            pending: true,
            invitedBy: user.uid,
            createdAt: now,
            displayName: "",
            photoURL: "",
          },
        },
      },
      { merge: true }
    )
      .then(function () {
        flash("Added. They appear under Manage users; their Google sign-in links their account when they first open the app.");
        persist(data, {
          message: "Access added — " + email + " (" + roleLabel(roleToSet) + ")",
        });
      })
      .catch(function (e) {
        flash(e.message || "Could not add user.");
      });
  }
  function canActorEditUserRole(actorRole, targetUid, targetRow) {
    if (!targetRow || actorRole === "default") return false;
    if (targetUid === access.ownerUid) return false;
    if (actorRole === "owner") return true;
    if (actorRole === "admin") {
      var tr = targetRow.role || "default";
      if (tr === "owner" || tr === "admin") return false;
      return true;
    }
    return false;
  }
  function roleOptionsForRow(actorRole, targetUid, targetRow) {
    if (!canActorEditUserRole(actorRole, targetUid, targetRow)) return [];
    if (actorRole === "admin") {
      return ["default", "admin"].filter(function (r) {
        return canInviteWithRole("admin", r);
      });
    }
    return ["owner", "admin", "default"].filter(function (r) {
      return canInviteWithRole("owner", r);
    });
  }
  function setAccessUserRole(targetUid, newRole) {
    if (!user || !access || !access.users || !access.users[user.uid]) return;
    var actorRole = access.users[user.uid].role || "default";
    if (actorRole !== "owner" && actorRole !== "admin") return;
    var row = access.users[targetUid];
    if (!row) return;
    var oldRole = row.role || "default";
    if (oldRole === newRole) return;
    if (targetUid === access.ownerUid && newRole !== "owner") {
      flash("The primary owner account must stay an owner.");
      return;
    }
    if (!canActorEditUserRole(actorRole, targetUid, row)) {
      flash("You can’t change this user’s role.");
      return;
    }
    if (!canInviteWithRole(actorRole, newRole)) {
      flash("You can only assign roles at or below your level.");
      return;
    }
    if (actorRole === "admin" && (oldRole === "owner" || oldRole === "admin")) {
      flash("Only an owner can change admins or owners.");
      return;
    }
    if (newRole === "owner" && actorRole !== "owner") {
      flash("Only an owner can assign the owner role.");
      return;
    }
    var who = normalizeEmail(row.email) || row.displayName || targetUid;
    setDoc(
      accessRef(),
      {
        users: {
          [targetUid]: {
            ...row,
            role: newRole,
            updatedAt: new Date().toISOString(),
          },
        },
      },
      { merge: true }
    )
      .then(function () {
        flash("Role updated.");
        appendEventLogEntry("Role changed — " + who + ": " + roleLabel(oldRole) + " → " + roleLabel(newRole), user.email).catch(function () {});
      })
      .catch(function (e) {
        flash(e.message || "Could not update role.");
      });
  }
  function removeAccessUser(targetUid) {
    if (!access || !access.users || !access.users[user.uid]) return;
    var actorRole = access.users[user.uid].role || "default";
    if (actorRole !== "owner" && actorRole !== "admin") return;
    if (targetUid === access.ownerUid) return;
    var row = access.users[targetUid];
    if (!row) return;
    if (actorRole === "admin") {
      var tr = row.role || "default";
      if (tr === "owner" || tr === "admin") {
        flash("Only an owner can remove admins or owners.");
        return;
      }
    }
    if (!confirm("Remove this user from the app? They can be added again by email if needed.")) return;
    var who = row ? normalizeEmail(row.email) || row.displayName || targetUid : targetUid;
    updateDoc(accessRef(), new FieldPath("users", targetUid), deleteField())
      .then(function () {
        appendEventLogEntry("Access removed — " + who, user.email).catch(function () {});
      })
      .catch(function (e) {
        flash(e.message || "Could not remove user.");
      });
  }
  function acceptAccessRequest(requestId) {
    if (!user || !access || !access.users || !access.users[user.uid]) return;
    var myR = access.users[user.uid].role || "default";
    if (myR !== "owner" && myR !== "admin") return;
    var req = access.accessRequests && access.accessRequests[requestId];
    if (!req || !req.uid) return;
    var em = normalizeEmail(req.email);
    var now = new Date().toISOString();
    var userRow = {
      email: em,
      displayName: req.displayName || "",
      photoURL: req.photoURL || "",
      role: "default",
      updatedAt: now,
    };
    var sk = emailSlotKey(em);
    var slotExists = access.users && access.users[sk] && access.users[sk].pending;
    var p = accessRef();
    var reqPromise = slotExists
      ? updateDoc(
          p,
          new FieldPath("users", req.uid),
          userRow,
          new FieldPath("accessRequests", requestId),
          deleteField(),
          new FieldPath("users", sk),
          deleteField()
        )
      : updateDoc(p, new FieldPath("users", req.uid), userRow, new FieldPath("accessRequests", requestId), deleteField());
    reqPromise
      .then(function () {
        flash("Access granted.");
        appendEventLogEntry("Access approved — " + em + " (Default role)", user.email).catch(function () {});
      })
      .catch(function (e) {
        flash(e.message || "Could not approve.");
      });
  }
  function denyAccessRequest(requestId) {
    if (!user || !access || !access.users || !access.users[user.uid]) return;
    var myR = access.users[user.uid].role || "default";
    if (myR !== "owner" && myR !== "admin") return;
    var req = access.accessRequests && access.accessRequests[requestId];
    if (!req) return;
    var em = normalizeEmail(req.email);
    var patch = {};
    patch["accessRequests." + requestId] = deleteField();
    updateDoc(accessRef(), patch)
      .then(function () {
        flash("Request denied.");
        appendEventLogEntry("Access denied — " + em, user.email).catch(function () {});
      })
      .catch(function (e) {
        flash(e.message || "Could not deny.");
      });
  }

  function exportActivityLogTxt() {
    var ev = Array.isArray(data.eventLog) ? data.eventLog : [];
    var filtered = ev.filter(function (e) {
      return eventLogEntryMatchesFilters(selM, activityLogRange, e);
    });
    var scopeLabel = isRegion(selM) ? "All Offices" : data.markets[selM] ? data.markets[selM].name : String(selM || "");
    var rangeLabel =
      activityLogRange === "day"
        ? "Last 24 hours"
        : activityLogRange === "week"
          ? "Last 7 days"
          : activityLogRange === "month"
            ? "Last 30 days"
            : "All time";
    var header =
      "Activity log export\n" +
      "Exported: " +
      new Date().toISOString() +
      "\nOffice / market: " +
      scopeLabel +
      "\nTime range: " +
      rangeLabel +
      "\nEntries: " +
      filtered.length +
      "\n\n";
    var body =
      filtered.length === 0
        ? "(No entries for the selected office and time range.)"
        : filtered
            .map(function (e) {
              var when =
                e && e.ts
                  ? new Date(e.ts).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
                  : "—";
              var actor = e && e.actor ? e.actor : "";
              var msg = e && e.message ? e.message : "";
              return when + (actor ? " · " + actor : "") + "\n" + msg;
            })
            .join("\n\n");
    var blob = new Blob([header + body], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "activity-log-" + activityLogRange + "-" + TODAY + ".txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  var mIds = Object.keys(data.markets).sort(function (a, b) {
    var na = data.markets[a] && data.markets[a].name ? data.markets[a].name : "";
    var nb = data.markets[b] && data.markets[b].name ? data.markets[b].name : "";
    return na.localeCompare(nb);
  });
  var selMResolved = selM == null ? REGION_KEY : selM;
  var officeScopeTitle =
    selMResolved === REGION_KEY
      ? "All Offices"
      : data.markets[selMResolved] && data.markets[selMResolved].name
        ? data.markets[selMResolved].name
        : selMResolved;
  var curReps = !selM
    ? []
    : isRegion(selM)
      ? allActive(data)
          .slice()
          .sort(function (a, b) {
            return a[1].name.localeCompare(b[1].name);
          })
      : mReps(data, selM);
  var rangeDates = getDatesInRange(startDate, endDate);
  var numDays = rangeDates.length;

  var analyzed = curReps.map(function (p) {
    return p[1].role === "closer" ? analyzeCloser(data, p[0], p[1], rangeDates, endDate) : analyzeKnocker(data, p[0], p[1], rangeDates, endDate);
  });
  var actionN = analyzed.filter(function (a) {
    return a.actionFlags.length > 0;
  });
  var coachN = analyzed.filter(function (a) {
    return a.actionFlags.length === 0 && a.coachFlags.length > 0;
  });

  var missingEntryReps = [];
  if (selM && !isRegion(selM)) {
    mReps(data, selM).forEach(function (p) {
      if (dayEntryMissing(data, p[0], p[1], endDate)) missingEntryReps.push(p);
    });
  }
  var monthCreditFailsTotal = selM && !isRegion(selM) ? monthCreditFailsForMarket(data, selM, endDate) : null;

  var showBoardMarketCol = !!selM && isRegion(selM);
  var knockerBoardSub =
    selM && !isRegion(selM)
      ? (data.markets[selM] ? data.markets[selM].name + " · " : "") + "Closers included when knocking · "
      : selM && isRegion(selM)
        ? "All Offices · Closers included when knocking · "
        : "";
  var closerBoardSub =
    selM && !isRegion(selM)
      ? (data.markets[selM] ? data.markets[selM].name : "") + " · "
      : selM && isRegion(selM)
        ? "All Offices · "
        : "";

  var knockerLB = [];
  scopedActiveReps(data, selM).forEach(function (p) {
    var rid = p[0],
      rep = p[1];
    var mkt = data.markets[rep.marketId];
    if (!mkt) return;
    var s = getRangeStats(data, rid, rangeDates);
    if (s.doorsKnocked === 0) return;
    knockerLB.push({
      rid: rid,
      name: rep.name,
      market: mkt.name,
      role: rep.role || "knocker",
      doors: s.doorsKnocked,
      convos: s.convosHad,
      sets: s.setsSet,
      d2c: s.d2c,
      c2s: s.c2s,
      setsAvg: s.setsAvg,
      days: s.days,
      streak: streakCount(data, rid, rep, endDate),
    });
  });
  knockerLB.sort(function (a, b) {
    var k = lbSort;
    if (k === "convos") return b.convos - a.convos;
    if (k === "sets") return b.sets - a.sets;
    if (k === "d2c") return b.d2c - a.d2c;
    if (k === "c2s") return b.c2s - a.c2s;
    return b.doors - a.doors;
  });

  var closerLB = [];
  scopedActiveReps(data, selM, "closer").forEach(function (p) {
    var rid = p[0],
      rep = p[1];
    var mkt = data.markets[rep.marketId];
    if (!mkt) return;
    var s = getRangeStats(data, rid, rangeDates);
    var mSG = getMonthSelfGens(data, rid, endDate);
    closerLB.push({
      rid: rid,
      name: rep.name,
      market: mkt.name,
      closes: s.apptsClosed,
      apptsRan: s.apptsRan,
      hours: Math.round(s.hours * 10) / 10,
      hoursAvg: s.hoursAvg,
      closeRate: s.closeRate,
      cadRate: s.cadRate,
      monthSelfGens: mSG,
      cads: s.cads,
      days: s.days,
      streak: streakCount(data, rid, rep, endDate),
    });
  });
  closerLB.sort(function (a, b) {
    var k = clSort;
    if (k === "closeRate") return b.closeRate - a.closeRate;
    if (k === "selfGens") return b.monthSelfGens - a.monthSelfGens;
    if (k === "hours") return b.hours - a.hours;
    return b.closes - a.closes;
  });

  var trendData = rangeDates.map(function (dt) {
    var row = { date: dt.slice(5) };
    var d2 = 0,
      c2 = 0,
      s2 = 0,
      cl2 = 0;
    if (selM && !isRegion(selM)) {
      mReps(data, selM).forEach(function (p) {
        var k = gK(data, p[0], dt);
        if (k) {
          d2 += k.doorsKnocked || 0;
          c2 += k.convosHad || 0;
          s2 += k.setsSet || 0;
          cl2 += (k.closes || 0) + (k.apptsClosed || 0);
        }
      });
    } else if (selM && isRegion(selM)) {
      allActive(data).forEach(function (p) {
        var k = gK(data, p[0], dt);
        if (k) {
          d2 += k.doorsKnocked || 0;
          c2 += k.convosHad || 0;
          s2 += k.setsSet || 0;
          cl2 += (k.closes || 0) + (k.apptsClosed || 0);
        }
      });
    }
    row.doors = d2;
    row.convos = c2;
    row.sets = s2;
    row.closes = cl2;
    return row;
  });
  var trendHasData = trendData.some(function (d) {
    return d.doors > 0 || d.closes > 0;
  });

  var rollupData = Object.entries(data.markets).map(function (p) {
    var mId = p[0],
      mkt = p[1];
    var roster = mReps(data, mId);
    var statsReps = repsInMarketForStats(data, mId);
    var t = { d: 0, c: 0, s: 0, cl: 0, rpt: 0, knockers: 0, closers: 0 };
    roster.forEach(function (rp) {
      if (rp[1].role === "closer") t.closers++;
      else t.knockers++;
    });
    statsReps.forEach(function (rp) {
      var st = getRangeStats(data, rp[0], rangeDates);
      if (st.days > 0) {
        t.d += st.doorsKnocked;
        t.c += st.convosHad;
        t.s += st.setsSet;
        t.cl += st.closes + st.apptsClosed;
        t.rpt++;
      }
    });
    return { id: mId, name: mkt.name, reps: roster.length, ...t };
  });
  rollupData.sort(function (a, b) {
    return b.cl - a.cl;
  });

  var mvpWeek = selM ? weeklyMVP(data, selM, endDate) : null;
  var chA = chMktA || (mIds[0] || null);
  var chB = chMktB || (mIds[1] || mIds[0] || null);
  var challengeDates = getDatesInRange(startDate, endDate);
  var chAstats = chA ? aggregateMarketChallenge(data, chA, challengeDates) : null;
  var chBstats = chB ? aggregateMarketChallenge(data, chB, challengeDates) : null;
  var challengeWinner =
    chAstats && chBstats && chA !== chB
      ? chAstats.closes > chBstats.closes
        ? chA
        : chBstats.closes > chAstats.closes
          ? chB
          : null
      : null;

  var report7 = getDatesInRange(daysAgo(6), TODAY);
  var reportPrev7 = getDatesInRange(daysAgo(13), daysAgo(7));
  var reportMarketId = selM && !isRegion(selM) ? selM : null;
  var reportAgg = reportMarketId ? aggregateMarketChallenge(data, reportMarketId, report7) : null;
  var reportAggPrev = reportMarketId ? aggregateMarketChallenge(data, reportMarketId, reportPrev7) : null;
  var reportRoster = reportMarketId ? mReps(data, reportMarketId) : [];
  var reportAnalyzed7 = reportMarketId
    ? reportRoster.map(function (p) {
        return p[1].role === "closer"
          ? analyzeCloser(data, p[0], p[1], report7, TODAY)
          : analyzeKnocker(data, p[0], p[1], report7, TODAY);
      })
    : [];
  var reportActionReps = reportAnalyzed7.filter(function (a) {
    return a.actionFlags.length > 0;
  });
  var reportTopPerformers = reportAnalyzed7
    .slice()
    .sort(function (a, b) {
      var ac = a.role === "closer" ? a.stats.apptsClosed : a.stats.closes;
      var bc = b.role === "closer" ? b.stats.apptsClosed : b.stats.closes;
      return bc - ac;
    })
    .slice(0, 3);

  var regionScorecard =
    selM && isRegion(selM)
      ? mIds.map(function (mId) {
          var cons = dataEntryConsistencyScore(data, mId, 14);
          var rosterN = mReps(data, mId).length;
          var st = aggregateMarketChallenge(data, mId, rangeDates);
          var termN = Object.values(data.reps).filter(function (r) {
            return r.marketId === mId && r.terminated;
          }).length;
          var avgProd = rosterN > 0 ? Math.round((st.closes / rosterN) * 10) / 10 : 0;
          return {
            mId: mId,
            name: data.markets[mId].name,
            cons: cons,
            rosterN: rosterN,
            termN: termN,
            avgClose: avgProd,
            st: st,
          };
        })
      : [];

  var profileRep = profileRepId && data.reps[profileRepId] ? data.reps[profileRepId] : null;
  var profileRid = profileRepId;
  var prof7 = profileRep && profileRid ? profileSeries(data, profileRid, profileRep, TODAY, 7) : [];
  var prof14 = profileRep && profileRid ? profileSeries(data, profileRid, profileRep, TODAY, 14) : [];
  var prof30 = profileRep && profileRid ? profileSeries(data, profileRid, profileRep, TODAY, 30) : [];
  var profBests = profileRep && profileRid ? personalBestsForRep(data, profileRid, profileRep) : null;
  var profStreak = profileRep && profileRid ? streakCount(data, profileRid, profileRep, TODAY) : 0;
  var profPromo = profileRep && profileRid && profileRep.role !== "closer" ? promotionKnockerProgress(data, profileRid, profileRep) : null;
  var profRamp = profileRep && profileRid ? newHireWeekAvgs(data, profileRid, profileRep) : null;
  var profLast30Dates = getDatesInRange(daysAgo(29), TODAY);
  var profStats30 =
    profileRep && profileRid
      ? profileRep.role === "closer"
        ? analyzeCloser(data, profileRid, profileRep, profLast30Dates, TODAY)
        : analyzeKnocker(data, profileRid, profileRep, profLast30Dates, TODAY)
      : null;
  var profDeal = profileRep && profileRep.marketId ? dealValueForMarket(data, profileRep.marketId) : 0;
  var profMonthCloses =
    profileRep && profileRid && profileRep.role === "closer"
      ? getRangeStats(data, profileRid, monthDateRange(TODAY)).apptsClosed
      : 0;
  var profRevEst = profileRep && profileRep.role === "closer" ? Math.round(profMonthCloses * profDeal) : 0;

  var showRange = tab !== "enter" && tab !== "manage" && tab !== "accountability" && tab !== "report";

  function renderFlagCard(item) {
    var rid = item.rid,
      rep = item.rep,
      s = item.stats;
    var off = offCt(data.accountabilityLog, rid);
    var ns = nSev(data.accountabilityLog, rid);
    var exp = expanded[rid];
    var logE = data.accountabilityLog[rid] || [];
    var isAction = item.actionFlags.length > 0;
    var tl = tenureLabel(rep);
    var isCloser = item.role === "closer";
    return (
      <Card key={rid} bc={isAction ? "#FF3B30" : "#FF9500"}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6 }}>
          <div style={{ flex: 1, minWidth: 170 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={function () {
                  setProfileRepId(rid);
                }}
                style={{
                  fontWeight: 700,
                  fontSize: 16,
                  color: "#1C1C1E",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
              >
                {rep.name}
              </button>
              <RoleBadge role={rep.role} />
              {tl ? <Badge text={tl} /> : null}
              {off > 0 ? <Badge text={off + " prior"} color="#FF3B30" bg="#FFF0EF" /> : null}
              {isAction ? <Badge text={"Next: " + ns.label} color={ns.color} bg={ns.bg} /> : null}
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
              {item.actionFlags.map(function (f, i) {
                return (
                  <span key={"a" + i} style={{ fontSize: 12, color: "#FF3B30", fontWeight: 600 }}>
                    {"• " + f.label}
                  </span>
                );
              })}
              {item.coachFlags.map(function (f, i) {
                return (
                  <span key={"c" + i} style={{ fontSize: 12, color: "#FF9500", fontWeight: 600 }}>
                    {"⚠ " + f.label}
                  </span>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "#8E8E93" }}>
              {isCloser
                ? ["Hrs avg: " + s.hoursAvg + "/5", "Close: " + s.closeRate + "%", "CAD: " + s.cadRate + "%", "SG: " + (item.monthSelfGens || 0)].map(
                    function (t, i) {
                      return <span key={i}>{t}</span>;
                    }
                  )
                : ["Doors: " + s.doorsKnocked, "Convos: " + s.convosHad, "Sets avg: " + s.setsAvg, "D2C: " + s.d2c + "%"].map(function (t, i) {
                    return <span key={i}>{t}</span>;
                  })}
              <span style={{ color: "#C7C7CC" }}>{s.days + "d data"}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <Btn
              v="secondary"
              onClick={function () {
                setEntryDate(endDate);
                if (isRegion(selM) && rep.marketId) setSelM(rep.marketId);
                setTab("enter");
              }}
              style={{ padding: "6px 12px", fontSize: 12 }}
            >
              Edit KPIs
            </Btn>
            <Btn
              onClick={function () {
                openLog(rid);
              }}
              style={{ padding: "6px 12px", fontSize: 12 }}
            >
              Log
            </Btn>
            <Btn
              v="secondary"
              onClick={function () {
                setExpanded(function (p) {
                  return { ...p, [rid]: !p[rid] };
                });
              }}
              style={{ padding: "6px 12px", fontSize: 12 }}
            >
              {exp ? "Hide" : "Hist"}
            </Btn>
          </div>
        </div>
        {exp && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F2F2F7" }}>
            {logE.length === 0 ? (
              <span style={{ fontSize: 12, color: "#C7C7CC" }}>No incidents.</span>
            ) : (
              logE.map(function (entry) {
                var sev = SEV.find(function (sv) {
                  return sv.key === entry.severity;
                }) || SEV[0];
                return (
                  <div key={entry.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, fontSize: 12 }}>
                    <span style={{ color: "#8E8E93", minWidth: 68 }}>{entry.date}</span>
                    <Badge text={sev.label} color={sev.color} bg={sev.bg} />
                    <span style={{ color: "#3A3A3C", flex: 1 }}>{entry.note}</span>
                    <button
                      onClick={function () {
                        delLogE(rid, entry.id);
                      }}
                      style={{ fontSize: 10, color: "#C7C7CC", background: "none", border: "none", cursor: "pointer" }}
                    >
                      x
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </Card>
    );
  }

  var ths = {
    textAlign: "center",
    padding: "10px 6px",
    fontWeight: 600,
    fontSize: 9,
    color: "#8E8E93",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    background: "#FAFAFA",
    borderBottom: "1px solid #E5E5EA",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F2F2F7" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>
        {
          ":root,body,*{font-family:'DM Sans',-apple-system,sans-serif}input,select,textarea,button{font-family:inherit}@media (max-width:768px){.header-shell{grid-template-columns:minmax(0,1fr) auto!important}.header-brand-block{display:none!important}.header-office-picker{justify-self:start!important}.header-office-picker .office-picker-trigger-btn{justify-content:flex-start!important;text-align:left!important}.header-office-picker .office-picker-menu{left:0!important;transform:none!important;right:auto!important}}@media print{.weekly-report-print *{box-shadow:none!important}.no-print{display:none!important}.weekly-report-print{padding:16px}}"
        }
      </style>

      <div
        className="no-print header-shell"
        style={{
          background: "#fff",
          padding: "14px 18px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
          alignItems: "center",
          columnGap: 12,
          rowGap: 10,
          borderBottom: "1px solid #E5E5EA",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div className="header-brand-block" style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "start", minWidth: 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FF3B30", flexShrink: 0 }} />
          <span style={{ fontWeight: 800, fontSize: 20, color: "#1C1C1E", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Jake's Region</span>
        </div>
        <div
          ref={officePickerRef}
          className="header-office-picker"
          style={{ position: "relative", justifySelf: "center", maxWidth: "min(420px, calc(100vw - 48px))", minWidth: 0 }}
        >
          <button
            type="button"
            className="office-picker-trigger-btn"
            aria-haspopup="listbox"
            aria-expanded={officePickerOpen}
            aria-label={officeScopeTitle + ". Change office or region."}
            onClick={function () {
              setOfficePickerOpen(!officePickerOpen);
              setProfileMenuOpen(false);
              setAccessNotifOpen(false);
            }}
            style={{
              width: "100%",
              border: "none",
              borderRadius: 12,
              background: "transparent",
              padding: "6px 12px",
              cursor: "pointer",
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              textAlign: "center",
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                fontSize: 24,
                fontWeight: 800,
                color: "#1C1C1E",
                lineHeight: 1.15,
              }}
            >
              {officeScopeTitle}
            </span>
            <svg
              width="13"
              height="13"
              viewBox="0 0 11 11"
              aria-hidden
              style={{
                flexShrink: 0,
                transform: officePickerOpen ? "rotate(180deg)" : "none",
                transition: "transform 0.2s ease",
                opacity: 0.45,
              }}
            >
              <path d="M2.5 3.5L5.5 6.5L8.5 3.5" fill="none" stroke="#3A3A3C" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {officePickerOpen ? (
            <div
              className="office-picker-menu"
              role="listbox"
              aria-label="Choose office or region"
              style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                top: "calc(100% + 8px)",
                width: 300,
                maxWidth: "calc(100vw - 24px)",
                background: "#fff",
                borderRadius: 14,
                border: "1px solid #E5E5EA",
                boxShadow: shL,
                padding: "8px 0",
                zIndex: 220,
              }}
            >
              <button
                type="button"
                role="option"
                aria-selected={selMResolved === REGION_KEY}
                onClick={function () {
                  setSelM(REGION_KEY);
                  setOfficePickerOpen(false);
                }}
                style={{
                  width: "100%",
                  border: "none",
                  background: selMResolved === REGION_KEY ? "#F2F2F7" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  padding: "10px 14px",
                  fontSize: 14,
                  fontWeight: selMResolved === REGION_KEY ? 700 : 500,
                  color: "#1C1C1E",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span>All Offices</span>
                {selMResolved === REGION_KEY ? (
                  <span style={{ fontSize: 12, color: "#007AFF", fontWeight: 700 }}>✓</span>
                ) : null}
              </button>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: "#8E8E93",
                  textTransform: "uppercase",
                  padding: "10px 14px 4px",
                  marginTop: 4,
                  borderTop: "1px solid #F2F2F7",
                }}
              >
                Offices
              </div>
              <div style={{ maxHeight: "min(40vh, 280px)", overflowY: "auto" }}>
                {mIds.map(function (id) {
                  var sel = selMResolved === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={sel}
                      onClick={function () {
                        setSelM(id);
                        setOfficePickerOpen(false);
                      }}
                      style={{
                        width: "100%",
                        border: "none",
                        background: sel ? "#F2F2F7" : "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        padding: "10px 14px",
                        fontSize: 14,
                        fontWeight: sel ? 700 : 500,
                        color: "#1C1C1E",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.markets[id].name}</span>
                      {sel ? <span style={{ fontSize: 12, color: "#007AFF", fontWeight: 700, flexShrink: 0 }}>✓</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end" }}>
          {showInviteUi ? (
            <div ref={accessNotifRef} style={{ position: "relative" }}>
              <button
                type="button"
                aria-label="Access requests"
                aria-expanded={accessNotifOpen}
                title="Access requests"
                onClick={function (e) {
                  e.stopPropagation();
                  setAccessNotifOpen(!accessNotifOpen);
                  setProfileMenuOpen(false);
                  setOfficePickerOpen(false);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  padding: 4,
                  margin: 0,
                  lineHeight: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: 0.8,
                }}
              >
                <img
                  src={notifPng}
                  alt=""
                  width={22}
                  height={22}
                  style={{ display: "block", objectFit: "contain" }}
                />
              </button>
              {pendingAccessRequests.length > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    right: 3,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#FF3B30",
                    border: "1px solid #FAFAFA",
                    pointerEvents: "none",
                  }}
                />
              ) : null}
              {accessNotifOpen ? (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 8px)",
                    width: 320,
                    maxWidth: "calc(100vw - 36px)",
                    background: "#fff",
                    borderRadius: 12,
                    border: "1px solid #E5E5EA",
                    boxShadow: shL,
                    padding: 12,
                    zIndex: 200,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 12, color: "#8E8E93", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
                    Access requests
                  </div>
                  {pendingAccessRequests.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 13, color: "#8E8E93", fontWeight: 500 }}>No pending requests.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {pendingAccessRequests.map(function (pr, pri) {
                        return (
                          <div
                            key={pr.id}
                            style={{
                              padding: "10px 0",
                              borderBottom: pri < pendingAccessRequests.length - 1 ? "1px solid #F2F2F7" : "none",
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#1C1C1E", marginBottom: 8, wordBreak: "break-all" }}>{pr.email}</div>
                            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                              <Btn
                                style={{ fontSize: 11, padding: "5px 12px" }}
                                onClick={function () {
                                  acceptAccessRequest(pr.id);
                                }}
                              >
                                Accept
                              </Btn>
                              <Btn
                                v="secondary"
                                style={{ fontSize: 11, padding: "5px 12px", color: "#FF3B30" }}
                                onClick={function () {
                                  denyAccessRequest(pr.id);
                                }}
                              >
                                Deny
                              </Btn>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
          <div ref={profileMenuRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={function () {
                setAccessNotifOpen(false);
                setOfficePickerOpen(false);
                setProfileMenuOpen(!profileMenuOpen);
              }}
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: "2px solid #E5E5EA",
                padding: 0,
                cursor: "pointer",
                overflow: "hidden",
                background: "#E5E5EA",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="Account"
              aria-label="Account menu"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
              ) : (
                <span style={{ fontSize: 14, fontWeight: 800, color: "#636366" }}>{(user.displayName || user.email || "?").slice(0, 1).toUpperCase()}</span>
              )}
            </button>
            {profileMenuOpen ? (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 8px)",
                  width: 300,
                  maxWidth: "calc(100vw - 36px)",
                  background: "#fff",
                  borderRadius: 14,
                  boxShadow: shL,
                  border: "1px solid #E5E5EA",
                  padding: 14,
                  zIndex: 200,
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="" width={44} height={44} style={{ borderRadius: "50%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                  ) : (
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        background: "#E5E5EA",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                        color: "#636366",
                      }}
                    >
                      {(user.displayName || user.email || "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: "#1C1C1E", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {user.displayName || "Google user"}
                    </div>
                    <div style={{ fontSize: 11, color: "#8E8E93", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {user.email}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <Badge
                        text={roleLabel(myRole)}
                        color={myRole === "owner" ? "#5856D6" : myRole === "admin" ? "#007AFF" : "#8E8E93"}
                        bg={myRole === "owner" ? "#EEF0FF" : myRole === "admin" ? "#E8F4FF" : "#F2F2F7"}
                      />
                    </div>
                  </div>
                </div>
                {showInviteUi ? (
                  <div style={{ borderTop: "1px solid #F2F2F7", paddingTop: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#8E8E93", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Add user</div>
                    <div style={{ fontSize: 11, color: "#8E8E93", marginBottom: 8, lineHeight: 1.45 }}>
                      <div style={{ marginBottom: 8 }}>Invitees must sign in with Google using the email you enter.</div>
                      <div>Default - dashboard access</div>
                      <div>Admin - dashboard access, can send invites and remove default users</div>
                      <div>Owner - dashboard access, can send invites, and remove default/admin users</div>
                    </div>
                    <input
                      type="email"
                      placeholder="invitee@company.com"
                      value={inviteEmailIn}
                      onChange={function (e) {
                        setInviteEmailIn(e.target.value);
                      }}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #E5E5EA",
                        fontSize: 13,
                        marginBottom: 8,
                      }}
                    />
                    <select
                      value={inviteRoleIn}
                      onChange={function (e) {
                        setInviteRoleIn(e.target.value);
                      }}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #E5E5EA",
                        fontSize: 13,
                        marginBottom: 8,
                        fontWeight: 600,
                      }}
                    >
                      {myRole === "owner" ? <option value="owner">Owner</option> : null}
                      {myRole === "owner" || myRole === "admin" ? <option value="admin">Admin</option> : null}
                      <option value="default">Default</option>
                    </select>
                    <Btn
                      onClick={function () {
                        addPendingAccessByEmail();
                      }}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 10, fontSize: 12 }}
                    >
                      Add User
                    </Btn>
                  </div>
                ) : null}
                {showInviteUi ? (
                  <div style={{ borderTop: "1px solid #F2F2F7", paddingTop: 12, marginBottom: 12 }}>
                    <Btn
                      v="secondary"
                      style={{ width: "100%", fontSize: 12, padding: "8px 12px" }}
                      onClick={function () {
                        setManageUsersOpen(true);
                        setProfileMenuOpen(false);
                      }}
                    >
                      Manage users
                    </Btn>
                  </div>
                ) : null}
                <div style={{ borderTop: "1px solid #F2F2F7", paddingTop: 12 }}>
                  <Btn
                    v="secondary"
                    onClick={function () {
                      setProfileMenuOpen(false);
                      doSignOut().catch(function () {});
                    }}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 10, fontSize: 13 }}
                  >
                    Sign out
                  </Btn>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {toast ? (
        <div className="no-print" style={{ position: "fixed", top: 64, right: 14, zIndex: 9999, background: "#1C1C1E", color: "#fff", fontSize: 13, fontWeight: 600, padding: "10px 20px", borderRadius: 12, boxShadow: shL }}>
          {toast}
        </div>
      ) : null}

      {manageUsersOpen && access ? (
        <div
          className="no-print"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={function () {
            setManageUsersOpen(false);
          }}
        >
          <div
            onClick={function (e) {
              e.stopPropagation();
            }}
            style={{ background: "#fff", borderRadius: 16, maxWidth: 440, width: "100%", maxHeight: "80vh", overflow: "auto", padding: 20, boxShadow: shL }}
          >
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4, color: "#1C1C1E" }}>People with access</div>
            <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 8px 0", lineHeight: 1.4 }}>
              Change roles (within your permission) or remove people.
            </p>
            <div style={{ marginBottom: 14 }}>
              {Object.entries(access.users || {})
                .map(function (p) {
                  return { uid: p[0], row: p[1] };
                })
                .sort(function (a, b) {
                  var ra = ROLE_RANK[a.row.role] || 0;
                  var rb = ROLE_RANK[b.row.role] || 0;
                  if (rb !== ra) return rb - ra;
                  var na = a.row.displayName || a.row.email || a.uid;
                  var nb = b.row.displayName || b.row.email || b.uid;
                  return na.localeCompare(nb);
                })
                .map(function (item) {
                  var uid = item.uid;
                  var row = item.row;
                  var isPrimaryOwnerRow = uid === access.ownerUid;
                  var roleOpts = roleOptionsForRow(myRole, uid, row);
                  var curRole = row.role || "default";
                  var canRemoveRow =
                    !isPrimaryOwnerRow &&
                    (myRole === "owner" || (myRole === "admin" && curRole !== "owner" && curRole !== "admin"));
                  return (
                    <div
                      key={uid}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 0",
                        borderBottom: "1px solid #F2F2F7",
                        flexWrap: "wrap",
                      }}
                    >
                      {row.photoURL ? (
                        <img src={row.photoURL} alt="" width={36} height={36} style={{ borderRadius: "50%", objectFit: "cover" }} referrerPolicy="no-referrer" />
                      ) : (
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            background: "#E5E5EA",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 800,
                            color: "#636366",
                          }}
                        >
                          {(row.displayName || row.email || "?").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#1C1C1E" }}>{row.displayName || row.email || uid}</div>
                        <div style={{ fontSize: 11, color: "#8E8E93", fontWeight: 600 }}>{row.email || ""}</div>
                      </div>
                      {roleOpts.length > 0 ? (
                        <select
                          aria-label={"Role for " + (row.email || uid)}
                          value={curRole}
                          onChange={function (e) {
                            setAccessUserRole(uid, e.target.value);
                          }}
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            padding: "6px 10px",
                            borderRadius: 8,
                            border: "1px solid #E5E5EA",
                            background: "#fff",
                            color: "#1C1C1E",
                            minWidth: 0,
                          }}
                        >
                          {roleOpts.map(function (r) {
                            return (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <Badge
                            text={roleLabel(curRole)}
                            color={row.role === "owner" ? "#5856D6" : row.role === "admin" ? "#007AFF" : "#8E8E93"}
                            bg={row.role === "owner" ? "#EEF0FF" : row.role === "admin" ? "#E8F4FF" : "#F2F2F7"}
                          />
                        </div>
                      )}
                      {canRemoveRow ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <Btn
                            v="secondary"
                            style={{ fontSize: 11, padding: "4px 10px", color: "#FF3B30" }}
                            onClick={function () {
                              removeAccessUser(uid);
                            }}
                          >
                            Remove
                          </Btn>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
            </div>
            <Btn
              onClick={function () {
                setManageUsersOpen(false);
              }}
              style={{ width: "100%", maxWidth: 200 }}
            >
              Done
            </Btn>
          </div>
        </div>
      ) : null}

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "12px" }}>
        <div
          className="swipe-tab-root"
          onTouchStart={onSwipeTabTouchStart}
          onTouchMove={onSwipeTabTouchMove}
          onTouchEnd={onSwipeTabTouchEnd}
          onTouchCancel={onSwipeTabTouchCancel}
          style={{ minHeight: "calc(100vh - 88px)" }}
        >
        <div
          className="no-print"
          onTouchStart={function (e) {
            e.stopPropagation();
          }}
          onTouchMove={function (e) {
            e.stopPropagation();
          }}
          onTouchEnd={function (e) {
            e.stopPropagation();
          }}
          onTouchCancel={function (e) {
            e.stopPropagation();
          }}
          style={{ display: "flex", gap: 4, marginBottom: 14, overflowX: "auto", WebkitOverflowScrolling: "touch", padding: "4px 0" }}
        >
          {MAIN_TABS.map(function (t) {
            return (
              <button
                key={t.k}
                onClick={function () {
                  setTab(t.k);
                }}
                style={{
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: tab === t.k ? 700 : 500,
                  color: tab === t.k ? "#fff" : "#8E8E93",
                  background: tab === t.k ? "#1C1C1E" : "#fff",
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  boxShadow: tab === t.k ? "none" : sh,
                }}
              >
                {t.l}
              </button>
            );
          })}
        </div>

        {showRange ? (
          <div className="no-print">
            <DateRangeBar startDate={startDate} endDate={endDate} onChange={setRange} />
          </div>
        ) : null}

        {tab === "dashboard" &&
          (!selM ? (
            <Card>
              <p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>Select a market or Region.</p>
            </Card>
          ) : (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1C1C1E", margin: "0 0 14px 0" }}>
                {isRegion(selM) ? "All Offices" : data.markets[selM] && data.markets[selM].name}
              </h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
                <StatCard label="Total" value={curReps.length} />
                <StatCard label="Action" value={actionN.length} v={actionN.length > 0 ? "red" : "gray"} />
                <StatCard label="Coach" value={coachN.length} v={coachN.length > 0 ? "amber" : "gray"} />
                <StatCard label={"Doors " + (numDays > 1 ? "(total)" : "")} value={analyzed.reduce(function (s, a) { return s + a.stats.doorsKnocked; }, 0)} />
                <StatCard label={"Sets " + (numDays > 1 ? "(total)" : "")} value={analyzed.reduce(function (s, a) { return s + a.stats.setsSet; }, 0)} />
                {monthCreditFailsTotal != null ? <StatCard label="Credit fails (mo)" value={monthCreditFailsTotal} /> : null}
              </div>
              {missingEntryReps.length > 0 && (
                <Card style={{ border: "1px solid #FFE4B8", background: "#FFF8EE" }}>
                  <SL color="#FF9500">
                    {"Missing entry — " + endDate + " (" + missingEntryReps.length + ")"}
                  </SL>
                  <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 8px 0" }}>Active reps with no KPI row for the end date of the range above.</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {missingEntryReps.map(function (p) {
                      return (
                        <Badge key={p[0]} text={p[1].name} color="#FF9500" bg="#FFF3E0" />
                      );
                    })}
                  </div>
                </Card>
              )}
              {isRegion(selM) && regionScorecard.length > 0 ? (
                <Card>
                  <SL>Market owner scorecard (region)</SL>
                  <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 12px 0" }}>
                    Uses the date range above for production; entry consistency = last 14 days.
                  </p>
                  {regionScorecard.map(function (row) {
                    return (
                      <div
                        key={row.mId}
                        style={{
                          padding: "12px 0",
                          borderBottom: "1px solid #F2F2F7",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 12,
                          alignItems: "center",
                        }}
                      >
                        <div style={{ fontWeight: 800, minWidth: 120 }}>{row.name}</div>
                        <Badge text={"Roster " + row.rosterN} />
                        <Badge text={"Entry " + row.cons.pct + "%"} color={row.cons.pct >= 80 ? "#34C759" : "#FF9500"} bg={row.cons.pct >= 80 ? "#F0FFF4" : "#FFF8EE"} />
                        <Badge text={"Avg closes/rep " + row.avgClose} />
                        <Badge text={"Terminated " + row.termN} color="#8E8E93" bg="#F2F2F7" />
                        <Btn
                          v="ghost"
                          style={{ marginLeft: "auto", fontSize: 12 }}
                          onClick={function () {
                            setSelM(row.mId);
                            setTab("dashboard");
                          }}
                        >
                          Open market
                        </Btn>
                      </div>
                    );
                  })}
                </Card>
              ) : null}
              {actionN.length > 0 && (
                <div>
                  <SL color="#FF3B30">{"Action (" + actionN.length + ")"}</SL>
                  {actionN.map(renderFlagCard)}
                </div>
              )}
              {coachN.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <SL color="#FF9500">{"Coaching (" + coachN.length + ")"}</SL>
                  {coachN.map(renderFlagCard)}
                </div>
              )}
              {actionN.length === 0 && coachN.length === 0 && !isRegion(selM) ? (
                <Card>
                  <p style={{ color: "#34C759", fontWeight: 700, margin: 0, textAlign: "center" }}>All reps meeting standard.</p>
                </Card>
              ) : null}
              {actionN.length === 0 && coachN.length === 0 && isRegion(selM) ? (
                <Card>
                  <p style={{ color: "#8E8E93", fontWeight: 600, margin: 0, textAlign: "center" }}>Pick a market from the header for rep-level flags, or use the scorecard above.</p>
                </Card>
              ) : null}
            </div>
          ))}

        {tab === "enter" &&
          (!selM || isRegion(selM) ? (
            <Card>
              <p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>Select a single market to enter KPIs (Region is view-only here).</p>
            </Card>
          ) : (
            <div style={{ paddingBottom: 96 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Enter KPIs</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                  <Btn
                    v="secondary"
                    onClick={function () {
                      setEntryDate(daysAgo(1));
                    }}
                    style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8 }}
                  >
                    Yesterday
                  </Btn>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={function (e) {
                      setEntryDate(e.target.value);
                    }}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      padding: "6px 12px",
                      border: "1px solid #E5E5EA",
                      borderRadius: 10,
                      background: "#fff",
                    }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <Btn v={enterViewMode === "cards" ? "primary" : "secondary"} onClick={function () { setEnterViewMode("cards"); }} style={{ borderRadius: 8, fontSize: 12 }}>
                  Cards
                </Btn>
                <Btn v={enterViewMode === "grid" ? "primary" : "secondary"} onClick={function () { setEnterViewMode("grid"); }} style={{ borderRadius: 8, fontSize: 12 }}>
                  Grid
                </Btn>
              </div>
              {enterViewMode === "cards"
                ? curReps.map(function (p) {
                    var rid = p[0],
                      rep = p[1],
                      isCloser = rep.role === "closer",
                      fields = isCloser ? C_FIELDS : K_FIELDS;
                    var closers = mReps(data, rep.marketId, "closer");
                    return (
                      <Card key={rid}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                          <button
                            type="button"
                            onClick={function () {
                              setProfileRepId(rid);
                            }}
                            style={{
                              fontWeight: 700,
                              fontSize: 16,
                              background: "none",
                              border: "none",
                              padding: 0,
                              cursor: "pointer",
                              textDecoration: "underline",
                            }}
                          >
                            {rep.name}
                          </button>
                          <RoleBadge role={rep.role} />
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          {fields.map(function (fld) {
                            return (
                              <div key={fld.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                <span style={{ fontSize: 9, color: "#8E8E93", fontWeight: 600, textTransform: "uppercase" }}>{fld.label}</span>
                                <NI
                                  value={(kpiIn[rid] && kpiIn[rid][fld.key]) || ""}
                                  onChange={function (e) {
                                    var val = e.target.value;
                                    var fk = fld.key;
                                    setKpiIn(function (prev) {
                                      var n = { ...prev };
                                      n[rid] = { ...n[rid] };
                                      n[rid][fk] = val;
                                      return n;
                                    });
                                  }}
                                  w={52}
                                />
                              </div>
                            );
                          })}
                        </div>
                        {!isCloser && kpiIn[rid] ? (
                          <div style={{ marginBottom: 10, padding: "10px 12px", background: "#F9F9F9", borderRadius: 10 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#8E8E93", marginBottom: 8 }}>CREDIT FAILS (0.5 promo pt each)</div>
                            {(kpiIn[rid].creditFails || []).map(function (row, cfi) {
                              return (
                                <div key={cfi} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                                  <select
                                    value={row.closerId || ""}
                                    onChange={function (e) {
                                      var v = e.target.value;
                                      setKpiIn(function (prev) {
                                        var n = { ...prev };
                                        var rowB = { ...n[rid] };
                                        var cf = (rowB.creditFails || []).map(function (x, j) {
                                          return j === cfi ? { closerId: v } : x;
                                        });
                                        rowB.creditFails = cf;
                                        rowB.creditFailCount = String(cf.length);
                                        return { ...n, [rid]: rowB };
                                      });
                                    }}
                                    style={{ fontSize: 13, padding: "6px 10px", borderRadius: 8, border: "1px solid #E5E5EA", flex: "1 1 140px" }}
                                  >
                                    <option value="">Closer…</option>
                                    {closers.map(function (cp) {
                                      return (
                                        <option key={cp[0]} value={cp[0]}>
                                          {cp[1].name}
                                        </option>
                                      );
                                    })}
                                  </select>
                                  <Btn
                                    v="ghost"
                                    onClick={function () {
                                      setKpiIn(function (prev) {
                                        var n = { ...prev };
                                        var rowB = { ...n[rid] };
                                        var cf = (rowB.creditFails || []).filter(function (_, j) {
                                          return j !== cfi;
                                        });
                                        rowB.creditFails = cf;
                                        rowB.creditFailCount = String(cf.length);
                                        return { ...n, [rid]: rowB };
                                      });
                                    }}
                                    style={{ fontSize: 11, padding: "4px 8px" }}
                                  >
                                    Remove
                                  </Btn>
                                </div>
                              );
                            })}
                            <Btn
                              v="secondary"
                              onClick={function () {
                                setKpiIn(function (prev) {
                                  var n = { ...prev };
                                  var rowB = { ...n[rid] };
                                  var cf = [...(rowB.creditFails || [])];
                                  var defC = rowB.creditFailAssignCloser || (closers[0] ? closers[0][0] : "");
                                  cf.push({ closerId: defC });
                                  rowB.creditFails = cf;
                                  rowB.creditFailCount = String(cf.length);
                                  return { ...n, [rid]: rowB };
                                });
                              }}
                              style={{ fontSize: 12, marginTop: 4, borderRadius: 8 }}
                            >
                              + Credit fail
                            </Btn>
                          </div>
                        ) : null}
                        {!isCloser ? (
                          <div style={{ fontSize: 11, color: "#8E8E93", marginBottom: 8 }}>
                            {"Promotion sales credits (month of date): " +
                              promotionSalesCreditsForMonth(data, rid, entryDate).toFixed(1) +
                              " (closes + 0.5× credit fails)"}
                          </div>
                        ) : null}
                        {isCloser && kpiIn[rid] && (
                          <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 8, background: "#F9F9F9", padding: "8px 12px", borderRadius: 10 }}>
                            {"Hours: "}
                            <strong style={{ color: "#1C1C1E" }}>
                              {Math.round(((parseInt(kpiIn[rid].apptsRan) || 0) + (parseInt(kpiIn[rid].cads) || 0) * 0.5 + (parseInt(kpiIn[rid].convosHad) || 0) / 10) * 10) / 10}
                            </strong>
                            {" / 5"}
                          </div>
                        )}
                        {isCloser && kpiIn[rid] ? (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#8E8E93", marginBottom: 6 }}>APPT SOURCES (optional — which knocker set each appt)</div>
                            <textarea
                              value={kpiIn[rid].apptSources || ""}
                              onChange={function (e) {
                                var val = e.target.value;
                                setKpiIn(function (prev) {
                                  var n = { ...prev };
                                  n[rid] = { ...n[rid], apptSources: val };
                                  return n;
                                });
                              }}
                              placeholder="e.g. Sam: 3, Jordan: 2 or free text"
                              rows={2}
                              style={{
                                width: "100%",
                                fontSize: 13,
                                padding: "8px 12px",
                                border: "1px solid #E5E5EA",
                                borderRadius: 10,
                                resize: "vertical",
                                boxSizing: "border-box",
                                background: "#FAFAFA",
                              }}
                            />
                          </div>
                        ) : null}
                        <input
                          type="text"
                          value={kpiNotes[rid] || ""}
                          onChange={function (e) {
                            var val = e.target.value;
                            setKpiNotes(function (prev) {
                              return { ...prev, [rid]: val };
                            });
                          }}
                          placeholder="Notes..."
                          style={{
                            width: "100%",
                            fontSize: 13,
                            padding: "8px 12px",
                            border: "1px solid #E5E5EA",
                            borderRadius: 10,
                            outline: "none",
                            boxSizing: "border-box",
                            background: "#FAFAFA",
                          }}
                        />
                      </Card>
                    );
                  })
                : null}
              {enterViewMode === "grid" && curReps.length > 0 ? (
                <Card style={{ padding: 0, overflow: "auto", borderRadius: 14 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th style={{ ...ths, position: "sticky", left: 0, background: "#FAFAFA", zIndex: 1, textAlign: "left" }}>Rep</th>
                        <th style={ths}>Role</th>
                        {K_FIELDS.map(function (f) {
                          return (
                            <th key={f.key} style={ths}>
                              {f.label}
                            </th>
                          );
                        })}
                        {C_FIELDS.map(function (f) {
                          return (
                            <th key={"c_" + f.key} style={ths}>
                              {"C:" + f.label}
                            </th>
                          );
                        })}
                        <th style={ths}>CF#</th>
                        <th style={{ ...ths, minWidth: 100 }}>CF→</th>
                        <th style={{ ...ths, minWidth: 80 }}>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {curReps.map(function (p) {
                        var rid = p[0],
                          rep = p[1],
                          isCloser = rep.role === "closer",
                          closers = mReps(data, rep.marketId, "closer");
                        return (
                          <tr key={rid} style={{ borderBottom: "1px solid #F2F2F7" }}>
                            <td style={{ padding: "8px 6px", fontWeight: 700, position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>{rep.name}</td>
                            <td style={{ padding: "8px 4px", textAlign: "center" }}>{isCloser ? "C" : "K"}</td>
                            {K_FIELDS.map(function (fld) {
                              return (
                                <td key={fld.key} style={{ padding: "4px", textAlign: "center" }}>
                                  {isCloser ? (
                                    <span style={{ color: "#C7C7CC" }}>—</span>
                                  ) : (
                                    <NI
                                      w={44}
                                      value={(kpiIn[rid] && kpiIn[rid][fld.key]) || ""}
                                      onChange={function (e) {
                                        var val = e.target.value,
                                          fk = fld.key;
                                        setKpiIn(function (prev) {
                                          var n = { ...prev };
                                          n[rid] = { ...n[rid] };
                                          n[rid][fk] = val;
                                          return n;
                                        });
                                      }}
                                    />
                                  )}
                                </td>
                              );
                            })}
                            {C_FIELDS.map(function (fld) {
                              return (
                                <td key={fld.key} style={{ padding: "4px", textAlign: "center" }}>
                                  {!isCloser ? (
                                    <span style={{ color: "#C7C7CC" }}>—</span>
                                  ) : (
                                    <NI
                                      w={44}
                                      value={(kpiIn[rid] && kpiIn[rid][fld.key]) || ""}
                                      onChange={function (e) {
                                        var val = e.target.value,
                                          fk = fld.key;
                                        setKpiIn(function (prev) {
                                          var n = { ...prev };
                                          n[rid] = { ...n[rid] };
                                          n[rid][fk] = val;
                                          return n;
                                        });
                                      }}
                                    />
                                  )}
                                </td>
                              );
                            })}
                            <td style={{ padding: "4px", textAlign: "center" }}>
                              {isCloser ? (
                                <span style={{ color: "#C7C7CC" }}>—</span>
                              ) : (
                                <NI
                                  w={40}
                                  value={(kpiIn[rid] && kpiIn[rid].creditFailCount) || "0"}
                                  onChange={function (e) {
                                    var val = e.target.value;
                                    setKpiIn(function (prev) {
                                      var n = { ...prev };
                                      var rowB = { ...n[rid] };
                                      var nc = parseInt(val, 10) || 0;
                                      if (nc < 0) nc = 0;
                                      if (nc > 30) nc = 30;
                                      var assign = rowB.creditFailAssignCloser || (closers[0] ? closers[0][0] : "");
                                      var cf = [];
                                      for (var i = 0; i < nc; i++) cf.push({ closerId: assign });
                                      rowB.creditFailCount = String(nc);
                                      rowB.creditFails = cf;
                                      return { ...n, [rid]: rowB };
                                    });
                                  }}
                                />
                              )}
                            </td>
                            <td style={{ padding: "4px" }}>
                              {isCloser ? (
                                <span style={{ color: "#C7C7CC" }}>—</span>
                              ) : (
                                <select
                                  value={(kpiIn[rid] && kpiIn[rid].creditFailAssignCloser) || ""}
                                  onChange={function (e) {
                                    var v = e.target.value;
                                    setKpiIn(function (prev) {
                                      var n = { ...prev };
                                      var rowB = { ...n[rid] };
                                      rowB.creditFailAssignCloser = v;
                                      var nc = parseInt(rowB.creditFailCount, 10) || 0;
                                      var cf = [];
                                      for (var i = 0; i < nc; i++) cf.push({ closerId: v });
                                      rowB.creditFails = cf;
                                      return { ...n, [rid]: rowB };
                                    });
                                  }}
                                  style={{ fontSize: 11, padding: "4px 6px", borderRadius: 6, border: "1px solid #E5E5EA", width: "100%", maxWidth: 120 }}
                                >
                                  <option value="">—</option>
                                  {closers.map(function (cp) {
                                    return (
                                      <option key={cp[0]} value={cp[0]}>
                                        {cp[1].name}
                                      </option>
                                    );
                                  })}
                                </select>
                              )}
                            </td>
                            <td style={{ padding: "4px" }}>
                              <input
                                type="text"
                                value={kpiNotes[rid] || ""}
                                onChange={function (e) {
                                  var val = e.target.value;
                                  setKpiNotes(function (prev) {
                                    return { ...prev, [rid]: val };
                                  });
                                }}
                                style={{ width: "100%", minWidth: 72, fontSize: 11, padding: "4px 6px", border: "1px solid #E5E5EA", borderRadius: 6 }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              ) : null}
            </div>
          ))}

        {tab === "knockerboard" && (
          !selM ? (
            <Card>
              <p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>Select a market or Region.</p>
            </Card>
          ) : (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px 0" }}>Knocker Board</h2>
            <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 12px 0" }}>
              {knockerBoardSub + numDays + " day" + (numDays > 1 ? "s" : "")}
            </p>
            {mvpWeek && mvpWeek.knocker.rid ? (
              <Card style={{ background: "linear-gradient(135deg,#FFF9E6,#FFF3CC)", border: "1px solid #E6C200", marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8E8E93", marginBottom: 6 }}>WEEK MVP (sets)</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: "#1C1C1E" }}>
                  {mvpWeek.knocker.name}
                  {mvpWeek.knocker.market ? <span style={{ fontWeight: 600, color: "#8E8E93" }}>{" · " + mvpWeek.knocker.market}</span> : null}
                </div>
                <div style={{ fontSize: 13, color: "#34C759", fontWeight: 700 }}>{mvpWeek.knocker.sets + " sets · week " + mvpWeek.weekStart + " → " + mvpWeek.weekEnd}</div>
              </Card>
            ) : null}
            <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
              {[["doors", "Doors"], ["convos", "Convos"], ["sets", "Sets"], ["d2c", "D2C%"], ["c2s", "C2S%"]].map(function (x) {
                return (
                  <Btn
                    key={x[0]}
                    v={lbSort === x[0] ? "primary" : "secondary"}
                    onClick={function () {
                      setLbSort(x[0]);
                    }}
                    style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8 }}
                  >
                    {x[1]}
                  </Btn>
                );
              })}
            </div>
            <Podium
              items={knockerLB.slice(0, 3).map(function (r) {
                return {
                  name: r.name,
                  sub:
                    (showBoardMarketCol ? r.market + " · " : "") +
                    (r.role === "closer" ? "Closer" : "Knocker") +
                    (r.streak > 0 ? " · 🔥" + r.streak + "d" : ""),
                  val: lbSort === "d2c" || lbSort === "c2s" ? r[lbSort] + "%" : r[lbSort],
                  metric: { doors: "Doors", convos: "Convos", sets: "Sets", d2c: "D2C%", c2s: "C2S%" }[lbSort],
                };
              })}
            />
            <Card style={{ padding: 0, overflow: "auto", borderRadius: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["#", "Rep"]
                      .concat(showBoardMarketCol ? ["Market"] : [])
                      .concat(["", "Strk", "Doors", "Convos", "Sets", "D2C%"])
                      .map(function (h) {
                        return (
                          <th key={h} style={{ ...ths, textAlign: h === "Rep" || h === "Market" || h === "" ? "left" : "center" }}>
                            {h}
                          </th>
                        );
                      })}
                  </tr>
                </thead>
                <tbody>
                  {knockerLB.map(function (r, i) {
                    var medal = i < 3 ? ["🥇", "🥈", "🥉"][i] : "";
                    return (
                      <tr key={r.rid} style={{ borderBottom: "1px solid #F2F2F7" }}>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 700, fontSize: medal ? 16 : 12, color: medal ? "#1C1C1E" : "#C7C7CC" }}>{medal || i + 1}</td>
                        <td style={{ padding: "10px 6px", fontWeight: 700 }}>
                          <button
                            type="button"
                            onClick={function () {
                              setProfileRepId(r.rid);
                            }}
                            style={{ background: "none", border: "none", padding: 0, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                          >
                            {r.name}
                          </button>
                        </td>
                        {showBoardMarketCol ? (
                          <td style={{ padding: "10px 6px", color: "#8E8E93", fontSize: 11 }}>{r.market}</td>
                        ) : null}
                        <td style={{ padding: "10px 2px" }}>{r.role === "closer" ? <RoleBadge role="closer" /> : null}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600, fontSize: 11 }}>{r.streak > 0 ? "🔥 " + r.streak : "—"}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.doors}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.convos}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.sets}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600, color: r.d2c > 40 ? "#34C759" : "#FF9500" }}>{r.d2c + "%"}</td>
                      </tr>
                    );
                  })}
                  {knockerLB.length === 0 && (
                    <tr>
                      <td colSpan={showBoardMarketCol ? 9 : 8} style={{ padding: 20, textAlign: "center", color: "#C7C7CC" }}>
                        No knocker data.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>
          )
        )}

        {tab === "closerboard" && (
          !selM ? (
            <Card>
              <p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>Select a market or Region.</p>
            </Card>
          ) : (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px 0" }}>Closer Board</h2>
            <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 12px 0" }}>
              {closerBoardSub + numDays + " day" + (numDays > 1 ? "s" : "")}
            </p>
            {mvpWeek && mvpWeek.closer.rid ? (
              <Card style={{ background: "linear-gradient(135deg,#E8F5FF,#D6EBFF)", border: "1px solid #64B5F6", marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8E8E93", marginBottom: 6 }}>WEEK MVP (closes)</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: "#1C1C1E" }}>
                  {mvpWeek.closer.name}
                  {mvpWeek.closer.market ? <span style={{ fontWeight: 600, color: "#8E8E93" }}>{" · " + mvpWeek.closer.market}</span> : null}
                </div>
                <div style={{ fontSize: 13, color: "#34C759", fontWeight: 700 }}>{mvpWeek.closer.closes + " closes · week " + mvpWeek.weekStart + " → " + mvpWeek.weekEnd}</div>
              </Card>
            ) : null}
            <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
              {[["closes", "Closes"], ["closeRate", "Close%"], ["selfGens", "Self-Gens"], ["hours", "Hours"]].map(function (x) {
                return (
                  <Btn
                    key={x[0]}
                    v={clSort === x[0] ? "primary" : "secondary"}
                    onClick={function () {
                      setClSort(x[0]);
                    }}
                    style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8 }}
                  >
                    {x[1]}
                  </Btn>
                );
              })}
            </div>
            <Podium
              items={closerLB.slice(0, 3).map(function (r) {
                var vm = { closes: r.closes, closeRate: r.closeRate + "%", selfGens: r.monthSelfGens, hours: r.hours };
                return {
                  name: r.name,
                  sub: (showBoardMarketCol ? r.market : "Closer") + (r.streak > 0 ? " · 🔥" + r.streak + "d" : ""),
                  val: vm[clSort],
                  metric: { closes: "Closes", closeRate: "Close%", selfGens: "Mo SG", hours: "Hours" }[clSort],
                };
              })}
            />
            <Card style={{ padding: 0, overflow: "auto", borderRadius: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["#", "Rep"]
                      .concat(showBoardMarketCol ? ["Market"] : [])
                      .concat(["Strk", "Appts", "Closed", "Close%", "CAD%", "Hrs", "Hrs/Day", "Mo SG"])
                      .map(function (h) {
                        return (
                          <th key={h} style={{ ...ths, textAlign: h === "Rep" || h === "Market" ? "left" : "center" }}>
                            {h}
                          </th>
                        );
                      })}
                  </tr>
                </thead>
                <tbody>
                  {closerLB.map(function (r, i) {
                    var medal = i < 3 ? ["🥇", "🥈", "🥉"][i] : "";
                    return (
                      <tr key={r.rid} style={{ borderBottom: "1px solid #F2F2F7" }}>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 700, fontSize: medal ? 16 : 12, color: medal ? "#1C1C1E" : "#C7C7CC" }}>{medal || i + 1}</td>
                        <td style={{ padding: "10px 6px", fontWeight: 700 }}>
                          <button
                            type="button"
                            onClick={function () {
                              setProfileRepId(r.rid);
                            }}
                            style={{ background: "none", border: "none", padding: 0, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                          >
                            {r.name}
                          </button>
                        </td>
                        {showBoardMarketCol ? (
                          <td style={{ padding: "10px 6px", color: "#8E8E93", fontSize: 11 }}>{r.market}</td>
                        ) : null}
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600, fontSize: 11 }}>{r.streak > 0 ? "🔥 " + r.streak : "—"}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.apptsRan}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 700, color: "#34C759" }}>{r.closes}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.closeRate + "%"}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600, color: r.cadRate > 30 ? "#FF3B30" : "#8E8E93" }}>{r.cadRate + "%"}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600, color: r.hours < 5 * r.days ? "#FF3B30" : "#34C759" }}>{r.hours}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.hoursAvg}</td>
                        <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 800, fontSize: 14, color: r.monthSelfGens < 1 ? "#FF3B30" : r.monthSelfGens >= 3 ? "#34C759" : "#1C1C1E" }}>{r.monthSelfGens}</td>
                      </tr>
                    );
                  })}
                  {closerLB.length === 0 && (
                    <tr>
                      <td colSpan={showBoardMarketCol ? 11 : 10} style={{ padding: 20, textAlign: "center", color: "#C7C7CC" }}>
                        No closer data.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>
          )
        )}

        {tab === "trends" &&
          (!selM ? (
            <Card>
              <p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>Select a market or Region.</p>
            </Card>
          ) : (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 14px 0" }}>
                {isRegion(selM) ? "Trends — Region" : "Trends"}
              </h2>
              {!trendHasData ? (
                <Card>
                  <p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>No data in range.</p>
                </Card>
              ) : (
                <div>
                  <Card>
                    <SL>Activity</SL>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#8E8E93" }} />
                        <YAxis tick={{ fontSize: 10, fill: "#8E8E93" }} />
                        <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12, border: "none", boxShadow: shL }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="doors" fill="#1C1C1E" radius={[6, 6, 0, 0]} name="Doors" />
                        <Bar dataKey="convos" fill="#FF3B30" radius={[6, 6, 0, 0]} name="Convos" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                  <Card>
                    <SL>Production</SL>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#8E8E93" }} />
                        <YAxis tick={{ fontSize: 10, fill: "#8E8E93" }} />
                        <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12, border: "none", boxShadow: shL }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="sets" stroke="#FF3B30" strokeWidth={2.5} dot={{ r: 3 }} name="Sets" />
                        <Line type="monotone" dataKey="closes" stroke="#34C759" strokeWidth={2.5} dot={{ r: 3 }} name="Closes" />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>
                </div>
              )}
            </div>
          ))}

        {tab === "accountability" &&
          (!selM || isRegion(selM) ? (
            <Card>
              <p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>Select a single market for the accountability log.</p>
            </Card>
          ) : (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 14px 0" }}>Accountability Log</h2>
              {curReps.map(function (p) {
                var rid = p[0],
                  rep = p[1],
                  log = data.accountabilityLog[rid] || [],
                  ns = nSev(data.accountabilityLog, rid);
                return (
                  <Card key={rid} bc={log.length > 0 ? ns.color : undefined}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: log.length > 0 ? 10 : 0, flexWrap: "wrap", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          onClick={function () {
                            setProfileRepId(rid);
                          }}
                          style={{
                            fontWeight: 700,
                            fontSize: 15,
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            textDecoration: "underline",
                          }}
                        >
                          {rep.name}
                        </button>
                        <RoleBadge role={rep.role} />
                        <Badge text={log.length + " incident" + (log.length !== 1 ? "s" : "")} color={log.length > 0 ? "#FF3B30" : "#8E8E93"} bg={log.length > 0 ? "#FFF0EF" : "#F2F2F7"} />
                        {log.length > 0 ? <Badge text={"Next: " + ns.label} color={ns.color} bg={ns.bg} /> : null}
                      </div>
                      <Btn
                        onClick={function () {
                          openLog(rid);
                        }}
                        style={{ fontSize: 12, padding: "6px 14px" }}
                      >
                        + Log
                      </Btn>
                    </div>
                    {log.map(function (e) {
                      var sev = SEV.find(function (sv) {
                        return sv.key === e.severity;
                      }) || SEV[0];
                      return (
                        <div key={e.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, fontSize: 12 }}>
                          <span style={{ color: "#8E8E93", minWidth: 68 }}>{e.date}</span>
                          <Badge text={sev.label} color={sev.color} bg={sev.bg} />
                          <span style={{ color: "#3A3A3C", flex: 1 }}>{e.note}</span>
                          <button
                            onClick={function () {
                              delLogE(rid, e.id);
                            }}
                            style={{ fontSize: 10, color: "#C7C7CC", background: "none", border: "none", cursor: "pointer" }}
                          >
                            x
                          </button>
                        </div>
                      );
                    })}
                  </Card>
                );
              })}
            </div>
          ))}

        {tab === "challenge" && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 8px 0" }}>Office challenge</h2>
            <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 14px 0" }}>Compare two markets using the date range above.</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8E8E93", marginBottom: 6 }}>Market A</div>
                <select
                  value={chA || ""}
                  onChange={function (e) {
                    setChMktA(e.target.value || null);
                  }}
                  style={{ fontSize: 14, padding: "10px 14px", borderRadius: 10, border: "1px solid #E5E5EA", minWidth: 160 }}
                >
                  {mIds.map(function (id) {
                    return (
                      <option key={id} value={id}>
                        {data.markets[id].name}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8E8E93", marginBottom: 6 }}>Market B</div>
                <select
                  value={chB || ""}
                  onChange={function (e) {
                    setChMktB(e.target.value || null);
                  }}
                  style={{ fontSize: 14, padding: "10px 14px", borderRadius: 10, border: "1px solid #E5E5EA", minWidth: 160 }}
                >
                  {mIds.map(function (id) {
                    return (
                      <option key={id} value={id}>
                        {data.markets[id].name}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
            {chAstats && chBstats && chA !== chB ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { label: "Market A", id: chA, s: chAstats },
                  { label: "Market B", id: chB, s: chBstats },
                ].map(function (col) {
                  return (
                    <Card key={col.id} bc={challengeWinner === col.id ? "#34C759" : undefined}>
                      <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>{data.markets[col.id] ? data.markets[col.id].name : ""}</div>
                      <div style={{ fontSize: 13, color: "#8E8E93", marginBottom: 10 }}>{challengeDates.length + " days in range"}</div>
                      <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
                        <div>
                          <strong>{col.s.doors}</strong> doors
                        </div>
                        <div>
                          <strong>{col.s.convos}</strong> convos
                        </div>
                        <div>
                          <strong>{col.s.sets}</strong> sets
                        </div>
                        <div>
                          <strong style={{ color: "#34C759" }}>{col.s.closes}</strong> closes
                        </div>
                        <div>
                          D2C <strong>{col.s.d2c}</strong>%
                        </div>
                        <div>
                          C2S <strong>{col.s.c2s}</strong>%
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <p style={{ color: "#8E8E93", margin: 0 }}>Pick two different markets.</p>
              </Card>
            )}
          </div>
        )}

        {tab === "report" && (
          <div className="weekly-report-print" style={{ maxWidth: 720 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px 0" }}>Weekly report</h2>
                <p style={{ fontSize: 12, color: "#8E8E93", margin: 0 }}>Last 7 days · select a single market in the header</p>
              </div>
              <span className="no-print">
                <Btn
                  v="secondary"
                  onClick={function () {
                    window.print();
                  }}
                  style={{ borderRadius: 10 }}
                >
                  Print / PDF
                </Btn>
              </span>
            </div>
            {!reportMarketId ? (
              <Card>
                <p style={{ color: "#8E8E93", margin: 0 }}>Select one market (not Region) to generate the report.</p>
              </Card>
            ) : (
              <div>
                <Card>
                  <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12 }}>{data.markets[reportMarketId].name}</div>
                  <div style={{ fontSize: 13, color: "#8E8E93", marginBottom: 14 }}>{report7[0] + " → " + report7[report7.length - 1]}</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <StatCard label="Doors" value={reportAgg ? reportAgg.doors : 0} />
                    <StatCard label="Convos" value={reportAgg ? reportAgg.convos : 0} />
                    <StatCard label="Sets" value={reportAgg ? reportAgg.sets : 0} />
                    <StatCard label="Closes" value={reportAgg ? reportAgg.closes : 0} v="green" />
                    <StatCard label="D2C%" value={reportAgg ? reportAgg.d2c : 0} />
                    <StatCard label="C2S%" value={reportAgg ? reportAgg.c2s : 0} />
                  </div>
                  {reportAgg && reportAggPrev ? (
                    <p style={{ fontSize: 12, color: "#8E8E93", marginTop: 12, marginBottom: 0 }}>
                      vs prior week: closes {reportAgg.closes - reportAggPrev.closes >= 0 ? "+" : ""}
                      {reportAgg.closes - reportAggPrev.closes} · doors {reportAgg.doors - reportAggPrev.doors >= 0 ? "+" : ""}
                      {reportAgg.doors - reportAggPrev.doors}
                    </p>
                  ) : null}
                </Card>
                <Card>
                  <SL>Top performers (production)</SL>
                  {reportTopPerformers.length === 0 ? (
                    <p style={{ color: "#C7C7CC", fontSize: 13 }}>No data.</p>
                  ) : (
                    reportTopPerformers.map(function (a, i) {
                      var prod = a.role === "closer" ? a.stats.apptsClosed : a.stats.closes;
                      return (
                        <div key={a.rid} style={{ padding: "8px 0", borderBottom: "1px solid #F2F2F7", display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 800, color: "#C7C7CC" }}>{i + 1}</span>
                          <button
                            type="button"
                            onClick={function () {
                              setProfileRepId(a.rid);
                            }}
                            style={{ fontWeight: 700, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                          >
                            {a.rep.name}
                          </button>
                          <RoleBadge role={a.rep.role} />
                          <span style={{ marginLeft: "auto", color: "#34C759", fontWeight: 700 }}>{prod + " closes"}</span>
                        </div>
                      );
                    })
                  )}
                </Card>
                <Card>
                  <SL color="#FF3B30">Reps needing action</SL>
                  {reportActionReps.length === 0 ? (
                    <p style={{ color: "#34C759", fontWeight: 600 }}>None flagged.</p>
                  ) : (
                    reportActionReps.map(function (a) {
                      return (
                        <div key={a.rid} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #F2F2F7" }}>
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>
                            <button
                              type="button"
                              onClick={function () {
                                setProfileRepId(a.rid);
                              }}
                              style={{ fontWeight: 700, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                            >
                              {a.rep.name}
                            </button>{" "}
                            <RoleBadge role={a.rep.role} />
                          </div>
                          <div style={{ fontSize: 12, color: "#FF3B30" }}>
                            {a.actionFlags.map(function (f) {
                              return (
                                <span key={f.label} style={{ marginRight: 8 }}>
                                  • {f.label}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </Card>
              </div>
            )}
          </div>
        )}

        {tab === "rollup" && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px 0" }}>All Markets</h2>
            <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 16px 0" }}>
              {"Ranked by closes · " + numDays + " day" + (numDays > 1 ? "s" : "")}
            </p>
            <Podium items={rollupData.slice(0, 3).map(function (m) { return { name: m.name, sub: m.knockers + "K / " + m.closers + "C", val: m.cl, metric: "Closes" }; })} />
            {rollupData.map(function (m, i) {
              var medal = i < 3 ? ["🥇", "🥈", "🥉"][i] : "";
              return (
                <Card key={m.id} style={{ cursor: "pointer" }} bc={i < 3 ? ["#FFD700", "#C0C0C0", "#CD7F32"][i] : undefined}>
                  <div
                    onClick={function () {
                      setSelM(m.id);
                      setTab("dashboard");
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
                  >
                    <span style={{ fontSize: medal ? 24 : 16, width: 32, textAlign: "center", fontWeight: 800, color: medal ? "#1C1C1E" : "#C7C7CC" }}>{medal || i + 1}</span>
                    <div style={{ flex: 1, minWidth: 100 }}>
                      <div style={{ fontWeight: 800, fontSize: 17 }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: "#8E8E93" }}>{m.knockers + " knockers · " + m.closers + " closers"}</div>
                    </div>
                    <div style={{ display: "flex", gap: 14 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{m.d}</div>
                        <div style={{ fontSize: 9, color: "#8E8E93", fontWeight: 600, textTransform: "uppercase" }}>Doors</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{m.s}</div>
                        <div style={{ fontSize: 9, color: "#8E8E93", fontWeight: 600, textTransform: "uppercase" }}>Sets</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: "#34C759" }}>{m.cl}</div>
                        <div style={{ fontSize: 9, color: "#8E8E93", fontWeight: 600, textTransform: "uppercase" }}>Closes</div>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {tab === "manage" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 14px 0" }}>Manage</h2>
            <Card>
              <SL>Markets</SL>
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <input
                  value={newMkt}
                  onChange={function (e) {
                    setNewMkt(e.target.value);
                  }}
                  placeholder="Market name..."
                  onKeyDown={function (e) {
                    if (e.key === "Enter") addMarket();
                  }}
                  style={{ flex: "1 1 140px", fontSize: 14, padding: "10px 14px", border: "1.5px solid #E5E5EA", borderRadius: 10, outline: "none", background: "#FAFAFA" }}
                />
                <Btn onClick={addMarket} style={{ borderRadius: 10 }}>
                  + Market
                </Btn>
              </div>
              {mIds.map(function (mId) {
                var kc = Object.values(data.reps).filter(function (r) { return r.marketId === mId && onRoster(r) && r.role !== "closer"; }).length;
                var cc = Object.values(data.reps).filter(function (r) { return r.marketId === mId && onRoster(r) && r.role === "closer"; }).length;
                return (
                  <div key={mId} style={{ padding: "10px 0", borderBottom: "1px solid #F2F2F7", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{data.markets[mId].name}</span>
                    <Badge text={kc + "K / " + cc + "C"} />
                    <label style={{ fontSize: 11, color: "#8E8E93", display: "flex", alignItems: "center", gap: 4 }}>
                      Avg deal $
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={data.markets[mId].averageDealValue != null ? data.markets[mId].averageDealValue : ""}
                        onChange={function (e) {
                          setMarketDealValue(mId, e.target.value);
                        }}
                        placeholder="0"
                        style={{ width: 80, fontSize: 13, padding: "6px 8px", borderRadius: 8, border: "1px solid #E5E5EA" }}
                      />
                    </label>
                    <Btn v="ghost" onClick={function () { delMarket(mId); }} style={{ marginLeft: "auto", fontSize: 12, color: "#FF3B30" }}>
                      Delete
                    </Btn>
                  </div>
                );
              })}
            </Card>
            <Card>
              <SL>Defaults</SL>
              <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                Company average deal ($) — used when a market has no value set
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={data.settings && data.settings.averageDealValue != null ? data.settings.averageDealValue : ""}
                  onChange={function (e) {
                    setGlobalDealValue(e.target.value);
                  }}
                  style={{ width: 100, fontSize: 14, padding: "8px 12px", borderRadius: 10, border: "1px solid #E5E5EA" }}
                />
              </label>
            </Card>
            {isRegion(selM) ? (
              <Card>
                <p style={{ color: "#8E8E93", margin: 0 }}>Select a single market in the header to add or edit reps.</p>
              </Card>
            ) : null}
            {selM && !isRegion(selM) ? (
              <Card>
                <SL>{"Reps — " + (data.markets[selM] ? data.markets[selM].name : "")}</SL>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, fontWeight: 600, color: "#8E8E93" }}>
                  <input
                    type="checkbox"
                    checked={showTerminatedManage}
                    onChange={function (e) {
                      setShowTerminatedManage(e.target.checked);
                    }}
                  />
                  Show terminated
                </label>
                <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    value={newRep}
                    onChange={function (e) { setNewRep(e.target.value); }}
                    placeholder="Name..."
                    onKeyDown={function (e) { if (e.key === "Enter") addRep(); }}
                    style={{ flex: "1 1 100px", fontSize: 14, padding: "10px 14px", border: "1.5px solid #E5E5EA", borderRadius: 10, outline: "none", background: "#FAFAFA" }}
                  />
                  <select value={newRepRole} onChange={function (e) { setNewRepRole(e.target.value); }} style={{ fontSize: 14, fontWeight: 600, padding: "10px 14px", border: "1.5px solid #E5E5EA", borderRadius: 10, background: "#FAFAFA" }}>
                    <option value="knocker">Knocker</option>
                    <option value="closer">Closer</option>
                  </select>
                  <input type="date" value={newRepDate} onChange={function (e) { setNewRepDate(e.target.value); }} style={{ fontSize: 13, padding: "8px 12px", border: "1.5px solid #E5E5EA", borderRadius: 10, background: "#FAFAFA" }} />
                  <Btn onClick={addRep} style={{ borderRadius: 10 }}>
                    + Rep
                  </Btn>
                </div>
                {Object.entries(data.reps)
                  .filter(function (p) {
                    return p[1].marketId === selM && (showTerminatedManage || !p[1].terminated);
                  })
                  .sort(function (a, b) { return a[1].name.localeCompare(b[1].name); })
                  .map(function (p) {
                    var rid = p[0], rep = p[1], tl = tenureLabel(rep);
                    var isTerm = !!rep.terminated;
                    return (
                      <div key={rid} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0", borderBottom: "1px solid #F2F2F7", flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600, fontSize: 14, opacity: rep.active !== false && !isTerm ? 1 : 0.5 }}>{rep.name}</span>
                        <RoleBadge role={rep.role} />
                        {tl ? <Badge text={tl} /> : null}
                        {isTerm ? <Badge text="Terminated" color="#8B0000" bg="#FFE5E5" /> : null}
                        {rep.active === false && !isTerm ? <Badge text="Inactive" /> : null}
                        {!isTerm && rep.role !== "closer" ? (
                          <label style={{ fontSize: 11, color: "#8E8E93", display: "flex", alignItems: "center", gap: 4 }}>
                            Recruits
                            <input
                              type="number"
                              min={0}
                              value={rep.recruits != null ? rep.recruits : 0}
                              onChange={function (e) {
                                setRepRecruits(rid, e.target.value);
                              }}
                              style={{ width: 44, fontSize: 13, padding: "4px 6px", borderRadius: 6, border: "1px solid #E5E5EA" }}
                            />
                          </label>
                        ) : null}
                        <div style={{ marginLeft: "auto", display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {!isTerm ? (
                            <Btn v="secondary" onClick={function () { setRepRole(rid, rep.role === "closer" ? "knocker" : "closer"); }} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8 }}>
                              {rep.role === "closer" ? "To Knocker" : "To Closer"}
                            </Btn>
                          ) : null}
                          {!isTerm ? (
                            <Btn v="ghost" onClick={function () { togRep(rid); }} style={{ fontSize: 11, padding: "4px 10px", color: rep.active !== false ? "#FF3B30" : "#34C759" }}>
                              {rep.active !== false ? "Deact" : "React"}
                            </Btn>
                          ) : null}
                          {!isTerm ? (
                            <Btn v="ghost" onClick={function () { terminateRep(rid); }} style={{ fontSize: 11, padding: "4px 10px", color: "#8B0000" }}>
                              Terminate
                            </Btn>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
              </Card>
            ) : null}
            <Card style={{ marginTop: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: 800, fontSize: 15, color: "#1C1C1E" }}>Activity log</span>
                <button
                  type="button"
                  onClick={function () {
                    setEventLogOpen(!eventLogOpen);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: "6px 0",
                    cursor: "pointer",
                    fontSize: 12,
                    color: "#8E8E93",
                    fontWeight: 700,
                  }}
                >
                  {eventLogOpen ? "Hide" : "Show"}
                </button>
              </div>
              <p style={{ fontSize: 12, color: "#8E8E93", margin: "6px 0 0 0", lineHeight: 1.45 }}>
                Open the log to choose a time range and export. Filters use the header office plus the range below; export matches the list.
                {isRegion(selM)
                  ? " All Offices includes company-wide and access events."
                  : data.markets[selM]
                    ? " Only events tagged for " + data.markets[selM].name + " appear; choose All Offices for company-wide and access activity."
                    : ""}
              </p>
              {eventLogOpen ? (
                <div style={{ marginTop: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-start",
                      gap: 8,
                      flexWrap: "wrap",
                      marginBottom: 10,
                    }}
                  >
                    <select
                      aria-label="Activity log time range"
                      value={activityLogRange}
                      onChange={function (e) {
                        setActivityLogRange(e.target.value);
                      }}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #E5E5EA",
                        background: "#fff",
                        color: "#1C1C1E",
                        maxWidth: "100%",
                      }}
                    >
                      <option value="day">Last 24 hours</option>
                      <option value="week">Last 7 days</option>
                      <option value="month">Last 30 days</option>
                      <option value="all">All time</option>
                    </select>
                    <Btn
                      v="secondary"
                      onClick={function (e) {
                        e.stopPropagation();
                        exportActivityLogTxt();
                      }}
                      style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8 }}
                    >
                      Export .txt
                    </Btn>
                  </div>
                  <div
                    style={{
                      maxHeight: 360,
                      overflowY: "auto",
                      borderRadius: 10,
                      border: "1px solid #E5E5EA",
                      background: "#FAFAFA",
                    }}
                  >
                  {function () {
                    var ev = Array.isArray(data.eventLog) ? data.eventLog : [];
                    var filtered = ev.filter(function (e) {
                      return eventLogEntryMatchesFilters(selM, activityLogRange, e);
                    });
                    if (ev.length === 0) {
                      return <p style={{ margin: 0, padding: 16, color: "#8E8E93", fontSize: 13, textAlign: "center" }}>No activity recorded yet.</p>;
                    }
                    if (filtered.length === 0) {
                      return (
                        <p style={{ margin: 0, padding: 16, color: "#8E8E93", fontSize: 13, textAlign: "center" }}>
                          No entries for this office and time range. Try All Offices, a wider range, or All time.
                        </p>
                      );
                    }
                    return (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {filtered.map(function (e, i) {
                        var when = e && e.ts ? new Date(e.ts).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—";
                        var actor = e && e.actor ? e.actor : "";
                        var msg = e && e.message ? e.message : "";
                        return (
                          <li
                            key={(e.ts || "") + "-" + i + "-" + (e.message || "").slice(0, 12)}
                            style={{
                              padding: "10px 14px",
                              borderBottom: i < filtered.length - 1 ? "1px solid #E5E5EA" : "none",
                              fontSize: 13,
                            }}
                          >
                            <div style={{ fontSize: 11, color: "#8E8E93", fontWeight: 600, marginBottom: 4 }}>
                              {when}
                              {actor ? <span style={{ fontWeight: 500 }}> · {actor}</span> : null}
                            </div>
                            <div style={{ color: "#1C1C1E", lineHeight: 1.4 }}>{msg}</div>
                          </li>
                        );
                      })}
                    </ul>
                    );
                  }()}
                  </div>
                </div>
              ) : null}
            </Card>
          </div>
        )}
        </div>
      </div>

      {tab === "enter" && selM && !isRegion(selM) && curReps.length > 0 ? (
        <div className="no-print" style={{ position: "fixed", right: 20, bottom: 22, zIndex: 95 }}>
          <Btn
            onClick={saveKPIs}
            style={{
              padding: "14px 22px",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 999,
              boxShadow: shL,
            }}
          >
            Save changes
          </Btn>
        </div>
      ) : null}

      {profileRep && profileRid ? (
        <div
          onClick={function () {
            setProfileRepId(null);
          }}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 998,
            padding: 16,
            overflowY: "auto",
          }}
        >
          <div
            onClick={function (e) {
              e.stopPropagation();
            }}
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: 22,
              maxWidth: 720,
              margin: "24px auto",
              boxShadow: shL,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px 0" }}>{profileRep.name}</h2>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <RoleBadge role={profileRep.role} />
                  {tenureLabel(profileRep) ? <Badge text={tenureLabel(profileRep)} /> : null}
                  {profStreak > 0 ? <Badge text={"🔥 " + profStreak + "-day streak"} color="#FF6B00" bg="#FFF3E8" /> : null}
                  {data.markets[profileRep.marketId] ? <Badge text={data.markets[profileRep.marketId].name} /> : null}
                </div>
              </div>
              <Btn v="secondary" onClick={function () { setProfileRepId(null); }} style={{ borderRadius: 10 }}>
                Close
              </Btn>
            </div>
            {mvpWeek && (mvpWeek.knocker.rid === profileRid || mvpWeek.closer.rid === profileRid) ? (
              <Card style={{ background: "#FFF9E6", border: "1px solid #FFD700", marginBottom: 12 }}>
                <span style={{ fontWeight: 800 }}>This week&apos;s MVP</span>
                <span style={{ color: "#8E8E93", marginLeft: 8 }}>
                  {mvpWeek.knocker.rid === profileRid ? mvpWeek.knocker.sets + " sets" : mvpWeek.closer.closes + " closes"}
                </span>
              </Card>
            ) : null}
            {profPromo ? (
              <Card>
                <SL>Promotion to closer</SL>
                <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 8px 0" }}>Need {PROMO_SALES_NEED}+ sales credits (closes + 0.5×CF) two months in a row + {PROMO_RECRUITS_NEED} recruits.</p>
                <div style={{ height: 10, background: "#F2F2F7", borderRadius: 8, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ width: profPromo.barPct + "%", height: "100%", background: profPromo.qualified ? "#34C759" : "#FF9500", transition: "width 0.3s" }} />
                </div>
                <div style={{ fontSize: 13, display: "flex", flexWrap: "wrap", gap: 12 }}>
                  <span>
                    This mo: <strong>{profPromo.cur.toFixed(1)}</strong> / {PROMO_SALES_NEED}
                  </span>
                  <span>
                    Last mo: <strong>{profPromo.prev.toFixed(1)}</strong> / {PROMO_SALES_NEED}
                  </span>
                  <span>
                    Recruits: <strong>{profPromo.recruits}</strong> / {PROMO_RECRUITS_NEED}
                  </span>
                  {profPromo.qualified ? <Badge text="Qualified" color="#34C759" bg="#F0FFF4" /> : null}
                </div>
              </Card>
            ) : null}
            {profileRep.role === "closer" ? (
              <Card>
                <SL>Est. revenue (this month)</SL>
                <p style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
                  ${profRevEst.toLocaleString()}
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#8E8E93", marginLeft: 8 }}>{profMonthCloses + " closes × $" + profDeal}</span>
                </p>
              </Card>
            ) : null}
            {profRamp ? (
              <Card>
                <SL>New hire ramp (first 30 days)</SL>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
                  <div>
                    <strong>Wk 1</strong> avg doors {profRamp.w1.doors}, sets {profRamp.w1.sets}
                  </div>
                  <div>
                    <strong>Wk 2</strong> avg doors {profRamp.w2.doors}, sets {profRamp.w2.sets}
                  </div>
                  <div>
                    <strong>Wk 3</strong> avg doors {profRamp.w3.doors}, sets {profRamp.w3.sets}
                  </div>
                </div>
              </Card>
            ) : null}
            {profBests ? (
              <Card>
                <SL>Personal bests (single day)</SL>
                <div style={{ fontSize: 13, display: "flex", flexWrap: "wrap", gap: 14 }}>
                  {profileRep.role === "closer" ? (
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                      <span>Doors {profBests.doors}</span>
                      <span>Convos {profBests.convos}</span>
                      <span>Closed {profBests.apptsClosed}</span>
                    </span>
                  ) : (
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                      <span>Doors {profBests.doors}</span>
                      <span>Convos {profBests.convos}</span>
                      <span>Sets {profBests.sets}</span>
                      <span>Closes {profBests.closes}</span>
                    </span>
                  )}
                </div>
              </Card>
            ) : null}
            {profStats30 ? (
              <Card>
                <SL>Last 30 days — conversion</SL>
                <p style={{ fontSize: 14, margin: 0 }}>
                  D2C <strong>{profStats30.stats.d2c}%</strong> · C2S <strong>{profStats30.stats.c2s}%</strong>
                  {profileRep.role === "closer" ? (
                    <span>
                      {" "}
                      · Close rate <strong>{profStats30.stats.closeRate}%</strong>
                    </span>
                  ) : null}
                </p>
              </Card>
            ) : null}
            <Card>
              <SL>Trends (7 / 14 / 30 days)</SL>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#8E8E93", marginBottom: 4 }}>7 days</div>
                <ResponsiveContainer width="100%" height={140}>
                  {profileRep.role === "closer" ? (
                    <LineChart data={prof7}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="closed" stroke="#34C759" name="Closed" dot={false} />
                      <Line type="monotone" dataKey="appts" stroke="#1C1C1E" name="Appts" dot={false} />
                    </LineChart>
                  ) : (
                    <LineChart data={prof7}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="doors" stroke="#1C1C1E" name="Doors" dot={false} />
                      <Line type="monotone" dataKey="sets" stroke="#FF3B30" name="Sets" dot={false} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#8E8E93", marginBottom: 4 }}>14 days</div>
                <ResponsiveContainer width="100%" height={140}>
                  {profileRep.role === "closer" ? (
                    <LineChart data={prof14}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="closed" stroke="#34C759" dot={false} />
                    </LineChart>
                  ) : (
                    <LineChart data={prof14}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="doors" stroke="#1C1C1E" dot={false} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#8E8E93", marginBottom: 4 }}>30 days</div>
                <ResponsiveContainer width="100%" height={160}>
                  {profileRep.role === "closer" ? (
                    <LineChart data={prof30}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="closed" stroke="#34C759" dot={false} />
                    </LineChart>
                  ) : (
                    <LineChart data={prof30}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="sets" stroke="#FF3B30" dot={false} />
                      <Line type="monotone" dataKey="closes" stroke="#34C759" dot={false} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
            </Card>
            <Card style={{ padding: 0, overflow: "auto" }}>
              <div style={{ padding: "18px 18px 0" }}>
                <SL>Daily KPIs (last 30 days)</SL>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={ths}>Date</th>
                    {profileRep.role === "closer"
                      ? ["Appts", "Closed", "CAD", "Conv", "Doors", "SG C"].map(function (h) {
                          return (
                            <th key={h} style={ths}>
                              {h}
                            </th>
                          );
                        })
                      : ["Doors", "Conv", "Sets", "Appt", "Close", "CF"].map(function (h) {
                          return (
                            <th key={h} style={ths}>
                              {h}
                            </th>
                          );
                        })}
                  </tr>
                </thead>
                <tbody>
                  {profLast30Dates
                    .slice()
                    .reverse()
                    .map(function (ds) {
                      var k = gK(data, profileRid, ds);
                      return (
                        <tr key={ds} style={{ borderBottom: "1px solid #F2F2F7" }}>
                          <td style={{ padding: 6 }}>{ds}</td>
                          {profileRep.role === "closer" ? (
                            <>
                              <td style={{ textAlign: "center", padding: 6 }}>{k ? k.apptsRan || 0 : "—"}</td>
                              <td style={{ textAlign: "center", padding: 6 }}>{k ? k.apptsClosed || 0 : "—"}</td>
                              <td style={{ textAlign: "center", padding: 6 }}>{k ? k.cads || 0 : "—"}</td>
                              <td style={{ textAlign: "center", padding: 6 }}>{k ? k.convosHad || 0 : "—"}</td>
                              <td style={{ textAlign: "center", padding: 6 }}>{k ? k.doorsKnocked || 0 : "—"}</td>
                              <td style={{ textAlign: "center", padding: 6 }}>{k ? k.selfGenCloses || 0 : "—"}</td>
                            </>
                          ) : (
                            <>
                              <td style={{ textAlign: "center", padding: 6 }}>{k ? k.doorsKnocked || 0 : "—"}</td>
                              <td style={{ textAlign: "center", padding: 6 }}>{k ? k.convosHad || 0 : "—"}</td>
                              <td style={{ textAlign: "center", padding: 6 }}>{k ? k.setsSet || 0 : "—"}</td>
                              <td style={{ textAlign: "center", padding: 6 }}>{k ? k.apptsRan || 0 : "—"}</td>
                              <td style={{ textAlign: "center", padding: 6 }}>{k ? k.closes || 0 : "—"}</td>
                              <td style={{ textAlign: "center", padding: 6 }}>{k && k.creditFails ? k.creditFails.length : "—"}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </Card>
            <Card>
              <SL>Accountability</SL>
              {(data.accountabilityLog[profileRid] || []).length === 0 ? (
                <p style={{ color: "#C7C7CC", fontSize: 13 }}>No entries.</p>
              ) : (
                (data.accountabilityLog[profileRid] || []).map(function (e) {
                  var sev = SEV.find(function (sv) {
                    return sv.key === e.severity;
                  }) || SEV[0];
                  return (
                    <div key={e.id} style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 13 }}>
                      <span style={{ color: "#8E8E93", minWidth: 72 }}>{e.date}</span>
                      <Badge text={sev.label} color={sev.color} bg={sev.bg} />
                      <span>{e.note}</span>
                    </div>
                  );
                })
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {showLog && logRep ? (
        <div
          onClick={function () {
            setShowLog(false);
          }}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            padding: 16,
          }}
        >
          <div
            onClick={function (e) {
              e.stopPropagation();
            }}
            style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}
          >
            <h3 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 4px 0" }}>Log Incident</h3>
            <p style={{ fontSize: 13, color: "#8E8E93", margin: "0 0 14px 0" }}>
              {(data.reps[logRep] ? data.reps[logRep].name : "") + " — Auto: "}
              <strong style={{ color: nSev(data.accountabilityLog, logRep).color }}>{nSev(data.accountabilityLog, logRep).label}</strong>
            </p>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
              {SEV.map(function (s) {
                return (
                  <button
                    key={s.key}
                    onClick={function () {
                      setLogSevO(logSevO === s.key ? null : s.key);
                    }}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: logSevO === s.key ? "2px solid " + s.color : "1.5px solid #E5E5EA",
                      background: logSevO === s.key ? s.bg : "#fff",
                      color: s.color,
                      cursor: "pointer",
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <textarea
              value={logNote}
              onChange={function (e) {
                setLogNote(e.target.value);
              }}
              placeholder="What happened?..."
              rows={3}
              style={{ width: "100%", fontSize: 14, padding: 12, border: "1.5px solid #E5E5EA", borderRadius: 12, resize: "vertical", boxSizing: "border-box", outline: "none", background: "#FAFAFA" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 12 }}>
              <Btn v="secondary" onClick={function () { setShowLog(false); }} style={{ borderRadius: 10 }}>
                Cancel
              </Btn>
              <Btn onClick={saveLog} disabled={!logNote.trim()} style={{ borderRadius: 10 }}>
                Save
              </Btn>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

