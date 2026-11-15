'use strict';
/* MEDIC: the onboard AI medical officer.
   - Chat by text, or "call" mode: speech-to-text (Web Speech API) -> reply -> text-to-speech, in a loop.
   - Spoken/typed measurements ("heart rate 72", "blood pressure 120 over 80") are logged directly.
   - Questions go to an n8n webhook (free LLM such as Groq or Gemini) when configured,
     otherwise to built-in offline rules. Health STATUS always comes from the app's thresholds. */

const Assistant = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TTS = 'speechSynthesis' in window;
  const call = { active: false, start: 0, timer: null };
  let phase = 'idle'; // idle | listening | thinking | speaking
  let rec = null;
  let busy = false;

  const el = (id) => document.getElementById(id);

  /* ---------- chat log ---------- */
  function push(role, text, tag) {
    state.chat.push({ role, text, tag, t: Date.now() });
    if (state.chat.length > 80) state.chat.splice(0, state.chat.length - 80);
    save();
    renderChat();
  }

  function renderChat() {
    const box = el('chat');
    if (!box || !state) return;
    if (!state.chat.length) {
      box.innerHTML = `<div class="chat-empty">
        <p><strong>MEDIC</strong> is your onboard medical officer. On a Mars mission the ground is up to 22 minutes away, so MEDIC answers right away using your own health data.</p>
        <p class="muted small">Try a suggestion below, type a question, or press <b>Start call</b> to talk.</p></div>`;
      return;
    }
    const tagLabel = { ai: 'AI', offline: 'Offline rules', logged: 'Logged' };
    box.innerHTML = state.chat.map((m) => {
      if (m.role === 'system') return `<div class="msg system">${esc(m.text)}</div>`;
      const who = m.role === 'user' ? esc(me().name) : 'MEDIC';
      const tag = m.tag ? `<span class="tag tag-${m.tag}">${tagLabel[m.tag] || m.tag}</span>` : '';
      return `<div class="msg ${m.role}"><div class="who">${who} ${tag}</div><div class="bubble">${esc(m.text).replace(/\n/g, '<br>')}</div></div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- phase / call UI ---------- */
  function setPhase(p) {
    phase = p;
    const labels = {
      idle: call.active ? 'On call' : 'Ready',
      listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…',
    };
    const s = el('callStatus');
    if (s) s.textContent = labels[p];
    const card = el('callCard');
    if (card) card.dataset.phase = call.active ? p : 'idle';
    const mic = el('btnMic');
    if (mic) mic.classList.toggle('rec', p === 'listening' && !call.active);
  }

  function caption(text) {
    const c = el('liveCaption');
    if (c) { c.textContent = text || ''; c.hidden = !text; }
  }

  function tickTimer() {
    const s = Math.floor((Date.now() - call.start) / 1000);
    const t = el('callTimer');
    if (t) t.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  function startCall() {
    if (!SR) {
      push('system', 'Voice input is not supported in this browser. Use Chrome or Edge, or type your messages.');
      return;
    }
    call.active = true;
    call.start = Date.now();
    tickTimer();
    call.timer = setInterval(tickTimer, 1000);
    el('btnCall').textContent = '📵 End call';
    el('btnCall').classList.add('end');
    push('system', 'Call started with MEDIC.');
    const al = buildAlerts();
    const score = readiness();
    const greet = score == null
      ? `MEDIC online. Hello ${me().name}. I don't have any readings for you yet. Tell me a value, like "heart rate 70", or ask me anything. How are you feeling today?`
      : `MEDIC online. Hello ${me().name}. Your readiness score is ${score} out of 100` +
        (al.length ? `, and I see ${al.length} item${al.length > 1 ? 's' : ''} to review, starting with ${al[0].title.split(':')[0].toLowerCase()}.` : ', and everything is in range.') +
        ' How are you feeling today?';
    push('assistant', greet, 'offline');
    speak(greet).then(() => { if (call.active) listen(); });
  }

  function endCall() {
    if (!call.active) return;
    call.active = false;
    clearInterval(call.timer);
    if (rec) { try { rec.abort(); } catch (e) { /* ignore */ } rec = null; }
    if (TTS) speechSynthesis.cancel();
    const secs = Math.floor((Date.now() - call.start) / 1000);
    el('btnCall').textContent = '📞 Start call';
    el('btnCall').classList.remove('end');
    caption('');
    push('system', `Call ended (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}).`);
    setPhase('idle');
  }

  /* ---------- speech ---------- */
  function listen() {
    if (!SR) { push('system', 'Voice input is not supported in this browser. Use Chrome or Edge.'); return; }
    if (rec) { try { rec.abort(); } catch (e) { /* ignore */ } }
    const r = new SR();
    rec = r;
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let finalText = '';
    let fatal = false;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      caption(finalText || interim);
    };
    r.onerror = (e) => {
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) {
        fatal = true;
        push('system', `Microphone unavailable (${e.error}). Allow microphone access and open the app from http://localhost in Chrome or Edge.`);
      } else if (e.error === 'network') {
        fatal = true;
        push('system', 'Speech recognition needs an internet connection in this browser.');
      }
    };
    r.onend = () => {
      if (rec !== r) return;
      rec = null;
      caption('');
      if (finalText.trim()) { handle(finalText.trim()); return; }
      if (fatal) { if (call.active) endCall(); else setPhase('idle'); return; }
      if (call.active) setTimeout(() => { if (call.active && !busy && phase === 'listening') listen(); }, 250);
      else setPhase('idle');
    };
    setPhase('listening');
    try { r.start(); } catch (e) { rec = null; setPhase('idle'); }
  }

  function pickVoice() {
    if (!TTS) return null;
    const voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
    const pref = ['Google US English', 'Samantha', 'Microsoft Aria', 'Microsoft Jenny', 'Alex'];
    for (const p of pref) { const v = voices.find((x) => x.name.includes(p)); if (v) return v; }
    return voices[0] || null;
  }

  function speak(text) {
    return new Promise((resolve) => {
      if (!TTS || !crew.ttsOn) { resolve(); return; }
      speechSynthesis.cancel();
      const clean = text.replace(/[*_#`]/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .replace(/SpO₂/g, 'S P O 2').replace(/mg\/dL/g, 'milligrams per deciliter').replace(/mmHg/g, 'millimeters of mercury')
        .replace(/mSv/g, 'millisieverts').replace(/°C/g, 'degrees Celsius').replace(/(\d+)\/(\d+)/g, '$1 over $2');
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = 'en-US';
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = 1.03;
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(safety); resolve(); } };
      const safety = setTimeout(finish, 2500 + clean.split(/\s+/).length * 450);
      u.onend = finish;
      u.onerror = finish;
      setPhase('speaking');
      speechSynthesis.speak(u);
    });
  }

  /* ---------- message handling ---------- */
  async function handle(text) {
    text = text.trim();
    if (!text || busy || !state) return;
    busy = true;
    push('user', text);
    setPhase('thinking');
    let reply;
    let tag;
    try {
      const logs = parseLogs(text);
      if (Object.keys(logs).length) {
        const res = logValues(logs);
        reply = describeLogs(logs, res);
        tag = 'logged';
        if (typeof App !== 'undefined') {
          App.refresh();
          if (res.xp) App.toast(`+${res.xp} XP`);
        }
      } else if (crew.webhookUrl) {
        try {
          reply = await askAI(text);
          tag = 'ai';
        } catch (err) {
          push('system', `AI service unavailable: ${err.message}. Using offline rules.`);
          reply = localReply(text);
          tag = 'offline';
        }
      } else {
        reply = localReply(text);
        tag = 'offline';
      }
    } catch (e) {
      reply = `Sorry, something went wrong: ${e.message}`;
      tag = 'offline';
    }
    push('assistant', reply, tag);
    await speak(reply);
    busy = false;
    if (call.active) listen(); else setPhase('idle');
  }

  async function askAI(text) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(crew.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          user_message: text,
          session_id: state.sessionId,
          astronaut: `${me().name} (${me().role})`,
          health_summary: healthSummary(),
          recent_chat: state.chat.filter((m) => m.role !== 'system').slice(-8).map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); } catch (e) { data = raw; }
      if (data && typeof data === 'object' && data.message === 'Error in workflow') {
        throw new Error('n8n returned "Error in workflow". Open the workflow\'s Executions tab in n8n to see which node failed');
      }
      if (data && typeof data === 'object' && typeof data.error === 'string') throw new Error(data.error);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reply = extractReply(data);
      if (!reply) throw new Error('the response had no "reply" field');
      return reply;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('no answer after 25 s');
      if (e instanceof TypeError) throw new Error('network or CORS error. Check the URL and that the n8n workflow is active');
      throw e;
    } finally {
      clearTimeout(to);
    }
  }

  function extractReply(d) {
    if (d == null) return null;
    if (typeof d === 'string') return d.trim() || null;
    if (Array.isArray(d)) return extractReply(d[0]);
    if (typeof d === 'object') {
      for (const k of ['reply', 'output', 'text', 'response', 'answer', 'message']) {
        if (typeof d[k] === 'string' && d[k].trim()) return d[k].trim();
      }
      if (d.json) return extractReply(d.json);
    }
    return null;
  }

  async function testConnection(url) {
    const prev = crew.webhookUrl;
    crew.webhookUrl = url;
    try {
      const r = await askAI('Connection test from Signos Vitales. Reply with one short sentence.');
      return { ok: true, text: r };
    } catch (e) {
      return { ok: false, text: e.message };
    } finally {
      crew.webhookUrl = prev;
    }
  }

  /* ---------- parse spoken / typed measurements ---------- */
  function parseLogs(input) {
    let t = ' ' + input.toLowerCase().replace(/,/g, ' ').replace(/(\d+)\s+point\s+(\d+)/g, '$1.$2') + ' ';
    if (/\?/.test(t) || /^\s*(what|why|how|is|are|should|can|could|when|do|does|which|tell|explain)\b/.test(t)) return {};
    const out = {};
    const num = '(\\d+(?:\\.\\d+)?)';
    const take = (id, re, idx = 1, mult = 1) => {
      const m = t.match(re);
      if (!m) return;
      let v = parseFloat(m[idx]) * mult;
      if (id === 'temp' && v > 50) v = +((v - 32) / 1.8).toFixed(1); // Fahrenheit -> Celsius
      const lim = IND[id].input;
      if (v >= lim.min && v <= lim.max) out[id] = v;
    };
    const bp = t.match(/(?:blood pressure|pressure|\bbp)\D{0,15}?(\d{2,3})\s*(?:\/|over|\s)\s*(\d{2,3})/);
    if (bp) {
      const s = +bp[1]; const d = +bp[2];
      if (s >= IND.sbp.input.min && s <= IND.sbp.input.max && d >= IND.dbp.input.min && d <= IND.dbp.input.max && s > d) { out.sbp = s; out.dbp = d; }
      t = t.replace(bp[0], ' ');
    }
    take('hr', new RegExp(`(?:heart rate|heartrate|pulse|\\bhr)\\D{0,12}?${num}`));
    take('spo2', new RegExp(`(?:spo2|sp o2|oxygen saturation|saturation|oxygen|\\bo2)\\D{0,12}?${num}`));
    take('glucose', new RegExp(`(?:glucose|blood sugar|sugar)\\D{0,12}?${num}`));
    take('temp', new RegExp(`(?:temperature|\\btemp)\\D{0,12}?${num}`));
    take('sleep', new RegExp(`(?:slept|sleep)\\D{0,12}?${num}`));
    const exH = t.match(new RegExp(`(?:exercised|exercise|workout|worked out|trained|training)\\D{0,12}?${num}\\s*(hours?|hrs?|h\\b|minutes?|mins?)?`));
    if (exH) {
      const v = parseFloat(exH[1]) * (exH[2] && exH[2].startsWith('h') ? 60 : 1);
      if (v >= 0 && v <= IND.exercise.input.max) out.exercise = v;
    } else {
      take('exercise', new RegExp(`${num}\\s*(?:minutes?|mins?)\\s*(?:of\\s*)?(?:exercise|workout|training)`));
    }
    take('rad', new RegExp(`(?:radiation|dosimeter|dose)\\D{0,12}?${num}`));
    take('mood', /mood\D{0,12}?([1-5])\b/);
    return out;
  }

  function describeLogs(logs, res) {
    const parts = [];
    const flagged = [];
    const st = (id) => statusOf(id, logs[id]);
    if (logs.sbp != null && logs.dbp != null) {
      const s = worst([st('sbp'), st('dbp')]);
      parts.push(`blood pressure ${logs.sbp}/${logs.dbp} mmHg (${STATUS_LABEL[s].toLowerCase()})`);
      if (s !== 'green') flagged.push([st('sbp') === s ? 'sbp' : 'dbp', s]);
    }
    Object.keys(logs).filter((k) => k !== 'sbp' && k !== 'dbp').forEach((id) => {
      parts.push(`${IND[id].short.toLowerCase()} ${fmtVal(id, logs[id])} (${STATUS_LABEL[st(id)].toLowerCase()})`);
      if (st(id) !== 'green') flagged.push([id, st(id)]);
    });
    let msg = `Logged ${parts.join(', ')}.`;
    if (res.completed.length) msg += ` Routine task done: ${res.completed.join(', ')}.`;
    if (res.xp) msg += ` +${res.xp} XP.`;
    flagged.sort((a, b) => RANK[b[1]] - RANK[a[1]]);
    if (flagged.length) {
      const [id, s] = flagged[0];
      msg += ` ${IND[id].short} needs attention. ${IND[id].actions[s][0]}.`;
      if (s === 'red') msg += ` If it stays out of range, contact the flight surgeon (signal delay ${envObj().delayLabel}).`;
    } else {
      msg += ' All within normal range.';
    }
    return msg;
  }

  /* ---------- offline rule-based replies ---------- */
  const TOPICS = [
    [/heart|pulse|\bhr\b|cardio/, ['hr']],
    [/blood pressure|pressure|\bbp\b|dizz/, ['sbp', 'dbp']],
    [/oxygen|spo2|saturation|breath|lung|co2/, ['spo2']],
    [/glucose|sugar|diabet|insulin|meal|food|nutrition/, ['glucose']],
    [/temp|fever|cold|flu|sick|infect|immune/, ['temp']],
    [/sleep|tired|fatigue|insomnia|rest\b|exhaust/, ['sleep']],
    [/mood|stress|sad|lonely|anxious|anxiety|homesick|depress|feel|mental|crew conflict/, ['mood']],
    [/exercise|bone|muscle|workout|treadmill|train|fitness/, ['exercise']],
    [/radiation|dose|solar|dosimeter|flare|cosmic|shelter|particle/, ['rad']],
  ];

  function describeIndicator(id) {
    const ind = IND[id];
    const l = latest(id);
    if (!l) return `I don't have any ${ind.short.toLowerCase()} readings yet. ${ind.measure}`;
    const s = statusOf(id, l.value);
    let txt = `Your latest ${ind.short.toLowerCase()} is ${fmtVal(id, l.value)} (${relDay(l.date)}): ${STATUS_LABEL[s].toLowerCase()}, normal range ${rangeText(id)}.`;
    if (s === 'green') txt += ` ${ind.why.split('. ')[0]}.`;
    else txt += ` What to do: ${ind.actions[s].slice(0, 2).join('; ')}.`;
    return txt;
  }

  function overview() {
    const al = buildAlerts();
    const reds = al.filter((a) => a.level === 'red').length;
    const yellows = al.length - reds;
    if (readiness() == null) return 'I don\'t have any readings for you yet. Start with the daily check-in, or tell me a value like "heart rate 70" or "slept 7 hours".';
    let txt = `Readiness ${readiness()}/100 on mission day ${missionDay()}.`;
    if (!al.length) return txt + ' All indicators are within normal range. Keep following your routine.';
    txt += ` ${reds ? `${reds} alert${reds > 1 ? 's' : ''}` : ''}${reds && yellows ? ' and ' : ''}${yellows ? `${yellows} item${yellows > 1 ? 's' : ''} to watch` : ''}.`;
    txt += ` Top priority: ${al[0].title}. ${al[0].actions[0]}.`;
    if (al[1]) txt += ` Next: ${al[1].title.split(':')[0]}.`;
    return txt;
  }

  function localReply(text) {
    const t = text.toLowerCase();
    const env = envObj();
    if (/chest pain|can'?t breathe|cannot breathe|unconscious|faint(ed)?|bleeding|seizure|emergency|harm myself|suicid/.test(t)) {
      return 'This may be an emergency. Alert your crewmates now and start the onboard emergency medical procedure. Then contact the flight surgeon: the signal delay to Earth is ' + env.delayLabel + ', so do not wait for an answer before acting.';
    }
    if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(t.trim()) && t.length < 30) {
      return `Hello ${me().name}. I'm MEDIC, your onboard medical officer. Ask "how am I doing?", ask about any indicator, or log a value like "heart rate 70".`;
    }
    if (/surgeon|doctor|ground|mission control|houston|earth/.test(t)) {
      return `The ground is ${env.delayLabel} away each way from ${env.short}. Open the dashboard and press "Report to flight surgeon" to send a full summary; I can help you in the meantime.`;
    }
    if (/solar particle|storm|shelter/.test(t)) {
      return `If a solar particle event is under way: move to the storm shelter or most shielded area now, postpone spacewalks and surface excursions, and report your dosimeter reading to the flight surgeon and mission control. ${describeIndicator('rad')}`;
    }
    if (/thank/.test(t)) return 'You are welcome. Remember your next routine task on the dashboard.';
    const ids = [];
    TOPICS.forEach(([re, list]) => { if (re.test(t)) list.forEach((id) => { if (!ids.includes(id)) ids.push(id); }); });
    if (/how am i|status|summary|overall|report|doing|today|check/.test(t) || !ids.length) {
      const base = overview();
      return ids.length ? base + ' ' + ids.slice(0, 2).map(describeIndicator).join(' ') : base;
    }
    return ids.slice(0, 2).map(describeIndicator).join(' ');
  }

  /* ---------- wiring ---------- */
  function init() {
    el('btnCall').addEventListener('click', () => (call.active ? endCall() : startCall()));
    el('btnMic').addEventListener('click', () => {
      if (call.active) return;
      if (phase === 'listening' && rec) { try { rec.stop(); } catch (e) { /* ignore */ } return; }
      listen();
    });
    el('composer').addEventListener('submit', (e) => {
      e.preventDefault();
      const i = el('chatInput');
      const v = i.value;
      i.value = '';
      handle(v);
    });
    el('btnClearChat').addEventListener('click', () => { if (!state) return; state.chat = []; save(); renderChat(); });
    const tts = el('ttsToggle');
    tts.checked = !!crew.ttsOn;
    tts.disabled = !TTS;
    tts.addEventListener('change', () => { crew.ttsOn = tts.checked; saveCrew(); if (!tts.checked && TTS) speechSynthesis.cancel(); });
    const sugg = ['How am I doing today?', 'Why is my sleep flagged?', 'Heart rate 72, blood pressure 118 over 76', 'What should I do during a solar particle event?', 'I feel lonely and stressed'];
    el('suggest').innerHTML = sugg.map((s) => `<button type="button" class="chip-btn">${esc(s)}</button>`).join('');
    el('suggest').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) handle(b.textContent); });
    el('srNote').textContent = SR ? 'Voice: your browser\'s built-in speech recognition (free).' : 'Voice input needs Chrome or Edge. You can still type.';
    if (TTS) speechSynthesis.getVoices();
    renderEngine();
    renderChat();
    setPhase('idle');
  }

  function renderEngine() {
    const n = el('engineNote');
    if (!n) return;
    n.innerHTML = crew.webhookUrl
      ? '🟢 Answers from: <b>AI (free Groq LLM)</b>. Health status always comes from the app\'s thresholds.'
      : '⚪ Answers from: <b>offline rules</b>. Add an AI service URL in ⚙ Settings to use a free LLM.';
  }

  return { init, renderChat, renderEngine, testConnection, endCall, isOnCall: () => call.active };
})();
