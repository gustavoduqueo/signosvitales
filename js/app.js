'use strict';
/* UI: tabs, dashboard (body map, detail, tiles, alerts, routine, badges), check-in,
   trends, learn, settings and flight-surgeon report. */

const ui = { tab: 'dashboard', system: null, indicator: null, trendId: 'hr', trendDays: 30 };
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const pill = (st, text) => `<span class="pill st-${st}">${esc(text || STATUS_LABEL[st])}</span>`;

/* ---------- header ---------- */
function renderHeader() {
  const env = envObj();
  $('#chipDay').textContent = `Mission day ${missionDay()}`;
  $('#chipDelay').textContent = `📡 Earth delay ${env.delayLabel}`;
  $('#chipDelay').title = env.desc;
  const score = readiness();
  const st = score >= 85 ? 'green' : score >= 60 ? 'yellow' : 'red';
  const label = { green: 'Mission ready', yellow: 'Needs attention', red: 'Act now' }[st];
  $('#readiness').innerHTML = `<div class="ring st-${st}" style="--p:${score}"><span>${score}</span></div>
    <div class="ring-txt"><small>Readiness</small><b>${label}</b></div>`;
  const lv = level();
  const inLv = state.xp % 250;
  $('#xpBox').innerHTML = `<div class="xp-top"><b>Lv ${lv}</b><small>${inLv}/250 XP · 🔥 ${streak()}d</small></div>
    <div class="bar"><i style="width:${(inLv / 250) * 100}%"></i></div>`;
  $('#envSelect').value = state.env;
}

/* ---------- dashboard ---------- */
function defaultSystem() {
  return Object.keys(SYSTEMS).reduce((best, k) => (RANK[systemStatus(k)] > RANK[systemStatus(best)] ? k : best), 'cardio');
}

function renderBodyMap() {
  $$('[data-system]', $('#bodySvg')).forEach((g) => {
    const k = g.dataset.system;
    g.setAttribute('class', `region st-${systemStatus(k)}${ui.system === k ? ' selected' : ''}${g.classList.contains('halo') ? ' halo' : ''}`);
  });
  $('#legend').innerHTML = Object.entries(SYSTEMS).map(([k, s]) => {
    const st = systemStatus(k);
    return `<li><button class="legend-item${ui.system === k ? ' active' : ''}" data-sys="${k}">
      <span class="dot st-${st}"></span><span class="lg-name">${s.icon} ${s.name}</span><span class="lg-st st-${st}">${STATUS_LABEL[st]}</span></button></li>`;
  }).join('');
}

function renderDetail() {
  const key = ui.system;
  const sys = SYSTEMS[key];
  if (!sys.indicators.includes(ui.indicator)) {
    ui.indicator = sys.indicators.reduce((b, id) => (RANK[indStatus(id)] > RANK[indStatus(b)] ? id : b), sys.indicators[0]);
  }
  const ind = IND[ui.indicator];
  const st = systemSt(key);
  const ist = indStatus(ind.id);
  const rows = sys.indicators.map((id) => {
    const l = latest(id);
    const s = statusOf(id, l && l.value);
    return `<button class="ind-row${id === ui.indicator ? ' active' : ''}" data-ind="${id}">
      <span class="dot st-${s}"></span><span class="ir-name">${IND[id].name}</span>
      <span class="ir-val">${l ? esc(fmtVal(id, l.value)) : '—'}</span>
      <span class="ir-range muted small">normal ${esc(rangeText(id))}</span></button>`;
  }).join('');
  const hz = sys.hazards.map((h) => `<span class="hz-chip" title="${esc(HAZARDS[h].text)}">${HAZARDS[h].icon} ${HAZARDS[h].name}</span>`).join('');
  let todo;
  if (ist === 'green') todo = '<p>In normal range. Keep following your routine and log the next measurement on schedule.</p>';
  else if (ist === 'unknown') todo = '<p>No data yet. Log it in the daily check-in.</p>';
  else todo = `<ul>${ind.actions[ist].map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`;
  let extra = '';
  if (key === 'radiation') {
    const dose = missionDose();
    const pct = Math.min(100, (dose / CAREER_LIMIT_MSV) * 100);
    extra = `<div class="dose"><div class="dose-top"><span>Mission dose (estimated)</span><b>${dose.toFixed(1)} mSv</b></div>
      <div class="bar big"><i style="width:${pct}%"></i></div>
      <small class="muted">${pct.toFixed(0)}% of the ${CAREER_LIMIT_MSV} mSv NASA career limit · usual level at ${esc(envObj().short)}: ~${envObj().radBaseline} mSv/day</small></div>`;
  }
  $('#detail').innerHTML = `
    <div class="card-h"><h2>${sys.icon} ${sys.name}</h2>${pill(st)}</div>
    <p class="muted">${esc(sys.desc)}</p>
    <div class="hz">${hz}</div>
    ${extra}
    <div class="ind-rows">${rows}</div>
    <div class="chart-box"><canvas id="detailChart" aria-label="${esc(ind.name)} chart"></canvas></div>
    <p class="chart-cap muted small">${esc(ind.name)} · last 14 days · green band = normal, yellow = watch</p>
    <div class="todo st-${ist}"><h4>${ist === 'green' ? '✅ Looking good' : ist === 'unknown' ? 'ℹ️ No data' : '🩺 What to do now'}</h4>${todo}</div>
    <details class="why"><summary>Why it matters in space &amp; how to measure</summary>
      <p><b>Why:</b> ${esc(ind.why)}</p><p><b>How to measure aboard:</b> ${esc(ind.measure)}</p></details>`;
  drawIndicatorChart($('#detailChart'), ind.id, 14);
}
function systemSt(k) { return systemStatus(k); }

function renderTiles() {
  $('#tiles').innerHTML = INDICATORS.map((ind) => {
    const l = latest(ind.id);
    const s = statusOf(ind.id, l && l.value);
    const a = avgWindow(ind.id, 1, 7);
    let arrow = '';
    if (l && a != null && ind.id !== 'mood') {
      const diff = l.value - a;
      const rel = Math.abs(diff) / (Math.abs(a) || 1);
      arrow = rel < 0.03 ? '→' : diff > 0 ? '↑' : '↓';
    }
    const val = ind.id === 'mood' && l ? `${MOOD[l.value].e} ${l.value}<small>/5</small>` : l ? `${fmtNum(ind.id, l.value)}<small> ${esc(ind.unit)}</small>` : '—';
    return `<button class="tile st-${s}" data-ind="${ind.id}">
      <div class="tile-top"><span>${esc(ind.short)}</span><span class="dot st-${s}"></span></div>
      <div class="tile-val">${val} <span class="arrow" title="vs 7-day average">${arrow}</span></div>
      <div class="tile-foot"><span>${l ? relDay(l.date) : 'no data'}</span><span>${esc(rangeText(ind.id))}</span></div></button>`;
  }).join('');
  const todayVals = (getReading(today()) || { values: {} }).values;
  const missing = INDICATORS.filter((i) => todayVals[i.id] == null).length;
  $('#tilesNote').textContent = missing ? `${missing} not logged today` : 'All logged today ✔';
}

function renderAlerts() {
  const al = buildAlerts();
  if (!al.length) {
    $('#alerts').innerHTML = '<p class="ok-msg">✅ No alerts. All indicators are within normal range.</p>';
    return;
  }
  $('#alerts').innerHTML = al.map((a, i) => `
    <details class="alert st-${a.level}"${i < 2 ? ' open' : ''}>
      <summary><span class="dot st-${a.level}"></span><b>${esc(a.title)}</b>${a.trend ? '<span class="tag">trend</span>' : ''}</summary>
      <p class="muted small">${esc(a.text)}</p>
      <ol>${a.actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      ${a.escalate ? `<p class="escalate">📡 Needs flight surgeon review. Signal delay ${esc(envObj().delayLabel)}: act on the steps above first.</p>` : ''}
      <button class="link-btn" data-ind="${a.id}">View ${esc(IND[a.id].short)} →</button>
    </details>`).join('');
}

function renderRoutine() {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  $('#routine').innerHTML = ROUTINE.map((t) => {
    const done = taskDone(t);
    const due = !done && hm >= t.time;
    return `<li class="${done ? 'done' : due ? 'due' : ''}">
      <span class="check">${done ? '✔' : ''}</span>
      <div class="rt-body"><b>${esc(t.title)}</b><small class="muted">${esc(t.detail)}</small></div>
      <div class="rt-meta"><span class="time">${t.time}</span><small>${done ? 'done' : due ? 'due now' : 'later'} · +${t.xp} XP</small></div></li>`;
  }).join('');
  $('#badges').innerHTML = badges().map((b) => `<div class="badge${b.earned ? ' earned' : ''}" title="${esc(b.desc)}">
      <span class="b-icon">${b.icon}</span><span class="b-name">${esc(b.name)}</span><small>${esc(b.desc)}</small></div>`).join('');
}

function renderDashboard() {
  if (!ui.system) ui.system = defaultSystem();
  renderBodyMap();
  renderDetail();
  renderTiles();
  renderAlerts();
  renderRoutine();
}

function selectIndicator(id, scroll = true) {
  ui.system = IND[id].system;
  ui.indicator = id;
  if (ui.tab !== 'dashboard') showTab('dashboard');
  else { renderBodyMap(); renderDetail(); }
  if (scroll && window.matchMedia('(max-width: 900px)').matches) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- check-in ---------- */
function renderCheckin() {
  const r = getReading(today());
  const vals = r ? r.values : {};
  const groups = ROUTINE.map((t) => {
    const fields = t.ids.map((id) => {
      const ind = IND[id];
      const l = latest(id);
      const v = vals[id];
      if (id === 'mood') {
        return `<div class="field mood-field" data-id="mood"><label>${esc(ind.name)}</label>
          <div class="mood-row">${[1, 2, 3, 4, 5].map((n) => `<label class="mood-opt"><input type="radio" name="mood" value="${n}"${v === n ? ' checked' : ''}><span>${MOOD[n].e}<small>${MOOD[n].l}</small></span></label>`).join('')}</div>
          <div class="hint">Normal: ${esc(rangeText(id))}</div></div>`;
      }
      return `<div class="field" data-id="${id}">
        <label for="f-${id}">${esc(ind.name)} <span class="unit">${esc(ind.unit)}</span></label>
        <div class="input-row"><input id="f-${id}" name="${id}" type="number" inputmode="decimal" step="${ind.input.step}" min="${ind.input.min}" max="${ind.input.max}" value="${v != null ? v : ''}" placeholder="${l ? 'last: ' + fmtNum(id, l.value) : ''}"><span class="dot st-${statusOf(id, v)}"></span></div>
        <div class="hint">Normal: ${esc(rangeText(id))}</div>
        <details><summary>How to measure</summary><p>${esc(ind.measure)}</p></details></div>`;
    }).join('');
    const done = taskDone(t);
    return `<fieldset class="group${done ? ' done' : ''}"><legend>${done ? '✔ ' : ''}${esc(t.title)} <small>${t.time} · +${t.xp} XP</small></legend><div class="fields">${fields}</div></fieldset>`;
  }).join('');
  $('#checkinForm').innerHTML = groups + `<div class="form-actions"><span class="muted small">Logging every routine task today earns a +50 XP bonus.</span><button type="submit" class="btn primary">Save check-in</button></div>`;
}

function onCheckinInput(e) {
  const f = e.target.closest('.field');
  if (!f || e.target.type !== 'number') return;
  const dot = $('.dot', f);
  const v = e.target.value === '' ? null : +e.target.value;
  dot.className = `dot st-${statusOf(f.dataset.id, v)}`;
}

function onCheckinSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const values = {};
  INDICATORS.forEach((ind) => {
    if (ind.id === 'mood') {
      const m = $('input[name="mood"]:checked', form);
      if (m) values.mood = +m.value;
      return;
    }
    const inp = $(`#f-${ind.id}`, form);
    if (inp && inp.value !== '') values[ind.id] = +inp.value;
  });
  if (!Object.keys(values).length) { toast('Enter at least one value'); return; }
  const bad = Object.entries(values).find(([id, v]) => v < IND[id].input.min || v > IND[id].input.max);
  if (bad) { toast(`${IND[bad[0]].short}: value out of possible range`); return; }
  const res = logValues(values);
  const flagged = Object.keys(values).filter((id) => statusOf(id, values[id]) !== 'green');
  toast(`Saved ${res.logged.length} value${res.logged.length > 1 ? 's' : ''}${res.xp ? ` · +${res.xp} XP` : ''}${flagged.length ? ` · ${flagged.length} need attention` : ''}`);
  ui.system = null;
  showTab('dashboard');
}

function simulateWearable() {
  const rnd = (a, b, d = 0) => +(a + Math.random() * (b - a)).toFixed(d);
  const vals = { hr: rnd(58, 78), sbp: rnd(108, 126), dbp: rnd(68, 80), spo2: rnd(96, 99), temp: rnd(36.5, 37.1, 1) };
  Object.entries(vals).forEach(([id, v]) => {
    const inp = $(`#f-${id}`);
    if (inp) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  toast('⌚ Synced vitals from the wearable (simulated)');
}

/* ---------- trends ---------- */
function renderTrends() {
  $('#trendChips').innerHTML = INDICATORS.map((i) => `<button class="chip-btn${ui.trendId === i.id ? ' active' : ''}" data-trend="${i.id}"><span class="dot st-${indStatus(i.id)}"></span>${esc(i.short)}</button>`).join('');
  $$('#trendRange button').forEach((b) => b.classList.toggle('active', +b.dataset.days === ui.trendDays));
  const id = ui.trendId;
  const ind = IND[id];
  const vals = series(id, ui.trendDays).map((p) => p.value).filter((v) => v != null);
  const l = latest(id);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const inRange = vals.filter((v) => statusOf(id, v) === 'green').length;
  const f = (v) => (v == null ? '—' : fmtNum(id, v));
  $('#trendTitle').innerHTML = `${SYSTEMS[ind.system].icon} ${esc(ind.name)} <span class="muted small">(${esc(ind.unit)})</span>`;
  $('#trendStats').innerHTML = [
    ['Latest', l ? f(l.value) : '—', l ? statusOf(id, l.value) : 'unknown'],
    [`${ui.trendDays}-day avg`, f(avg), statusOf(id, avg)],
    ['Min', vals.length ? f(Math.min(...vals)) : '—', vals.length ? statusOf(id, Math.min(...vals)) : 'unknown'],
    ['Max', vals.length ? f(Math.max(...vals)) : '—', vals.length ? statusOf(id, Math.max(...vals)) : 'unknown'],
    ['Days in range', vals.length ? `${inRange}/${vals.length}` : '—', vals.length && inRange / vals.length >= 0.8 ? 'green' : 'yellow'],
  ].map(([k, v, s]) => `<div class="stat"><small>${k}</small><b class="txt-${s}">${v}</b></div>`).join('');
  $('#trendWhy').textContent = ind.why;
  drawIndicatorChart($('#trendChart'), id, ui.trendDays);
  $('#miniGrid').innerHTML = INDICATORS.map((i) => {
    const li = latest(i.id);
    return `<button class="mini st-${indStatus(i.id)}" data-trend="${i.id}"><div class="mini-h"><span>${esc(i.short)}</span><b>${li ? esc(fmtVal(i.id, li.value)) : '—'}</b></div><div class="mini-c"><canvas id="mini-${i.id}"></canvas></div></button>`;
  }).join('');
  INDICATORS.forEach((i) => drawIndicatorChart($(`#mini-${i.id}`), i.id, ui.trendDays, true));
}

/* ---------- learn ---------- */
function renderLearn() {
  const hz = Object.values(HAZARDS).map((h) => `<div class="card hz-card"><h3>${h.icon} ${esc(h.name)}</h3><p>${esc(h.text)}</p></div>`).join('');
  const rows = INDICATORS.map((i) => `<tr><td><b>${esc(i.name)}</b><br><small class="muted">${SYSTEMS[i.system].icon} ${esc(SYSTEMS[i.system].name)}</small></td>
    <td>${esc(rangeText(i.id))}</td><td>${esc(i.measure)}</td><td>${esc(i.why)}</td></tr>`).join('');
  const env = Object.entries(ENVIRONMENTS).map(([k, e]) => `<tr${k === state.env ? ' class="cur"' : ''}><td><b>${esc(e.name)}</b></td><td>${esc(e.gravity)}</td><td>${esc(e.delayLabel)}</td><td>~${e.radBaseline} mSv/day</td><td>${esc(e.desc)}</td></tr>`).join('');
  $('#learnBody').innerHTML = `
    <div class="card intro"><h2>How Signos Vitales works</h2>
      <ol><li><b>Measure</b>: a daily routine reminds you which indicators to log: sleep, vitals, glucose, dosimeter, exercise and mood.</li>
      <li><b>Assess</b>: each value is compared with a normal (green), watch (yellow) and alert (red) range. Body systems take the status of their worst indicator.</li>
      <li><b>Act</b>: every yellow or red result comes with concrete steps. Red results also need the flight surgeon, who may be minutes away by radio.</li>
      <li><b>Ask</b>: MEDIC, the AI medical officer, explains results by voice or chat, and you can log values hands-free.</li></ol></div>
    <h2 class="sec-title">The 5 hazards of human spaceflight (NASA HRP)</h2>
    <div class="hz-grid">${hz}</div>
    <h2 class="sec-title">Health indicators</h2>
    <div class="card table-wrap"><table><thead><tr><th>Indicator</th><th>Normal</th><th>How to measure aboard</th><th>Why it matters in space</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2 class="sec-title">Mission environments</h2>
    <div class="card table-wrap"><table><thead><tr><th>Environment</th><th>Gravity</th><th>Signal delay</th><th>Typical radiation</th><th>Notes</th></tr></thead><tbody>${env}</tbody></table>
    <p class="muted small">Radiation levels are approximate published averages, used as each environment's normal level. A daily dose above 1.5× that level shows as "watch", and above 3× as "alert" (a possible solar particle event).</p></div>
    <h2 class="sec-title">Sources</h2>
    <div class="card"><ul class="sources">${SOURCES.map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul></div>`;
}

/* ---------- modals ---------- */
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
  const f = $('#modal input, #modal textarea, #modal button');
  if (f) f.focus();
}
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }

function openSettings() {
  openModal(`<h2>Settings</h2>
    <label class="fld">Astronaut name / callsign<input id="setName" value="${esc(state.callsign)}" maxlength="40"></label>
    <label class="fld">AI webhook URL (n8n, optional)
      <input id="setHook" type="url" placeholder="https://YOUR-INSTANCE.app.n8n.cloud/webhook/medic" value="${esc(state.webhookUrl)}"></label>
    <p class="muted small">MEDIC POSTs <code>{ user_message, health_summary, … }</code> and reads <code>reply</code> from the JSON response. Leave empty to use the offline rules. Setup steps are in the README.</p>
    <div class="row"><button class="btn small" id="btnTest">Test connection</button><span id="testOut" class="small"></span></div>
    <hr>
    <div class="row between"><button class="btn small danger" id="btnReset">Reset demo data</button>
      <div class="row"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="btnSaveSet">Save</button></div></div>`);
  $('#btnTest').onclick = async () => {
    const url = $('#setHook').value.trim();
    if (!url) { $('#testOut').textContent = 'Enter a URL first.'; return; }
    $('#testOut').textContent = 'Testing…';
    const r = await Assistant.testConnection(url);
    $('#testOut').className = `small txt-${r.ok ? 'green' : 'red'}`;
    $('#testOut').textContent = r.ok ? `✔ ${r.text}` : `✖ ${r.text}`;
  };
  $('#btnSaveSet').onclick = () => {
    state.callsign = $('#setName').value.trim() || 'Astronaut';
    state.webhookUrl = $('#setHook').value.trim();
    save();
    closeModal();
    Assistant.renderEngine();
    renderAll();
    toast('Settings saved');
  };
  $('#btnReset').onclick = () => {
    if (!confirm('Replace all readings, XP and chat with fresh demo data?')) return;
    resetDemo();
    ui.system = null;
    closeModal();
    renderAll();
    toast('Demo data reset');
  };
}

function openReport() {
  const env = envObj();
  openModal(`<h2>📡 Report to flight surgeon</h2>
    <p class="muted small">Sends a summary to the ground. From ${esc(env.name)}, a one-way signal takes <b>${esc(env.delayLabel)}</b>, so expect a reply after about twice that long. Keep following the onboard actions in the meantime.</p>
    <textarea id="reportTxt" rows="16" readonly>${esc(surgeonReport())}</textarea>
    <div class="row between"><button class="btn ghost" data-close>Close</button>
      <div class="row"><button class="btn" id="btnCopy">Copy</button><button class="btn primary" id="btnSend">Transmit (simulated)</button></div></div>`);
  $('#btnCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#reportTxt').value); toast('Report copied'); } catch (e) { $('#reportTxt').select(); toast('Press Ctrl/Cmd+C to copy'); }
  };
  $('#btnSend').onclick = () => {
    closeModal();
    toast(`📡 Report transmitted. Arrives at mission control in ${env.delayLabel}.`);
  };
}

/* ---------- toasts ---------- */
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

/* ---------- tabs & render ---------- */
function showTab(name) {
  ui.tab = name;
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  renderHeader();
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${name}`));
  renderTab();
  window.scrollTo({ top: 0 });
}

function renderTab() {
  if (ui.tab === 'dashboard') renderDashboard();
  else if (ui.tab === 'checkin') renderCheckin();
  else if (ui.tab === 'trends') renderTrends();
  else if (ui.tab === 'learn') renderLearn();
  else if (ui.tab === 'assistant') Assistant.renderChat();
}

function renderAll() {
  renderHeader();
  if (ui.tab !== 'checkin') renderTab(); // don't wipe a half-filled form
}

const App = { refresh: renderAll, toast };

function init() {
  $('#envSelect').innerHTML = Object.entries(ENVIRONMENTS).map(([k, e]) => `<option value="${k}">${esc(e.name)}</option>`).join('');
  $('#envSelect').addEventListener('change', (e) => {
    state.env = e.target.value;
    save();
    renderAll();
    const env = envObj();
    toast(`${env.name}: Earth delay ${env.delayLabel}, usual radiation ~${env.radBaseline} mSv/day`);
  });

  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) { showTab(g.dataset.goto); return; }
    if (e.target.closest('[data-close]') || e.target.id === 'modal') { closeModal(); return; }
    const sysBtn = e.target.closest('[data-sys]');
    if (sysBtn) { ui.system = sysBtn.dataset.sys; renderBodyMap(); renderDetail(); return; }
    const tr = e.target.closest('[data-trend]');
    if (tr) { ui.trendId = tr.dataset.trend; renderTrends(); if (tr.classList.contains('mini')) $('#tab-trends').scrollIntoView({ behavior: 'smooth' }); return; }
    const ib = e.target.closest('[data-ind]');
    if (ib && ui.tab === 'dashboard') { selectIndicator(ib.dataset.ind, !ib.closest('#detail')); }
  });
  $('#bodySvg').addEventListener('click', (e) => {
    const g = e.target.closest('[data-system]');
    if (!g) return;
    ui.system = g.dataset.system;
    renderBodyMap();
    renderDetail();
  });
  $('#bodySvg').addEventListener('keydown', (e) => {
    const g = e.target.closest('[data-system]');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ui.system = g.dataset.system; renderBodyMap(); renderDetail(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

  $('#trendRange').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-days]');
    if (b) { ui.trendDays = +b.dataset.days; renderTrends(); }
  });
  $('#checkinForm').addEventListener('input', onCheckinInput);
  $('#checkinForm').addEventListener('submit', onCheckinSubmit);
  $('#btnSync').addEventListener('click', simulateWearable);
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnReport').addEventListener('click', openReport);

  Assistant.init();
  const fromHash = location.hash.slice(1);
  if ($(`#tab-${CSS.escape(fromHash)}`)) showTab(fromHash); else renderAll();
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if ($(`#tab-${CSS.escape(h)}`)) showTab(h); });
}

init();
