/**
 * MEDIC AI proxy: Cloudflare Worker (free tier).
 *
 * Receives the JSON that Signos Vitales sends, asks a free Groq LLM for a short
 * spoken-style answer and returns { "reply": "..." }.
 * The Groq API key lives in the Worker secret GROQ_API_KEY and is never sent to the browser.
 *
 * Request:  POST { user_message, astronaut, health_summary, recent_chat: [{role, text}] }
 * Response: 200 { reply } | 4xx/5xx { error }
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']; // fallback if one is retired
const MAX_MESSAGE_CHARS = 1000;
const MAX_HISTORY = 8;
const RATE_LIMIT = { windowMs: 60_000, max: 20 }; // per IP, per Worker instance (best effort)
const hits = new Map();

const SYSTEM_PROMPT = `You are MEDIC, the onboard AI medical officer of a crewed space mission. You talk with the astronaut by voice.

Rules:
- Answer in English, in 1 to 3 short sentences that sound natural when read aloud. No markdown, lists, emojis or headings.
- Use ONLY the health data provided. Each indicator's status (Normal / Watch / Alert) was computed by the app's thresholds: never contradict it, never invent values, never diagnose.
- For an Alert, give the single most important action first, then remind the astronaut to report it to the flight surgeon, keeping the signal delay to Earth in mind.
- If the astronaut mentions an emergency (chest pain, can't breathe, fainting, heavy bleeding, thoughts of self-harm), tell them to alert the crew immediately and start the onboard emergency procedure.
- Be warm and encouraging, especially about mood, sleep and isolation.`;

function allowedOrigin(origin, env) {
  if (!origin) return null;
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*') || list.includes(origin)) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin; // local development
  return null;
}

function cors(origin, env) {
  const ok = allowedOrigin(origin, env);
  return {
    'Access-Control-Allow-Origin': ok || 'null',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_LIMIT.max;
}

function buildMessages(body) {
  const userMessage = String(body.user_message || '').slice(0, MAX_MESSAGE_CHARS).trim();
  const astronaut = String(body.astronaut || 'Astronaut').slice(0, 80);
  const summary = JSON.stringify(body.health_summary || {}).slice(0, 6000);
  const history = (Array.isArray(body.recent_chat) ? body.recent_chat : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .map((m) => ({ role: m.role, content: m.text.slice(0, MAX_MESSAGE_CHARS) }));
  // the app already includes the current question as the last history entry
  const last = history[history.length - 1];
  if (last && last.role === 'user' && last.content.trim() === userMessage) history.pop();
  return {
    userMessage,
    messages: [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\nAstronaut: ${astronaut}\nHealth data (JSON): ${summary}` },
      ...history.slice(-MAX_HISTORY),
      { role: 'user', content: userMessage },
    ],
  };
}

let workingModel = null; // remembered per Worker instance once a model answers
let discovered = null;    // { at, ids }

/** Ask Groq which models this key can use and rank the chat-capable ones. */
async function discoverModels(env) {
  if (discovered && Date.now() - discovered.at < 3600_000) return discovered.ids;
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Groq ${res.status}: ${data.error?.message || 'could not list models'}`);
  const notChat = /whisper|guard|tts|playai|orpheus|prompt-guard|embed|distil|vision|compound|safeguard/i;
  const rank = [/gpt-oss-120b/i, /llama-4/i, /llama.*70b/i, /gpt-oss/i, /qwen/i, /llama/i, /kimi|deepseek|mistral|gemma/i];
  const score = (id) => { const i = rank.findIndex((re) => re.test(id)); return i === -1 ? rank.length : i; };
  const ids = (data.data || [])
    .filter((m) => m && m.id && m.active !== false && !notChat.test(m.id))
    .map((m) => m.id)
    .sort((a, b) => score(a) - score(b));
  discovered = { at: Date.now(), ids };
  return ids;
}

async function askGroq(messages, env) {
  const first = [env.GROQ_MODEL, workingModel, ...DEFAULT_MODELS].filter(Boolean);
  const tried = new Set();
  let lastError = 'no model available';
  let models = [...new Set(first)];
  let usedDiscovery = false;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    if (tried.has(model)) continue;
    tried.add(model);
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages, temperature: 0.4, max_tokens: 1024,
        ...(/gpt-oss/i.test(model) ? { reasoning_effort: 'low', include_reasoning: false } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const choice = data.choices?.[0];
      let reply = choice?.message?.content?.trim();
      if (reply && choice.finish_reason === 'length') { // cut off: keep complete sentences only
        const end = Math.max(reply.lastIndexOf('. '), reply.lastIndexOf('! '), reply.lastIndexOf('? '));
        if (end > 40) reply = reply.slice(0, end + 1);
      }
      if (reply) { workingModel = model; return { reply, model }; }
      lastError = 'the model returned an empty answer';
    } else {
      lastError = `Groq ${res.status}: ${data.error?.message || res.statusText}`;
      if (res.status === 401 || res.status === 429) break; // bad key / rate limited: other models won't help
      if (model === workingModel) workingModel = null;
    }
    // ran out of known names (e.g. models retired): ask Groq what is available now
    if (i === models.length - 1 && !usedDiscovery) {
      usedDiscovery = true;
      try { models = models.concat((await discoverModels(env)).filter((m) => !tried.has(m)).slice(0, 4)); } catch (e) { lastError = e.message; }
    }
  }
  throw new Error(lastError);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = cors(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method === 'GET') {
      return json({ ok: true, service: 'MEDIC AI proxy', keyConfigured: !!env.GROQ_API_KEY, model: workingModel }, 200, headers);
    }
    if (request.method !== 'POST') return json({ error: 'Use POST' }, 405, headers);
    if (origin && !allowedOrigin(origin, env)) return json({ error: 'Origin not allowed' }, 403, headers);
    if (!env.GROQ_API_KEY) return json({ error: 'GROQ_API_KEY secret is not set on the Worker' }, 500, headers);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return json({ error: 'Too many requests. Wait a minute and try again' }, 429, headers);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'Body must be JSON' }, 400, headers); }
    const { userMessage, messages } = buildMessages(body);
    if (!userMessage) return json({ error: 'user_message is required' }, 400, headers);

    try {
      const { reply, model } = await askGroq(messages, env);
      return json({ reply, model }, 200, headers);
    } catch (e) {
      return json({ error: e.message }, 502, headers);
    }
  },
};
