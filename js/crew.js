'use strict';
/* Crew overview for the Commander and the Crew Medical Officer:
   everyone's readiness, body-system status, alerts and check-in progress at a glance. */

const CrewView = (() => {
  function snapshot(m) {
    return withMember(m.id, () => {
      const alerts = buildAlerts();
      const score = readiness();
      return {
        m,
        score,
        alerts,
        worst: alerts.length ? alerts[0].level : score == null ? 'unknown' : 'green',
        systems: Object.keys(SYSTEMS).map((k) => [k, systemStatus(k)]),
        tasks: ROUTINE.filter((t) => taskDone(t)).length,
        last: lastCheckinDate(),
        dose: missionDose(),
      };
    });
  }

  function card(r) {
    const isMe = r.m.id === currentId;
    const canRemove = me().role === 'Commander' && !isMe;
    const scoreSt = r.score == null ? 'unknown' : r.score >= 85 ? 'green' : r.score >= 60 ? 'yellow' : 'red';
    const alerts = r.alerts.length
      ? `<ul class="cc-alerts">${r.alerts.slice(0, 3).map((a) => `<li><span class="dot st-${a.level}"></span>${esc(a.title)}</li>`).join('')}${r.alerts.length > 3 ? `<li class="muted">+${r.alerts.length - 3} more</li>` : ''}</ul>`
      : `<p class="cc-ok">${r.score == null ? 'No readings yet' : '✅ No alerts'}</p>`;
    return `<div class="card crew-card st-${r.worst}">
      <div class="cc-head">
        <span class="p-av">${r.m.avatar}</span>
        <div class="cc-name"><b>${esc(r.m.name)}${isMe ? ' <span class="tag">you</span>' : ''}</b><small>${esc(r.m.role)}</small></div>
        <div class="ring st-${scoreSt}" style="--p:${r.score || 0}" title="Readiness"><span>${r.score == null ? '—' : r.score}</span></div>
      </div>
      <div class="cc-sys">${r.systems.map(([k, s]) => `<span class="cc-s st-${s}" title="${esc(SYSTEMS[k].name)}: ${STATUS_LABEL[s]}">${SYSTEMS[k].icon}</span>`).join('')}</div>
      ${alerts}
      <div class="cc-meta">
        <span>🕒 ${r.last ? `Last check-in ${relDay(r.last)}` : 'Never checked in'}</span>
        <span>📋 Today ${r.tasks}/${ROUTINE.length}</span>
        <span>☢️ ${r.dose.toFixed(0)} mSv</span>
      </div>
      ${canRemove ? `<button class="link-btn danger-link" data-remove="${r.m.id}">Remove from crew</button>` : ''}
    </div>`;
  }

  function render() {
    const box = document.getElementById('crewBody');
    if (!canViewCrew()) {
      box.innerHTML = '<div class="card"><p>Only the Commander or the Crew Medical Officer can open the crew overview.</p></div>';
      return;
    }
    const rows = crew.members.map(snapshot);
    rows.sort((a, b) => RANK[b.worst] - RANK[a.worst] || (a.score ?? 101) - (b.score ?? 101));
    const needs = rows.filter((r) => r.worst === 'red').length;
    const watch = rows.filter((r) => r.worst === 'yellow').length;
    const scored = rows.filter((r) => r.score != null);
    const avg = scored.length ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length) : null;
    const checked = rows.filter((r) => r.last === today()).length;
    box.innerHTML = `<div class="card">
        <div class="card-h"><h2>👥 Crew overview</h2><button class="btn small" id="btnCrewReport">📡 Crew report to flight surgeon</button></div>
        <div class="stats">
          <div class="stat"><small>Crew</small><b>${rows.length}</b></div>
          <div class="stat"><small>Need attention</small><b class="txt-${needs ? 'red' : 'green'}">${needs}</b></div>
          <div class="stat"><small>To watch</small><b class="txt-${watch ? 'yellow' : 'green'}">${watch}</b></div>
          <div class="stat"><small>Avg readiness</small><b>${avg == null ? '—' : avg}</b></div>
          <div class="stat"><small>Checked in today</small><b>${checked}/${rows.length}</b></div>
        </div>
        <p class="muted small">Visible to the Commander and the Crew Medical Officer only. Crew members who need attention are listed first.</p>
      </div>
      <div class="crew-grid">${rows.map(card).join('')}</div>`;
  }

  function crewReport() {
    const env = envObj();
    const parts = [
      'CREW HEALTH REPORT: SIGNOS VITALES',
      `Mission: ${env.name} · Day ${missionDay()} · ${today()}`,
      `Prepared by: ${me().name} (${me().role})`,
      `Crew size: ${crew.members.length}`,
    ];
    crew.members.forEach((m) => {
      parts.push('', '='.repeat(48), withMember(m.id, surgeonReport));
    });
    return parts.join('\n');
  }

  function openCrewReport() {
    const env = envObj();
    openModal(`<h2>📡 Crew report to flight surgeon</h2>
      <p class="muted small">Summary for the whole crew. From ${esc(env.name)}, a one-way signal takes <b>${esc(env.delayLabel)}</b>.</p>
      <textarea id="reportTxt" rows="18" readonly>${esc(crewReport())}</textarea>
      <div class="row between"><button class="btn ghost" data-close>Close</button>
        <div class="row"><button class="btn" id="btnCopy">Copy</button><button class="btn primary" id="btnSend">Transmit (simulated)</button></div></div>`);
    document.getElementById('btnCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(document.getElementById('reportTxt').value); toast('Report copied'); } catch (e) { document.getElementById('reportTxt').select(); toast('Press Ctrl/Cmd+C to copy'); }
    };
    document.getElementById('btnSend').onclick = () => { closeModal(); toast(`📡 Crew report transmitted. Arrives at mission control in ${env.delayLabel}.`); };
  }

  function init() {
    document.getElementById('crewBody').addEventListener('click', (e) => {
      if (e.target.closest('#btnCrewReport')) { openCrewReport(); return; }
      const rm = e.target.closest('[data-remove]');
      if (rm && me().role === 'Commander') {
        const m = member(rm.dataset.remove);
        if (m && confirm(`Remove ${m.name} and delete all of their health data from this device?`)) {
          removeMember(m.id);
          render();
          toast(`${m.name} was removed from the crew`);
        }
      }
    });
  }

  return { init, render };
})();
