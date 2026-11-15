'use strict';
/* State, persistence, simulated history and all health computations. */

const STORE_KEY = 'signosvitales.state.v1';

/* ---------- dates ---------- */
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function today() { return dateStr(new Date()); }
function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  return dateStr(new Date(y, m - 1, d + n));
}
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function relDay(date) {
  const n = daysBetween(date, today());
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
}

/* ---------- simulated mission history ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateHistory(envKey) {
  const env = ENVIRONMENTS[envKey] || ENVIRONMENTS.transit;
  const rng = mulberry32(20261004);
  const n = (sd) => (rng() + rng() + rng() - 1.5) * 2 * sd; // ~normal noise
  const r = (v, d = 0) => +v.toFixed(d);
  const readings = [];
  const t0 = today();
  for (let i = 0; i < 30; i++) {
    const v = {};
    v.hr = Math.round(63 + (i >= 22 ? (i - 22) * 2 : 0) + n(2));          // creeping up in the last week
    v.sbp = Math.round(117 + n(4));
    v.dbp = Math.round(75 + n(3));
    v.spo2 = Math.min(99, Math.round(97 + n(0.8))); if (i === 19) v.spo2 = 93;
    v.temp = r(36.8 + n(0.15), 1); if (i === 26) v.temp = 37.8;              // brief low-grade fever
    v.glucose = Math.round(88 + n(6)); if (i >= 27) v.glucose = 90 + i - 27;
    v.sleep = r(i < 20 ? 7.4 + n(0.4) : 7.0 - (i - 20) * 0.15 + n(0.2), 1);  // sleep debt building
    if (i === 29) v.sleep = 5.6;
    v.mood = i < 22 ? (rng() < 0.75 ? 4 : 5) : (rng() < 0.6 ? 3 : 4); if (i === 29) v.mood = 3;
    v.exercise = i % 9 === 4 ? 75 : Math.round((125 + n(10)) / 5) * 5;
    v.rad = r(env.radBaseline * (1 + n(0.08)), 2);
    if (i === 23) v.rad = r(env.radBaseline * 4.2, 2);                          // solar particle event
    if (i === 24) v.rad = r(env.radBaseline * 2.2, 2);
    if (i === 11) delete v.glucose;                                           // a missed measurement
    readings.push({ date: addDays(t0, i - 30), values: v });
  }
  return readings;
}

function seedState(envKey = 'transit', keep = {}) {
  return {
    v: 1,
    env: envKey,
    callsign: keep.callsign || 'Cmdr. Rivera',
    missionStart: addDays(today(), -41),
    readings: generateHistory(envKey),
    xp: 1180,
    webhookUrl: keep.webhookUrl || '',
    ttsOn: keep.ttsOn !== undefined ? keep.ttsOn : true,
    sessionId: 'sv-' + Math.random().toString(36).slice(2, 10),
    chat: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.v === 1 && Array.isArray(s.readings) && ENVIRONMENTS[s.env]) {
      if (!Array.isArray(s.chat)) s.chat = [];
      return s;
    }
  } catch (e) { /* storage unavailable or corrupt: fall back to demo data */ }
  return null;
}

let state = loadState() || seedState();

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function resetDemo() {
  state = seedState(state.env, { callsign: state.callsign, webhookUrl: state.webhookUrl, ttsOn: state.ttsOn });
  save();
}

/* ---------- lookups ---------- */
function envObj() { return ENVIRONMENTS[state.env] || ENVIRONMENTS.transit; }
function getReading(date) { return state.readings.find((r) => r.date === date); }
function sortedReadings() { return [...state.readings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); }

function latest(id) {
  const rs = sortedReadings();
  for (let i = rs.length - 1; i >= 0; i--) {
    const v = rs[i].values[id];
    if (v != null) return { value: v, date: rs[i].date };
  }
  return null;
}

function lastLogged(id, count) {
  const out = [];
  const rs = sortedReadings();
  for (let i = rs.length - 1; i >= 0 && out.length < count; i--) {
    if (rs[i].values[id] != null) out.push(rs[i].values[id]);
  }
  return out;
}

function series(id, days) {
  const t = today();
  const out = [];
  for (let k = days - 1; k >= 0; k--) {
    const d = addDays(t, -k);
    const r = getReading(d);
    out.push({ date: d, value: r && r.values[id] != null ? r.values[id] : null });
  }
  return out;
}

function avgWindow(id, endOffset, days) {
  const vals = [];
  for (let k = endOffset; k < endOffset + days; k++) {
    const r = getReading(addDays(today(), -k));
    if (r && r.values[id] != null) vals.push(r.values[id]);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/* ---------- status ---------- */
const RANK = { unknown: 0, green: 1, yellow: 2, red: 3 };

function rangesFor(id) { return IND[id].ranges(envObj()); }

function statusOf(id, v) {
  if (v == null || Number.isNaN(+v)) return 'unknown';
  const rg = rangesFor(id);
  const inR = (x, [lo, hi]) => x >= lo && x <= hi;
  return inR(v, rg.green) ? 'green' : inR(v, rg.yellow) ? 'yellow' : 'red';
}

function worst(list) { return list.reduce((w, s) => (RANK[s] > RANK[w] ? s : w), 'unknown'); }
function indStatus(id) { const l = latest(id); return statusOf(id, l && l.value); }
function systemStatus(key) { return worst(SYSTEMS[key].indicators.map(indStatus)); }

function fmtNum(id, v) {
  if (v == null) return '—';
  return (+v).toFixed(IND[id].decimals);
}
function fmtVal(id, v) {
  if (v == null) return '—';
  if (id === 'mood') return `${v}/5 ${MOOD[v] ? MOOD[v].l : ''}`.trim();
  return `${fmtNum(id, v)} ${IND[id].unit}`;
}
function rangeText(id) {
  const g = rangesFor(id).green;
  const u = id === 'mood' ? '/5' : ` ${IND[id].unit}`;
  if (!Number.isFinite(g[1])) return `≥ ${g[0]}${u}`;
  if (g[0] === 0) return `≤ ${g[1]}${u}`;
  return `${g[0]}–${g[1]}${u}`;
}

function missionDay() { return daysBetween(state.missionStart, today()) + 1; }

function missionDose() {
  const logged = state.readings.filter((r) => r.values.rad != null);
  const sum = logged.reduce((a, r) => a + r.values.rad, 0);
  const unlogged = Math.max(0, missionDay() - logged.length);
  return sum + unlogged * envObj().radBaseline; // days without a reading assume the local baseline
}

function readiness() {
  let s = 100;
  INDICATORS.forEach((i) => {
    const st = indStatus(i.id);
    if (st === 'yellow') s -= 8;
    if (st === 'red') s -= 20;
  });
  return Math.max(0, s);
}

function hasData(d) { const r = getReading(d); return !!r && Object.keys(r.values).length > 0; }

function streak() {
  let d = today();
  if (!hasData(d)) d = addDays(d, -1);
  let c = 0;
  while (hasData(d)) { c++; d = addDays(d, -1); }
  return c;
}

/* ---------- alerts ---------- */
function buildAlerts() {
  const alerts = [];
  INDICATORS.forEach((ind) => {
    const l = latest(ind.id);
    const st = statusOf(ind.id, l && l.value);
    if (st === 'red' || st === 'yellow') {
      alerts.push({
        level: st, id: ind.id,
        title: `${ind.name}: ${fmtVal(ind.id, l.value)}`,
        text: `Outside the normal range (${rangeText(ind.id)}). Measured ${relDay(l.date)}.`,
        actions: ind.actions[st],
        escalate: st === 'red',
      });
    }
  });

  const trend = (id, cond, title, text, actions) => {
    if (indStatus(id) !== 'green') return; // the value itself is already flagged
    const a = avgWindow(id, 0, 7);
    const b = avgWindow(id, 7, 7);
    if (a == null || b == null) return;
    if (cond(a, b)) alerts.push({ level: 'yellow', id, title, text: text(a, b), actions, trend: true });
  };
  trend('hr', (a, b) => a - b >= 5, 'Resting heart rate is trending up',
    (a, b) => `7-day average ${a.toFixed(0)} bpm vs ${b.toFixed(0)} bpm the week before. This can be an early sign of fatigue, dehydration or illness.`,
    ['Prioritize sleep and hydration for the next 2 days', 'Re-measure every morning before getting up', 'Report it if the average keeps rising for another week']);
  trend('sleep', (a) => a < 6.5, 'Sleep debt is building',
    (a) => `You averaged ${a.toFixed(1)} h over the last 7 nights (target: 7–9 h).`,
    IND.sleep.actions.yellow);
  trend('exercise', (a) => a < 100, 'Exercise below target this week',
    (a) => `Average ${a.toFixed(0)} min/day over 7 days (target: 120 min).`,
    IND.exercise.actions.yellow);
  trend('mood', (a, b) => a < 3.6 && a < b, 'Mood has dipped this week',
    (a, b) => `Average ${a.toFixed(1)}/5 vs ${b.toFixed(1)}/5 the week before.`,
    IND.mood.actions.yellow);

  const dose = missionDose();
  if (dose > CAREER_LIMIT_MSV * 0.5) {
    alerts.push({
      level: dose > CAREER_LIMIT_MSV * 0.8 ? 'red' : 'yellow', id: 'rad',
      title: `Mission radiation dose: ${dose.toFixed(0)} mSv`,
      text: `${((dose / CAREER_LIMIT_MSV) * 100).toFixed(0)}% of the ${CAREER_LIMIT_MSV} mSv NASA career limit.`,
      actions: IND.rad.actions.yellow,
    });
  }
  return alerts.sort((x, y) => RANK[y.level] - RANK[x.level]);
}

/* ---------- routine, XP, badges ---------- */
function taskDone(task, date = today()) {
  const r = getReading(date);
  return !!r && task.ids.every((id) => r.values[id] != null);
}

function logValues(values) {
  const d = today();
  let r = getReading(d);
  if (!r) { r = { date: d, values: {} }; state.readings.push(r); }
  const before = ROUTINE.map((t) => taskDone(t));
  const allBefore = before.every(Boolean);
  const logged = [];
  Object.entries(values).forEach(([k, v]) => {
    if (IND[k] && v != null && v !== '' && !Number.isNaN(+v)) { r.values[k] = +v; logged.push(k); }
  });
  let xp = 0;
  const completed = [];
  ROUTINE.forEach((t, i) => {
    if (!before[i] && taskDone(t)) { xp += t.xp; completed.push(t.title); }
  });
  if (!allBefore && ROUTINE.every((t) => taskDone(t))) xp += 50;
  state.xp += xp;
  save();
  return { xp, completed, logged };
}

function level() { return Math.floor(state.xp / 250) + 1; }

function badges() {
  const last7 = (id) => series(id, 7).map((p) => p.value);
  const sleep5 = lastLogged('sleep', 5);
  const mood5 = lastLogged('mood', 5);
  const radDays = series('rad', 7).filter((p) => p.value != null).length;
  return [
    { icon: '🚀', name: 'Daily check-in', desc: 'Log any measurement today', earned: hasData(today()) },
    { icon: '✅', name: 'Full routine', desc: 'Complete every routine task today', earned: ROUTINE.every((t) => taskDone(t)) },
    { icon: '🔥', name: '7-day streak', desc: 'Check in 7 days in a row', earned: streak() >= 7 },
    { icon: '🌙', name: 'Sleep champion', desc: '7+ hours on your last 5 logged nights', earned: sleep5.length === 5 && sleep5.every((v) => v >= 7) },
    { icon: '🦴', name: 'Bone guardian', desc: '120+ min of exercise on 5 of the last 7 days', earned: last7('exercise').filter((v) => v != null && v >= 120).length >= 5 },
    { icon: '🧘', name: 'Steady mind', desc: 'Mood 4+ on your last 5 check-ins', earned: mood5.length === 5 && mood5.every((v) => v >= 4) },
    { icon: '☢️', name: 'Radiation aware', desc: 'Read your dosimeter on 6 of the last 7 days', earned: radDays >= 6 },
  ];
}

/* ---------- summaries for the AI and the flight surgeon ---------- */
function healthSummary() {
  const env = envObj();
  return {
    mission_day: missionDay(),
    environment: env.name,
    gravity: env.gravity,
    signal_delay_to_earth: env.delayLabel,
    readiness_score: readiness(),
    mission_radiation_dose_msv: +missionDose().toFixed(1),
    indicators: INDICATORS.map((i) => {
      const l = latest(i.id);
      return {
        name: i.name, value: l ? l.value : null, unit: i.unit,
        status: STATUS_LABEL[statusOf(i.id, l && l.value)],
        normal_range: rangeText(i.id), measured: l ? relDay(l.date) : 'never',
      };
    }),
    alerts: buildAlerts().map((a) => `${a.level.toUpperCase()}: ${a.title}`),
  };
}

function surgeonReport() {
  const env = envObj();
  const lines = [];
  lines.push('CREW HEALTH REPORT: SIGNOS VITALES');
  lines.push(`Astronaut: ${state.callsign}`);
  lines.push(`Mission: ${env.name} · Day ${missionDay()} · ${today()}`);
  lines.push(`Readiness score: ${readiness()}/100`);
  lines.push(`Mission radiation dose: ${missionDose().toFixed(1)} mSv`);
  lines.push('');
  lines.push('LATEST INDICATORS');
  INDICATORS.forEach((i) => {
    const l = latest(i.id);
    const st = STATUS_LABEL[statusOf(i.id, l && l.value)].toUpperCase();
    lines.push(`- ${i.name}: ${l ? fmtVal(i.id, l.value) : 'no data'} [${st}] (normal ${rangeText(i.id)}${l ? ', ' + relDay(l.date) : ''})`);
  });
  lines.push('');
  lines.push('ALERTS');
  const al = buildAlerts();
  if (!al.length) lines.push('- None');
  al.forEach((a) => lines.push(`- ${a.level.toUpperCase()}: ${a.title}. ${a.text}`));
  lines.push('');
  lines.push('7-DAY AVERAGES');
  ['hr', 'sbp', 'dbp', 'sleep', 'mood', 'exercise'].forEach((id) => {
    const a = avgWindow(id, 0, 7);
    lines.push(`- ${IND[id].name}: ${a == null ? 'no data' : a.toFixed(IND[id].decimals || 1) + (id === 'mood' ? '/5' : ' ' + IND[id].unit)}`);
  });
  return lines.join('\n');
}
