'use strict';
/* Static knowledge base: mission environments, spaceflight hazards, body systems,
   health indicators (ranges, explanations, actions) and the daily routine.
   Ranges are simplified general adult references for an educational prototype. */

const ENVIRONMENTS = {
  iss: {
    name: 'ISS · Low Earth Orbit', short: 'ISS', gravity: 'Microgravity (~0 g)',
    delayLabel: '< 1 s', radBaseline: 0.5,
    desc: "Inside Earth's magnetic field. The crew can get back to Earth within hours.",
  },
  lunar: {
    name: 'Lunar Surface Base', short: 'Moon', gravity: '0.17 g',
    delayLabel: '~1.3 s', radBaseline: 1.4,
    desc: 'No magnetic field or atmosphere. Signals take about 1.3 seconds to reach Earth.',
  },
  transit: {
    name: 'Mars Transit', short: 'Mars transit', gravity: 'Microgravity (~0 g)',
    delayLabel: '~12 min (3–22)', radBaseline: 1.8,
    desc: 'Deep space: the highest radiation and no quick way home. Messages take 3 to 22 minutes each way.',
  },
  mars: {
    name: 'Mars Surface Base', short: 'Mars', gravity: '0.38 g',
    delayLabel: '~12 min (3–22)', radBaseline: 0.7,
    desc: 'A thin atmosphere gives some shielding. Dust, partial gravity and long delays to Earth.',
  },
};

const HAZARDS = {
  radiation: {
    name: 'Space radiation', icon: '☢️',
    text: "Outside Earth's protective magnetic field, crews are exposed to galactic cosmic rays and solar particle events. Exposure raises long-term cancer risk and can affect the nervous system, heart and immune system.",
  },
  isolation: {
    name: 'Isolation & confinement', icon: '🏠',
    text: 'Small crews live and work in tight quarters for months. Disrupted sleep, heavy workload and separation from family can lead to fatigue, stress, low mood and conflict.',
  },
  distance: {
    name: 'Distance from Earth', icon: '📡',
    text: 'On a Mars mission a message can take up to ~22 minutes each way and resupply is impossible, so the crew must detect and handle medical problems on their own.',
  },
  gravity: {
    name: 'Gravity fields', icon: '🪐',
    text: 'Microgravity and partial gravity weaken bones and muscles, shift body fluids toward the head and decondition the heart. Moving between gravity fields affects balance and orientation.',
  },
  environment: {
    name: 'Hostile, closed environment', icon: '🛰️',
    text: "The spacecraft is the crew's life support. Air quality (CO₂), temperature, noise, lighting and microbes all affect health, sleep and immunity.",
  },
};

const SYSTEMS = {
  brain: {
    name: 'Brain & behavior', icon: '🧠', indicators: ['sleep', 'mood'], hazards: ['isolation', 'distance'],
    desc: 'Sleep and mood drive alertness, decision-making and crew cohesion. This matters most when the crew has to solve problems on its own.',
  },
  cardio: {
    name: 'Cardiovascular', icon: '❤️', indicators: ['hr', 'sbp', 'dbp'], hazards: ['gravity', 'radiation'],
    desc: 'Without gravity, body fluids shift toward the head and the heart and blood vessels decondition, changing heart rate and blood pressure.',
  },
  resp: {
    name: 'Respiratory', icon: '🫁', indicators: ['spo2'], hazards: ['environment'],
    desc: "Breathing depends on the cabin's life-support system. Blood oxygen saturation shows how well oxygen reaches the body.",
  },
  immune: {
    name: 'Immune & temperature', icon: '🛡️', indicators: ['temp'], hazards: ['radiation', 'environment'],
    desc: 'Spaceflight changes immune function, and closed habitats help germs spread. Body temperature is an early sign of infection.',
  },
  metabolic: {
    name: 'Metabolism & nutrition', icon: '🍽️', indicators: ['glucose'], hazards: ['environment', 'distance'],
    desc: 'A limited diet, stress and inactivity change how the body handles sugar and nutrients.',
  },
  musculo: {
    name: 'Bones & muscles', icon: '🦴', indicators: ['exercise'], hazards: ['gravity'],
    desc: 'Bones and muscles weaken without the load of gravity. Daily exercise is the main way to prevent it.',
  },
  radiation: {
    name: 'Radiation exposure', icon: '☢️', indicators: ['rad'], hazards: ['radiation'],
    desc: 'Daily dose from cosmic rays and solar particle events, read from your personal dosimeter.',
  },
};

const INDICATORS = [
  {
    id: 'hr', name: 'Resting heart rate', short: 'Heart rate', unit: 'bpm', system: 'cardio', decimals: 0,
    input: { min: 25, max: 220, step: 1 },
    ranges: () => ({ green: [50, 90], yellow: [40, 110] }),
    why: 'In microgravity the heart works less against gravity and the cardiovascular system deconditions. A rising resting heart rate can signal fatigue, dehydration, stress, infection or deconditioning.',
    measure: 'Chest strap or smartwatch, or count your pulse at the wrist for 60 seconds after 5 minutes of rest, before leaving the sleep station.',
    actions: {
      yellow: ['Re-measure after 5 minutes of quiet rest', 'Drink 250–500 mL of water', 'Review your sleep and workload over the last 3 days'],
      red: ['Stop strenuous activity and rest', 'Re-measure in 10 minutes and check blood pressure and SpO₂', 'If it stays out of range, or with chest pain, dizziness or shortness of breath, contact the flight surgeon'],
    },
  },
  {
    id: 'sbp', name: 'Systolic blood pressure', short: 'Systolic BP', unit: 'mmHg', system: 'cardio', decimals: 0,
    input: { min: 60, max: 240, step: 1 },
    ranges: () => ({ green: [90, 129], yellow: [85, 139] }),
    why: 'Fluid shifts and reduced gravity change how the body regulates blood pressure. Low pressure can cause dizziness on return to gravity; high pressure strains the heart and blood vessels.',
    measure: 'Automatic arm cuff, seated, arm at heart level, after 5 minutes of rest. Take two readings 1 minute apart and log the average.',
    actions: {
      yellow: ['Re-measure following the protocol', "Limit sodium in today's meals and stay hydrated", 'Do a 5-minute breathing exercise and re-check'],
      red: ['If high: rest, avoid exertion and re-measure in 15 minutes', 'If low: lie down with legs raised and drink fluids with electrolytes', 'If it persists or comes with headache, vision changes or fainting, contact the flight surgeon'],
    },
  },
  {
    id: 'dbp', name: 'Diastolic blood pressure', short: 'Diastolic BP', unit: 'mmHg', system: 'cardio', decimals: 0,
    input: { min: 30, max: 150, step: 1 },
    ranges: () => ({ green: [60, 84], yellow: [55, 89] }),
    why: 'Diastolic pressure is the pressure while the heart relaxes between beats. Together with systolic pressure it shows how the cardiovascular system is adapting to spaceflight.',
    measure: 'Measured together with systolic pressure using the arm cuff (same protocol).',
    actions: {
      yellow: ['Re-measure following the protocol', 'Stay hydrated and limit sodium', 'Do a 5-minute breathing exercise and re-check'],
      red: ['Rest and re-measure in 15 minutes', 'Check heart rate and note any symptoms', 'If it persists, contact the flight surgeon'],
    },
  },
  {
    id: 'spo2', name: 'Blood oxygen (SpO₂)', short: 'SpO₂', unit: '%', system: 'resp', decimals: 0,
    input: { min: 50, max: 100, step: 1 },
    ranges: () => ({ green: [95, 100], yellow: [92, 100] }),
    why: 'Oxygen saturation shows how well the lungs deliver oxygen. In a sealed cabin, life-support problems (low O₂, high CO₂) or a respiratory infection can lower it.',
    measure: 'Fingertip pulse oximeter at rest, warm hand, holding still for 30 seconds.',
    actions: {
      yellow: ['Re-measure on another finger with a warm hand', 'Check cabin O₂ and CO₂ on the life-support panel', 'Take slow, deep breaths for 2 minutes'],
      red: ['Check life-support alarms now and alert the crew', 'Use supplemental oxygen per protocol if available', 'Contact the flight surgeon'],
    },
  },
  {
    id: 'temp', name: 'Body temperature', short: 'Body temp', unit: '°C', system: 'immune', decimals: 1,
    input: { min: 33, max: 43, step: 0.1 },
    ranges: () => ({ green: [36.1, 37.5], yellow: [35.5, 38.0] }),
    why: 'Spaceflight alters immune function and closed habitats help microbes spread. A fever can be an early sign of infection. Core temperature also tends to run slightly higher on long missions.',
    measure: 'Digital thermometer (oral or forehead) at the same time each morning, before exercise.',
    actions: {
      yellow: ['Re-measure in 30 minutes, away from exercise and heaters', 'Hydrate and rest', 'Note any symptoms: cough, sore throat, fatigue'],
      red: ['Keep distance from crewmates where possible and wear a mask', 'Hydrate, rest and re-measure every 2 hours', 'Contact the flight surgeon: a fever above 38 °C needs medical guidance'],
    },
  },
  {
    id: 'glucose', name: 'Blood glucose (fasting)', short: 'Glucose', unit: 'mg/dL', system: 'metabolic', decimals: 0,
    input: { min: 20, max: 500, step: 1 },
    ranges: () => ({ green: [70, 99], yellow: [60, 125] }),
    why: 'Spaceflight can reduce insulin sensitivity, and a limited diet, stress and inactivity affect blood sugar. Stable glucose supports energy and mental performance.',
    measure: 'Finger-stick glucometer, fasting (before breakfast), with a clean and dry finger.',
    actions: {
      yellow: ['If high: review your last meal, add a short exercise session and re-check in 2 hours', 'If low: take 15 g of fast carbohydrates and re-check in 15 minutes', 'Keep regular meal times'],
      red: ['If below 60 mg/dL: take 15–20 g of fast carbohydrates now, re-check in 15 minutes and do not work alone', 'If 126 mg/dL or higher fasting: re-test and, if confirmed, report to the flight surgeon', 'Watch for confusion, sweating or tremor and alert a crewmate'],
    },
  },
  {
    id: 'sleep', name: 'Sleep last night', short: 'Sleep', unit: 'h', system: 'brain', decimals: 1,
    input: { min: 0, max: 16, step: 0.1 },
    ranges: () => ({ green: [7, 9], yellow: [6, 10] }),
    why: 'Sunrises every 90 minutes in orbit, noise, workload and stress disrupt sleep. Sleep loss impairs attention, mood and immunity and raises the risk of mistakes.',
    measure: 'Sleep-tracking wearable, or your own estimate of hours actually asleep in the sleep station.',
    actions: {
      yellow: ['Dim the lights and avoid screens 1 hour before sleep', 'Keep a fixed sleep window and use an eye mask and earplugs', 'Avoid caffeine in the 6 hours before sleep'],
      red: ['Tell the commander: fatigue raises the risk of mistakes in critical tasks', 'Schedule a protected 8-hour sleep window tonight', 'If sleep problems last 3 or more nights, talk to the flight surgeon'],
    },
  },
  {
    id: 'mood', name: 'Mood', short: 'Mood', unit: '/5', system: 'brain', decimals: 0,
    input: { min: 1, max: 5, step: 1 },
    ranges: () => ({ green: [4, 5], yellow: [3, 5] }),
    why: 'Isolation, confinement and distance from home can lead to stress, low mood and conflict. Honest daily self-checks catch problems before they affect you, the crew or the mission.',
    measure: 'Daily self-rating from 1 (very low) to 5 (great).',
    actions: {
      yellow: ['Take a 10-minute break: music, the view from a window or a call home', 'Talk with a crewmate about how you feel', 'Try a short guided breathing exercise'],
      red: ['Reach out today to the crew medical officer or a crewmate you trust', 'Schedule a private conference with the ground support team', 'If you have thoughts of harming yourself, tell the crew right away'],
    },
  },
  {
    id: 'exercise', name: 'Exercise today', short: 'Exercise', unit: 'min', system: 'musculo', decimals: 0,
    input: { min: 0, max: 400, step: 5 },
    ranges: () => ({ green: [120, Infinity], yellow: [60, Infinity] }),
    why: 'Without the load of gravity, astronauts can lose about 1–1.5% of bone mineral density per month, plus muscle and aerobic fitness. About 2 hours a day of resistance and aerobic exercise is the main countermeasure.',
    measure: 'Log your minutes on the resistance device, treadmill or exercise bike.',
    actions: {
      yellow: ['Add a session today to reach 120 minutes', 'Prioritize resistance work: squats, deadlifts, heel raises', 'Eat enough protein, calcium and vitamin D'],
      red: ["Re-plan today's schedule to include at least 90 minutes of exercise", 'Discuss what is getting in the way (pain, fatigue, workload) with the commander', 'Report any pain or injury to the flight surgeon'],
    },
  },
  {
    id: 'rad', name: 'Radiation dose', short: 'Radiation', unit: 'mSv/day', system: 'radiation', decimals: 2,
    input: { min: 0, max: 100, step: 0.01 },
    ranges: (env) => ({ green: [0, +(env.radBaseline * 1.5).toFixed(2)], yellow: [0, +(env.radBaseline * 3).toFixed(2)] }),
    why: "Beyond Earth's magnetic field, cosmic rays and solar particle events raise the radiation dose. A reading far above the usual level for your location may mean a solar particle event is under way.",
    measure: "Personal dosimeter worn on the body. Log the day's dose in millisieverts (mSv).",
    actions: {
      yellow: ['Check space-weather alerts from the ground or onboard monitors', 'Limit time in lightly shielded areas (EVA, cupola, rover)', 'Keep logging daily to track your mission total'],
      red: ['Possible solar particle event: move to the storm shelter or most shielded area now', 'Postpone spacewalks and surface excursions', 'Report the reading to the flight surgeon and mission control'],
    },
  },
];

const IND = Object.fromEntries(INDICATORS.map((i) => [i.id, i]));

const ROUTINE = [
  { id: 'sleep', time: '07:00', title: "Log last night's sleep", detail: 'Hours actually asleep', ids: ['sleep'], xp: 10 },
  { id: 'vitals', time: '07:15', title: 'Morning vitals', detail: 'Heart rate, blood pressure, SpO₂, temperature', ids: ['hr', 'sbp', 'dbp', 'spo2', 'temp'], xp: 40 },
  { id: 'glucose', time: '07:30', title: 'Fasting glucose', detail: 'Finger-stick before breakfast', ids: ['glucose'], xp: 15 },
  { id: 'dosimeter', time: '08:00', title: 'Read your dosimeter', detail: "Yesterday's dose in mSv", ids: ['rad'], xp: 10 },
  { id: 'exercise', time: '18:00', title: 'Exercise log', detail: 'Target: 120 min of resistance + aerobic', ids: ['exercise'], xp: 20 },
  { id: 'mood', time: '21:00', title: 'Evening mood check', detail: 'Rate how you feel from 1 to 5', ids: ['mood'], xp: 10 },
];

const MOOD = {
  1: { e: '😞', l: 'Very low' }, 2: { e: '🙁', l: 'Low' }, 3: { e: '😐', l: 'Okay' },
  4: { e: '🙂', l: 'Good' }, 5: { e: '😄', l: 'Great' },
};

const STATUS_LABEL = { green: 'Normal', yellow: 'Watch', red: 'Alert', unknown: 'No data' };

const CAREER_LIMIT_MSV = 600; // NASA career effective dose limit

const SOURCES = [
  { title: 'NASA HRP: 5 Hazards of Human Spaceflight', url: 'https://www.nasa.gov/hrp/hazards/' },
  { title: 'NASA HRP: Risks of Human Spaceflight', url: 'https://www.nasa.gov/hrp/risks/' },
  { title: 'NASA HRP: Ongoing research in space', url: 'https://www.nasa.gov/hrp/ongoing-hrp-research/' },
  { title: 'CSA: Monitoring radiation for astronaut health', url: 'https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp' },
  { title: 'CSA: Why do we conduct science experiments in space?', url: 'https://www.asc-csa.gc.ca/eng/iss/science/why-do-we-conduct-science-experiments-in-space.asp' },
  { title: 'Space Apps 2026 challenge: Health Monitoring Software', url: 'https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/' },
];
