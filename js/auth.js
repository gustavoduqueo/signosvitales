'use strict';
/* Crew login: pick your profile, unlock with a 4–6 digit PIN, add new crew members,
   lock / switch astronaut, auto-lock after inactivity, brute-force lockout. */

const Auth = (() => {
  const IDLE_MS = 5 * 60 * 1000;
  const MAX_TRIES = 5;
  const LOCKOUT_MS = 30 * 1000;
  const view = { mode: 'pick', id: null, pin: '', error: '', busy: false };
  const fails = {}; // memberId -> { n, until }
  let idleTimer = null;
  let lastActivity = 0;

  const box = () => document.getElementById('login');
  const visible = () => !box().hidden;

  /* ---------- show / hide ---------- */
  function show() {
    document.body.classList.add('locked');
    box().hidden = false;
    Object.assign(view, { mode: 'pick', id: null, pin: '', error: '', busy: false });
    render();
  }

  function hide() {
    document.body.classList.remove('locked');
    box().hidden = true;
    box().innerHTML = '';
  }

  /* ---------- rendering ---------- */
  function render() {
    const env = envObj();
    let body;
    if (view.mode === 'pin') body = pinHtml();
    else if (view.mode === 'add') body = addHtml();
    else body = pickHtml();
    box().innerHTML = `<div class="login-box">
      <div class="login-brand">
        <span class="logo" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M2 17h7l3-7 5 14 3-9 2 2h8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <div><strong>Signos Vitales</strong><small>Crew health station · ${esc(env.name)} · Day ${missionDay()}</small></div>
      </div>
      ${body}
      <p class="login-foot">🔒 Health data stays on this device. PINs are stored only as salted PBKDF2 hashes.</p>
    </div>`;
    if (view.mode === 'add') { const f = document.getElementById('addName'); if (f) f.focus(); }
  }

  function pickHtml() {
    const cards = crew.members.map((m) => `<button class="pick" data-pick="${m.id}">
        <span class="p-av">${m.avatar}</span><b>${esc(m.name)}</b><small>${esc(m.role)}</small></button>`).join('');
    const demo = crew.members
      .filter((m) => m.demo)
      .map((m) => { const d = DEMO_CREW.find((x) => x.name === m.name); return d ? `${esc(m.name)} <b>${d.pin}</b>` : ''; })
      .filter(Boolean);
    return `<h2>Who is checking in?</h2>
      <div class="crew-pick">${cards}
        <button class="pick add" data-add><span class="p-av">＋</span><b>Add crew member</b><small>New profile</small></button>
      </div>
      ${demo.length ? `<p class="demo-hint">Demo PINs: ${demo.join(' · ')}</p>` : ''}`;
  }

  function pinHtml() {
    const m = member(view.id);
    const slots = Math.max(4, view.pin.length);
    const dots = Array.from({ length: slots }, (_, i) => `<i class="${i < view.pin.length ? 'on' : ''}"></i>`).join('');
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<button data-key="${k}">${k}</button>`).join('');
    return `<button class="link-btn back" data-back>← Back</button>
      <div class="pin-who"><span class="p-av big">${m.avatar}</span><h2>${esc(m.name)}</h2><small class="muted">${esc(m.role)}</small></div>
      <div class="pin-dots${view.error ? ' shake' : ''}" aria-label="${view.pin.length} digits entered">${dots}</div>
      <p class="pin-err${view.error ? '' : ' hint'}" role="alert">${esc(view.error) || (view.busy ? 'Checking…' : 'Enter your PIN')}</p>
      <div class="keypad">${keys}
        <button data-key="del" aria-label="Delete">⌫</button><button data-key="0">0</button>
        <button data-key="ok" class="ok" aria-label="Unlock">✓</button></div>`;
  }

  function addHtml() {
    return `<button class="link-btn back" data-back>← Back</button>
      <h2>Add crew member</h2>
      <form id="addForm" class="add-form" autocomplete="off">
        <label class="fld">Name<input id="addName" maxlength="30" required></label>
        <label class="fld">Role<select id="addRole">${ROLES.map((r) => `<option>${r}</option>`).join('')}</select></label>
        <div class="fld">Avatar<div class="av-row">${AVATARS.map((a, i) => `<label class="av-opt"><input type="radio" name="av" value="${a}"${i === 0 ? ' checked' : ''}><span>${a}</span></label>`).join('')}</div></div>
        <div class="row2">
          <label class="fld">PIN (4–6 digits)<input id="addPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" required></label>
          <label class="fld">Repeat PIN<input id="addPin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" required></label>
        </div>
        <p class="pin-err" role="alert">${esc(view.error)}</p>
        <button class="btn primary wide" type="submit"${view.busy ? ' disabled' : ''}>${view.busy ? 'Creating…' : 'Create profile & sign in'}</button>
      </form>
      <p class="muted small">Commander and Crew Medical Officer roles can also open the crew overview.</p>`;
  }

  /* ---------- PIN entry ---------- */
  function press(key) {
    if (view.busy) return;
    if (key === 'del') { view.pin = view.pin.slice(0, -1); view.error = ''; render(); return; }
    if (key === 'ok') { submitPin(); return; }
    if (view.pin.length >= 6) return;
    view.pin += key;
    view.error = '';
    render();
  }

  async function submitPin() {
    const id = view.id;
    const f = fails[id];
    if (f && f.until > Date.now()) {
      view.error = `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 1000)} s.`;
      view.pin = '';
      render();
      return;
    }
    if (view.pin.length < 4) { view.error = 'Your PIN has 4 to 6 digits.'; render(); return; }
    view.busy = true;
    render();
    let ok = false;
    try { ok = await verifyPin(id, view.pin); } catch (e) { view.busy = false; view.error = e.message; render(); return; }
    view.busy = false;
    if (ok) { delete fails[id]; login(id); return; }
    const g = fails[id] || (fails[id] = { n: 0, until: 0 });
    g.n++;
    view.pin = '';
    if (g.n >= MAX_TRIES) { g.n = 0; g.until = Date.now() + LOCKOUT_MS; view.error = 'Too many wrong PINs. Locked for 30 seconds.'; }
    else view.error = `Wrong PIN. ${MAX_TRIES - g.n} attempt${MAX_TRIES - g.n > 1 ? 's' : ''} left.`;
    render();
  }

  /* ---------- add member ---------- */
  async function submitAdd(e) {
    e.preventDefault();
    if (view.busy) return;
    const name = document.getElementById('addName').value.trim();
    const role = document.getElementById('addRole').value;
    const avatar = (document.querySelector('input[name="av"]:checked') || {}).value || AVATARS[0];
    const pin = document.getElementById('addPin').value;
    const pin2 = document.getElementById('addPin2').value;
    let err = '';
    if (!name) err = 'Enter a name.';
    else if (crew.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) err = 'A crew member with that name already exists.';
    else if (!/^\d{4,6}$/.test(pin)) err = 'The PIN must be 4 to 6 digits.';
    else if (pin !== pin2) err = "The PINs don't match.";
    if (err) { view.error = err; document.querySelector('#addForm .pin-err').textContent = err; return; }
    view.busy = true;
    try {
      const m = await createMember({ name, role, avatar, pin });
      view.busy = false;
      login(m.id);
      toast(`Welcome aboard, ${m.name}! Start with your daily check-in.`);
    } catch (ex) {
      view.busy = false;
      view.error = ex.message;
      render();
    }
  }

  /* ---------- session ---------- */
  function login(id) {
    openMember(id);
    hide();
    resetIdle();
    App.onLogin();
  }

  function lock(reason) {
    clearTimeout(idleTimer);
    if (Assistant.isOnCall()) Assistant.endCall();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    closeMember();
    App.onLock();
    show();
    if (reason) toast(reason);
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    if (!currentId) return;
    idleTimer = setTimeout(() => {
      if (!currentId) return;
      if (Assistant.isOnCall()) resetIdle(); // never lock in the middle of a voice call
      else lock('Locked after 5 minutes of inactivity');
    }, IDLE_MS);
  }

  function activity() {
    if (!currentId || Date.now() - lastActivity < 5000) return;
    lastActivity = Date.now();
    resetIdle();
  }

  function init() {
    box().addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.pick) { Object.assign(view, { mode: 'pin', id: t.dataset.pick, pin: '', error: '' }); render(); }
      else if (t.hasAttribute('data-add')) { Object.assign(view, { mode: 'add', error: '' }); render(); }
      else if (t.hasAttribute('data-back')) { Object.assign(view, { mode: 'pick', id: null, pin: '', error: '' }); render(); }
      else if (t.dataset.key) press(t.dataset.key);
    });
    box().addEventListener('submit', (e) => { if (e.target.id === 'addForm') submitAdd(e); });
    document.addEventListener('keydown', (e) => {
      if (!visible()) return;
      if (view.mode === 'pin') {
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
        else if (e.key === 'Enter') { e.preventDefault(); press('ok'); }
      }
      if (e.key === 'Escape' && view.mode !== 'pick') { Object.assign(view, { mode: 'pick', id: null, pin: '', error: '' }); render(); }
    });
    ['click', 'keydown', 'pointermove', 'touchstart', 'scroll'].forEach((ev) => document.addEventListener(ev, activity, { passive: true }));
  }

  return { init, show, lock, resetIdle };
})();
