'use strict';
/* Crew, authentication, persistence, simulated history and all health computations.

   Storage model (onboard crew tablet, works offline):
   - CREW_KEY: shared mission settings + crew roster (name, role, avatar, PIN salt + PBKDF2 hash)
   - MEMBER_PREFIX + id: one astronaut's health data (readings, XP, chat with MEDIC)
   - SESSION_KEY (sessionStorage): who is logged in on this tab
   Global `state` always holds the logged-in astronaut's data; `crew` holds the shared part. */

const CREW_KEY = 'signosvitales.crew.v2';
const MEMBER_PREFIX = 'signosvitales.member.v2.';
const SESSION_KEY = 'signosvitales.session.v2';
const LEGACY_KEY = 'signosvitales.state.v1';

const ROLES = ['Commander', 'Flight Engineer', 'Mission Specialist', 'Crew Medical Officer'];
const CREW_VIEW_ROLES = ['Commander', 'Crew Medical Officer'];
const AVATARS = ['🧑‍🚀', '👩‍🚀', '👨‍🚀', '🚀', '🛰️', '🌕', '🪐', '⭐'];
const PIN_ITERATIONS = 100000;

/* Demo crew: fictional astronauts, each with a different health story. */
const DEMO_CREW = [
  { name: 'Rivera', role: 'Commander', avatar: '🧑‍🚀', pin: '1111', scenario: 'sleep', seed: 20261004, xp: 1180 },
  { name: 'Okafor', role: 'Flight Engineer', avatar: '👩🏾‍🚀', pin: '2222', scenario: 'healthy', seed: 777, xp: 1640 },
  { name: 'Tanaka', role: 'Mission Specialist', avatar: '👨🏻‍🚀', pin: '3333', scenario: 'fever', seed: 4242, xp: 920 },
  { name: 'Haddad', role: 'Crew Medical Officer', avatar: '👩🏽‍🚀', pin: '4444', scenario: 'bone', seed: 9001, xp: 1310 },
];

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

function generateHistory(envKey, scenario = 'sleep', seed = 20261004) {
  const env = ENVIRONMENTS[envKey] || ENVIRONMENTS.transit;
  const rng = mulberry32(seed);
  const n = (sd) => (rng() + rng() + rng() - 1.5) * 2 * sd; // ~normal noise
  const r = (v, d = 0) => +v.toFixed(d);
  const readings = [];
  const t0 = today();
  for (let i = 0; i < 30; i++) {
    const v = {};
    // healthy baseline
    v.hr = Math.round(61 + n(2));
    v.sbp = Math.round(117 + n(4));
    v.dbp = Math.round(75 + n(3));
    v.spo2 = Math.min(99, Math.round(97 + n(0.8)));
    v.temp = r(36.8 + n(0.15), 1);
    v.glucose = Math.round(88 + n(5));
    v.sleep = r(7.5 + n(0.35), 1);
    v.mood = rng() < 0.7 ? 4 : 5;
    v.exercise = Math.round((130 + n(8)) / 5) * 5;

    if (scenario === 'sleep') { // sleep debt, mood dip, resting HR creeping up
      v.hr = Math.round(63 + (i >= 22 ? (i - 22) * 2 : 0) + n(2));
      if (i === 19) v.spo2 = 93;
      if (i === 26) v.temp = 37.8;
      if (i >= 27) v.glucose = 90 + i - 27;
      v.sleep = r(i < 20 ? 7.4 + n(0.4) : 7.0 - (i - 20) * 0.15 + n(0.2), 1);
      if (i === 29) v.sleep = 5.6;
      v.mood = i < 22 ? (rng() < 0.75 ? 4 : 5) : (rng() < 0.6 ? 3 : 4);
      if (i === 29) v.mood = 3;
      v.exercise = i % 9 === 4 ? 75 : Math.round((125 + n(10)) / 5) * 5;
    } else if (scenario === 'fever') { // infection starting in the last 3 days
      if (i >= 27) { v.temp = [37.6, 38.1, 38.4][i - 27]; v.hr = [82, 91, 97][i - 27]; }
      if (i === 29) { v.sleep = 6.2; v.mood = 3; v.spo2 = 95; v.exercise = 40; }
    } else if (scenario === 'bone') { // skipping exercise, blood pressure rising
      if (i >= 18) v.exercise = Math.round((i >= 25 ? 55 : 85) + n(8));
      if (i >= 25) { v.sbp = Math.round(133 + n(2)); v.dbp = Math.round(83 + n(1.5)); }
    }

    v.rad = r(env.radBaseline * (1 + n(0.08)), 2);
    if (i === 23) v.rad = r(env.radBaseline * (4.1 + n(0.15)), 2);               // solar particle event (whole crew)
    if (i === 24) v.rad = r(env.radBaseline * 2.2, 2);
    if (i === 11 + (seed % 5)) delete v.glucose;                                 // a missed measurement
    readings.push({ date: addDays(t0, i - 30), values: v });
  }
  return readings;
}

/* ---------- storage helpers (fall back to memory if localStorage is blocked) ---------- */
const memStore = {};
function lsGet(k) {
  if (k in memStore) return memStore[k];
  try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function lsSet(k, v) {
  memStore[k] = v;
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* memory only */ }
}
function lsDel(k) {
  delete memStore[k];
  try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
}

/* ---------- PIN hashing (PBKDF2-SHA256, random salt per astronaut) ---------- */
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
function randomHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return toHex(a); }

async function hashPin(pin, saltHex) {
  if (!(window.crypto && crypto.subtle)) {
    throw new Error('PIN login needs a secure page: open the app over HTTPS or http://localhost.');
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations: PIN_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return toHex(new Uint8Array(bits));
}

/* ---------- crew & session ---------- */
let crew = null;      // shared: env, missionStart, webhookUrl, ttsOn, members[]
let state = null;     // logged-in astronaut's data: readings, xp, chat, sessionId
let currentId = null;

function newMemberData(readings = [], xp = 0) {
  return { readings, xp, chat: [], sessionId: 'sv-' + randomHex(4) };
}

function member(id) { return crew && crew.members.find((m) => m.id === id); }
function me() { return member(currentId) || { name: 'Astronaut', role: '', avatar: '🧑‍🚀' }; }
function canViewCrew() { return !!member(currentId) && CREW_VIEW_ROLES.includes(member(currentId).role); }

function saveCrew() { lsSet(CREW_KEY, crew); }
function save() {
  saveCrew();
  if (currentId && state) lsSet(MEMBER_PREFIX + currentId, state);
}

async function createMember({ name, role, avatar, pin, demo }, data) {
  const id = 'm' + randomHex(6);
  const salt = randomHex(16);
  const hash = await hashPin(pin, salt);
  const m = { id, name, role, avatar, salt, hash, demo: !!demo, created: today() };
  crew.members.push(m);
  lsSet(MEMBER_PREFIX + id, data || newMemberData());
  saveCrew();
  return m;
}

async function seedCrew(keep = {}) {
  crew = {
    v: 2,
    env: ENVIRONMENTS[keep.env] ? keep.env : 'transit',
    missionStart: addDays(today(), -41),
    webhookUrl: keep.webhookUrl || '',
    ttsOn: keep.ttsOn !== undefined ? keep.ttsOn : true,
    members: [],
  };
  for (const d of DEMO_CREW) {
    await createMember({ ...d, demo: true }, newMemberData(generateHistory(crew.env, d.scenario, d.seed), d.xp));
  }
}

async function initStore() {
  crew = lsGet(CREW_KEY);
  if (!crew || crew.v !== 2 || !Array.isArray(crew.members)) {
    const legacy = lsGet(LEGACY_KEY); // single-astronaut version: keep its settings
    await seedCrew(legacy ? { env: legacy.env, webhookUrl: legacy.webhookUrl, ttsOn: legacy.ttsOn } : {});
    lsDel(LEGACY_KEY);
  }
  if (!ENVIRONMENTS[crew.env]) crew.env = 'transit';
  let sid = null;
  try { sid = sessionStorage.getItem(SESSION_KEY); } catch (e) { /* ignore */ }
  if (sid && member(sid)) openMember(sid);
}

function loadMemberData(id) {
  const d = lsGet(MEMBER_PREFIX + id);
  if (d && Array.isArray(d.readings)) {
    if (!Array.isArray(d.chat)) d.chat = [];
    if (!d.sessionId) d.sessionId = 'sv-' + randomHex(4);
    if (typeof d.xp !== 'number') d.xp = 0;
    return d;
  }
  return newMemberData();
}

function openMember(id) {
  currentId = id;
  state = loadMemberData(id);
  try { sessionStorage.setItem(SESSION_KEY, id); } catch (e) { /* ignore */ }
}

function closeMember() {
  if (currentId && state) save();
  currentId = null;
  state = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}

async function verifyPin(id, pin) {
  const m = member(id);
  return !!m && (await hashPin(pin, m.salt)) === m.hash;
}

async function changePin(id, newPin) {
  const m = member(id);
  m.salt = randomHex(16);
  m.hash = await hashPin(newPin, m.salt);
  saveCrew();
}

function removeMember(id) {
  crew.members = crew.members.filter((m) => m.id !== id);
  lsDel(MEMBER_PREFIX + id);
  saveCrew();
}

async function resetDemo() {
  const keep = { env: crew.env, webhookUrl: crew.webhookUrl, ttsOn: crew.ttsOn };
  crew.members.forEach((m) => lsDel(MEMBER_PREFIX + m.id));
  currentId = null;
  state = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  await seedCrew(keep);
}

/* Run fn() as if `id` were logged in (used by the crew overview). Synchronous only. */
function withMember(id, fn) {
  if (id === currentId) return fn();
  const prevState = state;
  const prevId = currentId;
  state = loadMemberData(id);
  currentId = id;
  try { return fn(); } finally { state = prevState; currentId = prevId; }
}

function lastCheckinDate() {
  const rs = sortedReadings();
  for (let i = rs.length - 1; i >= 0; i--) if (Object.keys(rs[i].values).length) return rs[i].date;
  return null;
}

/* ---------- lookups ---------- */
function envObj() { return ENVIRONMENTS[crew && crew.env] || ENVIRONMENTS.transit; }
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

function missionDay() { return daysBetween(crew.missionStart, today()) + 1; }

function missionDose() {
  const logged = state.readings.filter((r) => r.values.rad != null);
  const sum = logged.reduce((a, r) => a + r.values.rad, 0);
  const unlogged = Math.max(0, missionDay() - logged.length);
  return sum + unlogged * envObj().radBaseline; // days without a reading assume the local baseline
}

function readiness() { // null when the astronaut has no readings yet
  let s = 100;
  let any = false;
  INDICATORS.forEach((i) => {
    const st = indStatus(i.id);
    if (st !== 'unknown') any = true;
    if (st === 'yellow') s -= 8;
    if (st === 'red') s -= 20;
  });
  return any ? Math.max(0, s) : null;
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
  lines.push(`Astronaut: ${me().name} (${me().role})`);
  lines.push(`Mission: ${env.name} · Day ${missionDay()} · ${today()}`);
  lines.push(`Readiness score: ${readiness() == null ? 'no data' : readiness() + '/100'}`);
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
