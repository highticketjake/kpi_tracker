import { useState, useEffect, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, Legend } from "recharts";

var SK = "kpi-tracker-v7";
var DD = { markets: {}, reps: {}, dailyKPIs: {}, accountabilityLog: {} };
var TODAY = new Date().toISOString().split("T")[0];

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
var SEV = [
  { key: "coaching", label: "Coaching", color: "#FF9500", bg: "#FFF8EE" },
  { key: "warning", label: "Written Warning", color: "#FF6B00", bg: "#FFF3E8" },
  { key: "final", label: "Final Warning", color: "#FF3B30", bg: "#FFF0EF" },
  { key: "termination", label: "Termination", color: "#8B0000", bg: "#FFE5E5" },
];

function gid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); }
function pct(a, b) { return b > 0 ? Math.round(a / b * 1000) / 10 : 0; }
function daysBetween(a, b) { return Math.floor((new Date(b) - new Date(a)) / 86400000); }

function getDatesInRange(start, end) {
  var d = []; var cur = new Date(start);
  var endD = new Date(end);
  while (cur <= endD) { d.push(cur.toISOString().split("T")[0]); cur.setDate(cur.getDate() + 1); }
  return d;
}

function daysAgo(n) { var d = new Date(TODAY); d.setDate(d.getDate() - n); return d.toISOString().split("T")[0]; }
function monthStart() { return TODAY.slice(0, 8) + "01"; }

async function load() {
  if (typeof window === "undefined" || !window.storage) return DD;
  var keys = [SK, "kpi-tracker-v6", "kpi-tracker-v5", "kpi-tracker-v4", "kpi-tracker-v3"];
  for (var i = 0; i < keys.length; i++) { try { var r = await window.storage.get(keys[i]); if (r && r.value) return { ...DD, ...JSON.parse(String(r.value)) }; } catch (e) {} }
  return DD;
}
async function save(d) { if (typeof window !== "undefined" && window.storage) { try { await window.storage.set(SK, JSON.stringify(d)); } catch (e) {} } }

function kk(rid, dt) { return rid + "__" + dt; }
function gK(d, rid, dt) { return d.dailyKPIs[kk(rid, dt)] || null; }
function offCt(log, rid) { return (log[rid] || []).length; }
function nSev(log, rid) { return SEV[Math.min(offCt(log, rid), SEV.length - 1)]; }
function mReps(d, mId, role) { return Object.entries(d.reps).filter(function(p) { return p[1].marketId === mId && p[1].active !== false && (!role || p[1].role === role); }).sort(function(a, b) { return a[1].name.localeCompare(b[1].name); }); }
function allActive(d, role) { return Object.entries(d.reps).filter(function(p) { return p[1].active !== false && d.markets[p[1].marketId] && (!role || p[1].role === role); }); }

function closerHours(kpi) { return (kpi.apptsRan || 0) + (kpi.cads || 0) * 0.5 + (kpi.convosHad || 0) / 10; }

function getRangeStats(data, rid, dates) {
  var t = { setsSet: 0, apptsRan: 0, closes: 0, doorsKnocked: 0, convosHad: 0, apptsClosed: 0, cads: 0, selfGenSets: 0, selfGenCloses: 0, days: 0, hours: 0 };
  dates.forEach(function(d) { var k = gK(data, rid, d); if (k) { t.setsSet += k.setsSet || 0; t.apptsRan += k.apptsRan || 0; t.closes += k.closes || 0; t.doorsKnocked += k.doorsKnocked || 0; t.convosHad += k.convosHad || 0; t.apptsClosed += k.apptsClosed || 0; t.cads += k.cads || 0; t.selfGenSets += k.selfGenSets || 0; t.selfGenCloses += k.selfGenCloses || 0; t.hours += closerHours(k); t.days++; } });
  t.setsAvg = t.days > 0 ? Math.round(t.setsSet / t.days * 10) / 10 : 0;
  t.hoursAvg = t.days > 0 ? Math.round(t.hours / t.days * 10) / 10 : 0;
  t.closeRate = t.apptsRan > 0 ? pct(t.apptsClosed, t.apptsRan) : 0;
  t.cadRate = (t.apptsRan + t.cads) > 0 ? pct(t.cads, t.apptsRan + t.cads) : 0;
  t.d2c = pct(t.convosHad, t.doorsKnocked);
  t.c2s = pct(t.setsSet, t.convosHad);
  return t;
}

function getMonthSelfGens(data, rid, dt) {
  var ms = dt.slice(0, 8) + "01"; var total = 0;
  var dim = new Date(new Date(dt).getFullYear(), new Date(dt).getMonth() + 1, 0).getDate();
  for (var i = 0; i < dim; i++) { var d = new Date(ms); d.setDate(d.getDate() + i); var ds = d.toISOString().split("T")[0]; var k = gK(data, rid, ds); if (k) total += k.selfGenCloses || 0; }
  return total;
}

function tenureLabel(rep) {
  if (!rep || !rep.startDate) return "";
  var d = daysBetween(rep.startDate, TODAY);
  if (d < 0) return ""; if (d < 7) return "Day " + (d + 1); if (d < 30) return "Wk " + Math.ceil((d + 1) / 7); return Math.floor(d / 30) + "mo";
}

function analyzeKnocker(data, rid, rep, dates, endDate) {
  var s = getRangeStats(data, rid, dates);
  var flags = [];
  var lastDay = gK(data, rid, endDate);
  if (s.days === 0) { flags.push({ type: "action", label: "No data" }); }
  else {
    if (lastDay && (lastDay.doorsKnocked || 0) < 120) flags.push({ type: "action", label: "Doors: " + (lastDay.doorsKnocked || 0) + "/120" });
    if (lastDay && (lastDay.convosHad || 0) < 50) flags.push({ type: "action", label: "Convos: " + (lastDay.convosHad || 0) + "/50" });
    if (s.setsAvg < 3) flags.push({ type: "action", label: "Sets avg " + s.setsAvg });
    else if (s.setsAvg < 4) flags.push({ type: "coaching", label: "Sets avg " + s.setsAvg });
    var w7 = getRangeStats(data, rid, getDatesInRange(daysAgo(6), endDate));
    if (w7.apptsRan < 5) flags.push({ type: "action", label: "Wk appts " + w7.apptsRan + "/5" });
    if (w7.closes < 2) flags.push({ type: w7.closes === 0 ? "action" : "coaching", label: "Wk closes " + w7.closes + "/2" });
  }
  return { rid: rid, rep: rep, role: "knocker", stats: s, flags: flags, actionFlags: flags.filter(function(f) { return f.type === "action"; }), coachFlags: flags.filter(function(f) { return f.type === "coaching"; }) };
}

function analyzeCloser(data, rid, rep, dates, endDate) {
  var s = getRangeStats(data, rid, dates);
  var mSG = getMonthSelfGens(data, rid, endDate);
  var flags = [];
  if (s.days === 0) { flags.push({ type: "action", label: "No data" }); }
  else {
    if (s.hoursAvg < 4.5) flags.push({ type: "action", label: "Avg hrs " + s.hoursAvg + "/5" });
    else if (s.hoursAvg < 5) flags.push({ type: "coaching", label: "Avg hrs " + s.hoursAvg + "/5" });
  }
  var dom = parseInt(endDate.slice(8, 10));
  if (dom > 20 && mSG < 1) flags.push({ type: "action", label: "0 self-gens this month" });
  else if (dom > 14 && mSG < 1) flags.push({ type: "coaching", label: "0 self-gens mid-month" });
  return { rid: rid, rep: rep, role: "closer", stats: s, monthSelfGens: mSG, flags: flags, actionFlags: flags.filter(function(f) { return f.type === "action"; }), coachFlags: flags.filter(function(f) { return f.type === "coaching"; }) };
}

// ===== COMPONENTS =====
var sh = "0 1px 3px rgba(0,0,0,0.06)";
var shL = "0 4px 16px rgba(0,0,0,0.08)";

function Badge(p) { return <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, color: p.color || "#666", background: p.bg || "#F2F2F7" }}>{p.text}</span>; }
function Card(p) { return <div style={{ background: "#fff", borderRadius: 16, padding: 18, marginBottom: 12, boxShadow: sh, border: p.bc ? "2px solid " + p.bc : "1px solid rgba(0,0,0,0.04)", ...(p.style || {}) }}>{p.children}</div>; }
function StatCard(p) { var c = { red: { bg: "#FFF0EF", t: "#FF3B30", b: "#FFD4D1" }, amber: { bg: "#FFF8EE", t: "#FF9500", b: "#FFE4B8" }, green: { bg: "#F0FFF4", t: "#34C759", b: "#C6F6D5" }, gray: { bg: "#F9F9F9", t: "#1C1C1E", b: "#E5E5EA" } }[p.v || "gray"]; return <div style={{ background: c.bg, borderRadius: 14, padding: "14px 10px", flex: "1 1 80px", textAlign: "center", border: "1px solid " + c.b, minWidth: 75 }}><div style={{ fontSize: 24, fontWeight: 700, color: c.t, lineHeight: 1 }}>{p.value}</div><div style={{ fontSize: 9, color: "#8E8E93", marginTop: 5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{p.label}</div></div>; }
function Btn(p) { var s = { primary: { background: "#1C1C1E", color: "#fff" }, danger: { background: "#FF3B30", color: "#fff" }, secondary: { background: "#F2F2F7", color: "#1C1C1E" }, ghost: { background: "transparent", color: "#8E8E93" } }[p.v || "primary"]; return <button onClick={p.onClick} disabled={p.disabled} style={{ fontSize: 13, fontWeight: 600, padding: "8px 18px", borderRadius: 10, border: "none", cursor: p.disabled ? "not-allowed" : "pointer", opacity: p.disabled ? 0.4 : 1, ...s, ...(p.style || {}) }}>{p.children}</button>; }
function NI(p) { return <input type="number" min="0" value={p.value} onChange={p.onChange} style={{ width: p.w || 58, textAlign: "center", fontSize: 15, fontWeight: 600, padding: "8px 4px", border: "1.5px solid #E5E5EA", borderRadius: 10, background: "#FAFAFA", outline: "none", ...(p.style || {}) }} />; }
function SL(p) { return <div style={{ fontSize: 13, fontWeight: 700, color: p.color || "#8E8E93", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, marginTop: p.mt || 0 }}>{p.children}</div>; }
function RoleBadge(p) { var isC = p.role === "closer"; return <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: isC ? "#1C1C1E" : "#F2F2F7", color: isC ? "#fff" : "#8E8E93", textTransform: "uppercase" }}>{isC ? "Closer" : "Knocker"}</span>; }

function Podium(p) {
  var items = p.items || [];
  if (items.length < 1) return null;
  var medals = [ { e: "\uD83E\uDD47", bg: "linear-gradient(135deg,#FFF9E6,#FFF3CC)", b: "#FFD700" }, { e: "\uD83E\uDD48", bg: "linear-gradient(135deg,#F8F8F8,#ECECEC)", b: "#C0C0C0" }, { e: "\uD83E\uDD49", bg: "linear-gradient(135deg,#FFF5EB,#FFE8D6)", b: "#CD7F32" } ];
  function PB(item, rank, h) {
    if (!item) return <div style={{ flex: 1 }} />;
    var m = medals[rank];
    return <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
      <div style={{ fontSize: 30, marginBottom: 2 }}>{m.e}</div>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#1C1C1E", textAlign: "center" }}>{item.name}</div>
      <div style={{ fontSize: 10, color: "#8E8E93", marginBottom: 6 }}>{item.sub}</div>
      <div style={{ width: "100%", background: m.bg, border: "2px solid " + m.b, borderRadius: "14px 14px 0 0", height: h, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "8px 6px", boxSizing: "border-box" }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#1C1C1E" }}>{item.val}</div>
        <div style={{ fontSize: 9, color: "#8E8E93", fontWeight: 600, textTransform: "uppercase" }}>{item.metric}</div>
      </div>
    </div>;
  }
  return <div style={{ display: "flex", gap: 6, alignItems: "flex-end", maxWidth: 440, margin: "0 auto 16px", padding: "0 8px" }}>
    {PB(items[1] || null, 1, 100)}{PB(items[0], 0, 140)}{PB(items[2] || null, 2, 80)}
  </div>;
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
  var activePreset = presets.find(function(pr) { return pr.s === p.startDate && pr.e === p.endDate; });
  var rangeLabel = p.startDate === p.endDate ? p.startDate : p.startDate + " to " + p.endDate;
  var numDays = getDatesInRange(p.startDate, p.endDate).length;

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "12px 16px", marginBottom: 14, boxShadow: sh, border: "1px solid rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
        {presets.map(function(pr) {
          var active = activePreset && activePreset.label === pr.label;
          return <button key={pr.label} onClick={function() { p.onChange(pr.s, pr.e); }} style={{ fontSize: 12, fontWeight: active ? 700 : 500, padding: "6px 14px", borderRadius: 8, border: "none", background: active ? "#1C1C1E" : "#F2F2F7", color: active ? "#fff" : "#8E8E93", cursor: "pointer", transition: "all 0.15s" }}>{pr.label}</button>;
        })}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="date" value={p.startDate} onChange={function(e) { p.onChange(e.target.value, p.endDate < e.target.value ? e.target.value : p.endDate); }} style={{ fontSize: 13, fontWeight: 600, padding: "6px 10px", border: "1px solid #E5E5EA", borderRadius: 8, background: "#FAFAFA" }} />
        <span style={{ fontSize: 12, color: "#C7C7CC" }}>to</span>
        <input type="date" value={p.endDate} onChange={function(e) { p.onChange(p.startDate > e.target.value ? e.target.value : p.startDate, e.target.value); }} style={{ fontSize: 13, fontWeight: 600, padding: "6px 10px", border: "1px solid #E5E5EA", borderRadius: 8, background: "#FAFAFA" }} />
        <span style={{ fontSize: 11, color: "#8E8E93", fontWeight: 600 }}>{numDays + (numDays === 1 ? " day" : " days")}</span>
      </div>
    </div>
  );
}

// ===== MAIN =====
export default function App() {
  var _d = useState(DD), data = _d[0], setData = _d[1];
  var _lo = useState(false), loaded = _lo[0], setLoaded = _lo[1];
  var _t = useState("dashboard"), tab = _t[0], setTab = _t[1];
  var _m = useState(null), selM = _m[0], setSelM = _m[1];
  var _nm = useState(""), newMkt = _nm[0], setNewMkt = _nm[1];
  var _nr = useState(""), newRep = _nr[0], setNewRep = _nr[1];
  var _nrd = useState(""), newRepDate = _nrd[0], setNewRepDate = _nrd[1];
  var _nrr = useState("knocker"), newRepRole = _nrr[0], setNewRepRole = _nrr[1];
  var _sd = useState(TODAY), startDate = _sd[0], setStartDate = _sd[1];
  var _ed = useState(TODAY), endDate = _ed[0], setEndDate = _ed[1];
  var _entryDate = useState(TODAY), entryDate = _entryDate[0], setEntryDate = _entryDate[1];
  var _ki = useState({}), kpiIn = _ki[0], setKpiIn = _ki[1];
  var _kn = useState({}), kpiNotes = _kn[0], setKpiNotes = _kn[1];
  var _ln = useState(""), logNote = _ln[0], setLogNote = _ln[1];
  var _lr = useState(null), logRep = _lr[0], setLogRep = _lr[1];
  var _sl = useState(false), showLog = _sl[0], setShowLog = _sl[1];
  var _so = useState(null), logSevO = _so[0], setLogSevO = _so[1];
  var _ex = useState({}), expanded = _ex[0], setExpanded = _ex[1];
  var _to = useState(""), toast = _to[0], setToast = _to[1];
  var _lb = useState("doors"), lbSort = _lb[0], setLbSort = _lb[1];
  var _cs = useState("closes"), clSort = _cs[0], setClSort = _cs[1];

  useEffect(function() { load().then(function(d) { setData(d); var k = Object.keys(d.markets); if (k.length) setSelM(k[0]); setLoaded(true); }).catch(function() { setLoaded(true); }); }, []);
  var persist = useCallback(function(n) { setData(n); save(n); }, []);
  function flash(m) { setToast(m); setTimeout(function() { setToast(""); }, 2000); }
  function setRange(s, e) { setStartDate(s); setEndDate(e); }

  function addMarket() { if (!newMkt.trim()) return; var id = gid(); persist({ ...data, markets: { ...data.markets, [id]: { name: newMkt.trim() } } }); setSelM(id); setNewMkt(""); }
  function delMarket(id) { if (!confirm("Delete?")) return; var n = JSON.parse(JSON.stringify(data)); delete n.markets[id]; Object.keys(n.reps).forEach(function(r) { if (n.reps[r].marketId === id) delete n.reps[r]; }); persist(n); var rem = Object.keys(n.markets); setSelM(rem.length ? rem[0] : null); }
  function addRep() { if (!newRep.trim() || !selM) return; persist({ ...data, reps: { ...data.reps, [gid()]: { name: newRep.trim(), marketId: selM, active: true, startDate: newRepDate || TODAY, role: newRepRole } } }); setNewRep(""); setNewRepDate(""); }
  function togRep(rid) { persist({ ...data, reps: { ...data.reps, [rid]: { ...data.reps[rid], active: !data.reps[rid].active } } }); }
  function setRepRole(rid, role) { persist({ ...data, reps: { ...data.reps, [rid]: { ...data.reps[rid], role: role } } }); }

  function initKI(mId, dt) {
    var reps = mReps(data, mId); var inp = {}; var notes = {};
    reps.forEach(function(p) { var id = p[0], rep = p[1], ex = gK(data, id, dt);
      if (rep.role === "closer") { inp[id] = ex ? { apptsRan: ex.apptsRan || "", apptsClosed: ex.apptsClosed || "", cads: ex.cads || "", convosHad: ex.convosHad || "", doorsKnocked: ex.doorsKnocked || "", selfGenSets: ex.selfGenSets || "", selfGenCloses: ex.selfGenCloses || "" } : { apptsRan: "", apptsClosed: "", cads: "", convosHad: "", doorsKnocked: "", selfGenSets: "", selfGenCloses: "" }; }
      else { inp[id] = ex ? { doorsKnocked: ex.doorsKnocked, convosHad: ex.convosHad || "", setsSet: ex.setsSet, apptsRan: ex.apptsRan, closes: ex.closes } : { doorsKnocked: "", convosHad: "", setsSet: "", apptsRan: "", closes: "" }; }
      notes[id] = ex && ex.notes ? ex.notes : "";
    }); setKpiIn(inp); setKpiNotes(notes);
  }
  useEffect(function() { if (selM && loaded) initKI(selM, entryDate); }, [selM, entryDate, loaded, JSON.stringify(data.reps)]);

  function saveKPIs() {
    var n = { ...data, dailyKPIs: { ...data.dailyKPIs } };
    Object.entries(kpiIn).forEach(function(p) { var rid = p[0], v = p[1], entry = { repId: rid, date: entryDate, notes: kpiNotes[rid] || "" }; Object.keys(v).forEach(function(k) { entry[k] = parseInt(v[k]) || 0; }); n.dailyKPIs[kk(rid, entryDate)] = entry; });
    persist(n); flash("Saved");
  }
  function openLog(rid) { setLogRep(rid); setLogNote(""); setLogSevO(null); setShowLog(true); }
  function saveLog() { if (!logRep || !logNote.trim()) return; var sev = logSevO || nSev(data.accountabilityLog, logRep).key; persist({ ...data, accountabilityLog: { ...data.accountabilityLog, [logRep]: [...(data.accountabilityLog[logRep] || []), { date: TODAY, note: logNote.trim(), severity: sev, id: gid() }] } }); setShowLog(false); flash("Logged"); }
  function delLogE(rid, eid) { persist({ ...data, accountabilityLog: { ...data.accountabilityLog, [rid]: (data.accountabilityLog[rid] || []).filter(function(e) { return e.id !== eid; }) } }); }

  if (!loaded) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#8E8E93" }}>Loading...</div>;

  var mIds = Object.keys(data.markets);
  var curReps = selM ? mReps(data, selM) : [];
  var rangeDates = getDatesInRange(startDate, endDate);
  var numDays = rangeDates.length;

  // Analyze reps over range
  var analyzed = curReps.map(function(p) { return p[1].role === "closer" ? analyzeCloser(data, p[0], p[1], rangeDates, endDate) : analyzeKnocker(data, p[0], p[1], rangeDates, endDate); });
  var actionN = analyzed.filter(function(a) { return a.actionFlags.length > 0; });
  var coachN = analyzed.filter(function(a) { return a.actionFlags.length === 0 && a.coachFlags.length > 0; });

  // Knocker LB
  var knockerLB = [];
  allActive(data).forEach(function(p) {
    var rid = p[0], rep = p[1]; var mkt = data.markets[rep.marketId]; if (!mkt) return;
    var s = getRangeStats(data, rid, rangeDates);
    if (s.doorsKnocked === 0) return;
    knockerLB.push({ rid: rid, name: rep.name, market: mkt.name, role: rep.role || "knocker", doors: s.doorsKnocked, convos: s.convosHad, sets: s.setsSet, d2c: s.d2c, c2s: s.c2s, setsAvg: s.setsAvg, days: s.days });
  });
  knockerLB.sort(function(a, b) { var k = lbSort; if (k === "convos") return b.convos - a.convos; if (k === "sets") return b.sets - a.sets; if (k === "d2c") return b.d2c - a.d2c; if (k === "c2s") return b.c2s - a.c2s; return b.doors - a.doors; });

  // Closer LB
  var closerLB = [];
  allActive(data, "closer").forEach(function(p) {
    var rid = p[0], rep = p[1]; var mkt = data.markets[rep.marketId]; if (!mkt) return;
    var s = getRangeStats(data, rid, rangeDates);
    var mSG = getMonthSelfGens(data, rid, endDate);
    closerLB.push({ rid: rid, name: rep.name, market: mkt.name, closes: s.apptsClosed, apptsRan: s.apptsRan, hours: Math.round(s.hours * 10) / 10, hoursAvg: s.hoursAvg, closeRate: s.closeRate, cadRate: s.cadRate, monthSelfGens: mSG, cads: s.cads, days: s.days });
  });
  closerLB.sort(function(a, b) { var k = clSort; if (k === "closeRate") return b.closeRate - a.closeRate; if (k === "selfGens") return b.monthSelfGens - a.monthSelfGens; if (k === "hours") return b.hours - a.hours; return b.closes - a.closes; });

  // Trends
  var trendData = rangeDates.map(function(dt) {
    var row = { date: dt.slice(5) }; var d2 = 0, c2 = 0, s2 = 0, cl2 = 0;
    if (selM) { mReps(data, selM).forEach(function(p) { var k = gK(data, p[0], dt); if (k) { d2 += k.doorsKnocked || 0; c2 += k.convosHad || 0; s2 += k.setsSet || 0; cl2 += (k.closes || 0) + (k.apptsClosed || 0); } }); }
    row.doors = d2; row.convos = c2; row.sets = s2; row.closes = cl2; return row;
  });
  var trendHasData = trendData.some(function(d) { return d.doors > 0 || d.closes > 0; });

  // Rollup
  var rollupData = Object.entries(data.markets).map(function(p) {
    var mId = p[0], mkt = p[1]; var reps = mReps(data, mId);
    var t = { d: 0, c: 0, s: 0, cl: 0, rpt: 0, knockers: 0, closers: 0 };
    reps.forEach(function(rp) { if (rp[1].role === "closer") t.closers++; else t.knockers++; var st = getRangeStats(data, rp[0], rangeDates); if (st.days > 0) { t.d += st.doorsKnocked; t.c += st.convosHad; t.s += st.setsSet; t.cl += st.closes + st.apptsClosed; t.rpt++; } });
    return { id: mId, name: mkt.name, reps: reps.length, ...t };
  });
  rollupData.sort(function(a, b) { return b.cl - a.cl; });

  var TABS = [
    { k: "dashboard", l: "Dashboard" }, { k: "enter", l: "Enter" },
    { k: "knockerboard", l: "Knockers" }, { k: "closerboard", l: "Closers" },
    { k: "trends", l: "Trends" }, { k: "accountability", l: "Log" },
    { k: "rollup", l: "Markets" }, { k: "manage", l: "Manage" },
  ];

  var showRange = tab !== "enter" && tab !== "manage" && tab !== "accountability";

  function renderFlagCard(item) {
    var rid = item.rid, rep = item.rep, s = item.stats;
    var off = offCt(data.accountabilityLog, rid); var ns = nSev(data.accountabilityLog, rid);
    var exp = expanded[rid]; var logE = data.accountabilityLog[rid] || [];
    var isAction = item.actionFlags.length > 0; var tl = tenureLabel(rep); var isCloser = item.role === "closer";
    return (
      <Card key={rid} bc={isAction ? "#FF3B30" : "#FF9500"}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 6 }}>
          <div style={{ flex: 1, minWidth: 170 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: "#1C1C1E" }}>{rep.name}</span>
              <RoleBadge role={rep.role} />
              {tl ? <Badge text={tl} /> : null}
              {off > 0 ? <Badge text={off + " prior"} color="#FF3B30" bg="#FFF0EF" /> : null}
              {isAction ? <Badge text={"Next: " + ns.label} color={ns.color} bg={ns.bg} /> : null}
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
              {item.actionFlags.map(function(f, i) { return <span key={"a" + i} style={{ fontSize: 12, color: "#FF3B30", fontWeight: 600 }}>{"\u2022 " + f.label}</span>; })}
              {item.coachFlags.map(function(f, i) { return <span key={"c" + i} style={{ fontSize: 12, color: "#FF9500", fontWeight: 600 }}>{"\u26A0 " + f.label}</span>; })}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11, color: "#8E8E93" }}>
              {isCloser ? (
                [
                  "Hrs avg: " + s.hoursAvg + "/5",
                  "Close: " + s.closeRate + "%",
                  "CAD: " + s.cadRate + "%",
                  "SG: " + (item.monthSelfGens || 0)
                ].map(function(t, i) { return <span key={i}>{t}</span>; })
              ) : (
                [
                  "Doors: " + s.doorsKnocked,
                  "Convos: " + s.convosHad,
                  "Sets avg: " + s.setsAvg,
                  "D2C: " + s.d2c + "%"
                ].map(function(t, i) { return <span key={i}>{t}</span>; })
              )}
              <span style={{ color: "#C7C7CC" }}>{s.days + "d data"}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <Btn onClick={function() { openLog(rid); }} style={{ padding: "6px 12px", fontSize: 12 }}>Log</Btn>
            <Btn v="secondary" onClick={function() { setExpanded(function(p) { return { ...p, [rid]: !p[rid] }; }); }} style={{ padding: "6px 12px", fontSize: 12 }}>{exp ? "Hide" : "Hist"}</Btn>
          </div>
        </div>
        {exp && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F2F2F7" }}>
            {logE.length === 0 ? <span style={{ fontSize: 12, color: "#C7C7CC" }}>No incidents.</span> :
              logE.map(function(entry) { var sev = SEV.find(function(sv) { return sv.key === entry.severity; }) || SEV[0]; return (
                <div key={entry.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, fontSize: 12 }}>
                  <span style={{ color: "#8E8E93", minWidth: 68 }}>{entry.date}</span>
                  <Badge text={sev.label} color={sev.color} bg={sev.bg} />
                  <span style={{ color: "#3A3A3C", flex: 1 }}>{entry.note}</span>
                  <button onClick={function() { delLogE(rid, entry.id); }} style={{ fontSize: 10, color: "#C7C7CC", background: "none", border: "none", cursor: "pointer" }}>x</button>
                </div>
              ); })}
          </div>
        )}
      </Card>
    );
  }

  var ths = { textAlign: "center", padding: "10px 6px", fontWeight: 600, fontSize: 9, color: "#8E8E93", textTransform: "uppercase", letterSpacing: "0.04em", background: "#FAFAFA", borderBottom: "1px solid #E5E5EA" };

  return (
    <div style={{ minHeight: "100vh", background: "#F2F2F7" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <style>{":root,body,*{font-family:'DM Sans',-apple-system,sans-serif}input,select,textarea,button{font-family:inherit}"}</style>

      <div style={{ background: "#fff", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, borderBottom: "1px solid #E5E5EA", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FF3B30" }} />
          <span style={{ fontWeight: 800, fontSize: 16, color: "#1C1C1E" }}>Command Center</span>
        </div>
        <select value={selM || ""} onChange={function(e) { setSelM(e.target.value || null); }} style={{ fontSize: 14, fontWeight: 600, padding: "8px 14px", background: "#F2F2F7", color: "#1C1C1E", border: "none", borderRadius: 10 }}>
          <option value="">Select Market</option>
          {mIds.map(function(id) { return <option key={id} value={id}>{data.markets[id].name}</option>; })}
        </select>
      </div>

      {toast ? <div style={{ position: "fixed", top: 64, right: 14, zIndex: 9999, background: "#1C1C1E", color: "#fff", fontSize: 13, fontWeight: 600, padding: "10px 20px", borderRadius: 12, boxShadow: shL }}>{toast}</div> : null}

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "12px" }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 14, overflowX: "auto", WebkitOverflowScrolling: "touch", padding: "4px 0" }}>
          {TABS.map(function(t) { return <button key={t.k} onClick={function() { setTab(t.k); }} style={{ padding: "8px 14px", fontSize: 13, fontWeight: tab === t.k ? 700 : 500, color: tab === t.k ? "#fff" : "#8E8E93", background: tab === t.k ? "#1C1C1E" : "#fff", border: "none", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap", boxShadow: tab === t.k ? "none" : sh }}>{t.l}</button>; })}
        </div>

        {/* GLOBAL DATE RANGE */}
        {showRange && <DateRangeBar startDate={startDate} endDate={endDate} onChange={setRange} />}

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          !selM ? <Card><p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>Select a market.</p></Card> : (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "#1C1C1E", margin: "0 0 14px 0" }}>{data.markets[selM] && data.markets[selM].name}</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
                <StatCard label="Total" value={curReps.length} />
                <StatCard label="Action" value={actionN.length} v={actionN.length > 0 ? "red" : "gray"} />
                <StatCard label="Coach" value={coachN.length} v={coachN.length > 0 ? "amber" : "gray"} />
                <StatCard label={"Doors " + (numDays > 1 ? "(total)" : "")} value={analyzed.reduce(function(s, a) { return s + a.stats.doorsKnocked; }, 0)} />
                <StatCard label={"Sets " + (numDays > 1 ? "(total)" : "")} value={analyzed.reduce(function(s, a) { return s + a.stats.setsSet; }, 0)} />
              </div>
              {actionN.length > 0 && <div><SL color="#FF3B30">{"Action (" + actionN.length + ")"}</SL>{actionN.map(renderFlagCard)}</div>}
              {coachN.length > 0 && <div style={{ marginTop: 8 }}><SL color="#FF9500">{"Coaching (" + coachN.length + ")"}</SL>{coachN.map(renderFlagCard)}</div>}
              {actionN.length === 0 && coachN.length === 0 && <Card><p style={{ color: "#34C759", fontWeight: 700, margin: 0, textAlign: "center" }}>All reps meeting standard.</p></Card>}
            </div>
          )
        )}

        {/* ENTER */}
        {tab === "enter" && (
          !selM ? <Card><p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>Select a market.</p></Card> : (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Enter KPIs</h2>
                <input type="date" value={entryDate} onChange={function(e) { setEntryDate(e.target.value); }} style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, padding: "6px 12px", border: "1px solid #E5E5EA", borderRadius: 10, background: "#fff" }} />
              </div>
              {curReps.map(function(p) {
                var rid = p[0], rep = p[1], isCloser = rep.role === "closer", fields = isCloser ? C_FIELDS : K_FIELDS;
                return (
                  <Card key={rid}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><span style={{ fontWeight: 700, fontSize: 16 }}>{rep.name}</span><RoleBadge role={rep.role} /></div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {fields.map(function(fld) { return <div key={fld.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        <span style={{ fontSize: 9, color: "#8E8E93", fontWeight: 600, textTransform: "uppercase" }}>{fld.label}</span>
                        <NI value={(kpiIn[rid] && kpiIn[rid][fld.key]) || ""} onChange={function(e) { var val = e.target.value; var fk = fld.key; setKpiIn(function(prev) { var n = { ...prev }; n[rid] = { ...n[rid] }; n[rid][fk] = val; return n; }); }} w={52} />
                      </div>; })}
                    </div>
                    {isCloser && kpiIn[rid] && <div style={{ fontSize: 12, color: "#8E8E93", marginBottom: 8, background: "#F9F9F9", padding: "8px 12px", borderRadius: 10 }}>{"Hours: "}<strong style={{ color: "#1C1C1E" }}>{Math.round(((parseInt(kpiIn[rid].apptsRan) || 0) + (parseInt(kpiIn[rid].cads) || 0) * 0.5 + (parseInt(kpiIn[rid].convosHad) || 0) / 10) * 10) / 10}</strong>{" / 5"}</div>}
                    <input type="text" value={kpiNotes[rid] || ""} onChange={function(e) { var val = e.target.value; setKpiNotes(function(prev) { return { ...prev, [rid]: val }; }); }} placeholder="Notes..." style={{ width: "100%", fontSize: 13, padding: "8px 12px", border: "1px solid #E5E5EA", borderRadius: 10, outline: "none", boxSizing: "border-box", background: "#FAFAFA" }} />
                  </Card>
                );
              })}
              {curReps.length > 0 && <Btn onClick={saveKPIs} style={{ padding: "12px 36px", fontSize: 15, borderRadius: 12 }}>Save</Btn>}
            </div>
          )
        )}

        {/* KNOCKER BOARD */}
        {tab === "knockerboard" && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px 0" }}>Knocker Board</h2>
            <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 12px 0" }}>{"All markets \u00B7 Closers included when knocking \u00B7 " + numDays + " day" + (numDays > 1 ? "s" : "")}</p>
            <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
              {[["doors", "Doors"], ["convos", "Convos"], ["sets", "Sets"], ["d2c", "D2C%"], ["c2s", "C2S%"]].map(function(x) { return <Btn key={x[0]} v={lbSort === x[0] ? "primary" : "secondary"} onClick={function() { setLbSort(x[0]); }} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8 }}>{x[1]}</Btn>; })}
            </div>
            <Podium items={knockerLB.slice(0, 3).map(function(r) { return { name: r.name, sub: r.market + (r.role === "closer" ? " \u00B7 Closer" : ""), val: lbSort === "d2c" || lbSort === "c2s" ? r[lbSort] + "%" : r[lbSort], metric: { doors: "Doors", convos: "Convos", sets: "Sets", d2c: "D2C%", c2s: "C2S%" }[lbSort] }; })} />
            {knockerLB.length > 3 && (
              <Card style={{ padding: 0, overflow: "auto", borderRadius: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr>
                  {["#", "Rep", "Market", "", "Doors", "Convos", "Sets", "D2C%"].map(function(h) { return <th key={h} style={{ ...ths, textAlign: h === "Rep" || h === "Market" || h === "" ? "left" : "center" }}>{h}</th>; })}
                </tr></thead><tbody>
                  {knockerLB.slice(3).map(function(r, i) { return <tr key={r.rid} style={{ borderBottom: "1px solid #F2F2F7" }}>
                    <td style={{ textAlign: "center", padding: "10px 6px", color: "#C7C7CC", fontWeight: 700 }}>{i + 4}</td>
                    <td style={{ padding: "10px 6px", fontWeight: 700 }}>{r.name}</td>
                    <td style={{ padding: "10px 6px", color: "#8E8E93", fontSize: 11 }}>{r.market}</td>
                    <td style={{ padding: "10px 2px" }}>{r.role === "closer" ? <RoleBadge role="closer" /> : null}</td>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.doors}</td>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.convos}</td>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.sets}</td>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600, color: r.d2c > 40 ? "#34C759" : "#FF9500" }}>{r.d2c + "%"}</td>
                  </tr>; })}
                </tbody></table>
              </Card>
            )}
          </div>
        )}

        {/* CLOSER BOARD */}
        {tab === "closerboard" && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px 0" }}>Closer Board</h2>
            <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 12px 0" }}>{"All markets \u00B7 " + numDays + " day" + (numDays > 1 ? "s" : "")}</p>
            <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
              {[["closes", "Closes"], ["closeRate", "Close%"], ["selfGens", "Self-Gens"], ["hours", "Hours"]].map(function(x) { return <Btn key={x[0]} v={clSort === x[0] ? "primary" : "secondary"} onClick={function() { setClSort(x[0]); }} style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8 }}>{x[1]}</Btn>; })}
            </div>
            <Podium items={closerLB.slice(0, 3).map(function(r) { var vm = { closes: r.closes, closeRate: r.closeRate + "%", selfGens: r.monthSelfGens, hours: r.hours }; return { name: r.name, sub: r.market, val: vm[clSort], metric: { closes: "Closes", closeRate: "Close%", selfGens: "Mo SG", hours: "Hours" }[clSort] }; })} />
            <Card style={{ padding: 0, overflow: "auto", borderRadius: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr>
                {["#", "Rep", "Market", "Appts", "Closed", "Close%", "CAD%", "Hrs", "Hrs/Day", "Mo SG"].map(function(h) { return <th key={h} style={{ ...ths, textAlign: h === "Rep" || h === "Market" ? "left" : "center" }}>{h}</th>; })}
              </tr></thead><tbody>
                {closerLB.map(function(r, i) {
                  var medal = i < 3 ? ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"][i] : "";
                  return <tr key={r.rid} style={{ borderBottom: "1px solid #F2F2F7" }}>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 700, fontSize: medal ? 16 : 12, color: medal ? "#1C1C1E" : "#C7C7CC" }}>{medal || (i + 1)}</td>
                    <td style={{ padding: "10px 6px", fontWeight: 700 }}>{r.name}</td>
                    <td style={{ padding: "10px 6px", color: "#8E8E93", fontSize: 11 }}>{r.market}</td>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.apptsRan}</td>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 700, color: "#34C759" }}>{r.closes}</td>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.closeRate + "%"}</td>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600, color: r.cadRate > 30 ? "#FF3B30" : "#8E8E93" }}>{r.cadRate + "%"}</td>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600, color: r.hours < 5 * r.days ? "#FF3B30" : "#34C759" }}>{r.hours}</td>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 600 }}>{r.hoursAvg}</td>
                    <td style={{ textAlign: "center", padding: "10px 6px", fontWeight: 800, fontSize: 14, color: r.monthSelfGens < 1 ? "#FF3B30" : r.monthSelfGens >= 3 ? "#34C759" : "#1C1C1E" }}>{r.monthSelfGens}</td>
                  </tr>;
                })}
                {closerLB.length === 0 && <tr><td colSpan={10} style={{ padding: 20, textAlign: "center", color: "#C7C7CC" }}>No closer data.</td></tr>}
              </tbody></table>
            </Card>
          </div>
        )}

        {/* TRENDS */}
        {tab === "trends" && (
          !selM ? <Card><p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>Select a market.</p></Card> : (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 14px 0" }}>Trends</h2>
              {!trendHasData ? <Card><p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>No data in range.</p></Card> : (
                <div>
                  <Card><SL>Activity</SL><ResponsiveContainer width="100%" height={200}><BarChart data={trendData}><CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" /><XAxis dataKey="date" tick={{ fontSize: 10, fill: "#8E8E93" }} /><YAxis tick={{ fontSize: 10, fill: "#8E8E93" }} /><Tooltip contentStyle={{ borderRadius: 10, fontSize: 12, border: "none", boxShadow: shL }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="doors" fill="#1C1C1E" radius={[6, 6, 0, 0]} name="Doors" /><Bar dataKey="convos" fill="#FF3B30" radius={[6, 6, 0, 0]} name="Convos" /></BarChart></ResponsiveContainer></Card>
                  <Card><SL>Production</SL><ResponsiveContainer width="100%" height={200}><LineChart data={trendData}><CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" /><XAxis dataKey="date" tick={{ fontSize: 10, fill: "#8E8E93" }} /><YAxis tick={{ fontSize: 10, fill: "#8E8E93" }} /><Tooltip contentStyle={{ borderRadius: 10, fontSize: 12, border: "none", boxShadow: shL }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="sets" stroke="#FF3B30" strokeWidth={2.5} dot={{ r: 3 }} name="Sets" /><Line type="monotone" dataKey="closes" stroke="#34C759" strokeWidth={2.5} dot={{ r: 3 }} name="Closes" /></LineChart></ResponsiveContainer></Card>
                </div>
              )}
            </div>
          )
        )}

        {/* ACCOUNTABILITY */}
        {tab === "accountability" && (
          !selM ? <Card><p style={{ color: "#8E8E93", textAlign: "center", margin: 0 }}>Select a market.</p></Card> : (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 14px 0" }}>Accountability Log</h2>
              {curReps.map(function(p) {
                var rid = p[0], rep = p[1], log = data.accountabilityLog[rid] || [], ns = nSev(data.accountabilityLog, rid);
                return <Card key={rid} bc={log.length > 0 ? ns.color : undefined}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: log.length > 0 ? 10 : 0, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{rep.name}</span><RoleBadge role={rep.role} />
                      <Badge text={log.length + " incident" + (log.length !== 1 ? "s" : "")} color={log.length > 0 ? "#FF3B30" : "#8E8E93"} bg={log.length > 0 ? "#FFF0EF" : "#F2F2F7"} />
                      {log.length > 0 ? <Badge text={"Next: " + ns.label} color={ns.color} bg={ns.bg} /> : null}
                    </div>
                    <Btn onClick={function() { openLog(rid); }} style={{ fontSize: 12, padding: "6px 14px" }}>+ Log</Btn>
                  </div>
                  {log.map(function(e) { var sev = SEV.find(function(sv) { return sv.key === e.severity; }) || SEV[0]; return <div key={e.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, fontSize: 12 }}>
                    <span style={{ color: "#8E8E93", minWidth: 68 }}>{e.date}</span><Badge text={sev.label} color={sev.color} bg={sev.bg} /><span style={{ color: "#3A3A3C", flex: 1 }}>{e.note}</span>
                    <button onClick={function() { delLogE(rid, e.id); }} style={{ fontSize: 10, color: "#C7C7CC", background: "none", border: "none", cursor: "pointer" }}>x</button>
                  </div>; })}
                </Card>;
              })}
            </div>
          )
        )}

        {/* MARKETS */}
        {tab === "rollup" && (
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px 0" }}>All Markets</h2>
            <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 16px 0" }}>{"Ranked by closes \u00B7 " + numDays + " day" + (numDays > 1 ? "s" : "")}</p>
            <Podium items={rollupData.slice(0, 3).map(function(m) { return { name: m.name, sub: m.knockers + "K / " + m.closers + "C", val: m.cl, metric: "Closes" }; })} />
            {rollupData.map(function(m, i) {
              var medal = i < 3 ? ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"][i] : "";
              return <Card key={m.id} style={{ cursor: "pointer" }} bc={i < 3 ? ["#FFD700", "#C0C0C0", "#CD7F32"][i] : undefined}>
                <div onClick={function() { setSelM(m.id); setTab("dashboard"); }} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: medal ? 24 : 16, width: 32, textAlign: "center", fontWeight: 800, color: medal ? "#1C1C1E" : "#C7C7CC" }}>{medal || (i + 1)}</span>
                  <div style={{ flex: 1, minWidth: 100 }}><div style={{ fontWeight: 800, fontSize: 17 }}>{m.name}</div><div style={{ fontSize: 12, color: "#8E8E93" }}>{m.knockers + " knockers \u00B7 " + m.closers + " closers"}</div></div>
                  <div style={{ display: "flex", gap: 14 }}>
                    <div style={{ textAlign: "center" }}><div style={{ fontSize: 20, fontWeight: 800 }}>{m.d}</div><div style={{ fontSize: 9, color: "#8E8E93", fontWeight: 600, textTransform: "uppercase" }}>Doors</div></div>
                    <div style={{ textAlign: "center" }}><div style={{ fontSize: 20, fontWeight: 800 }}>{m.s}</div><div style={{ fontSize: 9, color: "#8E8E93", fontWeight: 600, textTransform: "uppercase" }}>Sets</div></div>
                    <div style={{ textAlign: "center" }}><div style={{ fontSize: 20, fontWeight: 800, color: "#34C759" }}>{m.cl}</div><div style={{ fontSize: 9, color: "#8E8E93", fontWeight: 600, textTransform: "uppercase" }}>Closes</div></div>
                  </div>
                </div>
              </Card>;
            })}
          </div>
        )}

        {/* MANAGE */}
        {tab === "manage" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 14px 0" }}>Manage</h2>
            <Card>
              <SL>Markets</SL>
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <input value={newMkt} onChange={function(e) { setNewMkt(e.target.value); }} placeholder="Market name..." onKeyDown={function(e) { if (e.key === "Enter") addMarket(); }} style={{ flex: "1 1 140px", fontSize: 14, padding: "10px 14px", border: "1.5px solid #E5E5EA", borderRadius: 10, outline: "none", background: "#FAFAFA" }} />
                <Btn onClick={addMarket} style={{ borderRadius: 10 }}>+ Market</Btn>
              </div>
              {mIds.map(function(mId) { var kc = Object.values(data.reps).filter(function(r) { return r.marketId === mId && r.active !== false && r.role !== "closer"; }).length; var cc = Object.values(data.reps).filter(function(r) { return r.marketId === mId && r.active !== false && r.role === "closer"; }).length; return <div key={mId} style={{ padding: "10px 0", borderBottom: "1px solid #F2F2F7", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{data.markets[mId].name}</span><Badge text={kc + "K / " + cc + "C"} />
                <Btn v="ghost" onClick={function() { delMarket(mId); }} style={{ marginLeft: "auto", fontSize: 12, color: "#FF3B30" }}>Delete</Btn>
              </div>; })}
            </Card>
            {selM && (
              <Card>
                <SL>{"Reps \u2014 " + (data.markets[selM] ? data.markets[selM].name : "")}</SL>
                <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <input value={newRep} onChange={function(e) { setNewRep(e.target.value); }} placeholder="Name..." onKeyDown={function(e) { if (e.key === "Enter") addRep(); }} style={{ flex: "1 1 100px", fontSize: 14, padding: "10px 14px", border: "1.5px solid #E5E5EA", borderRadius: 10, outline: "none", background: "#FAFAFA" }} />
                  <select value={newRepRole} onChange={function(e) { setNewRepRole(e.target.value); }} style={{ fontSize: 14, fontWeight: 600, padding: "10px 14px", border: "1.5px solid #E5E5EA", borderRadius: 10, background: "#FAFAFA" }}><option value="knocker">Knocker</option><option value="closer">Closer</option></select>
                  <input type="date" value={newRepDate} onChange={function(e) { setNewRepDate(e.target.value); }} style={{ fontSize: 13, padding: "8px 12px", border: "1.5px solid #E5E5EA", borderRadius: 10, background: "#FAFAFA" }} />
                  <Btn onClick={addRep} style={{ borderRadius: 10 }}>+ Rep</Btn>
                </div>
                {Object.entries(data.reps).filter(function(p) { return p[1].marketId === selM; }).sort(function(a, b) { return a[1].name.localeCompare(b[1].name); }).map(function(p) {
                  var rid = p[0], rep = p[1], tl = tenureLabel(rep);
                  return <div key={rid} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0", borderBottom: "1px solid #F2F2F7", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 14, opacity: rep.active !== false ? 1 : 0.4 }}>{rep.name}</span><RoleBadge role={rep.role} />
                    {tl ? <Badge text={tl} /> : null}{rep.active === false ? <Badge text="Inactive" /> : null}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                      <Btn v="secondary" onClick={function() { setRepRole(rid, rep.role === "closer" ? "knocker" : "closer"); }} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8 }}>{rep.role === "closer" ? "To Knocker" : "To Closer"}</Btn>
                      <Btn v="ghost" onClick={function() { togRep(rid); }} style={{ fontSize: 11, padding: "4px 10px", color: rep.active !== false ? "#FF3B30" : "#34C759" }}>{rep.active !== false ? "Deact" : "React"}</Btn>
                    </div>
                  </div>;
                })}
              </Card>
            )}
            <Card style={{ background: "#FFF0EF", border: "1px solid #FFD4D1" }}>
              <SL color="#FF3B30">Reset All Data</SL>
              <Btn v="danger" onClick={function() { if (!confirm("DELETE ALL?")) return; persist(DD); setSelM(null); flash("Cleared"); }} style={{ borderRadius: 10 }}>Reset</Btn>
            </Card>
          </div>
        )}
      </div>

      {/* LOG MODAL */}
      {showLog && logRep ? (
        <div onClick={function() { setShowLog(false); }} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }}>
          <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 420, boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 4px 0" }}>Log Incident</h3>
            <p style={{ fontSize: 13, color: "#8E8E93", margin: "0 0 14px 0" }}>{(data.reps[logRep] ? data.reps[logRep].name : "") + " \u2014 Auto: "}<strong style={{ color: nSev(data.accountabilityLog, logRep).color }}>{nSev(data.accountabilityLog, logRep).label}</strong></p>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
              {SEV.map(function(s) { return <button key={s.key} onClick={function() { setLogSevO(logSevO === s.key ? null : s.key); }} style={{ fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, border: logSevO === s.key ? "2px solid " + s.color : "1.5px solid #E5E5EA", background: logSevO === s.key ? s.bg : "#fff", color: s.color, cursor: "pointer" }}>{s.label}</button>; })}
            </div>
            <textarea value={logNote} onChange={function(e) { setLogNote(e.target.value); }} placeholder="What happened?..." rows={3} style={{ width: "100%", fontSize: 14, padding: 12, border: "1.5px solid #E5E5EA", borderRadius: 12, resize: "vertical", boxSizing: "border-box", outline: "none", background: "#FAFAFA" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 12 }}>
              <Btn v="secondary" onClick={function() { setShowLog(false); }} style={{ borderRadius: 10 }}>Cancel</Btn>
              <Btn onClick={saveLog} disabled={!logNote.trim()} style={{ borderRadius: 10 }}>Save</Btn>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
