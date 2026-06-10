// All dates are local-time "YYYY-MM-DD" strings, weeks run Mon-Sun (same as v1).

export function ymd(d) {
  const x = d instanceof Date ? d : new Date(d + "T12:00:00");
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
}

export function today() {
  return ymd(new Date());
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
}

export function weekStartMonday(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay(); // 0=Sun
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

export function monthStart(dateStr) {
  return dateStr.slice(0, 8) + "01";
}

export function prevMonthRange(dateStr) {
  const first = monthStart(dateStr);
  const lastOfPrev = addDays(first, -1);
  return [monthStart(lastOfPrev), lastOfPrev];
}

export function listDates(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// Week index used to rotate the office challenge round-robin (v1 epoch).
const CHALLENGE_EPOCH = "2020-01-06";
export function challengeWeekIndex(dateStr) {
  return Math.floor(daysBetween(CHALLENGE_EPOCH, weekStartMonday(dateStr)) / 7);
}

export function tenureLabel(startDate, ref) {
  const days = daysBetween(startDate, ref);
  if (days < 0) return "Starts soon";
  if (days < 7) return `Day ${days + 1}`;
  if (days < 60) return `Wk ${Math.floor(days / 7) + 1}`;
  return `${Math.floor(days / 30)}mo`;
}
