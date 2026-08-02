// storage.js — localStorage persistence layer.
//
// Everything the app needs to remember (completed workouts, history,
// current streak, last completed date) lives under a single namespaced
// key so it never collides with anything else that might use the same
// local file origin. No server, no cookies, no network calls.

const STORAGE_KEY = "workoutApp:v1";

/** Shape of a fresh install with nothing completed yet. */
function defaultState() {
  return {
    completed: {}, // { "YYYY-MM-DD": { dayKey: "mon", durationMs: 123456 } }
    history: [], // [{ date, dayKey, nameHi, nameEn, durationMs }]
    streak: 0,
    lastCompletedDate: null, // "YYYY-MM-DD"
  };
}

/** Read saved state from localStorage, merging in defaults for any keys
 * that might be missing (e.g. after an app update). */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed);
  } catch (err) {
    console.error("workoutApp: could not read saved data, starting fresh.", err);
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** "YYYY-MM-DD" for a given Date (local time, not UTC). */
function todayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isRestDay(date) {
  const entry = WEEKLY_SCHEDULE[date.getDay()];
  return !entry || entry.rest;
}

/** Walk backwards from (but not including) `date` to find the most recent
 * non-rest day, so completing a streak isn't broken by scheduled rest
 * days. Bounded to 7 days as a safety net. */
function previousWorkoutDateISO(date) {
  const d = new Date(date);
  for (let i = 0; i < 7; i++) {
    d.setDate(d.getDate() - 1);
    if (!isRestDay(d)) return todayISO(d);
  }
  return null;
}

/** Whether the workout for `dayKey` (e.g. "mon") was completed at any point
 * within the week starting at `weekStart` (a Date at Monday 00:00). Checking
 * by dayKey rather than the exact calendar date means the weekly list's
 * checkmark still shows correctly even if someone does e.g. Wednesday's
 * routine a day late — it reflects "was this workout done this week", not
 * "was something done on this exact date". */
function isDayKeyCompletedThisWeek(state, dayKey, weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  return Object.entries(state.completed).some(([dateStr, info]) => {
    if (info.dayKey !== dayKey) return false;
    const d = new Date(`${dateStr}T00:00:00`);
    return d >= weekStart && d < weekEnd;
  });
}

/** Record today's workout as complete: updates completed-days map,
 * history log, and the streak counter (rest days don't break a streak).
 * Persists to localStorage and returns the updated state. */
function markWorkoutComplete(dayKey, nameHi, nameEn, durationMs) {
  const state = loadState();
  const today = todayISO();

  if (!state.completed[today]) {
    const expectedPrev = previousWorkoutDateISO(new Date());
    if (state.lastCompletedDate && state.lastCompletedDate === expectedPrev) {
      state.streak += 1;
    } else {
      state.streak = 1;
    }
    state.lastCompletedDate = today;
  }

  state.completed[today] = { dayKey, durationMs };
  state.history.push({ date: today, dayKey, nameHi, nameEn, durationMs });

  saveState(state);
  return state;
}
