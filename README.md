# Signos Vitales: Astronaut Health Monitor

**NASA Space Apps Challenge 2026 · [Create Health Monitoring Software for Astronauts on Space Missions](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/)**

On long missions, astronauts are responsible for spotting health changes in themselves. On the way to Mars, a message to the flight surgeon can take up to 22 minutes each way. Signos Vitales is a visual self-assessment tool. It helps a crew member **measure → assess → act → ask**:

| Step | What the app does |
|---|---|
| **Measure** | A daily routine prompts each measurement: sleep, morning vitals, fasting glucose, dosimeter, exercise and mood. Values can be typed, synced from a (simulated) wearable, or **spoken** to the AI. |
| **Assess** | Every value is compared with a **green / yellow / red** range. A clickable **body map** colors each body system by its worst indicator, and a **readiness score** summarizes the day. |
| **Act** | Every yellow or red result comes with concrete steps. Red results are flagged for the flight surgeon, and a one-click **report** shows the signal delay to Earth. |
| **Ask** | **MEDIC**, the onboard AI medical officer, explains results by chat or by a **voice call**, and logs values hands-free ("heart rate 72, blood pressure 118 over 76"). |

## Crew login (onboard crew tablet)

The app runs as a shared **crew health station**. Each astronaut has a profile protected by a **4–6 digit PIN**, and their health data, XP and MEDIC conversation are stored separately.

- **Who is checking in?** Pick your profile and enter your PIN on the keypad. You can also **add a crew member** with a name, role, avatar and PIN.
- **Roles:** Commander, Flight Engineer, Mission Specialist and Crew Medical Officer. The **Commander** and the **Crew Medical Officer** also get the **👥 Crew** tab:
  - every astronaut's readiness, body-system status and top alerts, with whoever needs attention first
  - check-in progress and mission radiation dose
  - a combined **crew report to the flight surgeon**
  - the Commander can also remove members
- **🔒 Lock / switch** button in the header. The tablet also **auto-locks after 5 minutes** of inactivity, except during a voice call.
- **Works offline.** Everything is stored on the device (`localStorage`), with no server and no internet needed. Chart.js is bundled in `vendor/`.

**Demo crew** (fictional, each with a different health story):

| Astronaut | Role | PIN | Story |
|---|---|---|---|
| Rivera | Commander | `1111` | sleep debt, mood dip, resting HR trending up |
| Okafor | Flight Engineer | `2222` | healthy: all green |
| Tanaka | Mission Specialist | `3333` | fever starting, elevated heart rate |
| Haddad | Crew Medical Officer | `4444` | skipping exercise (bone loss risk), BP rising |

**Security notes (prototype):**
- PINs are never stored in plain text. Only a salted PBKDF2-SHA256 hash is kept (100,000 iterations, random salt per astronaut).
- Five wrong PINs lock that profile for 30 seconds.
- Locking clears the previous astronaut's data from the screen.
- Health data in `localStorage` is **not encrypted**, so anyone with developer tools on the device can read it. A production version would encrypt each profile with a key derived from the PIN and sync to the ground over a secure link.
- PIN login needs a secure page (HTTPS, or `http://localhost`), which GitHub Pages provides.

## Features mapped to the challenge

- **Visual self-assessment tool**: body map, color-coded tiles, readiness ring.
- **Indicators named in the challenge**: blood pressure, heart rate, blood sugar, body temperature, sleep hours and mood. Also SpO₂, exercise minutes and radiation dose.
- **Links to the NASA HRP hazards**: each body system shows which of the 5 hazards affect it. The Learn tab explains each hazard and indicator.
- **"When does a result need attention?"**: thresholds, trend detection (e.g. resting heart rate rising week over week, sleep debt) and escalation to the flight surgeon.
- **Different environments**: ISS, lunar base, Mars transit and Mars base, each with its own gravity, signal delay and normal radiation level.
- **Periodic prompts**: the daily routine with due times.
- **Gamification**: XP, levels, streaks and achievements.
- **Dynamic charts**: trends over 7, 14 or 30 days, with normal and watch ranges shaded.
- **Simple instructions**: "How to measure aboard" and "Why it matters in space" for every indicator.

## Run it

No build step and no dependencies. Serve the folder over HTTP; the microphone needs `localhost` or HTTPS.

```bash
cd signosvitales
python3 -m http.server 8000
# open http://localhost:8000 in Chrome or Edge (needed for voice input)
```

The app starts with a 4-person demo crew and 30 days of **simulated** data each (see the table above). All of them saw the same solar particle event a week ago. Everything is saved in the browser's `localStorage`. The Commander can restore the demo crew from **⚙ Settings → Reset demo crew**.

Deep links: `#dashboard`, `#checkin`, `#trends`, `#assistant`, `#learn`.

## AI medical officer: free LLM through n8n (optional)

Without any setup, MEDIC answers with built-in offline rules. For natural conversation, connect it to an n8n workflow that uses a free LLM.

**How the pieces fit:**

```
Browser (Web Speech API speech-to-text) ──POST JSON──▶ n8n Webhook ─▶ AI Agent (Groq or Gemini, free tier) ─▶ Respond to Webhook
       ▲                                                                                                            │
       └──────────────────────── { "reply": "..." } ◀─────────────────────────────────────────────────────────────────┘
Browser speaks the reply (speechSynthesis)
```

Speech-to-text and text-to-speech run free in the browser. n8n only handles text.

### Build the workflow in n8n

1. **Webhook** node
   - HTTP Method: `POST` · Path: `medic`
   - Respond: **Using 'Respond to Webhook' Node**
   - Options → **Allowed Origins (CORS)**: `*` (or `http://localhost:8000`)
2. **AI Agent** node
   - Source for Prompt: **Define below** · Prompt: `{{ $json.body.user_message }}`
     > ⚠️ The data you send is under **`body`**. `{{ $json.user_message }}` comes back empty and the agent fails with *"Error in workflow"*.
   - Options → **System Message**:
     ```
     You are MEDIC, the onboard AI medical officer of a space mission. Speak in English,
     in 1–3 short sentences suitable for being read aloud. Use ONLY the health data below.
     The status of each indicator (Normal/Watch/Alert) was computed by the app: never
     contradict it and never diagnose. For any Alert, give the first concrete action and
     remind the astronaut to contact the flight surgeon, considering the signal delay.
     For emergencies (chest pain, cannot breathe, unconscious), tell them to alert the crew immediately.

     Astronaut: {{ $json.body.astronaut }}
     Health data: {{ JSON.stringify($json.body.health_summary) }}
     ```
   - **Chat Model** sub-node, either:
     - **Groq Chat Model**: free API key at console.groq.com, model `llama-3.3-70b-versatile`, or
     - **Google Gemini Chat Model**: free API key at aistudio.google.com, a `gemini-*-flash` model.
   - *(Optional)* **Simple Memory** sub-node, Session Key: `{{ $('Webhook').item.json.body.session_id }}`
3. **Respond to Webhook** node
   - Respond With: **JSON** · Response Body:
     ```
     { "reply": {{ JSON.stringify($json.output) }} }
     ```
4. **Activate** the workflow and copy the **Production URL** (`/webhook/medic`, not `/webhook-test/`).
5. In the app: **⚙ Settings → AI webhook URL** → paste the URL → **Test connection** → **Save**.

Free-tier rate limits change; check Groq's or Google's current limits before the demo. If the AI is unreachable, MEDIC says so in the chat and falls back to offline rules, so the demo keeps working.

### Request the app sends

```json
{
  "user_message": "Why is my sleep flagged?",
  "session_id": "sv-ab12cd34",
  "astronaut": "Cmdr. Rivera",
  "health_summary": {
    "mission_day": 42, "environment": "Mars Transit", "signal_delay_to_earth": "~12 min (3–22)",
    "readiness_score": 72,
    "indicators": [{ "name": "Sleep last night", "value": 5.6, "unit": "h", "status": "Alert", "normal_range": "7–9 h", "measured": "yesterday" }],
    "alerts": ["RED: Sleep last night: 5.6 h"]
  },
  "recent_chat": [{ "role": "user", "text": "..." }]
}
```

The app reads `reply` from the response (it also accepts `output`, `text` or `response`).

Test from the terminal:

```bash
curl -X POST "https://YOUR-INSTANCE.app.n8n.cloud/webhook/medic" \
  -H "Content-Type: application/json" \
  -d '{"user_message":"How am I doing?","health_summary":{"readiness_score":72}}'
```

## Demo script (≈2 minutes)

0. **Login**: "This is the crew tablet." Pick **Rivera**, enter PIN `1111`.
1. **Dashboard**: "Day 42 of a Mars transit. Readiness 72. The brain glows red." Click it: sleep at 5.6 h is red and trending down, with steps to take right now.
2. **Alerts**: show the heart-rate *trend* alert, which looks at the week, not a single reading. Open **Report to flight surgeon** and point out the 12-minute delay.
3. **Mission selector**: switch to ISS. The Earth delay drops to under 1 s and the radiation baseline changes.
4. **Trends → Radiation**: the solar particle event spike a week ago.
5. **AI Medical Officer → Start call**: say *"Heart rate 74, blood pressure 121 over 79"* (logged, +XP), then *"Why am I so tired?"*.
6. **Check-in**: "Sync wearable" fills in the vitals and the routine ticks off. Unlock achievements.
7. **👥 Crew**: as Commander, show the whole crew. Tanaka has a fever and is listed first. Send the **crew report** to the flight surgeon.
8. **🔒 Lock** and log in as **Tanaka** (`3333`): a different astronaut with different data, and no Crew tab for a Mission Specialist.

## Project structure

```
index.html        layout and body-map SVG
css/styles.css    dark "mission control" theme, responsive
vendor/           Chart.js 4.4.1 (bundled so the app works offline)
js/auth.js        crew login screen: profile picker, PIN keypad, add member, lock / auto-lock
js/crew.js        crew overview for Commander / Crew Medical Officer
js/data.js        knowledge base: environments, hazards, systems, indicators, ranges, actions, routine
js/store.js       crew roster, PIN hashing, per-astronaut storage, simulated history, status/alerts/trends/XP/report logic
js/charts.js      Chart.js line charts with shaded normal/watch bands
js/assistant.js   MEDIC: chat, voice call loop, value parsing, n8n client, offline rules
js/app.js         rendering and interaction for every tab
```

## Data & sources

- NASA Human Research Program: [5 Hazards of Human Spaceflight](https://www.nasa.gov/hrp/hazards/), [Risks](https://www.nasa.gov/hrp/risks/), [Ongoing research](https://www.nasa.gov/hrp/ongoing-hrp-research/)
- Canadian Space Agency: [Monitoring radiation for astronaut health](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp), [Why do we conduct science experiments in space?](https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp)
- Health data in the app is **simulated**. Normal ranges are simplified general adult references, and radiation baselines are approximate published averages for each environment.

> **Disclaimer:** educational hackathon prototype, not a medical device.
